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
import { FeatureDimensionView } from "./FeatureDimensionView.js";

export class CadView {
    constructor(viewer, cadDocument) {
        this.viewer = viewer;
        this.cadDocument = cadDocument;
        this.scene = new THREE.Scene();
        this.renderSize = new THREE.Vector2();
        this.draftFeature = null;
        this.dimensionViews = new Map();
        this.isDimensionVisible = true;
        this.formatDimension = (dimension) => dimension.value.toFixed(2);

        for (const feature of cadDocument.features) {
            this.addFeature(feature);
        }
        cadDocument.addEventListener("feature_added", (event) => this.addFeature(event.feature));
        cadDocument.addEventListener("feature_removed", (event) => this.removeFeature(event.feature));
        viewer.addEventListener("update", () => this.update());
        viewer.addEventListener("render.pass.perspective_overlay", () => this.render());
    }

    addFeature(feature) {
        this.scene.add(feature);
        this.dimensionViews.set(feature, new FeatureDimensionView(feature));
    }

    removeFeature(feature) {
        this.scene.remove(feature);
        this.dimensionViews.get(feature)?.dispose();
        this.dimensionViews.delete(feature);
    }

    setDraftFeature(feature) {
        if (this.draftFeature) {
            this.removeFeature(this.draftFeature);
        }
        this.draftFeature = feature;
        if (feature) {
            this.addFeature(feature);
        }
    }

    setDimensionVisible(isVisible) {
        this.isDimensionVisible = isVisible;
    }

    setDimensionFormatter(formatDimension) {
        this.formatDimension = formatDimension;
        this.dimensionViews.forEach((dimensionView) => dimensionView.invalidate());
    }

    update() {
        const camera = this.viewer.scene.getActiveCamera();
        const { width, height } = this.viewer.renderer.getSize(this.renderSize);
        for (const feature of this.scene.children) {
            feature.updateScreenSize(camera, width, height);
            const dimensionView = this.dimensionViews.get(feature);
            if (!dimensionView) {
                continue;
            }
            dimensionView.group.visible = this.isDimensionVisible;
            if (this.isDimensionVisible) {
                dimensionView.sync(this.formatDimension);
                dimensionView.updateScreenSize(camera, width, height);
            }
        }
    }

    render() {
        if (this.scene.children.length === 0) {
            return;
        }
        const renderer = this.viewer.renderer;
        const previousSortObjects = renderer.sortObjects;
        renderer.sortObjects = true;
        renderer.render(this.scene, this.viewer.scene.getActiveCamera());
        renderer.sortObjects = previousSortObjects;
    }
}
