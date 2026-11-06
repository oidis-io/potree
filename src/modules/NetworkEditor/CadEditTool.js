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
        this.enabled = true;
        this.selectedFeature = null;
        this.pressPosition = null;
        this.draggedVertexIndex = null;
        this.hasVertexMoved = false;
        this.renderSize = new THREE.Vector2();
        this.raycaster = new THREE.Raycaster();
        this.dragHandle = new THREE.Object3D();
        this.dragHandle.addEventListener("drag", (event) => this.onVertexDrag(event));
        this.dragHandle.addEventListener("drop", () => this.onVertexDrop());

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

    select(feature) {
        if (this.selectedFeature === feature) {
            return;
        }
        if (this.selectedFeature && this.draggedVertexIndex !== null && this.hasVertexMoved) {
            this.dispatchEvent({ type: "feature_changed", feature: this.selectedFeature });
        }
        this.draggedVertexIndex = null;
        this.hasVertexMoved = false;
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
        if (feature.featureType === CadFeatureType.POINT) {
            return false;
        }
        const segmentIndex = this.findSelectedSegmentAt(canvasPoint);
        if (segmentIndex === null) {
            return false;
        }
        const start = feature.points[segmentIndex];
        const end = feature.points[(segmentIndex + 1) % feature.points.length];
        feature.insertPointAt(segmentIndex + 1, this.computePointOnSegment(canvasPoint, start, end));
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
            const segment = this.projectSegmentToScreen(feature.points[index], feature.points[(index + 1) % pointCount]);
            const distance = segment ? this.measureDistanceToSegment(canvasPoint, segment[0], segment[1]) : Infinity;
            if (distance <= nearestDistance) {
                nearestIndex = index;
                nearestDistance = distance;
            }
        }
        return nearestIndex;
    }

    computePointOnSegment(canvasPoint, start, end) {
        const { width, height } = this.viewer.renderer.getSize(this.renderSize);
        const pointer = new THREE.Vector2(canvasPoint.x / width * 2 - 1, -canvasPoint.y / height * 2 + 1);
        this.raycaster.setFromCamera(pointer, this.viewer.scene.getActiveCamera());
        const pointOnSegment = new THREE.Vector3();
        this.raycaster.ray.distanceSqToSegment(start, end, null, pointOnSegment);
        return pointOnSegment;
    }

    isOtherObjectDragged() {
        const draggedObject = this.viewer.inputHandler.drag?.object;
        return Boolean(draggedObject) && draggedObject !== this.dragHandle;
    }

    onMouseDown(event) {
        this.pressPosition = null;
        if (!this.enabled || event.button !== 0 || this.isOtherObjectDragged()) {
            return;
        }
        const vertexIndex = this.findSelectedVertexAt(this.toCanvasPoint(event));
        if (vertexIndex !== null) {
            this.draggedVertexIndex = vertexIndex;
            this.hasVertexMoved = false;
            this.viewer.inputHandler.startDragging(this.dragHandle);
            return;
        }
        this.pressPosition = { x: event.clientX, y: event.clientY };
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
        const position = this.surfacePicker.pick(event.drag.end, feature.points[this.draggedVertexIndex].z);
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
    }

    findSelectedVertexAt(canvasPoint) {
        if (!this.selectedFeature) {
            return null;
        }
        let nearestIndex = null;
        let nearestDistance = VERTEX_PICK_TOLERANCE_PIXELS;
        this.selectedFeature.points.forEach((point, index) => {
            const screenPoint = this.projectPointToScreen(point);
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
            const screenPoint = this.projectPointToScreen(feature.points[0]);
            const distance = screenPoint ? Math.hypot(screenPoint.x - canvasPoint.x, screenPoint.y - canvasPoint.y) : Infinity;
            return { distance: distance, area: 0 };
        }
        const isPolygon = feature.featureType === CadFeatureType.POLYGON;
        const pointCount = feature.points.length;
        const segmentCount = isPolygon ? pointCount : pointCount - 1;
        let distance = Infinity;
        for (let index = 0; index < segmentCount; index++) {
            const segment = this.projectSegmentToScreen(feature.points[index], feature.points[(index + 1) % pointCount]);
            if (segment) {
                distance = Math.min(distance, this.measureDistanceToSegment(canvasPoint, segment[0], segment[1]));
            }
        }
        if (isPolygon) {
            const screenRing = this.projectRingToScreen(feature.points);
            if (screenRing.length >= 3 && pointInPolygon(canvasPoint.x, canvasPoint.y, screenRing)) {
                return { distance: Math.min(distance, FEATURE_PICK_TOLERANCE_PIXELS), area: polygonArea(screenRing) };
            }
        }
        return { distance: distance, area: 0 };
    }

    measureDistanceToSegment(point, start, end) {
        const segmentX = end.x - start.x;
        const segmentY = end.y - start.y;
        const lengthSquared = segmentX * segmentX + segmentY * segmentY;
        const share = lengthSquared === 0 ? 0 : THREE.MathUtils.clamp(((point.x - start.x) * segmentX + (point.y - start.y) * segmentY) / lengthSquared, 0, 1);
        return Math.hypot(point.x - (start.x + share * segmentX), point.y - (start.y + share * segmentY));
    }

    toViewSpace(position) {
        return position.clone().applyMatrix4(this.viewer.scene.getActiveCamera().matrixWorldInverse);
    }

    isInFrontOfCamera(viewPosition) {
        return viewPosition.z <= -this.viewer.scene.getActiveCamera().near;
    }

    clipToNearPlane(visiblePosition, hiddenPosition) {
        const nearDepth = -this.viewer.scene.getActiveCamera().near;
        const share = (nearDepth - visiblePosition.z) / (hiddenPosition.z - visiblePosition.z);
        return visiblePosition.clone().lerp(hiddenPosition, share);
    }

    viewToScreen(viewPosition) {
        const projected = viewPosition.clone().applyMatrix4(this.viewer.scene.getActiveCamera().projectionMatrix);
        const { width, height } = this.viewer.renderer.getSize(this.renderSize);
        return { x: (projected.x + 1) / 2 * width, y: (1 - projected.y) / 2 * height };
    }

    projectPointToScreen(position) {
        const viewPosition = this.toViewSpace(position);
        return this.isInFrontOfCamera(viewPosition) ? this.viewToScreen(viewPosition) : null;
    }

    projectSegmentToScreen(start, end) {
        let viewStart = this.toViewSpace(start);
        let viewEnd = this.toViewSpace(end);
        const isStartVisible = this.isInFrontOfCamera(viewStart);
        const isEndVisible = this.isInFrontOfCamera(viewEnd);
        if (!isStartVisible && !isEndVisible) {
            return null;
        }
        if (!isStartVisible) {
            viewStart = this.clipToNearPlane(viewEnd, viewStart);
        }
        if (!isEndVisible) {
            viewEnd = this.clipToNearPlane(viewStart, viewEnd);
        }
        return [this.viewToScreen(viewStart), this.viewToScreen(viewEnd)];
    }

    projectRingToScreen(points) {
        const viewPoints = points.map((point) => this.toViewSpace(point));
        const clippedRing = [];
        viewPoints.forEach((current, index) => {
            const next = viewPoints[(index + 1) % viewPoints.length];
            const isCurrentVisible = this.isInFrontOfCamera(current);
            const isNextVisible = this.isInFrontOfCamera(next);
            if (isCurrentVisible) {
                clippedRing.push(current);
            }
            if (isCurrentVisible && !isNextVisible) {
                clippedRing.push(this.clipToNearPlane(current, next));
            } else if (!isCurrentVisible && isNextVisible) {
                clippedRing.push(this.clipToNearPlane(next, current));
            }
        });
        return clippedRing.map((viewPoint) => this.viewToScreen(viewPoint));
    }

    toCanvasPoint(event) {
        const canvasRectangle = this.viewer.renderer.domElement.getBoundingClientRect();
        return { x: event.clientX - canvasRectangle.left, y: event.clientY - canvasRectangle.top };
    }
}
