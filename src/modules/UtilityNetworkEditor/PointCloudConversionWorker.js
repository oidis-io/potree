/*! ******************************************************************************************************** *
 *
 * Copyright 2026 Oidis
 *
 * SPDX-License-Identifier: BSD-2-Clause
 * The BSD-2-Clause license for this file can be found in the LICENSE.txt file included with this distribution
 * or at https://spdx.org/licenses/BSD-2-Clause.html#licenseText
 *
 * ********************************************************************************************************* */

import { buildMemoryOctree, sortCloudByOctree } from "./MemoryOctreeBuilder.js";
import { ConversionMessageType, PointCloudLoadStage } from "./PointCloudConversionProtocol.js";
import { readPointCloudFile } from "./PointCloudFileReader.js";
import { createReadError, PointCloudReadErrorCode } from "./PointCloudReadError.js";
import { createStorageKey, PointCloudStore } from "./PointCloudStore.js";

const store = new PointCloudStore();

function postProgress(stage, share) {
    self.postMessage({ type: ConversionMessageType.PROGRESS, stage: stage, share: share });
}

function postLoaded(cloud, octree, details) {
    const buffers = [cloud.positions, cloud.colors, cloud.intensities, cloud.classifications].filter(Boolean).map((array) => array.buffer);
    self.postMessage({ type: ConversionMessageType.LOADED, cloud: cloud, octree: octree, ...details }, buffers);
}

async function loadFromStore(storageKey) {
    try {
        return await store.load(storageKey);
    } catch {
        return null;
    }
}

async function saveToStore(storageKey, file, cloud, octree) {
    postProgress(PointCloudLoadStage.STORING, 0);
    try {
        await store.save(storageKey, { fileName: file.name, fileSize: file.size, fileLastModified: file.lastModified }, cloud, octree);
        return true;
    } catch {
        return false;
    } finally {
        postProgress(PointCloudLoadStage.STORING, 1);
    }
}

async function convertFile(file, maximumPointCount) {
    const cloud = await readPointCloudFile(file, maximumPointCount, (share) => postProgress(PointCloudLoadStage.READING, share));
    const octree = await buildMemoryOctree(cloud, (share) => postProgress(PointCloudLoadStage.BUILDING, share));
    return sortCloudByOctree(cloud, octree);
}

async function openFile(file, maximumPointCount) {
    const storageKey = PointCloudStore.isSupported() ? await createStorageKey(file, maximumPointCount) : null;
    const stored = storageKey ? await loadFromStore(storageKey) : null;
    const source = { fileName: file.name, fileSize: file.size, fileLastModified: file.lastModified };
    if (stored) {
        postLoaded(stored.cloud, stored.octree, { ...source, storageKey: storageKey, isFromStorage: true, isStored: true });
        return;
    }
    const converted = await convertFile(file, maximumPointCount);
    const isStored = storageKey ? await saveToStore(storageKey, file, converted.cloud, converted.octree) : false;
    postLoaded(converted.cloud, converted.octree, { ...source, storageKey: isStored ? storageKey : null, isFromStorage: false, isStored: isStored });
}

async function openStored(storageKey) {
    postProgress(PointCloudLoadStage.RESTORING, 0);
    const stored = PointCloudStore.isSupported() ? await loadFromStore(storageKey) : null;
    if (!stored) {
        throw createReadError(PointCloudReadErrorCode.NOT_STORED);
    }
    const { fileName, fileSize, fileLastModified } = stored.metadata;
    postLoaded(stored.cloud, stored.octree, { fileName, fileSize, fileLastModified, storageKey: storageKey, isFromStorage: true, isStored: true });
}

self.onmessage = async (event) => {
    const message = event.data;
    try {
        if (message.type === ConversionMessageType.OPEN_FILE) {
            await openFile(message.file, message.maximumPointCount);
        } else if (message.type === ConversionMessageType.OPEN_STORED) {
            await openStored(message.storageKey);
        }
    } catch (error) {
        self.postMessage({ type: ConversionMessageType.FAILED, code: error.code ?? PointCloudReadErrorCode.FAILED, message: String(error.message ?? error) });
    }
};
