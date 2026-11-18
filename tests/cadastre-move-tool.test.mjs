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
import * as THREE from "../libs/three.js/build/three.module.js";
import { MOUSE } from "../src/defines.js";
import { CadastreMoveStep, CadastreMoveTool } from "../src/modules/UtilityNetworkEditor/CadastreMoveTool.js";

const BUILDING_IDENTIFIER = 7;
const IDENTITY_TRANSFORM = { centerX: 5, centerY: 4, shiftX: 0, shiftY: 0, rotationDegrees: 0 };

function createViewer() {
    const canvas = new EventTarget();
    canvas.style = { cursor: "" };
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0 });
    const viewer = new THREE.EventDispatcher();
    viewer.renderer = { domElement: canvas };
    viewer.inputHandler = {
        drag: null,
        startDragging(object) {
            this.drag = { object: object };
        }
    };
    return viewer;
}

function createSurfacePicker() {
    return {
        pick: (point) => new THREE.Vector3(point.x, point.y, 0),
        clearSnapIndicator: () => {}
    };
}

function createAlignment() {
    return {
        manualTransforms: [],
        previews: [],
        findDisplayedBuildingAt(position) {
            const transform = this.manualTransforms.at(-1) ?? IDENTITY_TRANSFORM;
            const x = position.x - transform.shiftX;
            const y = position.y - transform.shiftY;
            const isNear = x >= -1 && x <= 11 && y >= -1 && y <= 9;
            return isNear ? { identifier: BUILDING_IDENTIFIER, label: "7", transform: transform } : null;
        },
        setManualTransform(identifier, label, transform) {
            this.manualTransforms.push(transform);
        },
        showMovePreview(identifier, transform) {
            this.previews.push(transform);
        },
        clearMovePreview() {
            this.previews.push(null);
        }
    };
}

function createTool() {
    const viewer = createViewer();
    const alignment = createAlignment();
    const tool = new CadastreMoveTool(viewer, createSurfacePicker(), alignment);
    tool.activate();
    return { viewer, alignment, tool };
}

function drag(tool, [startX, startY], [endX, endY]) {
    tool.dragHandle.dispatchEvent({ type: "drag", drag: { mouse: MOUSE.LEFT, start: new THREE.Vector2(startX, startY), end: new THREE.Vector2(endX, endY) } });
}

function drop(viewer, tool) {
    tool.dragHandle.dispatchEvent({ type: "drop" });
    viewer.inputHandler.drag = null;
}

function readShift(transform) {
    return [Number(transform.shiftX.toFixed(6)), Number(transform.shiftY.toFixed(6))];
}

test("dragging a building by its corner shows the move live and keeps the camera still", () => {
    const { viewer, alignment, tool } = createTool();
    tool.onMouseDown({ button: 0, clientX: 10, clientY: 8 });
    assert.equal(viewer.inputHandler.drag.object, tool.dragHandle);
    drag(tool, [10, 8], [13, 12]);
    assert.deepEqual(readShift(alignment.previews.at(-1)), [3, 4]);
    assert.equal(alignment.manualTransforms.length, 0);
    drop(viewer, tool);
    assert.deepEqual(readShift(alignment.manualTransforms.at(-1)), [3, 4]);
    assert.equal(alignment.previews.at(-1), null);
    assert.equal(tool.step, CadastreMoveStep.PICK_SECOND_CORNER);
});

test("after clicking a corner the building follows the mouse until the target is clicked", () => {
    const { viewer, alignment, tool } = createTool();
    tool.onMouseDown({ button: 0, clientX: 10, clientY: 8 });
    drop(viewer, tool);
    assert.equal(tool.step, CadastreMoveStep.PICK_TARGET);
    assert.equal(alignment.manualTransforms.length, 0);
    tool.onMouseMove({ buttons: 0, clientX: 12, clientY: 9 });
    assert.deepEqual(readShift(alignment.previews.at(-1)), [2, 1]);
    tool.onMouseDown({ button: 0, clientX: 15, clientY: 10 });
    assert.equal(viewer.inputHandler.drag, null);
    tool.onMouseUp({ button: 0, clientX: 15, clientY: 10 });
    assert.deepEqual(readShift(alignment.manualTransforms.at(-1)), [5, 2]);
});

test("pressing outside a building leaves dragging to the camera", () => {
    const { viewer, tool } = createTool();
    tool.onMouseDown({ button: 0, clientX: 40, clientY: 40 });
    assert.equal(viewer.inputHandler.drag, null);
    assert.equal(tool.step, CadastreMoveStep.PICK_CORNER);
});

test("dragging the second corner rotates the moved building around the first corner", () => {
    const { viewer, alignment, tool } = createTool();
    tool.onMouseDown({ button: 0, clientX: 10, clientY: 8 });
    drag(tool, [10, 8], [13, 12]);
    drop(viewer, tool);
    tool.onMouseDown({ button: 0, clientX: 3, clientY: 12 });
    assert.equal(tool.step, CadastreMoveStep.PICK_SECOND_TARGET);
    drag(tool, [3, 12], [13, 2]);
    assert.ok(Math.abs(alignment.previews.at(-1).rotationDegrees - 90) < 1e-9);
    drop(viewer, tool);
    assert.ok(Math.abs(alignment.manualTransforms.at(-1).rotationDegrees - 90) < 1e-9);
    assert.equal(tool.active, false);
});
