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
import { isTextInputTarget } from "../../utils/InsertionKeyboard.js";
import { CadFeature, CadFeatureType, MINIMUM_POINT_COUNTS } from "./CadFeature.js";
import { ScreenProjector } from "./ScreenProjector.js";

const CLICK_TOLERANCE_PIXELS = 3;
const CLOSE_TOLERANCE_PIXELS = 10;
const DUPLICATE_VERTEX_DISTANCE_METRES = 0.01;
const RECTANGLE_POINT_COUNT = 4;
const DRAWING_CURSOR = "cell";

export const CadDrawingType = Object.freeze({
    POINT: CadFeatureType.POINT,
    POLYLINE: CadFeatureType.POLYLINE,
    POLYGON: CadFeatureType.POLYGON,
    RECTANGLE: "rectangle",
    CIRCLE: CadFeatureType.CIRCLE
});

function computeRectanglePoints(firstCorner, secondCorner, widthPoint) {
    const sideX = secondCorner.x - firstCorner.x;
    const sideY = secondCorner.y - firstCorner.y;
    const sideLength = Math.hypot(sideX, sideY);
    if (sideLength < DUPLICATE_VERTEX_DISTANCE_METRES) {
        return null;
    }
    const normalX = -sideY / sideLength;
    const normalY = sideX / sideLength;
    const width = (widthPoint.x - firstCorner.x) * normalX + (widthPoint.y - firstCorner.y) * normalY;
    if (Math.abs(width) < DUPLICATE_VERTEX_DISTANCE_METRES) {
        return null;
    }
    return [
        firstCorner.clone(),
        secondCorner.clone(),
        widthPoint.clone().set(secondCorner.x + normalX * width, secondCorner.y + normalY * width, widthPoint.z),
        widthPoint.clone().set(firstCorner.x + normalX * width, firstCorner.y + normalY * width, widthPoint.z)
    ];
}

