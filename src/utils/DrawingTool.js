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
import { EventDispatcher } from "../EventDispatcher.js";
import { InsertPoint } from "../viewer/DrawableArea.js";

export class DrawingTool extends EventDispatcher {
    constructor(viewer) {
        super();

        this.viewer = viewer;
        this.renderer = viewer.renderer;
        this.area = this.viewer.drawableArea;

        this.addEventListener("start_inserting_drawing", e => {
            this.viewer.dispatchEvent({
                type: "cancel_insertions"
            });
        });

        this.showLabels = true;
        this.scene = new THREE.Scene();
        this.scene.name = "scene_drawing";
        this.light = new THREE.PointLight(0xffffff, 1.0);
        this.scene.add(this.light);

        this.viewer.inputHandler.registerInteractiveScene(this.scene);

        this.onRemove = (e) => {
            this.scene.remove(e.drawing);
        };
        this.onAdd = e => {
            this.scene.add(e.drawing);
        };

        for (let drawing of viewer.scene.drawings) {
            this.onAdd({ drawing: drawing });
        }

        viewer.addEventListener("update", this.update.bind(this));
        viewer.addEventListener("render.pass.perspective_overlay", this.render.bind(this));
        viewer.addEventListener("scene_changed", this.onSceneChange.bind(this));

        viewer.scene.addEventListener("drawing_added", this.onAdd);
        viewer.scene.addEventListener("drawing_removed", this.onRemove);
    }

    onSceneChange(e) {
        if (e.oldScene) {
            e.oldScene.removeEventListener("drawing_added", this.onAdd);
            e.oldScene.removeEventListener("drawing_removed", this.onRemove);
        }

        e.scene.addEventListener("drawing_added", this.onAdd);
        e.scene.addEventListener("drawing_removed", this.onRemove);
    }

    startInsertion(args = {}) {
        let domElement = this.viewer.renderer.domElement;
        let entity = new InsertPoint(this.area);

        this.dispatchEvent({
            type: "start_inserting_drawing",
            drawing: entity
        });

        entity.name = args.name || "Drawing";

        let cancel = {
            removeLastMarker: entity.maxMarkers > 3,
            callback: null
        };

        let insertionCallback = (e) => {
            if (e.button === THREE.MOUSE.LEFT) {
                measure.addMarker(measure.points[measure.points.length - 1].position.clone());

                if (measure.points.length >= measure.maxMarkers) {
                    cancel.callback();
                }

                this.viewer.inputHandler.startDragging(
                    measure.spheres[measure.spheres.length - 1]);
            } else if (e.button === THREE.MOUSE.RIGHT) {
                // TODO(mkelnar) handle also escape to finish insertions
                cancel.callback();
            }
        };

        cancel.callback = e => {
            if (cancel.removeLastMarker) {
                measure.removeMarker(measure.points.length - 1);
            }
            domElement.removeEventListener("mouseup", insertionCallback, false);
            this.viewer.removeEventListener("cancel_insertions", cancel.callback);
        };

        if (measure.maxMarkers > 1) {
            this.viewer.addEventListener("cancel_insertions", cancel.callback);
            domElement.addEventListener("mouseup", insertionCallback, false);
        }

        measure.addMarker(new THREE.Vector3(0, 0, 0));
        this.viewer.inputHandler.startDragging(
            measure.spheres[measure.spheres.length - 1]);

        this.viewer.scene.addMeasurement(measure);

        return measure;
    }

    update() {
        // TODO(mkelnar) processing ?
    }

    render() {
        this.viewer.renderer.render(this.scene, this.viewer.scene.getActiveCamera());
    }
}
