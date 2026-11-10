/*! ******************************************************************************************************** *
 *
 * Copyright 2026 Oidis
 *
 * SPDX-License-Identifier: BSD-2-Clause
 * The BSD-2-Clause license for this file can be found in the LICENSE.txt file included with this distribution
 * or at https://spdx.org/licenses/BSD-2-Clause.html#licenseText
 *
 * ********************************************************************************************************* */

const DATABASE_VERSION = 1;
const STORE_NAME = "recent-files";
const READ_PERMISSION = { mode: "read" };

function openDatabase(databaseName) {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(databaseName, DATABASE_VERSION);
        request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

export class RecentFileStore {
    constructor(databaseName, key) {
        this.databaseName = databaseName;
        this.key = key;
    }

    static isSupported() {
        return typeof window.showOpenFilePicker === "function" && typeof window.indexedDB !== "undefined";
    }

    async save(fileHandle) {
        await this.runRequest("readwrite", (store) => store.put(fileHandle, this.key));
    }

    async load() {
        return (await this.runRequest("readonly", (store) => store.get(this.key))) ?? null;
    }

    async clear() {
        await this.runRequest("readwrite", (store) => store.delete(this.key));
    }

    async runRequest(mode, createRequest) {
        const database = await openDatabase(this.databaseName);
        try {
            return await new Promise((resolve, reject) => {
                const request = createRequest(database.transaction(STORE_NAME, mode).objectStore(STORE_NAME));
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
        } finally {
            database.close();
        }
    }
}

export async function readFileFromHandle(fileHandle, mayAskPermission) {
    let permission = await fileHandle.queryPermission(READ_PERMISSION);
    if (permission === "prompt" && mayAskPermission) {
        permission = await fileHandle.requestPermission(READ_PERMISSION);
    }
    return permission === "granted" ? fileHandle.getFile() : null;
}
