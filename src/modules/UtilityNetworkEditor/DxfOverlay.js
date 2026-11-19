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
import { LineMaterial } from "../../../libs/three.js/lines/LineMaterial.js";
import { LineSegments2 } from "../../../libs/three.js/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "../../../libs/three.js/lines/LineSegmentsGeometry.js";
import { EventDispatcher } from "../../EventDispatcher.js";
import { TextSprite } from "../../TextSprite.js";
import { Utils } from "../../utils.js";
import { DxfPrimitiveKind } from "./DxfGeometry.js";

const DENSIFY_STEP_METRES = 2;
const LIFT_METRES = 0.2;
const LINE_WIDTH_PIXELS = 1.5;
const POINT_CROSS_HALF_SIZE_METRES = 0.3;
const MAXIMUM_LABELS_PER_DOCUMENT = 400;
const LABEL_SCALE_PIXELS = 34;
const LABEL_FONT_SIZE = 20;
const LABEL_RENDER_ORDER = 5;
const LABEL_TEXT_COLOR = { r: 255, g: 255, b: 255, a: 1.0 };
const LABEL_BACKGROUND_COLOR = { r: 0, g: 0, b: 0, a: 0.5 };

function toLabelColor(color) {
    return { r: (color >> 16) & 0xff, g: (color >> 8) & 0xff, b: color & 0xff, a: 1.0 };
}

function disposeObject(object) {
    object.geometry?.dispose();
    object.material?.map?.dispose();
    object.material?.dispose();
}

export class DxfOverlay extends EventDispatcher {
    constructor(viewer, mapPlane) {
        super();
        this.viewer = viewer;
        this.mapPlane = mapPlane;
        this.terrainHeightSampler = null;
        this.documents = new Map();
        this.documentCounter = 0;
        this.renderSize = new THREE.Vector2();
        this.scene = new THREE.Scene();

        viewer.addEventListener("update", () => this.update());
        viewer.addEventListener("render.pass.perspective_overlay", () => this.render());
    }

    setTerrainHeightSampler(terrainHeightSampler) {
        this.terrainHeightSampler = terrainHeightSampler;
        terrainHeightSampler.addEventListener("ready", () => {
            if (this.terrainHeightSampler === terrainHeightSampler) {
                this.rebuildAll();
            }
        });
        this.rebuildAll();
    }

    getTerrainHeight(x, y) {
        return this.terrainHeightSampler?.heightAt(x, y) ?? this.mapPlane.height;
    }

    resolveHeight(entry, point) {
        return entry.document.isFlat ? this.getTerrainHeight(point.x, point.y) : point.z;
    }

    addDocument(fileName, document, storedName = null) {
        this.documentCounter++;
        const entry = {
            id: `dxf-${this.documentCounter}`,
            fileName: fileName,
            storedName: storedName,
            document: document,
            layers: new Map(document.layers.map((layer) => [layer.name, { visible: true, object: null, labels: [], lines: [] }]))
        };
        this.documents.set(entry.id, entry);
        for (const layerName of entry.layers.keys()) {
            this.buildLayer(entry, layerName);
        }
        this.notifyChanged();
        return entry.id;
    }

    removeDocument(documentId) {
        const entry = this.documents.get(documentId);
        if (!entry) {
            return;
        }
        for (const layerName of entry.layers.keys()) {
            this.disposeLayer(entry, layerName);
        }
        this.documents.delete(documentId);
        this.notifyChanged();
    }

    clear() {
        for (const documentId of [...this.documents.keys()]) {
            this.removeDocument(documentId);
        }
    }

    listDocuments() {
        return [...this.documents.values()].map((entry) => ({
            id: entry.id,
            fileName: entry.fileName,
            storedName: entry.storedName,
            bounds: entry.document.bounds,
            isFlat: entry.document.isFlat,
            isKrovak: entry.document.isKrovak,
            layers: entry.document.layers.map((layer) => ({ ...layer, visible: entry.layers.get(layer.name).visible }))
        }));
    }

    findDocument(documentId) {
        return this.documents.get(documentId) ?? null;
    }

    listLayerPrimitives(documentId, layerName) {
        const entry = this.documents.get(documentId);
        return entry ? entry.document.primitives.filter((primitive) => primitive.layer === layerName) : [];
    }

    setLayerVisible(documentId, layerName, visible) {
        const layerState = this.documents.get(documentId)?.layers.get(layerName);
        if (!layerState || layerState.visible === visible) {
            return;
        }
        layerState.visible = visible;
        if (layerState.object) {
            layerState.object.visible = visible;
        }
        layerState.labels.forEach((label) => {
            label.visible = visible;
        });
        this.notifyChanged();
    }

    notifyChanged() {
        this.dispatchEvent({ type: "documents_changed" });
        this.dispatchEvent({ type: "snap_lines_changed" });
    }

    getVisibleSnapLines() {
        return [...this.documents.values()].flatMap((entry) => [...entry.layers.values()]
            .filter((layerState) => layerState.visible)
            .flatMap((layerState) => layerState.lines));
    }

    drapePoint(entry, point) {
        return new THREE.Vector3(point.x, point.y, this.resolveHeight(entry, point) + (entry.document.isFlat ? LIFT_METRES : 0));
    }

