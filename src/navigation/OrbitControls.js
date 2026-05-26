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

/**
 * @author mschuetz / http://mschuetz.at
 *
 * adapted from THREE.OrbitControls by
 *
 * @author qiao / https://github.com/qiao
 * @author mrdoob / http://mrdoob.com
 * @author alteredq / http://alteredqualia.com/
 * @author WestLangley / http://github.com/WestLangley
 * @author erich666 / http://erichaines.com
 */

import * as THREE from "../../libs/three.js/build/three.module.js";
import TWEEN from "../../libs/tween/tween.min.js";
import { MOUSE } from "../defines.js";
import { Utils } from "../utils.js";
import { EventDispatcher } from "../EventDispatcher.js";
import PotreeConfig, { ViewMode } from "../PotreeConfig.js";

export class OrbitControls extends EventDispatcher {
    constructor(viewer) {
        super();

        this.viewer = viewer;
        this.renderer = viewer.renderer;

        this.scene = null;
        this.sceneControls = new THREE.Scene();

        this.rotationSpeed = 5;

        this.fadeFactor = 20;
        this.yawDelta = 0;
        this.pitchDelta = 0;
        this.panDelta = new THREE.Vector2(0, 0);
        this.radiusDelta = 0;
        this.wheelDelta = 0;
        this.zoomDelta = new THREE.Vector3();

        this.doubleClickZoomEnabled = true;

        this.tweens = [];

        let drag = (e) => {
            if (e.drag.object !== null) {
                return;
            }

            if (e.drag.startHandled === undefined) {
                e.drag.startHandled = true;

                this.dispatchEvent({ type: "start" });
            }

            let ndrag = {
                x: e.drag.lastDrag.x / this.renderer.domElement.clientWidth,
                y: e.drag.lastDrag.y / this.renderer.domElement.clientHeight
            };

            if (e.drag.mouse === MOUSE.LEFT) {
                this.yawDelta += ndrag.x * this.rotationSpeed;
                this.pitchDelta += ndrag.y * this.rotationSpeed;

                this.stopTweens();
            } else if (e.drag.mouse === MOUSE.RIGHT) {
                this.panDelta.x += ndrag.x;
                this.panDelta.y += ndrag.y;

                this.stopTweens();
            }
        };

        let drop = e => {
            this.dispatchEvent({ type: "end" });
        };

        let scroll = (e) => {
            this.wheelDelta += e.delta;
            this.stopTweens();
        };

        let dblclick = (e) => {
            if (this.doubleClickZoomEnabled) {
                this.zoomToLocation(e.mouse);
            }
        };

        let previousTouch = null;
        let touchStart = e => {
            previousTouch = e;
        };

        let touchEnd = e => {
            previousTouch = e;
        };

        let touchMove = e => {
            if (e.touches.length === 2 && previousTouch.touches.length === 2) {
                let prev = previousTouch;
                let curr = e;

                let prevDX = prev.touches[0].pageX - prev.touches[1].pageX;
                let prevDY = prev.touches[0].pageY - prev.touches[1].pageY;
                let prevDist = Math.sqrt(prevDX * prevDX + prevDY * prevDY);

                let currDX = curr.touches[0].pageX - curr.touches[1].pageX;
                let currDY = curr.touches[0].pageY - curr.touches[1].pageY;
                let currDist = Math.sqrt(currDX * currDX + currDY * currDY);

                let delta = currDist / prevDist;
                let resolvedRadius = this.scene.view.radius + this.radiusDelta;
                let newRadius = resolvedRadius / delta;
                this.radiusDelta = newRadius - resolvedRadius;

                this.stopTweens();
            } else if (e.touches.length === 3 && previousTouch.touches.length === 3) {
                let prev = previousTouch;
                let curr = e;

                let prevMeanX = (prev.touches[0].pageX + prev.touches[1].pageX + prev.touches[2].pageX) / 3;
                let prevMeanY = (prev.touches[0].pageY + prev.touches[1].pageY + prev.touches[2].pageY) / 3;

                let currMeanX = (curr.touches[0].pageX + curr.touches[1].pageX + curr.touches[2].pageX) / 3;
                let currMeanY = (curr.touches[0].pageY + curr.touches[1].pageY + curr.touches[2].pageY) / 3;

                let delta = {
                    x: (currMeanX - prevMeanX) / this.renderer.domElement.clientWidth,
                    y: (currMeanY - prevMeanY) / this.renderer.domElement.clientHeight
                };

                this.panDelta.x += delta.x;
                this.panDelta.y += delta.y;

                this.stopTweens();
            }

            previousTouch = e;
        };

        this.addEventListener("touchstart", touchStart);
        this.addEventListener("touchend", touchEnd);
        this.addEventListener("touchmove", touchMove);
        this.addEventListener("drag", drag);
        this.addEventListener("drop", drop);
        this.addEventListener("mousewheel", scroll);
        this.addEventListener("dblclick", dblclick);
    }

    setScene(scene) {
        this.scene = scene;
    }

    get doubleClockZoomEnabled() {
        return this.doubleClickZoomEnabled;
    }

    set doubleClockZoomEnabled(value) {
        this.doubleClickZoomEnabled = value;
    }

    stop() {
        this.yawDelta = 0;
        this.pitchDelta = 0;
        this.radiusDelta = 0;
        this.wheelDelta = 0;
        this.zoomDelta.set(0, 0, 0);
        this.panDelta.set(0, 0);
    }

