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
import { CadFeatureType } from "./CadFeature.js";
import { ScreenProjector } from "./ScreenProjector.js";

const VERTEX_SNAP_PIXELS = 10;
const EDGE_SNAP_PIXELS = 8;
const SEARCH_MARGIN_PIXELS = 15;
const MINIMUM_SEARCH_MARGIN_METRES = 2;
const MAXIMUM_SEARCH_MARGIN_METRES = 100;
const MAXIMUM_SEARCH_BOX_METRES = 400;
const INDEX_CELL_METRES = 20;
const INDICATOR_SIZE_PIXELS = 12;
const INDICATOR_COLOR = 0xffee00;

export const SnapKind = Object.freeze({
    VERTEX: "vertex",
    EDGE: "edge"
});

export class CadSnapper {
    constructor(viewer, mapPlane, cadDocument, cadastreOverlay) {
        this.viewer = viewer;
        this.mapPlane = mapPlane;
        this.cadDocument = cadDocument;
        this.cadastreOverlay = cadastreOverlay;
        this.screenProjector = new ScreenProjector(viewer);
        this.enabled = true;
        this.cadastreIndex = null;
        this.cadastreBounds = null;
        this.indicator = this.createIndicator();
        this.scene = new THREE.Scene();
        this.scene.add(this.indicator);

        cadastreOverlay.addEventListener("snap_lines_changed", () => {
            this.cadastreIndex = null;
        });
        viewer.addEventListener("render.pass.perspective_overlay", () => this.render());
    }

