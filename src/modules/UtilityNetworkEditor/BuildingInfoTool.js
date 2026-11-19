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

const CLICK_TOLERANCE_PIXELS = 3;
const INFO_CURSOR = "help";

export class BuildingInfoTool extends EventDispatcher {
    constructor(viewer, buildingExtrusionLayer) {
        super();
        this.viewer = viewer;
        this.buildingExtrusionLayer = buildingExtrusionLayer;
        this.active = false;
        this.pressPosition = null;

        const canvas = viewer.renderer.domElement;
        canvas.addEventListener("mousedown", (event) => this.onMouseDown(event));
        canvas.addEventListener("mouseup", (event) => this.onMouseUp(event));
        viewer.addEventListener("cancel_insertions", () => this.deactivate());
    }

    activate() {
        if (this.active) {
            return;
        }
        this.viewer.dispatchEvent({ type: "cancel_insertions" });
        this.active = true;
        this.viewer.renderer.domElement.style.cursor = INFO_CURSOR;
        this.dispatchEvent({ type: "activation_changed", active: true });
    }

    deactivate() {
        if (!this.active) {
            return;
        }
        this.active = false;
        this.pressPosition = null;
        const canvasStyle = this.viewer.renderer.domElement.style;
        if (canvasStyle.cursor === INFO_CURSOR) {
            canvasStyle.cursor = "";
        }
        this.dispatchEvent({ type: "activation_changed", active: false });
    }

    onMouseDown(event) {
        this.pressPosition = this.active && event.button === 0 ? { x: event.clientX, y: event.clientY } : null;
    }

    onMouseUp(event) {
        const pressPosition = this.pressPosition;
        this.pressPosition = null;
        if (!this.active || event.button !== 0 || !pressPosition) {
            return;
        }
        if (Math.hypot(event.clientX - pressPosition.x, event.clientY - pressPosition.y) > CLICK_TOLERANCE_PIXELS) {
            return;
        }
        const canvasRectangle = this.viewer.renderer.domElement.getBoundingClientRect();
        const building = this.buildingExtrusionLayer.pickBuilding(event.clientX - canvasRectangle.left, event.clientY - canvasRectangle.top);
        this.buildingExtrusionLayer.setSelectedIdentifier(building?.identifier ?? null);
        this.dispatchEvent({ type: "building_picked", building: building });
    }
}
