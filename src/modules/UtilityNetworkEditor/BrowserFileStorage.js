/*! ******************************************************************************************************** *
 *
 * Copyright 2026 Oidis
 *
 * SPDX-License-Identifier: BSD-2-Clause
 * The BSD-2-Clause license for this file can be found in the LICENSE.txt file included with this distribution
 * or at https://spdx.org/licenses/BSD-2-Clause.html#licenseText
 *
 * ********************************************************************************************************* */

export function isBrowserFileStorageSupported() {
    return typeof navigator !== "undefined" && typeof navigator.storage?.getDirectory === "function";
}

export async function openStorageDirectory(name) {
    const root = await navigator.storage.getDirectory();
    return root.getDirectoryHandle(name, { create: true });
}

export async function findStorageDirectory(parent, name) {
    try {
        return await parent.getDirectoryHandle(name);
    } catch {
        return null;
    }
}

function toBytes(data) {
    if (typeof data === "string") {
        return new TextEncoder().encode(data);
    }
    return data instanceof Uint8Array ? data : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

export async function writeStorageFile(directory, fileName, data) {
    const fileHandle = await directory.getFileHandle(fileName, { create: true });
    const bytes = toBytes(data);
    if (typeof fileHandle.createSyncAccessHandle === "function") {
        const accessHandle = await fileHandle.createSyncAccessHandle();
        try {
            accessHandle.truncate(0);
            accessHandle.write(bytes, { at: 0 });
            accessHandle.flush();
        } finally {
            accessHandle.close();
        }
        return;
    }
    const writable = await fileHandle.createWritable();
    try {
        await writable.write(bytes);
        await writable.close();
    } catch (error) {
        await writable.abort().catch(() => null);
        throw error;
    }
}

export async function readStorageFile(directory, fileName) {
    const fileHandle = await directory.getFileHandle(fileName);
    return fileHandle.getFile();
}
