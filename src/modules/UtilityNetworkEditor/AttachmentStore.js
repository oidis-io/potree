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

const ROOT_DIRECTORY_NAME = "utility-network-editor-attachments";
const INVALID_NAME_CHARACTERS = /[\\/:*?"<>|]/g;

function sanitizeName(name) {
    return name.replace(INVALID_NAME_CHARACTERS, "_").trim() || "soubor";
}

export class AttachmentStore {
    static isSupported() {
        return isBrowserFileStorageSupported();
    }

    async openOwnerDirectory(ownerKey, isCreated) {
        const root = await openStorageDirectory(ROOT_DIRECTORY_NAME);
        const directoryName = await hashText(ownerKey);
        return isCreated ? root.getDirectoryHandle(directoryName, { create: true }) : findStorageDirectory(root, directoryName);
    }

    async list(ownerKey) {
        const directory = await this.openOwnerDirectory(ownerKey, false);
        if (!directory) {
            return [];
        }
        const attachments = [];
        for await (const [name, handle] of directory.entries()) {
            if (handle.kind === "file") {
                const file = await handle.getFile();
                attachments.push({ name: name, size: file.size, lastModified: file.lastModified });
            }
        }
        return attachments.sort((first, second) => first.lastModified - second.lastModified);
    }

    async save(ownerKey, name, content) {
        const directory = await this.openOwnerDirectory(ownerKey, true);
        const storedName = sanitizeName(name);
        await writeStorageFile(directory, storedName, content);
        return storedName;
    }

    async load(ownerKey, name) {
        const directory = await this.openOwnerDirectory(ownerKey, false);
        return directory ? readStorageFile(directory, name) : null;
    }

    async remove(ownerKey, name) {
        const directory = await this.openOwnerDirectory(ownerKey, false);
        await directory?.removeEntry(name);
    }
}
