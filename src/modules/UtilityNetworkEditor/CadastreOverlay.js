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
import { CadastreLayer, fetchCadastreFeatures } from "./CadastreService.js";

export const CadastreOverlayLayer = Object.freeze({
    ALIGNED_BUILDINGS: "aligned_buildings",
    ESTIMATED_BUILDINGS: "estimated_buildings",
    MANUAL_BUILDINGS: "manual_buildings",
    REFERENCE_OUTLINES: "reference_outlines",
    SHIFT_ARROWS: "shift_arrows",
    MOVE_PREVIEW: "move_preview"
});

const LAYER_STYLES = Object.freeze({
    [CadastreLayer.PARCELS]: { color: 0xffd400, lineWidth: 1.5, isSnappable: true },
    [CadastreLayer.BUILDINGS]: { color: 0xff7a1a, lineWidth: 2, isSnappable: true },
    [CadastreLayer.REFERENCE_BUILDINGS]: { color: 0x3b82f6, lineWidth: 2, isSnappable: true },
    [CadastreLayer.ROADS]: { color: 0xc8ccd2, lineWidth: 2.5, isSnappable: true },
    [CadastreOverlayLayer.ALIGNED_BUILDINGS]: { color: 0x39d353, lineWidth: 2.5, isSnappable: true },
    [CadastreOverlayLayer.ESTIMATED_BUILDINGS]: { color: 0x22d3ee, lineWidth: 2.5, isSnappable: true },
    [CadastreOverlayLayer.MANUAL_BUILDINGS]: { color: 0xc084fc, lineWidth: 2.5, isSnappable: true },
    [CadastreOverlayLayer.REFERENCE_OUTLINES]: { color: 0x60a5fa, lineWidth: 1.5, isSnappable: true },
    [CadastreOverlayLayer.SHIFT_ARROWS]: { color: 0xff4fd8, lineWidth: 1.5, isSnappable: false },
    [CadastreOverlayLayer.MOVE_PREVIEW]: { color: 0xc084fc, lineWidth: 2.5, isSnappable: false }
});
const DENSIFY_STEP_METRES = 2;
const LIFT_METRES = 0.15;
const LABEL_SCALE_PIXELS = 40;
const LABEL_FONT_SIZE = 22;
const LABEL_RENDER_ORDER = 5;
const LABEL_TEXT_COLOR = { r: 255, g: 255, b: 255, a: 1.0 };
const LABEL_BACKGROUND_COLOR = { r: 0, g: 0, b: 0, a: 0.6 };
const LABEL_BORDER_COLOR = { r: 255, g: 79, b: 216, a: 1.0 };

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

    getLayerColor(layerId) {
        const style = LAYER_STYLES[layerId];
        return style ? `#${style.color.toString(16).padStart(6, "0")}` : null;
    }

    getOrCreateLayer(layerId) {
        if (!this.layers.has(layerId)) {
            this.layers.set(layerId, {
                visible: false,
                features: [],
                drapedFeatures: [],
                hiddenIdentifiers: new Set(),
                labels: [],
                labelSprites: [],
                object: null,
                requestIndex: 0
            });
        }
        return this.layers.get(layerId);
    }

    async loadLayer(layerId, extent) {
        const layer = this.getOrCreateLayer(layerId);
        const requestIndex = layer.requestIndex + 1;
        layer.requestIndex = requestIndex;
        this.dispatchEvent({ type: "layer_loading", layerId: layerId });
        try {
            const result = await fetchCadastreFeatures(layerId, extent);
            if (layer.requestIndex !== requestIndex) {
                return;
            }
            layer.features = result.features;
            this.drapeLayer(layerId);
            const lineCount = result.features.reduce((count, feature) => count + feature.lines.length, 0);
            this.dispatchEvent({ type: "layer_loaded", layerId: layerId, extent: extent, lineCount: lineCount, isTruncated: result.isTruncated });
        } catch (error) {
            if (layer.requestIndex === requestIndex) {
                this.dispatchEvent({ type: "layer_failed", layerId: layerId, error: error });
            }
        }
    }

    getLayerFeatures(layerId) {
        return this.layers.get(layerId)?.features ?? [];
    }

    setStaticLayer(layerId, features, labels = []) {
        const layer = this.getOrCreateLayer(layerId);
        layer.features = features;
        layer.labels = labels;
        this.drapeLayer(layerId);
    }

    setHiddenFeatures(layerId, identifiers) {
        const layer = this.layers.get(layerId);
        if (!layer) {
            return;
        }
        layer.hiddenIdentifiers = new Set(identifiers.map((identifier) => String(identifier)));
        this.replaceLayerObject(layerId, layer);
        this.notifySnapLinesChanged(layerId);
    }

    notifySnapLinesChanged(layerId) {
        if (LAYER_STYLES[layerId].isSnappable) {
            this.dispatchEvent({ type: "snap_lines_changed" });
        }
    }

    isLayerVisible(layerId) {
        return this.layers.get(layerId)?.visible ?? false;
    }

    setLayerVisible(layerId, visible) {
        const layer = this.layers.get(layerId);
        if (!layer) {
            return;
        }
        const isChanged = layer.visible !== visible;
        layer.visible = visible;
        if (layer.object) {
            layer.object.visible = visible;
        }
        layer.labelSprites.forEach((sprite) => {
            sprite.visible = visible;
        });
        this.notifySnapLinesChanged(layerId);
        if (isChanged) {
            this.dispatchEvent({ type: "layer_visibility_changed", layerId: layerId, visible: visible });
        }
    }

    getVisibleSnapLines() {
        return [...this.layers.entries()]
            .filter(([layerId, layer]) => layer.visible && LAYER_STYLES[layerId].isSnappable)
            .flatMap(([, layer]) => this.collectShownLines(layer));
    }

    collectShownLines(layer) {
        return layer.drapedFeatures
            .filter((feature) => !layer.hiddenIdentifiers.has(String(feature.identifier)))
            .flatMap((feature) => feature.drapedLines);
    }

    drapeLayer(layerId) {
        const layer = this.layers.get(layerId);
        layer.drapedFeatures = layer.features.map((feature) => ({
            identifier: feature.identifier,
            drapedLines: feature.lines.map((line) => this.drapeLine(line))
        }));
        this.replaceLayerObject(layerId, layer);
        this.replaceLayerLabels(layer);
        this.notifySnapLinesChanged(layerId);
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
        const shownLines = this.collectShownLines(layer);
        const origin = shownLines[0]?.points[0];
        if (!origin) {
            return;
        }
        const positions = [];
        for (const line of shownLines) {
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

    replaceLayerLabels(layer) {
        layer.labelSprites.forEach((sprite) => this.disposeLabel(sprite));
        layer.labelSprites = layer.labels.map((label) => this.createLabel(label, layer.visible));
    }

    createLabel(label, visible) {
        const sprite = new TextSprite("");
        sprite.material.map?.dispose();
        sprite.fontsize = LABEL_FONT_SIZE;
        sprite.textColor = LABEL_TEXT_COLOR;
        sprite.backgroundColor = LABEL_BACKGROUND_COLOR;
        sprite.borderColor = LABEL_BORDER_COLOR;
        sprite.setText(label.text);
        sprite.sprite.renderOrder = LABEL_RENDER_ORDER;
        sprite.position.copy(this.createDrapedPoint(label.x, label.y));
        sprite.visible = visible;
        this.scene.add(sprite);
        return sprite;
    }

    disposeLabel(sprite) {
        this.scene.remove(sprite);
        sprite.material.map?.dispose();
        sprite.material.dispose();
    }

    update() {
        const { width, height } = this.viewer.renderer.getSize(this.renderSize);
        const camera = this.viewer.scene.getActiveCamera();
        for (const layer of this.layers.values()) {
            layer.object?.material.resolution.set(width, height);
            for (const sprite of layer.labelSprites) {
                const pixelsPerMetre = Utils.projectedRadius(1, camera, camera.position.distanceTo(sprite.position), width, height);
                sprite.scale.setScalar(LABEL_SCALE_PIXELS / pixelsPerMetre);
            }
        }
    }

    render() {
        if (this.scene.children.length > 0) {
            this.viewer.renderer.render(this.scene, this.viewer.scene.getActiveCamera());
        }
    }
}