export class CadTool extends EventDispatcher {
    constructor(viewer, surfacePicker, cadDocument, cadView) {
        super();
        this.viewer = viewer;
        this.surfacePicker = surfacePicker;
        this.cadDocument = cadDocument;
        this.cadView = cadView;
        this.screenProjector = new ScreenProjector(viewer);
        this.style = { label: "", color: "#ff3366" };
        this.drawingType = null;
        this.draftFeature = null;
        this.rectangleCorners = [];
        this.pressPosition = null;
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

    startDrawing(drawingType) {
        this.viewer.dispatchEvent({ type: "cancel_insertions" });
        this.drawingType = drawingType;
        this.rectangleCorners = [];
        this.viewer.renderer.domElement.style.cursor = DRAWING_CURSOR;
        this.savedDoubleClickZoom = this.viewer.getDoubleClickZoom() !== false;
        this.viewer.setDoubleClickZoom(false);
        if (drawingType !== CadDrawingType.POINT) {
            const featureType = drawingType === CadDrawingType.RECTANGLE ? CadFeatureType.POLYGON : drawingType;
            this.draftFeature = new CadFeature(featureType, this.style);
            this.draftFeature.setDrawing(true);
            this.cadView.setDraftFeature(this.draftFeature);
        }
        this.dispatchEvent({ type: "drawing_changed", drawingType: drawingType });
    }

    isDraftComplete(feature) {
        if (this.drawingType === CadDrawingType.RECTANGLE) {
            return feature.points.length === RECTANGLE_POINT_COUNT;
        }
        return feature.points.length >= MINIMUM_POINT_COUNTS[feature.featureType];
    }

    finishDrawing() {
        if (!this.isDrawing) {
            return;
        }
        const feature = this.draftFeature;
        this.draftFeature = null;
        this.cadView.setDraftFeature(null);
        if (feature && this.isDraftComplete(feature)) {
            feature.setDrawing(false);
            this.cadDocument.addFeature(feature);
        } else if (feature) {
            feature.dispose();
        }
        this.drawingType = null;
        this.rectangleCorners = [];
        this.surfacePicker.clearSnapIndicator();
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
        if (this.isFirstPolygonVertexClicked(event)) {
            if (this.draftFeature.points.length >= MINIMUM_POINT_COUNTS[CadFeatureType.POLYGON]) {
                this.finishDrawing();
            }
            return;
        }
        const position = this.pickSurface(event);
        if (position) {
            this.addVertex(position);
        }
    }

    onMouseMove(event) {
        if (!this.isDrawing || event.buttons !== 0) {
            return;
        }
        const position = this.pickSurface(event);
        if (this.drawingType === CadDrawingType.RECTANGLE) {
            this.updateRectanglePreview(position);
        } else if (this.draftFeature) {
            this.draftFeature.setTrailingPoint(position);
        }
    }

    updateRectanglePreview(position) {
        const rectanglePoints = position && this.rectangleCorners.length === 2
            ? computeRectanglePoints(this.rectangleCorners[0], this.rectangleCorners[1], position)
            : null;
        if (!rectanglePoints) {
            this.draftFeature.setPoints(this.rectangleCorners);
            this.draftFeature.setTrailingPoint(position);
            return;
        }
        this.draftFeature.setPoints(rectanglePoints.slice(0, RECTANGLE_POINT_COUNT - 1));
        this.draftFeature.setTrailingPoint(rectanglePoints[RECTANGLE_POINT_COUNT - 1]);
    }

    addRectangleCorner(position) {
        const corners = this.rectangleCorners;
        if (corners.length === 2) {
            const rectanglePoints = computeRectanglePoints(corners[0], corners[1], position);
            if (rectanglePoints) {
                this.draftFeature.setPoints(rectanglePoints);
                this.finishDrawing();
            }
            return;
        }
        if (corners.length === 1 && Math.hypot(position.x - corners[0].x, position.y - corners[0].y) < DUPLICATE_VERTEX_DISTANCE_METRES) {
            return;
        }
        corners.push(position.clone());
        this.draftFeature.setPoints(corners);
    }

    isFirstPolygonVertexClicked(event) {
        const draftFeature = this.draftFeature;
        if (this.drawingType !== CadDrawingType.POLYGON || !draftFeature || draftFeature.points.length === 0) {
            return false;
        }
        const firstVertex = this.screenProjector.projectPoint(draftFeature.points[0]);
        const canvasPoint = this.toCanvasPoint(event);
        return firstVertex !== null && Math.hypot(firstVertex.x - canvasPoint.x, firstVertex.y - canvasPoint.y) <= CLOSE_TOLERANCE_PIXELS;
    }

    onKeyDown(event) {
        if (!this.draftFeature || event.key !== "Backspace" || isTextInputTarget(event)) {
            return;
        }
        event.preventDefault();
        if (this.drawingType === CadDrawingType.RECTANGLE) {
            this.rectangleCorners.pop();
            this.draftFeature.setPoints(this.rectangleCorners);
            return;
        }
        this.draftFeature.removeLastPoint();
    }

    addVertex(position) {
        if (this.drawingType === CadDrawingType.POINT) {
            const feature = new CadFeature(CadFeatureType.POINT, this.style);
            feature.addPoint(position);
            this.cadDocument.addFeature(feature);
            return;
        }
        if (this.drawingType === CadDrawingType.RECTANGLE) {
            this.addRectangleCorner(position);
            return;
        }
        const points = this.draftFeature.points;
        const lastPoint = points[points.length - 1];
        if (lastPoint && lastPoint.distanceTo(position) < DUPLICATE_VERTEX_DISTANCE_METRES) {
            return;
        }
        this.draftFeature.addPoint(position);
        if (this.drawingType === CadDrawingType.CIRCLE && this.draftFeature.points.length === MINIMUM_POINT_COUNTS[CadFeatureType.CIRCLE]) {
            this.finishDrawing();
        }
    }

    pickSurface(event) {
        const snapsToDraft = this.draftFeature && this.drawingType !== CadDrawingType.RECTANGLE;
        const snapOptions = { extraFeatures: snapsToDraft ? [this.draftFeature] : [] };
        return this.surfacePicker.pick(this.toCanvasPoint(event), null, snapOptions);
    }

    toCanvasPoint(event) {
        const canvasRectangle = this.viewer.renderer.domElement.getBoundingClientRect();
        return { x: event.clientX - canvasRectangle.left, y: event.clientY - canvasRectangle.top };
    }
}
