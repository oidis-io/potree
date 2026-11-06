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
import { EventDispatcher } from "../../EventDispatcher.js";
import { DtmNetworkLayer, fetchDtmFeatureInfo } from "./DtmService.js";

const CLICK_TOLERANCE_PIXELS = 3;
const MARKER_RADIUS_PIXELS = 8;
const MARKER_COLOR = 0xff3366;
const INFO_CURSOR = "help";

export class DtmInfoTool extends EventDispatcher {
    constructor(viewer, mapPlane, dtmOverlay = null) {
        super();
        this.viewer = viewer;
        this.mapPlane = mapPlane;
        this.dtmOverlay = dtmOverlay;
        this.active = false;
        this.pressPosition = null;
        this.requestIndex = 0;
        this.marker = new THREE.Mesh(
            new THREE.RingGeometry(0.6, 1, 32),
            new THREE.MeshBasicMaterial({ color: MARKER_COLOR, transparent: true, depthTest: false, depthWrite: false })
        );
        this.marker.visible = false;
        this.marker.frustumCulled = false;
        this.scene = new THREE.Scene();
        this.scene.add(this.marker);

        const canvas = viewer.renderer.domElement;
        canvas.addEventListener("mousedown", (event) => this.onMouseDown(event));
        canvas.addEventListener("mouseup", (event) => this.onMouseUp(event));
        viewer.addEventListener("cancel_insertions", () => this.deactivate());
        viewer.addEventListener("update", () => this.updateMarkerScale());
        viewer.addEventListener("render.pass.perspective_overlay", () => this.render());
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

    clearMarker() {
        this.requestIndex++;
        this.marker.visible = false;
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
        this.query(event.clientX - canvasRectangle.left, event.clientY - canvasRectangle.top);
    }

    async query(screenX, screenY) {
        const position = this.dtmOverlay
            ? this.dtmOverlay.intersectSurface(screenX, screenY)
            : this.mapPlane.intersectScreenPoint(screenX, screenY);
        const screenMetresPerPixel = this.mapPlane.metresPerPixelAt(screenX, screenY);
        if (!position || !screenMetresPerPixel) {
            return;
        }
        const metresPerPixel = this.dtmOverlay?.getImageMetresPerPixelAt(position.x, position.y) ?? screenMetresPerPixel;
        this.showMarker(position);
        const requestIndex = ++this.requestIndex;
        this.dispatchEvent({ type: "query_started", position: position });
        const layerIds = this.dtmOverlay?.layerIds ?? Object.values(DtmNetworkLayer);
        try {
            const result = layerIds.length > 0
                ? await fetchDtmFeatureInfo(position.x, position.y, metresPerPixel, layerIds)
                : { region: null, features: [] };
            if (requestIndex === this.requestIndex) {
                this.dispatchEvent({ type: "query_finished", position: position, result: result });
            }
        } catch (error) {
            if (requestIndex === this.requestIndex) {
                this.dispatchEvent({ type: "query_failed", position: position, error: error });
            }
        }
    }

    showMarker(position) {
        this.marker.position.copy(position);
        this.marker.visible = true;
        this.updateMarkerScale();
    }

    updateMarkerScale() {
        if (!this.marker.visible) {
            return;
        }
        const { width, height } = this.mapPlane.getRenderSize();
        const projected = this.marker.position.clone().project(this.viewer.scene.getActiveCamera());
        if (projected.z < -1 || projected.z > 1) {
            return;
        }
        const metresPerPixel = this.mapPlane.metresPerPixelAt((projected.x + 1) / 2 * width, (1 - projected.y) / 2 * height);
        if (metresPerPixel) {
            const radius = metresPerPixel * MARKER_RADIUS_PIXELS;
            this.marker.scale.set(radius, radius, 1);
        }
    }

    render() {
        if (this.marker.visible) {
            this.viewer.renderer.render(this.scene, this.viewer.scene.getActiveCamera());
        }
    }
}
