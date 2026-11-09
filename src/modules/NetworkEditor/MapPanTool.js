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

const INPUT_IMPORTANCE = 1;
const ENABLED_CLASS_NAME = "map-pan-enabled";
const PANNING_CLASS_NAME = "map-pan-active";

export class MapPanTool extends THREE.EventDispatcher {
    constructor(viewer, mapPlane, surfacePicker) {
        super();
        this.viewer = viewer;
        this.mapPlane = mapPlane;
        this.surfacePicker = surfacePicker;
        this.importance = INPUT_IMPORTANCE;
        this.enabled = false;
        this.panGesture = null;
        this.addEventListener("drag", (event) => this.onDrag(event));
        this.addEventListener("drop", () => this.endPan());
        viewer.inputHandler.addInputListener(this);
    }

    setEnabled(isEnabled) {
        this.enabled = isEnabled;
        this.endPan();
        this.viewer.renderer.domElement.classList.toggle(ENABLED_CLASS_NAME, isEnabled);
    }

    onDrag(event) {
        if (!this.enabled) {
            return;
        }
        const pressedButtons = event.drag.mouse;
        if ((pressedButtons & MOUSE.LEFT) !== 0) {
            event.consume();
            this.pan(event.drag);
        } else if ((pressedButtons & MOUSE.RIGHT) !== 0) {
            event.consume();
            this.rotate(event);
        } else {
            this.endPan();
        }
    }

    pan(drag) {
        if (this.panGesture?.drag !== drag) {
            this.panGesture = this.startPan(drag);
        }
        if (!this.panGesture) {
            return;
        }
        const { grabPoint, startCamera, startPosition } = this.panGesture;
        const cursorPoint = this.mapPlane.intersectScreenPointAtHeight(drag.end.x, drag.end.y, grabPoint.z, startCamera);
        if (!cursorPoint) {
            return;
        }
        this.viewer.scene.view.position.set(
            startPosition.x + grabPoint.x - cursorPoint.x,
            startPosition.y + grabPoint.y - cursorPoint.y,
            startPosition.z
        );
    }

    startPan(drag) {
        const grabPoint = this.surfacePicker.pick(drag.start);
        if (!grabPoint) {
            return null;
        }
        this.viewer.controls.stop?.();
        this.viewer.renderer.domElement.classList.add(PANNING_CLASS_NAME);
        return {
            drag: drag,
            grabPoint: grabPoint,
            startCamera: this.viewer.scene.getActiveCamera().clone(),
            startPosition: this.viewer.scene.view.position.clone()
        };
    }

    rotate(event) {
        const drag = event.drag;
        const pressedButtons = drag.mouse;
        drag.mouse = MOUSE.LEFT;
        this.viewer.controls.dispatchEvent({ type: "drag", drag: drag, viewer: event.viewer });
        drag.mouse = pressedButtons;
    }

    endPan() {
        this.panGesture = null;
        this.viewer.renderer.domElement.classList.remove(PANNING_CLASS_NAME);
    }
}
