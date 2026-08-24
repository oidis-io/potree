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
import { Utils } from "../utils.js";

export function bindDuplicateDrag(owner, target, options) {
    const eventType = options.eventType;
    const payloadKey = options.payloadKey;
    const getReferenceZ = options.getReferenceZ || null;
    const useGroundFallback = options.useGroundFallback === true;
    const checkEnabled = options.checkEnabled === true;

    let ghost = null;
    let dragStartWorld = null;
    let dragViewer = null;
    let isDragging = false;
    let escHandler = null;

    const cleanupDrag = () => {
        if (ghost) {
            owner.remove(ghost);
            for (const child of ghost.children) {
                if (child.material) {
                    child.material.dispose();
                }
            }
            ghost = null;
        }
        if (escHandler) {
            window.removeEventListener("keydown", escHandler);
            escHandler = null;
        }
        isDragging = false;
        dragStartWorld = null;
        dragViewer = null;
    };

    const worldPointAt = (e) => {
        const intersection = Utils.getMousePointCloudIntersection(
            e.drag.end,
            e.viewer.scene.getActiveCamera(),
            e.viewer,
            e.viewer.scene.pointclouds,
            { pickClipped: true }
        );
        if (intersection && intersection.location) {
            return intersection.location.clone();
        }
        if (!useGroundFallback) {
            return null;
        }
        const referenceZ = getReferenceZ ? getReferenceZ() : 0;
        const camera = e.viewer.scene.getActiveCamera();
        const renderer = e.viewer.renderer;
        const ndc = new THREE.Vector2(
            (e.drag.end.x / renderer.domElement.clientWidth) * 2 - 1,
            -(e.drag.end.y / renderer.domElement.clientHeight) * 2 + 1
        );
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(ndc, camera);
        const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -referenceZ);
        const hit = new THREE.Vector3();
        if (raycaster.ray.intersectPlane(plane, hit)) {
            return hit;
        }
        return null;
    };

    const drag = (e) => {
        if (checkEnabled && owner.enabled === false) {
            return;
        }
        const world = worldPointAt(e);
        if (!world) {
            return;
        }
        if (!isDragging) {
            isDragging = true;
            dragStartWorld = world.clone();
            dragViewer = e.viewer;
            ghost = owner.createDuplicatePreview();
            owner.add(ghost);
            escHandler = (ev) => {
                if (ev.keyCode === 27) {
                    cleanupDrag();
                    if (dragViewer) {
                        dragViewer.inputHandler.drag = null;
                    }
                }
            };
            window.addEventListener("keydown", escHandler);
        }
        if (ghost) {
            ghost.position.copy(new THREE.Vector3().subVectors(world, dragStartWorld));
        }
    };

    const drop = (e) => {
        if (ghost && dragStartWorld) {
            let offset = ghost.position.clone();
            const world = worldPointAt(e);
            if (world) {
                offset = new THREE.Vector3().subVectors(world, dragStartWorld);
            }
            cleanupDrag();
            e.viewer.dispatchEvent({ type: eventType, [payloadKey]: owner, offset: offset });
        } else {
            cleanupDrag();
        }
    };

    target.addEventListener("drag", drag);
    target.addEventListener("drop", drop);
}
