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
import { isTextInputTarget } from "../../utils/InsertionKeyboard.js";
import { pointInPolygon, polygonArea } from "../../utils/PolygonMath.js";
import { CadFeatureType, MINIMUM_POINT_COUNTS } from "./CadFeature.js";
import { ScreenProjector } from "./ScreenProjector.js";

const CLICK_TOLERANCE_PIXELS = 3;
const FEATURE_PICK_TOLERANCE_PIXELS = 8;
const VERTEX_PICK_TOLERANCE_PIXELS = 10;
const EDGE_INSERT_TOLERANCE_PIXELS = 6;

export class CadEditTool extends EventDispatcher {
    constructor(viewer, cadDocument, surfacePicker) {
        super();
        this.viewer = viewer;
        this.cadDocument = cadDocument;
        this.surfacePicker = surfacePicker;
        this.screenProjector = new ScreenProjector(viewer);
        this.enabled = true;
        this.selectedFeature = null;
        this.pressPosition = null;
        this.draggedVertexIndex = null;
        this.hasVertexMoved = false;
        this.moveStartPosition = null;
        this.moveOriginalPoints = null;
        this.hasFeatureMoved = false;
        this.terrainHeightSampler = null;
        this.dragHandle = new THREE.Object3D();
        this.dragHandle.addEventListener("drag", (event) => this.onVertexDrag(event));
        this.dragHandle.addEventListener("drop", () => this.onVertexDrop());
        this.moveHandle = new THREE.Object3D();
        this.moveHandle.addEventListener("drag", (event) => this.onFeatureMoveDrag(event));
        this.moveHandle.addEventListener("drop", () => this.onFeatureMoveDrop());

        const canvas = viewer.renderer.domElement;
        canvas.addEventListener("mousedown", (event) => this.onMouseDown(event));
        canvas.addEventListener("mouseup", (event) => this.onMouseUp(event));
        document.addEventListener("keydown", (event) => this.onKeyDown(event));
        viewer.addEventListener("cancel_insertions", () => this.select(null));
        viewer.inputHandler.addEventListener("selection_changed", (event) => {
            if (event.selection.length > 0) {
                this.select(null);
            }
        });
        cadDocument.addEventListener("feature_removed", (event) => {
            if (event.feature === this.selectedFeature) {
                this.select(null);
            }
        });
        cadDocument.addEventListener("layers_changed", () => {
            if (this.selectedFeature && !this.selectedFeature.visible) {
                this.select(null);
            }
        });
    }

    setEnabled(enabled) {
        this.enabled = enabled;
        if (!enabled) {
            this.select(null);
        }
    }

    setTerrainHeightSampler(terrainHeightSampler) {
        this.terrainHeightSampler = terrainHeightSampler;
    }

    select(feature) {
        if (this.selectedFeature === feature) {
            return;
        }
        const isVertexDragUnsaved = this.draggedVertexIndex !== null && this.hasVertexMoved;
        const isFeatureMoveUnsaved = this.moveStartPosition !== null && this.hasFeatureMoved;
        if (this.selectedFeature && (isVertexDragUnsaved || isFeatureMoveUnsaved)) {
            this.dispatchEvent({ type: "feature_changed", feature: this.selectedFeature });
        }
        this.draggedVertexIndex = null;
        this.hasVertexMoved = false;
        this.resetFeatureMove();
        this.surfacePicker.clearSnapIndicator();
        this.selectedFeature?.setSelected(false);
        this.selectedFeature = feature;
        feature?.setSelected(true);
        this.dispatchEvent({ type: "selection_changed", feature: feature });
    }

    updateSelectedFeature(style) {
        if (!this.selectedFeature) {
            return;
        }
        if (style.label !== undefined) {
            this.selectedFeature.setLabel(style.label);
        }
        if (style.color !== undefined) {
            this.selectedFeature.setColor(style.color);
        }
    }

    deleteSelectedFeature() {
        const feature = this.selectedFeature;
        if (!feature) {
            return;
        }
        this.select(null);
        this.cadDocument.removeFeature(feature);
        feature.dispose();
    }

    deleteSelectedVertex() {
        const feature = this.selectedFeature;
        if (feature.points.length <= MINIMUM_POINT_COUNTS[feature.featureType]) {
            this.dispatchEvent({ type: "vertex_delete_refused", feature: feature });
            return;
        }
        feature.removePointAt(feature.selectedVertexIndex);
        this.dispatchEvent({ type: "feature_changed", feature: feature });
    }