    zoomToLocation(mouse) {
        let camera = this.scene.getActiveCamera();

        let I = Utils.getMousePointCloudIntersection(
            mouse,
            camera,
            this.viewer,
            this.scene.pointclouds,
            { pickClipped: true });

        if (I === null) {
            return;
        }

        let targetRadius = 0;
        {
            let minimumJumpDistance = 0.2;

            if (I.pointcloud !== null) {
                let domElement = this.renderer.domElement;
                let ray = Utils.mouseToRay(mouse, camera, domElement.clientWidth, domElement.clientHeight);

                let nodes = I.pointcloud.nodesOnRay(I.pointcloud.visibleNodes, ray);
                let lastNode = nodes[nodes.length - 1];
                let radius = lastNode.getBoundingSphere(new THREE.Sphere()).radius;
                targetRadius = Math.min(this.scene.view.radius, radius);
                targetRadius = Math.max(minimumJumpDistance, targetRadius);
            } else {
                targetRadius = Math.max(minimumJumpDistance, this.scene.view.radius * 0.5);
            }
        }

        let d = this.scene.view.direction.multiplyScalar(-1);
        let cameraTargetPosition = new THREE.Vector3().addVectors(I.location, d.multiplyScalar(targetRadius));
        let animationDuration = 600;
        let easing = TWEEN.Easing.Quartic.Out;

        { // animate
            let value = { x: 0 };
            let tween = new TWEEN.Tween(value).to({ x: 1 }, animationDuration);
            tween.easing(easing);
            this.tweens.push(tween);

            let startPos = this.scene.view.position.clone();
            let targetPos = cameraTargetPosition.clone();
            let startRadius = this.scene.view.radius;
            let targetRadius = cameraTargetPosition.distanceTo(I.location);

            tween.onUpdate(() => {
                let t = value.x;
                this.scene.view.position.x = (1 - t) * startPos.x + t * targetPos.x;
                this.scene.view.position.y = (1 - t) * startPos.y + t * targetPos.y;
                this.scene.view.position.z = (1 - t) * startPos.z + t * targetPos.z;

                this.scene.view.radius = (1 - t) * startRadius + t * targetRadius;
                this.viewer.setMoveSpeed(this.scene.view.radius);
            });

            tween.onComplete(() => {
                this.tweens = this.tweens.filter(e => e !== tween);
            });

            tween.start();
        }
    }

    stopTweens() {
        this.tweens.forEach(e => e.stop());
        this.tweens = [];
    }

    update(delta) {
        let view = this.scene.view;

        { // apply rotation
            let progression = Math.min(1, this.fadeFactor * delta);

            let yaw = view.yaw;
            let pitch = view.pitch;
            let pivot = view.getPivot();

            yaw -= progression * this.yawDelta;
            pitch -= progression * this.pitchDelta;

            if (PotreeConfig.viewMode === ViewMode.FLAT) {
                yaw = 0;
                pitch = -Math.PI / 2;
            }

            view.yaw = yaw;
            view.pitch = pitch;
            if (PotreeConfig.lockToUpperHemisphere && pitch > Math.PI / 8) {
                view.pitch = Math.PI / 8;
            }

            let V = this.scene.view.direction.multiplyScalar(-view.radius);
            let position = new THREE.Vector3().addVectors(pivot, V);

            view.position.copy(position);
        }

        { // apply pan
            let progression = Math.min(1, this.fadeFactor * delta);
            let panDistance = progression * view.radius * 3;

            let px = -this.panDelta.x * panDistance;
            let py = this.panDelta.y * panDistance;

            view.pan(px, py);
        }

        if (this.wheelDelta !== 0) {
            let camera = this.scene.getActiveCamera();
            let I = Utils.getMousePointCloudIntersection(
                this.viewer.inputHandler.mouse,
                camera,
                this.viewer,
                this.scene.pointclouds,
                { pickClipped: true });

            if (I) {
                let resolvedPos = new THREE.Vector3().addVectors(view.position, this.zoomDelta);
                let distance = I.location.distanceTo(resolvedPos);
                let jumpDistance = distance * 0.2 * this.wheelDelta;
                let targetDir = new THREE.Vector3().subVectors(I.location, view.position).normalize();

                resolvedPos.add(targetDir.multiplyScalar(jumpDistance));
                this.zoomDelta.subVectors(resolvedPos, view.position);

                view.radius = resolvedPos.distanceTo(I.location);
            } else {
                this.radiusDelta += -this.wheelDelta * (view.radius + this.radiusDelta) * 0.1;
            }
        }

        if (this.zoomDelta.lengthSq() !== 0) {
            let fade = Math.pow(0.5, this.fadeFactor * delta);
            let progression = 1 - fade;
            let step = this.zoomDelta.clone().multiplyScalar(progression);
            view.position.add(step);
            this.zoomDelta.multiplyScalar(fade);
        }

        if (this.radiusDelta !== 0) {
            let progression = Math.min(1, this.fadeFactor * delta);
            let radius = view.radius + progression * this.radiusDelta;
            let V = view.direction.multiplyScalar(-radius);
            let position = new THREE.Vector3().addVectors(view.getPivot(), V);
            view.radius = radius;

            view.position.copy(position);
        }

        {
            let speed = view.radius;
            this.viewer.setMoveSpeed(speed);
        }

        {
            let progression = Math.min(1, this.fadeFactor * delta);
            let attenuation = Math.max(0, 1 - this.fadeFactor * delta);

            this.yawDelta *= attenuation;
            this.pitchDelta *= attenuation;
            this.panDelta.multiplyScalar(attenuation);
            this.radiusDelta -= progression * this.radiusDelta;
            this.wheelDelta = 0;
        }
    }
}
