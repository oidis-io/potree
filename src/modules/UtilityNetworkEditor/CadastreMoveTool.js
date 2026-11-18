/*! ******************************************************************************************************** *
 *
 * Copyright 2026 Oidis
 *
 * SPDX-License-Identifier: BSD-2-Clause
 * The BSD-2-Clause license for this file can be found in the LICENSE.txt file included with this distribution
 * or at https://spdx.org/licenses/BSD-2-Clause.html#licenseText
 *
 * ********************************************************************************************************* */

import * as THREE from "../../../libs/three.js/build/three.module.js";
import { MOUSE } from "../../defines.js";
import { EventDispatcher } from "../../EventDispatcher.js";
import { composeTransforms } from "./BuildingFitting.js";

const CLICK_TOLERANCE_PIXELS = 3;
const MOVE_CURSOR = "crosshair";
const MINIMUM_ROTATION_ARM_METRES = 0.5;

export const CadastreMoveStep = Object.freeze({
    PICK_CORNER: "pick_corner",
    PICK_TARGET: "pick_target",
    PICK_SECOND_CORNER: "pick_second_corner",
    PICK_SECOND_TARGET: "pick_second_target"
});

export const CadastreMoveMessage = Object.freeze({
    NO_BUILDING: "no_building",
    TOO_CLOSE: "too_close"
});

function normalizeDegrees(degrees) {
    return ((degrees + 540) % 360) - 180;
}

export class CadastreMoveTool extends EventDispatcher {
    constructor(viewer, surfacePicker, cadastreAlignment) {
        super();
        this.viewer = viewer;
        this.surfacePicker = surfacePicker;
        this.cadastreAlignment = cadastreAlignment;
        this.active = false;
        this.step = null;
        this.building = null;
        this.firstTarget = null;
        this.secondCorner = null;
        this.pressPosition = null;
        this.dragPosition = null;
        this.hasDragMoved = false;
        this.dragHandle = new THREE.Object3D();
        this.dragHandle.addEventListener("drag", (event) => this.onDrag(event));
        this.dragHandle.addEventListener("drop", () => this.onDrop());

        const canvas = viewer.renderer.domElement;
        canvas.addEventListener("mousedown", (event) => this.onMouseDown(event));
        canvas.addEventListener("mouseup", (event) => this.onMouseUp(event));
        canvas.addEventListener("mousemove", (event) => this.onMouseMove(event));
        viewer.addEventListener("cancel_insertions", () => this.deactivate());
    }

    activate() {
        if (this.active) {
            return;
        }
        this.viewer.dispatchEvent({ type: "cancel_insertions" });
        this.active = true;
        this.viewer.renderer.domElement.style.cursor = MOVE_CURSOR;
        this.dispatchEvent({ type: "activation_changed", active: true });
        this.setStep(CadastreMoveStep.PICK_CORNER);
    }

    deactivate() {
        if (!this.active) {
            return;
        }
        this.active = false;
        this.step = null;
        this.building = null;
        this.firstTarget = null;
        this.secondCorner = null;
        this.pressPosition = null;
        this.dragPosition = null;
        this.hasDragMoved = false;
        if (this.viewer.inputHandler.drag?.object === this.dragHandle) {
            this.viewer.inputHandler.drag = null;
        }
        this.cadastreAlignment.clearMovePreview();
        this.surfacePicker.clearSnapIndicator();
        const canvasStyle = this.viewer.renderer.domElement.style;
        if (canvasStyle.cursor === MOVE_CURSOR) {
            canvasStyle.cursor = "";
        }
        this.dispatchEvent({ type: "activation_changed", active: false });
    }

    setStep(step, message = null) {
        this.step = step;
        this.dispatchEvent({ type: "step_changed", step: step, message: message, building: this.building });
    }

    onMouseDown(event) {
        this.pressPosition = null;
        if (!this.active || event.button !== 0) {
            return;
        }
        const position = this.pick(event);
        if (position && this.startDragAt(position)) {
            return;
        }
        this.pressPosition = { x: event.clientX, y: event.clientY };
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
        const position = this.pick(event);
        if (position) {
            this.handleClick(position);
        }
    }

    onMouseMove(event) {
        if (!this.active || event.buttons !== 0) {
            return;
        }
        const position = this.pick(event);
        if (position) {
            this.previewAt(position);
        }
    }

    startDragAt(position) {
        if (this.step === CadastreMoveStep.PICK_CORNER && this.cadastreAlignment.findDisplayedBuildingAt(position)) {
            this.pickCorner(position);
        } else if (this.step === CadastreMoveStep.PICK_SECOND_CORNER && this.isOnMovedBuilding(position) && this.isFarFromPivot(position)) {
            this.pickSecondCorner(position);
        } else {
            return false;
        }
        this.dragPosition = null;
        this.hasDragMoved = false;
        this.viewer.inputHandler.startDragging(this.dragHandle);
        return true;
    }

