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
import { TextSprite } from "../../TextSprite.js";
import { Utils } from "../../utils.js";
import { computeFeatureDimensions, DimensionKind } from "./FeatureDimensions.js";

const LABEL_SCALE_PIXELS = 45;
const LABEL_FONT_SIZE = 22;
const LABEL_RENDER_ORDER = 5;
const RADIUS_LINE_RENDER_ORDER = 2;
const MINIMUM_SEGMENT_PIXELS = 60;
const SEGMENT_LABEL_CENTER_Y = 0.9;
const POINT_LABEL_CENTER_Y = 1.3;

export class FeatureDimensionView {
    constructor(feature) {
        this.feature = feature;
        this.group = new THREE.Group();
        this.labels = [];
        this.dimensions = [];
        this.revision = null;
        this.labelColorHex = null;
        const radiusGeometry = new THREE.BufferGeometry();
        radiusGeometry.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3));
        this.radiusLineMaterial = new THREE.LineBasicMaterial({ transparent: true, depthTest: false, depthWrite: false });
        this.radiusLine = new THREE.Line(radiusGeometry, this.radiusLineMaterial);
        this.radiusLine.renderOrder = RADIUS_LINE_RENDER_ORDER;
        this.radiusLine.frustumCulled = false;
        this.group.add(this.radiusLine);
        feature.add(this.group);
    }

    invalidate() {
        this.revision = null;
    }

    sync(formatDimension) {
        if (this.revision === this.feature.revision) {
            return;
        }
        this.revision = this.feature.revision;
        this.dimensions = computeFeatureDimensions(this.feature);
        const colorHex = this.feature.color.getHex();
        if (this.labelColorHex !== colorHex) {
            this.labelColorHex = colorHex;
            this.labels.forEach((label) => this.applyBorderColor(label));
        }
        this.syncLabelCount(this.dimensions.length);
        this.dimensions.forEach((dimension, index) => {
            const label = this.labels[index];
            this.replaceTexture(label, () => label.setText(formatDimension(dimension)));
            label.position.copy(dimension.position);
            label.sprite.center.set(0.5, dimension.segment ? SEGMENT_LABEL_CENTER_Y : POINT_LABEL_CENTER_Y);
        });
        this.syncRadiusLine();
    }

    syncLabelCount(count) {
        while (this.labels.length > count) {
            this.disposeLabel(this.labels.pop());
        }
        while (this.labels.length < count) {
            const label = new TextSprite("");
            label.fontsize = LABEL_FONT_SIZE;
            this.replaceTexture(label, () => label.setTextColor({ r: 255, g: 255, b: 255, a: 1.0 }));
            this.replaceTexture(label, () => label.setBackgroundColor({ r: 0, g: 0, b: 0, a: 0.6 }));
            this.applyBorderColor(label);
            label.sprite.renderOrder = LABEL_RENDER_ORDER;
            this.group.add(label);
            this.labels.push(label);
        }
    }

    applyBorderColor(label) {
        this.replaceTexture(label, () => label.setBorderColor(this.toLabelColor(this.feature.color)));
    }

    syncRadiusLine() {
        const radiusDimension = this.dimensions.find((dimension) => dimension.kind === DimensionKind.RADIUS);
        this.radiusLine.visible = Boolean(radiusDimension);
        if (!radiusDimension) {
            return;
        }
        const [start, end] = radiusDimension.segment;
        const positions = this.radiusLine.geometry.attributes.position;
        positions.setXYZ(1, end.x - start.x, end.y - start.y, end.z - start.z);
        positions.needsUpdate = true;
        this.radiusLine.position.copy(start);
        this.radiusLineMaterial.color.copy(this.feature.color);
    }

    updateScreenSize(camera, renderWidth, renderHeight) {
        this.dimensions.forEach((dimension, index) => {
            const label = this.labels[index];
            label.visible = dimension.kind !== DimensionKind.LENGTH
                || this.measureSegmentPixels(dimension.segment, camera, renderWidth, renderHeight) >= MINIMUM_SEGMENT_PIXELS;
            if (label.visible) {
                const pixelsPerMetre = Utils.projectedRadius(1, camera, camera.position.distanceTo(label.position), renderWidth, renderHeight);
                label.scale.setScalar(LABEL_SCALE_PIXELS / pixelsPerMetre);
            }
        });
    }

    measureSegmentPixels([start, end], camera, renderWidth, renderHeight) {
        const projectedStart = start.clone().project(camera);
        const projectedEnd = end.clone().project(camera);
        if (Math.abs(projectedStart.z) > 1 || Math.abs(projectedEnd.z) > 1) {
            return 0;
        }
        return Math.hypot((projectedEnd.x - projectedStart.x) * renderWidth / 2, (projectedEnd.y - projectedStart.y) * renderHeight / 2);
    }

    toLabelColor(color) {
        return { r: Math.round(color.r * 255), g: Math.round(color.g * 255), b: Math.round(color.b * 255), a: 1.0 };
    }

    replaceTexture(label, applyChange) {
        const previousTexture = label.material.map;
        applyChange();
        if (previousTexture && previousTexture !== label.material.map) {
            previousTexture.dispose();
        }
    }

    disposeLabel(label) {
        this.group.remove(label);
        label.material.map?.dispose();
        label.material.dispose();
    }

    dispose() {
        this.labels.forEach((label) => this.disposeLabel(label));
        this.labels = [];
        this.radiusLine.geometry.dispose();
        this.radiusLineMaterial.dispose();
        this.feature.remove(this.group);
    }
}
