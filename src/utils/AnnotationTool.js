/*! ******************************************************************************************************** *
 *
 * Copyright 2011-2020 Markus Schütz
 * Copyright 2025 Oidis
 *
 * SPDX-License-Identifier: BSD-2-Clause
 * The BSD-2-Clause license for this file can be found in the LICENSE.txt file included with this distribution
 * or at https://spdx.org/licenses/BSD-2-Clause.html#licenseText
 *
 * ********************************************************************************************************* */

import * as THREE from "../../libs/three.js/build/three.module.js";
import { Annotation } from "../Annotation.js";
import { Utils } from "../utils.js";
import { EventDispatcher } from "../EventDispatcher.js";

export class AnnotationTool extends EventDispatcher {
    constructor(viewer) {
        super();

        this.viewer = viewer;
        this.renderer = viewer.renderer;

        this.sg = new THREE.SphereGeometry(0.1);
        this.sm = new THREE.MeshNormalMaterial();
        this.s = new THREE.Mesh(this.sg, this.sm);
    }

    startInsertion(args = {}) {
        let domElement = this.viewer.renderer.domElement;

        let annotation = new Annotation({
            position: [589748.270, 231444.540, 753.675],
            title: "Annotation Title",
            description: `Annotation Description`
        });
        this.dispatchEvent({ type: "start_inserting_annotation", annotation: annotation });

        const annotations = this.viewer.scene.annotations;
        annotations.add(annotation);

        let callbacks = {
            cancel: null,
            finish: null,
        };

        let insertionCallback = (e) => {
            if (e.button === THREE.MOUSE.LEFT) {
                callbacks.finish();
            } else if (e.button === THREE.MOUSE.RIGHT) {
                callbacks.cancel();
            }
        };

        callbacks.cancel = e => {
            annotations.remove(annotation);

            domElement.removeEventListener("mouseup", insertionCallback, true);
        };

        callbacks.finish = e => {
            domElement.removeEventListener("mouseup", insertionCallback, true);
        };

        domElement.addEventListener("mouseup", insertionCallback, true);

        let drag = (e) => {
            let I = Utils.getMousePointCloudIntersection(
                e.drag.end,
                e.viewer.scene.getActiveCamera(),
                e.viewer,
                e.viewer.scene.pointclouds,
                { pickClipped: true });

            if (I) {
                this.s.position.copy(I.location);

                annotation.position.copy(I.location);
            }
        };

        let drop = (e) => {
            this.viewer.scene.scene.remove(this.s);
            this.s.removeEventListener("drag", drag);
            this.s.removeEventListener("drop", drop);
        };

        this.s.addEventListener("drag", drag);
        this.s.addEventListener("drop", drop);

        this.viewer.scene.scene.add(this.s);
        this.viewer.inputHandler.startDragging(this.s);

        return annotation;
    }

    update() {
        // dummy
    }

    render() {
        // this.viewer.renderer.render(this.scene, this.viewer.scene.getActiveCamera());
    }
}