    insertVertexAt(canvasPoint) {
        const feature = this.selectedFeature;
        if (feature.featureType === CadFeatureType.POINT || feature.featureType === CadFeatureType.CIRCLE) {
            return false;
        }
        const segmentIndex = this.findSelectedSegmentAt(canvasPoint);
        if (segmentIndex === null) {
            return false;
        }
        const start = feature.points[segmentIndex];
        const end = feature.points[(segmentIndex + 1) % feature.points.length];
        feature.insertPointAt(segmentIndex + 1, this.screenProjector.closestPointOnSegment(canvasPoint, start, end));
        this.dispatchEvent({ type: "feature_changed", feature: feature });
        return true;
    }

    findSelectedSegmentAt(canvasPoint) {
        const feature = this.selectedFeature;
        const pointCount = feature.points.length;
        const segmentCount = feature.featureType === CadFeatureType.POLYGON ? pointCount : pointCount - 1;
        let nearestIndex = null;
        let nearestDistance = EDGE_INSERT_TOLERANCE_PIXELS;
        for (let index = 0; index < segmentCount; index++) {
            const segment = this.screenProjector.projectSegment(feature.points[index], feature.points[(index + 1) % pointCount]);
            const distance = segment ? this.screenProjector.measureDistanceToSegment(canvasPoint, segment[0], segment[1]) : Infinity;
            if (distance <= nearestDistance) {
                nearestIndex = index;
                nearestDistance = distance;
            }
        }
        return nearestIndex;
    }

    isOtherObjectDragged() {
        const draggedObject = this.viewer.inputHandler.drag?.object;
        return Boolean(draggedObject) && draggedObject !== this.dragHandle && draggedObject !== this.moveHandle;
    }

    onMouseDown(event) {
        this.pressPosition = null;
        if (!this.enabled || event.button !== 0 || this.isOtherObjectDragged()) {
            return;
        }
        const canvasPoint = this.toCanvasPoint(event);
        const vertexIndex = this.findSelectedVertexAt(canvasPoint);
        if (vertexIndex !== null) {
            this.draggedVertexIndex = vertexIndex;
            this.hasVertexMoved = false;
            this.viewer.inputHandler.startDragging(this.dragHandle);
            return;
        }
        this.pressPosition = { x: event.clientX, y: event.clientY };
        if (this.selectedFeature && this.measureScreenHit(this.selectedFeature, canvasPoint).distance <= FEATURE_PICK_TOLERANCE_PIXELS) {
            this.startFeatureMove(canvasPoint);
        }
    }

    startFeatureMove(canvasPoint) {
        const startPosition = this.surfacePicker.pick(canvasPoint);
        if (!startPosition) {
            return;
        }
        this.moveStartPosition = startPosition;
        this.moveOriginalPoints = this.selectedFeature.points.map((point) => point.clone());
        this.hasFeatureMoved = false;
        this.viewer.inputHandler.startDragging(this.moveHandle);
    }

    resetFeatureMove() {
        this.moveStartPosition = null;
        this.moveOriginalPoints = null;
        this.hasFeatureMoved = false;
    }

    onFeatureMoveDrag(event) {
        if ((event.drag.mouse & MOUSE.LEFT) === 0) {
            this.viewer.inputHandler.drag = null;
            this.onFeatureMoveDrop();
            return;
        }
        const feature = this.selectedFeature;
        if (!feature || !this.moveStartPosition) {
            return;
        }
        const position = this.surfacePicker.pick(event.drag.end, this.moveStartPosition.z);
        if (!position) {
            return;
        }
        this.hasFeatureMoved = true;
        const offset = position.sub(this.moveStartPosition);
        feature.setPoints(this.moveOriginalPoints.map((point) => {
            const movedPoint = point.clone().add(offset);
            movedPoint.z = this.terrainHeightSampler?.measuredHeightAt(movedPoint.x, movedPoint.y) ?? this.surfacePicker.mapPlane.height;
            return movedPoint;
        }));
    }

    onFeatureMoveDrop() {
        if (this.selectedFeature && this.hasFeatureMoved) {
            this.dispatchEvent({ type: "feature_changed", feature: this.selectedFeature });
        }
        this.resetFeatureMove();
    }

    onMouseUp(event) {
        const pressPosition = this.pressPosition;
        this.pressPosition = null;
        if (!this.enabled || event.button !== 0 || !pressPosition || this.viewer.inputHandler.selection.length > 0) {
            return;
        }
        if (Math.hypot(event.clientX - pressPosition.x, event.clientY - pressPosition.y) > CLICK_TOLERANCE_PIXELS) {
            return;
        }
        const canvasPoint = this.toCanvasPoint(event);
        if (this.selectedFeature && this.insertVertexAt(canvasPoint)) {
            return;
        }
        this.select(this.pickFeatureAt(canvasPoint));
    }