    createIndicator() {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0], 3));
        const material = new THREE.PointsMaterial({
            color: INDICATOR_COLOR,
            size: INDICATOR_SIZE_PIXELS,
            sizeAttenuation: false,
            transparent: true,
            depthTest: false,
            depthWrite: false
        });
        const indicator = new THREE.Points(geometry, material);
        indicator.visible = false;
        indicator.frustumCulled = false;
        return indicator;
    }

    setEnabled(enabled) {
        this.enabled = enabled;
        if (!enabled) {
            this.hideIndicator();
        }
    }

    snap(canvasPoint, options = {}) {
        if (!this.enabled) {
            this.hideIndicator();
            return null;
        }
        const candidates = this.collectCandidates(canvasPoint, options);
        const result = this.findVertexSnap(canvasPoint, candidates.vertices) ?? this.findEdgeSnap(canvasPoint, candidates.segments);
        if (result) {
            this.indicator.position.copy(result.position);
            this.indicator.visible = true;
        } else {
            this.hideIndicator();
        }
        return result;
    }

    hideIndicator() {
        this.indicator.visible = false;
    }

    findVertexSnap(canvasPoint, vertices) {
        let result = null;
        let nearestDistance = VERTEX_SNAP_PIXELS;
        for (const vertex of vertices) {
            const screenPoint = this.screenProjector.projectPoint(vertex.position);
            const distance = screenPoint ? Math.hypot(screenPoint.x - canvasPoint.x, screenPoint.y - canvasPoint.y) : Infinity;
            if (distance <= nearestDistance) {
                result = { kind: SnapKind.VERTEX, position: vertex.position.clone(), feature: vertex.feature, index: vertex.index };
                nearestDistance = distance;
            }
        }
        return result;
    }

    findEdgeSnap(canvasPoint, segments) {
        let nearestSegment = null;
        let nearestDistance = EDGE_SNAP_PIXELS;
        for (const segment of segments) {
            const screenSegment = this.screenProjector.projectSegment(segment.start, segment.end);
            const distance = screenSegment ? this.screenProjector.measureDistanceToSegment(canvasPoint, screenSegment[0], screenSegment[1]) : Infinity;
            if (distance <= nearestDistance) {
                nearestSegment = segment;
                nearestDistance = distance;
            }
        }
        if (!nearestSegment) {
            return null;
        }
        const position = this.screenProjector.closestPointOnSegment(canvasPoint, nearestSegment.start, nearestSegment.end);
        return { kind: SnapKind.EDGE, position: position, feature: null, index: null };
    }

    collectCandidates(canvasPoint, options) {
        const candidates = { vertices: [], segments: [] };
        const features = [...this.cadDocument.features.filter((feature) => feature.visible), ...(options.extraFeatures ?? [])];
        for (const feature of features) {
            this.addFeatureCandidates(candidates, feature, options.excludedVertex);
        }
        this.addCadastreCandidates(candidates, canvasPoint);
        return candidates;
    }

    addFeatureCandidates(candidates, feature, excludedVertex) {
        const isExcludedFeature = excludedVertex?.feature === feature;
        if (feature.featureType === CadFeatureType.CIRCLE) {
            if (!isExcludedFeature) {
                feature.points.forEach((point, index) => candidates.vertices.push({ position: point, feature: feature, index: index }));
                feature.computeEdgeSegments().forEach(([start, end]) => candidates.segments.push({ start: start, end: end }));
            }
            return;
        }
        const isExcludedIndex = (index) => isExcludedFeature && index === excludedVertex.index;
        const pointCount = feature.points.length;
        const isClosed = feature.featureType === CadFeatureType.POLYGON && !feature.isDrawing;
        const excludedVertexIndices = isExcludedFeature ? this.findNeighbourIndices(excludedVertex.index, pointCount, isClosed) : [];
        feature.points.forEach((point, index) => {
            if (!excludedVertexIndices.includes(index)) {
                candidates.vertices.push({ position: point, feature: feature, index: index });
            }
        });
        if (feature.featureType === CadFeatureType.POINT) {
            return;
        }
        const segmentCount = isClosed ? pointCount : pointCount - 1;
        for (let index = 0; index < segmentCount; index++) {
            const endIndex = (index + 1) % pointCount;
            if (!isExcludedIndex(index) && !isExcludedIndex(endIndex)) {
                candidates.segments.push({ start: feature.points[index], end: feature.points[endIndex] });
            }
        }
    }

    findNeighbourIndices(index, pointCount, isClosed) {
        const neighbourIndices = [index];
        for (const offset of [-1, 1]) {
            const neighbourIndex = isClosed ? (index + offset + pointCount) % pointCount : index + offset;
            if (neighbourIndex >= 0 && neighbourIndex < pointCount) {
                neighbourIndices.push(neighbourIndex);
            }
        }
        return neighbourIndices;
    }

    addCadastreCandidates(candidates, canvasPoint) {
        const index = this.getCadastreIndex();
        const bounds = this.cadastreBounds;
        if (!bounds) {
            return;
        }
        const searchBox = this.computeSearchBox(canvasPoint, bounds);
        if (!searchBox) {
            return;
        }
        const minimumColumn = Math.max(this.toCell(searchBox.minimumX), bounds.minimumColumn);
        const maximumColumn = Math.min(this.toCell(searchBox.maximumX), bounds.maximumColumn);
        const minimumRow = Math.max(this.toCell(searchBox.minimumY), bounds.minimumRow);
        const maximumRow = Math.min(this.toCell(searchBox.maximumY), bounds.maximumRow);
        const segments = new Set();
        for (let column = minimumColumn; column <= maximumColumn; column++) {
            for (let row = minimumRow; row <= maximumRow; row++) {
                const cell = index.get(this.toCellKey(column, row));
                if (cell) {
                    cell.vertices.forEach((position) => candidates.vertices.push({ position: position, feature: null, index: null }));
                    cell.segments.forEach((segment) => segments.add(segment));
                }
            }
        }
        for (const segment of segments) {
            candidates.segments.push(segment);
        }
    }

    computeSearchBox(canvasPoint, bounds) {
        const hits = [bounds.minimumHeight, bounds.maximumHeight]
            .map((height) => this.mapPlane.intersectScreenPointAtHeight(canvasPoint.x, canvasPoint.y, height))
            .filter((hit) => hit !== null);
        if (hits.length === 0) {
            return null;
        }
        const margin = this.computeSearchMargin(canvasPoint, hits[0].z);
        const searchBox = {
            minimumX: Math.min(...hits.map((hit) => hit.x)) - margin,
            maximumX: Math.max(...hits.map((hit) => hit.x)) + margin,
            minimumY: Math.min(...hits.map((hit) => hit.y)) - margin,
            maximumY: Math.max(...hits.map((hit) => hit.y)) + margin
        };
        const boxSize = Math.max(searchBox.maximumX - searchBox.minimumX, searchBox.maximumY - searchBox.minimumY);
        return boxSize <= MAXIMUM_SEARCH_BOX_METRES ? searchBox : null;
    }

    computeSearchMargin(canvasPoint, height) {
        const intersect = (offsetX, offsetY) => this.mapPlane.intersectScreenPointAtHeight(canvasPoint.x + offsetX, canvasPoint.y + offsetY, height);
        const center = intersect(0, 0);
        const neighbours = [intersect(1, 0), intersect(0, 1)].filter((neighbour) => neighbour !== null);
        const metresPerPixel = center ? Math.max(0, ...neighbours.map((neighbour) => neighbour.distanceTo(center))) : 0;
        return THREE.MathUtils.clamp(metresPerPixel * SEARCH_MARGIN_PIXELS, MINIMUM_SEARCH_MARGIN_METRES, MAXIMUM_SEARCH_MARGIN_METRES);
    }

    getCadastreIndex() {
        if (this.cadastreIndex) {
            return this.cadastreIndex;
        }
        let bounds = null;
        const includeInBounds = (point) => {
            const column = this.toCell(point.x);
            const row = this.toCell(point.y);
            bounds = bounds ?? { minimumColumn: column, maximumColumn: column, minimumRow: row, maximumRow: row, minimumHeight: point.z, maximumHeight: point.z };
            bounds.minimumColumn = Math.min(bounds.minimumColumn, column);
            bounds.maximumColumn = Math.max(bounds.maximumColumn, column);
            bounds.minimumRow = Math.min(bounds.minimumRow, row);
            bounds.maximumRow = Math.max(bounds.maximumRow, row);
            bounds.minimumHeight = Math.min(bounds.minimumHeight, point.z);
            bounds.maximumHeight = Math.max(bounds.maximumHeight, point.z);
        };
        const index = new Map();
        const getCell = (column, row) => {
            const key = this.toCellKey(column, row);
            if (!index.has(key)) {
                index.set(key, { vertices: [], segments: [] });
            }
            return index.get(key);
        };
        for (const line of this.cadastreOverlay.getVisibleSnapLines()) {
            line.points.forEach(includeInBounds);
            for (const corner of line.corners) {
                getCell(this.toCell(corner.x), this.toCell(corner.y)).vertices.push(corner);
            }
            for (let pointIndex = 0; pointIndex < line.points.length - 1; pointIndex++) {
                const segment = { start: line.points[pointIndex], end: line.points[pointIndex + 1] };
                const minimumColumn = this.toCell(Math.min(segment.start.x, segment.end.x));
                const maximumColumn = this.toCell(Math.max(segment.start.x, segment.end.x));
                const minimumRow = this.toCell(Math.min(segment.start.y, segment.end.y));
                const maximumRow = this.toCell(Math.max(segment.start.y, segment.end.y));
                for (let column = minimumColumn; column <= maximumColumn; column++) {
                    for (let row = minimumRow; row <= maximumRow; row++) {
                        getCell(column, row).segments.push(segment);
                    }
                }
            }
        }
        this.cadastreIndex = index;
        this.cadastreBounds = bounds;
        return index;
    }

    toCell(coordinate) {
        return Math.floor(coordinate / INDEX_CELL_METRES);
    }

    toCellKey(column, row) {
        return `${column}:${row}`;
    }

    render() {
        if (this.indicator.visible) {
            this.viewer.renderer.render(this.scene, this.viewer.scene.getActiveCamera());
        }
    }
}
