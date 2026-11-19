/*! ******************************************************************************************************** *
 *
 * Copyright 2026 Oidis
 *
 * SPDX-License-Identifier: BSD-2-Clause
 * The BSD-2-Clause license for this file can be found in the LICENSE.txt file included with this distribution
 * or at https://spdx.org/licenses/BSD-2-Clause.html#licenseText
 *
 * ********************************************************************************************************* */

import assert from "node:assert/strict";
import { test } from "node:test";
import { EventDispatcher } from "../src/EventDispatcher.js";
import { CadastreAlignmentExceptions } from "../src/modules/UtilityNetworkEditor/CadastreAlignmentExceptions.js";
import { CadHistory } from "../src/modules/UtilityNetworkEditor/CadHistory.js";

class FakeDocument extends EventDispatcher {
    constructor() {
        super();
        this.features = [];
        this.isBulkUpdating = false;
        this.restoreCount = 0;
    }

    toState() {
        return { layers: [], features: [...this.features] };
    }

    restoreState(state) {
        this.features = [...state.features];
        this.restoreCount++;
    }

    addFeature(name) {
        this.features.push(name);
        this.dispatchEvent({ type: "feature_added" });
    }
}

const MOVE = { centerX: 0, centerY: 0, shiftX: 3, shiftY: 1, rotationDegrees: 0 };

test("undo takes back a manual move of a building without reloading the drawing", () => {
    const cadDocument = new FakeDocument();
    const exceptions = new CadastreAlignmentExceptions();
    const history = new CadHistory(cadDocument, exceptions);
    exceptions.add(65, "65", MOVE);
    assert.equal(history.canUndo, true);
    history.undo();
    assert.equal(exceptions.has(65), false);
    assert.equal(cadDocument.restoreCount, 0);
    assert.equal(history.canUndo, false);
});

test("undo takes back drawing and alignment changes in reverse order", () => {
    const cadDocument = new FakeDocument();
    const exceptions = new CadastreAlignmentExceptions();
    const history = new CadHistory(cadDocument, exceptions);
    cadDocument.addFeature("pipe");
    exceptions.add(65, "65", MOVE);
    exceptions.add(71, "71");
    history.undo();
    assert.deepEqual(exceptions.list().map((exception) => exception.label), ["65"]);
    history.undo();
    assert.equal(exceptions.size, 0);
    assert.deepEqual(cadDocument.features, ["pipe"]);
    history.undo();
    assert.deepEqual(cadDocument.features, []);
});