    onKeyDown(event) {
        if (!this.enabled || !this.selectedFeature || event.key !== "Delete" || event.repeat || isTextInputTarget(event)) {
            return;
        }
        event.preventDefault();
        this.draggedVertexIndex = null;
        this.resetFeatureMove();
        this.surfacePicker.clearSnapIndicator();
        const isVertexSelected = this.selectedFeature.selectedVertexIndex !== null
            && this.selectedFeature.featureType !== CadFeatureType.POINT;
        if (isVertexSelected) {
            this.deleteSelectedVertex();
        } else {
            this.deleteSelectedFeature();
        }
    }

    onVertexDrag(event) {
        if ((event.drag.mouse & MOUSE.LEFT) === 0) {
            this.viewer.inputHandler.drag = null;
            this.onVertexDrop();
            return;
        }
        const feature = this.selectedFeature;
        if (!feature || this.draggedVertexIndex === null) {
            return;
        }
        this.hasVertexMoved = true;
        const snapOptions = { excludedVertex: { feature: feature, index: this.draggedVertexIndex } };
        const position = this.surfacePicker.pick(event.drag.end, null, snapOptions);
        if (position) {
            feature.setPointAt(this.draggedVertexIndex, position);
        }
    }

    onVertexDrop() {
        const feature = this.selectedFeature;
        if (feature && this.draggedVertexIndex !== null) {
            if (this.hasVertexMoved) {
                this.dispatchEvent({ type: "feature_changed", feature: feature });
            } else {
                const isSameVertex = feature.selectedVertexIndex === this.draggedVertexIndex;
                feature.setSelectedVertex(isSameVertex ? null : this.draggedVertexIndex);
            }
        }
        this.draggedVertexIndex = null;
        this.hasVertexMoved = false;
        this.surfacePicker.clearSnapIndicator();
    }

    findSelectedVertexAt(canvasPoint) {
        if (!this.selectedFeature) {
            return null;
        }
        let nearestIndex = null;
        let nearestDistance = VERTEX_PICK_TOLERANCE_PIXELS;
        this.selectedFeature.points.forEach((point, index) => {
            const screenPoint = this.screenProjector.projectPoint(point);
            const distance = screenPoint ? Math.hypot(screenPoint.x - canvasPoint.x, screenPoint.y - canvasPoint.y) : Infinity;
            if (distance <= nearestDistance) {
                nearestIndex = index;
                nearestDistance = distance;
            }
        });
        return nearestIndex;
    }

    pickFeatureAt(canvasPoint) {
        let pickedFeature = null;
        let pickedHit = { distance: Infinity, area: Infinity };
        for (const feature of this.cadDocument.features) {
            if (!feature.visible) {
                continue;
            }
            const hit = this.measureScreenHit(feature, canvasPoint);
            if (hit.distance > FEATURE_PICK_TOLERANCE_PIXELS) {
                continue;
            }
            const isCloser = hit.distance < pickedHit.distance;
            const isSmallerOnTie = hit.distance === pickedHit.distance && hit.area < pickedHit.area;
            if (isCloser || isSmallerOnTie) {
                pickedFeature = feature;
                pickedHit = hit;
            }
        }
        return pickedFeature;
    }

    measureScreenHit(feature, canvasPoint) {
        if (feature.featureType === CadFeatureType.POINT) {
            const screenPoint = this.screenProjector.projectPoint(feature.points[0]);
            const distance = screenPoint ? Math.hypot(screenPoint.x - canvasPoint.x, screenPoint.y - canvasPoint.y) : Infinity;
            return { distance: distance, area: 0 };
        }
        let distance = Infinity;
        for (const [start, end] of feature.computeEdgeSegments()) {
            const segment = this.screenProjector.projectSegment(start, end);
            if (segment) {
                distance = Math.min(distance, this.screenProjector.measureDistanceToSegment(canvasPoint, segment[0], segment[1]));
            }
        }
        if (feature.isClosed()) {
            const screenRing = this.screenProjector.projectRing(feature.getOutlinePoints());
            if (screenRing.length >= 3 && pointInPolygon(canvasPoint.x, canvasPoint.y, screenRing)) {
                return { distance: Math.min(distance, FEATURE_PICK_TOLERANCE_PIXELS), area: polygonArea(screenRing) };
            }
        }
        return { distance: distance, area: 0 };
    }

    toCanvasPoint(event) {
        const canvasRectangle = this.viewer.renderer.domElement.getBoundingClientRect();
        return { x: event.clientX - canvasRectangle.left, y: event.clientY - canvasRectangle.top };
    }
}
