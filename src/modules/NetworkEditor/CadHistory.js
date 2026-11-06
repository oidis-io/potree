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

const MAXIMUM_UNDO_STEPS = 50;

export class CadHistory extends EventDispatcher {
    constructor(cadDocument) {
        super();
        this.cadDocument = cadDocument;
        this.isRestoring = false;
        this.snapshots = [this.createSnapshot()];
        cadDocument.addEventListener("feature_added", () => this.capture());
        cadDocument.addEventListener("feature_removed", () => this.capture());
    }

    get canUndo() {
        return this.snapshots.length > 1;
    }

    reset() {
        this.snapshots = [this.createSnapshot()];
        this.dispatchEvent({ type: "history_changed" });
    }

    createSnapshot() {
        return JSON.stringify(this.cadDocument.toData());
    }

    capture() {
        if (this.isRestoring) {
            return;
        }
        const snapshot = this.createSnapshot();
        if (snapshot === this.snapshots[this.snapshots.length - 1]) {
            return;
        }
        this.snapshots.push(snapshot);
        if (this.snapshots.length > MAXIMUM_UNDO_STEPS + 1) {
            this.snapshots.shift();
        }
        this.dispatchEvent({ type: "history_changed" });
    }

    undo() {
        this.capture();
        if (!this.canUndo) {
            return;
        }
        this.snapshots.pop();
        this.isRestoring = true;
        try {
            this.cadDocument.loadData(JSON.parse(this.snapshots[this.snapshots.length - 1]));
        } finally {
            this.isRestoring = false;
        }
        this.dispatchEvent({ type: "history_changed" });
    }
}
