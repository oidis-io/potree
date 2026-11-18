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
    constructor(cadDocument, alignmentExceptions = null) {
        super();
        this.cadDocument = cadDocument;
        this.alignmentExceptions = alignmentExceptions;
        this.isRestoring = false;
        this.snapshots = [this.createSnapshot()];
        cadDocument.addEventListener("feature_added", () => this.capture());
        cadDocument.addEventListener("feature_removed", () => this.capture());
        cadDocument.addEventListener("feature_layer_changed", () => this.capture());
        alignmentExceptions?.addEventListener("changed", () => this.capture());
    }

    get canUndo() {
        return this.snapshots.length > 1;
    }

    reset() {
        this.snapshots = [this.createSnapshot()];
        this.dispatchEvent({ type: "history_changed" });
    }

    createSnapshot() {
        return {
            drawing: JSON.stringify(this.cadDocument.toData()),
            alignmentExceptions: JSON.stringify(this.alignmentExceptions?.toData() ?? [])
        };
    }

    capture() {
        if (this.isRestoring) {
            return;
        }
        const snapshot = this.createSnapshot();
        const lastSnapshot = this.snapshots[this.snapshots.length - 1];
        if (snapshot.drawing === lastSnapshot.drawing && snapshot.alignmentExceptions === lastSnapshot.alignmentExceptions) {
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
        const undoneSnapshot = this.snapshots.pop();
        const snapshot = this.snapshots[this.snapshots.length - 1];
        this.isRestoring = true;
        try {
            if (snapshot.drawing !== undoneSnapshot.drawing) {
                this.cadDocument.loadData(JSON.parse(snapshot.drawing));
            }
            if (this.alignmentExceptions && snapshot.alignmentExceptions !== undoneSnapshot.alignmentExceptions) {
                this.alignmentExceptions.replace(JSON.parse(snapshot.alignmentExceptions));
            }
        } finally {
            this.isRestoring = false;
        }
        this.dispatchEvent({ type: "history_changed" });
    }
}
