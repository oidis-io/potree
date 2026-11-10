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
import { CadastreLayer, fetchCadastreLines } from "./CadastreService.js";

const LAYER_STYLES = Object.freeze({
    [CadastreLayer.PARCELS]: { color: 0xffd400, lineWidth: 1.5 },
    [CadastreLayer.BUILDINGS]: { color: 0xff7a1a, lineWidth: 2 },
    [CadastreLayer.ROADS]: { color: 0x5ec8ff, lineWidth: 2.5 }
});
const DENSIFY_STEP_METRES = 2;
const LIFT_METRES = 0.15;

export class CadastreOverlay extends EventDispatcher {
    constructor(viewer, mapPlane) {
        super();
        this.viewer = viewer;
        this.mapPlane = mapPlane;
        this.terrainHeightSampler = null;
        this.layers = new Map();
        this.renderSize = new THREE.Vector2();
        this.scene = new THREE.Scene();

        viewer.addEventListener("update", () => this.update());
        viewer.addEventListener("render.pass.perspective_overlay", () => this.render());
    }

    setTerrainHeightSampler(terrainHeightSampler) {
        this.terrainHeightSampler = terrainHeightSampler;
        terrainHeightSampler.addEventListener("ready", () => {
            for (const layerId of this.layers.keys()) {
                this.drapeLayer(layerId);
            }
        });
    }

    async loadLayer(layerId, extent) {
        const requestIndex = (this.layers.get(layerId)?.requestIndex ?? 0) + 1;
        const layer = this.layers.get(layerId) ?? { visible: true, flatLines: [], drapedLines: [], object: null };
        layer.requestIndex = requestIndex;
        this.layers.set(layerId, layer);
        this.dispatchEvent({ type: "layer_loading", layerId: layerId });
        try {
            const result = await fetchCadastreLines(layerId, extent);
            if (layer.requestIndex !== requestIndex) {
                return;
            }
            layer.flatLines = result.lines;
            this.drapeLayer(layerId);
            this.dispatchEvent({ type: "layer_loaded", layerId: layerId, lineCount: result.lines.length, isTruncated: result.isTruncated });
        } catch (error) {
            if (layer.requestIndex === requestIndex) {
                this.dispatchEvent({ type: "layer_failed", layerId: layerId, error: error });
            }
        }
    }

    setLayerVisible(layerId, visible) {
        const layer = this.layers.get(layerId);
        if (!layer) {
            return;
        }
        layer.visible = visible;
        if (layer.object) {
            layer.object.visible = visible;
        }
        this.dispatchEvent({ type: "snap_lines_changed" });
    }

    getVisibleSnapLines() {
        return [...this.layers.values()].filter((layer) => layer.visible).flatMap((layer) => layer.drapedLines);
    }

    drapeLayer(layerId) {
        const layer = this.layers.get(layerId);
        layer.drapedLines = layer.flatLines.map((line) => this.drapeLine(line));
        this.replaceLayerObject(layerId, layer);
        this.dispatchEvent({ type: "snap_lines_changed" });
    }

    drapeLine(line) {
        const points = [];
        const corners = [];
        for (let index = 0; index < line.length - 1; index++) {
            const [startX, startY] = line[index];
            const [endX, endY] = line[index + 1];
            const stepCount = Math.max(1, Math.ceil(Math.hypot(endX - startX, endY - startY) / DENSIFY_STEP_METRES));
            for (let step = 0; step < stepCount; step++) {
                const share = step / stepCount;
                const point = this.createDrapedPoint(startX + (endX - startX) * share, startY + (endY - startY) * share);
                points.push(point);
                if (step === 0) {
                    corners.push(point);
                }
            }
        }
        const [lastX, lastY] = line[line.length - 1];
        const lastPoint = this.createDrapedPoint(lastX, lastY);
        points.push(lastPoint);
        corners.push(lastPoint);
        return { points: points, corners: corners };
    }

    createDrapedPoint(x, y) {
        const terrainHeight = this.terrainHeightSampler?.heightAt(x, y) ?? null;
        return new THREE.Vector3(x, y, (terrainHeight ?? this.mapPlane.height) + LIFT_METRES);
    }

    replaceLayerObject(layerId, layer) {
        if (layer.object) {
            this.scene.remove(layer.object);
            layer.object.geometry.dispose();
            layer.object.material.dispose();
            layer.object = null;
        }
        const origin = layer.drapedLines[0]?.points[0];
        if (!origin) {
            return;
        }
        const positions = [];
        for (const line of layer.drapedLines) {
            for (let index = 0; index < line.points.length - 1; index++) {
                const start = line.points[index];
                const end = line.points[index + 1];
                positions.push(start.x - origin.x, start.y - origin.y, start.z - origin.z, end.x - origin.x, end.y - origin.y, end.z - origin.z);
            }
        }
        const geometry = new LineSegmentsGeometry();
        geometry.setPositions(positions);
        const style = LAYER_STYLES[layerId];
        const material = new LineMaterial({ color: style.color, linewidth: style.lineWidth, resolution: this.renderSize.clone() });
        material.transparent = true;
        material.depthTest = false;
        material.depthWrite = false;
        layer.object = new LineSegments2(geometry, material);
        layer.object.position.copy(origin);
        layer.object.visible = layer.visible;
        layer.object.frustumCulled = false;
        this.scene.add(layer.object);
    }

    update() {
        const { width, height } = this.viewer.renderer.getSize(this.renderSize);
        for (const layer of this.layers.values()) {
            layer.object?.material.resolution.set(width, height);
        }
    }

    render() {
        if (this.scene.children.length > 0) {
            this.viewer.renderer.render(this.scene, this.viewer.scene.getActiveCamera());
        }
    }
}
