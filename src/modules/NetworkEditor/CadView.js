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

export class CadView {
    constructor(viewer, cadDocument) {
        this.viewer = viewer;
        this.cadDocument = cadDocument;
        this.scene = new THREE.Scene();
        this.renderSize = new THREE.Vector2();
        this.draftFeature = null;

        for (const feature of cadDocument.features) {
            this.scene.add(feature);
        }
        cadDocument.addEventListener("feature_added", (event) => this.scene.add(event.feature));
        cadDocument.addEventListener("feature_removed", (event) => this.scene.remove(event.feature));
        viewer.addEventListener("update", () => this.update());
        viewer.addEventListener("render.pass.perspective_overlay", () => this.render());
    }

    setDraftFeature(feature) {
        if (this.draftFeature) {
            this.scene.remove(this.draftFeature);
        }
        this.draftFeature = feature;
        if (feature) {
            this.scene.add(feature);
        }
    }

    update() {
        const camera = this.viewer.scene.getActiveCamera();
        const { width, height } = this.viewer.renderer.getSize(this.renderSize);
        for (const feature of this.scene.children) {
            feature.updateScreenSize(camera, width, height);
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