    onDrag(event) {
        if ((event.drag.mouse & MOUSE.LEFT) === 0) {
            this.viewer.inputHandler.drag = null;
            this.onDrop();
            return;
        }
        if (event.drag.start.distanceTo(event.drag.end) > CLICK_TOLERANCE_PIXELS) {
            this.hasDragMoved = true;
        }
        const position = this.surfacePicker.pick(event.drag.end, null, {});
        if (position) {
            this.dragPosition = position;
            this.previewAt(position);
        }
    }

    onDrop() {
        const position = this.dragPosition;
        const hasMoved = this.hasDragMoved;
        this.dragPosition = null;
        this.hasDragMoved = false;
        if (this.active && hasMoved && position) {
            this.handleClick(position);
        }
    }

    pick(event) {
        const canvasRectangle = this.viewer.renderer.domElement.getBoundingClientRect();
        return this.surfacePicker.pick({ x: event.clientX - canvasRectangle.left, y: event.clientY - canvasRectangle.top }, null, {});
    }

    handleClick(position) {
        if (this.step === CadastreMoveStep.PICK_CORNER) {
            this.pickCorner(position);
        } else if (this.step === CadastreMoveStep.PICK_TARGET) {
            this.moveCornerTo(position);
        } else if (this.step === CadastreMoveStep.PICK_SECOND_CORNER) {
            this.pickSecondCorner(position);
        } else if (this.step === CadastreMoveStep.PICK_SECOND_TARGET) {
            this.rotateSecondCornerTo(position);
        }
    }

    previewAt(position) {
        if (this.step === CadastreMoveStep.PICK_TARGET) {
            this.cadastreAlignment.showMovePreview(this.building.identifier, this.createMoveTransform(position));
        } else if (this.step === CadastreMoveStep.PICK_SECOND_TARGET && this.isFarFromPivot(position)) {
            this.cadastreAlignment.showMovePreview(this.building.identifier, this.createRotationTransform(position));
        }
    }

    isOnMovedBuilding(position) {
        const building = this.cadastreAlignment.findDisplayedBuildingAt(position);
        return building !== null && String(building.identifier) === String(this.building.identifier);
    }

    isFarFromPivot(position) {
        return Math.hypot(position.x - this.firstTarget.x, position.y - this.firstTarget.y) >= MINIMUM_ROTATION_ARM_METRES;
    }

    pickCorner(position) {
        const building = this.cadastreAlignment.findDisplayedBuildingAt(position);
        if (!building) {
            this.setStep(CadastreMoveStep.PICK_CORNER, CadastreMoveMessage.NO_BUILDING);
            return;
        }
        this.building = { ...building, corner: position.clone() };
        this.setStep(CadastreMoveStep.PICK_TARGET);
    }

    moveCornerTo(position) {
        this.applyTransform(this.createMoveTransform(position));
        this.firstTarget = position.clone();
        this.setStep(CadastreMoveStep.PICK_SECOND_CORNER);
    }

    pickSecondCorner(position) {
        if (!this.isFarFromPivot(position)) {
            this.setStep(CadastreMoveStep.PICK_SECOND_CORNER, CadastreMoveMessage.TOO_CLOSE);
            return;
        }
        this.secondCorner = position.clone();
        this.setStep(CadastreMoveStep.PICK_SECOND_TARGET);
    }

    rotateSecondCornerTo(position) {
        if (!this.isFarFromPivot(position)) {
            this.setStep(CadastreMoveStep.PICK_SECOND_TARGET, CadastreMoveMessage.TOO_CLOSE);
            return;
        }
        this.applyTransform(this.createRotationTransform(position));
        this.deactivate();
    }

    createMoveTransform(position) {
        const corner = this.building.corner;
        const translation = { centerX: corner.x, centerY: corner.y, shiftX: position.x - corner.x, shiftY: position.y - corner.y, rotationDegrees: 0 };
        return composeTransforms(this.building.transform, translation);
    }

    createRotationTransform(position) {
        const pivot = this.firstTarget;
        const currentAngle = Math.atan2(this.secondCorner.y - pivot.y, this.secondCorner.x - pivot.x);
        const targetAngle = Math.atan2(position.y - pivot.y, position.x - pivot.x);
        const rotationDegrees = normalizeDegrees((targetAngle - currentAngle) * 180 / Math.PI);
        return composeTransforms(this.building.transform, { centerX: pivot.x, centerY: pivot.y, shiftX: 0, shiftY: 0, rotationDegrees: rotationDegrees });
    }

    applyTransform(transform) {
        this.building.transform = transform;
        this.cadastreAlignment.setManualTransform(this.building.identifier, this.building.label, transform);
        this.cadastreAlignment.clearMovePreview();
    }
}
