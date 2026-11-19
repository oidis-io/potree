/*! ******************************************************************************************************** *
 *
 * Copyright 2026 Oidis
 *
 * SPDX-License-Identifier: BSD-2-Clause
 * The BSD-2-Clause license for this file can be found in the LICENSE.txt file included with this distribution
 * or at https://spdx.org/licenses/BSD-2-Clause.html#licenseText
 *
 * ********************************************************************************************************* */

import { findStorageDirectory, isBrowserFileStorageSupported, openStorageDirectory, readStorageFile, writeStorageFile } from "./BrowserFileStorage.js";
import { hashText } from "./HashText.js";

const ROOT_DIRECTORY_NAME = "utility-network-editor-point-clouds";
const METADATA_FILE_NAME = "metadata.json";
const OPENED_FILE_NAME = "opened.json";
const STORE_FORMAT_VERSION = 1;
const MAXIMUM_STORED_POINT_CLOUDS = 3;
const STALE_ENTRY_MILLISECONDS = 10 * 60 * 1000;
const ARRAY_FILES = Object.freeze([
    { property: "positions", fileName: "positions.bin", arrayType: Float32Array },
    { property: "colors", fileName: "colors.bin", arrayType: Uint8Array },
    { property: "intensities", fileName: "intensities.bin", arrayType: Uint16Array },
    { property: "classifications", fileName: "classifications.bin", arrayType: Uint8Array }
]);

export function createStorageKey(file, maximumPointCount) {
    return hashText([file.name, file.size, file.lastModified, maximumPointCount, STORE_FORMAT_VERSION].join("\n"));
}

async function readMetadata(directory) {
    const metadata = JSON.parse(await (await readStorageFile(directory, METADATA_FILE_NAME)).text());
    return metadata.formatVersion === STORE_FORMAT_VERSION ? metadata : null;
}

async function writeMetadata(directory, metadata) {
    await writeStorageFile(directory, METADATA_FILE_NAME, JSON.stringify(metadata));
}

async function readOpenedAt(directory) {
    try {
        return Number(await (await readStorageFile(directory, OPENED_FILE_NAME)).text()) || null;
    } catch {
        return null;
    }
}

async function readNewestModification(directory) {
    let newestModification = 0;
    try {
        for await (const [, handle] of directory.entries()) {
            if (handle.kind === "file") {
                newestModification = Math.max(newestModification, (await handle.getFile()).lastModified);
            }
        }
    } catch {
        return Date.now();
    }
    return newestModification > 0 ? newestModification : Date.now();
}

export class PointCloudStore {
    static isSupported() {
        return isBrowserFileStorageSupported();
    }

    static async requestPersistence() {
        if (typeof navigator.storage?.persist !== "function") {
            return false;
        }
        return (await navigator.storage.persisted()) || navigator.storage.persist();
    }

    getRootDirectory() {
        return openStorageDirectory(ROOT_DIRECTORY_NAME);
    }

    async findDirectory(storageKey) {
        return findStorageDirectory(await this.getRootDirectory(), storageKey);
    }

    async readEntries() {
        const root = await this.getRootDirectory();
        const entries = [];
        for await (const [name, handle] of root.entries()) {
            if (handle.kind !== "directory") {
                continue;
            }
            const metadata = await readMetadata(handle).catch(() => null);
            entries.push({
                name: name,
                metadata: metadata,
                lastOpenedAt: metadata ? (await readOpenedAt(handle)) ?? metadata.lastOpenedAt : null,
                lastModification: metadata ? null : await readNewestModification(handle)
            });
        }
        return entries;
    }

    async list() {
        const entries = await this.readEntries();
        return entries
            .filter((entry) => entry.metadata !== null)
            .map((entry) => ({ ...entry.metadata, lastOpenedAt: entry.lastOpenedAt }))
            .sort((first, second) => second.lastOpenedAt - first.lastOpenedAt);
    }

    async load(storageKey) {
        const directory = await this.findDirectory(storageKey);
        const metadata = directory ? await readMetadata(directory).catch(() => null) : null;
        if (!metadata) {
            return null;
        }
        const cloud = {
            pointCount: metadata.pointCount,
            sourcePointCount: metadata.sourcePointCount,
            origin: metadata.origin,
            minimum: metadata.minimum,
            maximum: metadata.maximum,
            intensityRange: metadata.intensityRange
        };
        for (const arrayFile of ARRAY_FILES) {
            cloud[arrayFile.property] = metadata.arrayProperties.includes(arrayFile.property)
                ? new arrayFile.arrayType(await (await readStorageFile(directory, arrayFile.fileName)).arrayBuffer())
                : null;
        }
        const openedAt = Date.now();
        await writeStorageFile(directory, OPENED_FILE_NAME, String(openedAt)).catch(() => null);
        return { metadata: { ...metadata, lastOpenedAt: openedAt }, cloud: cloud, octree: metadata.octree };
    }

    async save(storageKey, source, cloud, octree) {
        const root = await this.getRootDirectory();
        await root.removeEntry(storageKey, { recursive: true }).catch(() => null);
        const directory = await root.getDirectoryHandle(storageKey, { create: true });
        try {
            const storedFiles = ARRAY_FILES.filter((arrayFile) => cloud[arrayFile.property]);
            for (const arrayFile of storedFiles) {
                await writeStorageFile(directory, arrayFile.fileName, cloud[arrayFile.property]);
            }
            const now = Date.now();
            await writeMetadata(directory, {
                formatVersion: STORE_FORMAT_VERSION,
                storageKey: storageKey,
                fileName: source.fileName,
                fileSize: source.fileSize,
                fileLastModified: source.fileLastModified,
                pointCount: cloud.pointCount,
                sourcePointCount: cloud.sourcePointCount,
                origin: cloud.origin,
                minimum: cloud.minimum,
                maximum: cloud.maximum,
                intensityRange: cloud.intensityRange,
                arrayProperties: storedFiles.map((arrayFile) => arrayFile.property),
                byteSize: storedFiles.reduce((sum, arrayFile) => sum + cloud[arrayFile.property].byteLength, 0),
                octree: octree,
                savedAt: now,
                lastOpenedAt: now
            });
        } catch (error) {
            await root.removeEntry(storageKey, { recursive: true }).catch(() => null);
            throw error;
        }
        await this.evict(storageKey);
    }

    async remove(storageKey) {
        const root = await this.getRootDirectory();
        await root.removeEntry(storageKey, { recursive: true });
    }

    async evict(keptStorageKey) {
        const root = await this.getRootDirectory();
        const entries = await this.readEntries();
        const now = Date.now();
        const staleNames = entries
            .filter((entry) => entry.metadata === null && now - entry.lastModification > STALE_ENTRY_MILLISECONDS)
            .map((entry) => entry.name);
        const oldNames = entries
            .filter((entry) => entry.metadata !== null)
            .sort((first, second) => second.lastOpenedAt - first.lastOpenedAt)
            .slice(MAXIMUM_STORED_POINT_CLOUDS)
            .map((entry) => entry.name);
        const removedNames = [...staleNames, ...oldNames].filter((name) => name !== keptStorageKey);
        await Promise.all(removedNames.map((name) => root.removeEntry(name, { recursive: true }).catch(() => null)));
    }

    async estimateUsage() {
        if (typeof navigator.storage?.estimate !== "function") {
            return null;
        }
        const estimate = await navigator.storage.estimate();
        return { usage: estimate.usage ?? 0, quota: estimate.quota ?? 0 };
    }
}
