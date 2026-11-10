/*! ******************************************************************************************************** *
 *
 * Copyright 2026 Oidis
 *
 * SPDX-License-Identifier: BSD-2-Clause
 * The BSD-2-Clause license for this file can be found in the LICENSE.txt file included with this distribution
 * or at https://spdx.org/licenses/BSD-2-Clause.html#licenseText
 *
 * ********************************************************************************************************* */

import { EventDispatcher } from "../../EventDispatcher.js";
import { createCadFile, parseCadFile } from "./CadFileFormat.js";

const SAVE_DELAY_MILLISECONDS = 300;

export class CadAutosave extends EventDispatcher {
    constructor(cadDocument, cadHistory, storageKey) {
        super();
        this.cadDocument = cadDocument;
        this.cadHistory = cadHistory;
        this.storageKey = storageKey;
        this.saveTimeout = null;
        this.isStarted = false;
    }

    load() {
        const text = window.localStorage.getItem(this.storageKey);
        return text === null ? null : parseCadFile(text);
    }

    start() {
        if (this.isStarted) {
            return;
        }
        this.isStarted = true;
        this.cadHistory.addEventListener("history_changed", () => this.scheduleSave());
        this.cadDocument.addEventListener("layers_changed", () => this.scheduleSave());
        window.addEventListener("pagehide", () => this.flush());
    }

    scheduleSave() {
        clearTimeout(this.saveTimeout);
        this.saveTimeout = setTimeout(() => this.save(), SAVE_DELAY_MILLISECONDS);
    }

    flush() {
        if (this.saveTimeout !== null) {
            this.save();
        }
    }

    save() {
        clearTimeout(this.saveTimeout);
        this.saveTimeout = null;
        try {
            window.localStorage.setItem(this.storageKey, JSON.stringify(createCadFile(this.cadDocument)));
            this.dispatchEvent({ type: "saved" });
        } catch (error) {
            this.dispatchEvent({ type: "save_failed", error: error });
        }
    }
}
