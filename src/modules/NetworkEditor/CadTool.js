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
import { Utils } from "../../utils.js";
import { isTextInputTarget } from "../../utils/InsertionKeyboard.js";
import { CadFeature, CadFeatureType, MINIMUM_POINT_COUNTS } from "./CadFeature.js";

const CLICK_TOLERANCE_PIXELS = 3;
const DUPLICATE_VERTEX_DISTANCE_METRES = 0.01;
const DRAWING_CURSOR = "cell";

export class CadTool extends EventDispatcher {
    constructor(viewer, mapPlane, cadDocument, cadView) {
        super();
        this.viewer = viewer;
        this.mapPlane = mapPlane;
        this.cadDocument = cadDocument;
        this.cadView = cadView;
        this.style = { label: "", color: "#ff3366" };
        this.drawingType = null;
        this.draftFeature = null;
        this.pressPosition = null;
        this.lastPickHeight = null;
        this.savedDoubleClickZoom = null;

        const canvas = viewer.renderer.domElement;
        canvas.addEventListener("mousedown", (event) => this.onMouseDown(event));
        canvas.addEventListener("mouseup", (event) => this.onMouseUp(event));
        canvas.addEventListener("mousemove", (event) => this.onMouseMove(event));
        document.addEventListener("keydown", (event) => this.onKeyDown(event));
        viewer.addEventListener("cancel_insertions", () => this.finishDrawing());
    }

    get isDrawing() {
        return this.drawingType !== null;
    }

    setStyle(style) {
        this.style = { ...this.style, ...style };
        if (this.draftFeature) {
            this.draftFeature.setColor(this.style.color);
            this.draftFeature.setLabel(this.style.label);
        }
    }

    startDrawing(featureType) {
        this.viewer.dispatchEvent({ type: "cancel_insertions" });
        this.drawingType = featureType;
        this.viewer.renderer.domElement.style.cursor = DRAWING_CURSOR;
        this.savedDoubleClickZoom = this.viewer.getDoubleClickZoom() !== false;
        this.viewer.setDoubleClickZoom(false);
        if (featureType !== CadFeatureType.POINT) {
            this.draftFeature = new CadFeature(featureType, this.style);
            this.draftFeature.setDrawing(true);
            this.cadView.setDraftFeature(this.draftFeature);
        }
        this.dispatchEvent({ type: "drawing_changed", drawingType: featureType });
    }

    finishDrawing() {
        if (!this.isDrawing) {
            return;
        }
        const feature = this.draftFeature;
        this.draftFeature = null;
        this.cadView.setDraftFeature(null);
        if (feature && feature.points.length >= MINIMUM_POINT_COUNTS[feature.featureType]) {
            feature.setDrawing(false);
            this.cadDocument.addFeature(feature);
        } else if (feature) {
            feature.dispose();
        }
        this.drawingType = null;
        const canvasStyle = this.viewer.renderer.domElement.style;
        if (canvasStyle.cursor === DRAWING_CURSOR) {
            canvasStyle.cursor = "";
        }
        this.viewer.setDoubleClickZoom(this.savedDoubleClickZoom);
        this.dispatchEvent({ type: "drawing_changed", drawingType: null });
    }

    onMouseDown(event) {
        this.pressPosition = this.isDrawing && event.button === 0 ? { x: event.clientX, y: event.clientY } : null;
    }

    onMouseUp(event) {
        const pressPosition = this.pressPosition;
        this.pressPosition = null;
        if (!this.isDrawing || event.button !== 0 || !pressPosition) {
            return;
        }
        if (Math.hypot(event.clientX - pressPosition.x, event.clientY - pressPosition.y) > CLICK_TOLERANCE_PIXELS) {
            return;
        }
        const position = this.resolvePointer(this.toCanvasPoint(event));
        if (position) {
            this.addVertex(position);
        }
    }

    onMouseMove(event) {
        if (!this.draftFeature || event.buttons !== 0) {
            return;
        }
        this.draftFeature.setTrailingPoint(this.resolvePointer(this.toCanvasPoint(event)));
    }

    onKeyDown(event) {
        if (!this.draftFeature || event.key !== "Backspace" || isTextInputTarget(event)) {
            return;
        }
        event.preventDefault();
        this.draftFeature.removeLastPoint();
    }

    addVertex(position) {
        if (this.drawingType === CadFeatureType.POINT) {
            const feature = new CadFeature(CadFeatureType.POINT, this.style);
            feature.addPoint(position);
            this.cadDocument.addFeature(feature);
            return;
        }
        const points = this.draftFeature.points;
        const lastPoint = points[points.length - 1];
        if (lastPoint && lastPoint.distanceTo(position) < DUPLICATE_VERTEX_DISTANCE_METRES) {
            return;
        }
        this.draftFeature.addPoint(position);
    }

    resolvePointer(canvasPoint) {
        const camera = this.viewer.scene.getActiveCamera();
        const pick = Utils.getMousePointCloudIntersection(canvasPoint, camera, this.viewer, this.viewer.scene.pointclouds, { pickClipped: true });
        if (pick && pick.distance !== null) {
            this.lastPickHeight = pick.location.z;
            return pick.location.clone();
        }
        return this.mapPlane.intersectScreenPointAtHeight(canvasPoint.x, canvasPoint.y, this.getReferenceHeight());
    }

    getReferenceHeight() {
        const points = this.draftFeature?.points ?? [];
        return points[points.length - 1]?.z ?? this.lastPickHeight ?? this.mapPlane.height;
    }

    toCanvasPoint(event) {
        const canvasRectangle = this.viewer.renderer.domElement.getBoundingClientRect();
        return { x: event.clientX - canvasRectangle.left, y: event.clientY - canvasRectangle.top };
    }
}