    drapeLine(entry, points, isClosed) {
        const vertices = isClosed ? [...points, points[0]] : points;
        const corners = vertices.map((point) => this.drapePoint(entry, point));
        if (!entry.document.isFlat) {
            return { points: corners, corners: corners };
        }
        const draped = [];
        for (let index = 0; index < vertices.length - 1; index++) {
            const start = vertices[index];
            const end = vertices[index + 1];
            const stepCount = Math.max(1, Math.ceil(Math.hypot(end.x - start.x, end.y - start.y) / DENSIFY_STEP_METRES));
            draped.push(corners[index]);
            for (let step = 1; step < stepCount; step++) {
                const share = step / stepCount;
                draped.push(this.drapePoint(entry, { x: start.x + (end.x - start.x) * share, y: start.y + (end.y - start.y) * share, z: 0 }));
            }
        }
        draped.push(corners[corners.length - 1]);
        return { points: draped, corners: corners };
    }

    buildLayer(entry, layerName) {
        const layerState = entry.layers.get(layerName);
        const positions = [];
        const colors = [];
        const color = new THREE.Color();
        let origin = null;
        const addSegment = (start, end, segmentColor) => {
            origin = origin ?? start.clone();
            positions.push(start.x - origin.x, start.y - origin.y, start.z - origin.z, end.x - origin.x, end.y - origin.y, end.z - origin.z);
            color.setHex(segmentColor);
            colors.push(color.r, color.g, color.b, color.r, color.g, color.b);
        };
        for (const primitive of entry.document.primitives) {
            if (primitive.layer !== layerName) {
                continue;
            }
            if (primitive.kind === DxfPrimitiveKind.LINE || primitive.kind === DxfPrimitiveKind.CIRCLE) {
                const line = this.drapeLine(entry, primitive.points, primitive.isClosed);
                for (let index = 0; index < line.points.length - 1; index++) {
                    addSegment(line.points[index], line.points[index + 1], primitive.color);
                }
                layerState.lines.push(line);
            } else if (primitive.kind === DxfPrimitiveKind.POINT) {
                const center = this.drapePoint(entry, primitive.position);
                const offsets = [[POINT_CROSS_HALF_SIZE_METRES, 0], [0, POINT_CROSS_HALF_SIZE_METRES]];
                for (const [offsetX, offsetY] of offsets) {
                    addSegment(new THREE.Vector3(center.x - offsetX, center.y - offsetY, center.z), new THREE.Vector3(center.x + offsetX, center.y + offsetY, center.z), primitive.color);
                }
                layerState.lines.push({ points: [center], corners: [center] });
            } else if (primitive.kind === DxfPrimitiveKind.TEXT && this.countLabels(entry) < MAXIMUM_LABELS_PER_DOCUMENT) {
                layerState.labels.push(this.createLabel(primitive, this.drapePoint(entry, primitive.position), layerState.visible));
            }
        }
        if (origin) {
            const geometry = new LineSegmentsGeometry();
            geometry.setPositions(positions);
            geometry.setColors(colors);
            const material = new LineMaterial({ color: 0xffffff, linewidth: LINE_WIDTH_PIXELS, vertexColors: true, resolution: this.renderSize.clone() });
            material.transparent = true;
            material.depthTest = false;
            material.depthWrite = false;
            layerState.object = new LineSegments2(geometry, material);
            layerState.object.position.copy(origin);
            layerState.object.visible = layerState.visible;
            layerState.object.frustumCulled = false;
            this.scene.add(layerState.object);
        }
    }

    countLabels(entry) {
        return [...entry.layers.values()].reduce((count, layerState) => count + layerState.labels.length, 0);
    }

    createLabel(primitive, position, visible) {
        const label = new TextSprite("");
        label.material.map?.dispose();
        label.fontsize = LABEL_FONT_SIZE;
        label.textColor = LABEL_TEXT_COLOR;
        label.backgroundColor = LABEL_BACKGROUND_COLOR;
        label.borderColor = toLabelColor(primitive.color);
        label.setText(primitive.text);
        label.sprite.renderOrder = LABEL_RENDER_ORDER;
        label.position.copy(position);
        label.visible = visible;
        this.scene.add(label);
        return label;
    }

    disposeLayer(entry, layerName) {
        const layerState = entry.layers.get(layerName);
        if (layerState.object) {
            this.scene.remove(layerState.object);
            disposeObject(layerState.object);
            layerState.object = null;
        }
        for (const label of layerState.labels) {
            this.scene.remove(label);
            disposeObject(label);
        }
        layerState.labels = [];
        layerState.lines = [];
    }

    rebuildAll() {
        for (const entry of this.documents.values()) {
            for (const layerName of entry.layers.keys()) {
                this.disposeLayer(entry, layerName);
                this.buildLayer(entry, layerName);
            }
        }
        if (this.documents.size > 0) {
            this.notifyChanged();
        }
    }

    update() {
        const { width, height } = this.viewer.renderer.getSize(this.renderSize);
        const camera = this.viewer.scene.getActiveCamera();
        for (const entry of this.documents.values()) {
            for (const layerState of entry.layers.values()) {
                layerState.object?.material.resolution.set(width, height);
                for (const label of layerState.labels) {
                    if (label.visible) {
                        const pixelsPerMetre = Utils.projectedRadius(1, camera, camera.position.distanceTo(label.position), width, height);
                        label.scale.setScalar(LABEL_SCALE_PIXELS / pixelsPerMetre);
                    }
                }
            }
        }
    }

    render() {
        if (this.scene.children.length > 0) {
            this.viewer.renderer.render(this.scene, this.viewer.scene.getActiveCamera());
        }
    }
}
