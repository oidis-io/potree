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

const VIEW_CHANGE_TOLERANCE = 0.001;
const DIRECTION_SCALE = 1000;

export class ViewChangeDetector {
    constructor(viewer, mapPlane) {
        this.viewer = viewer;
        this.mapPlane = mapPlane;
        this.lastSnapshot = null;
    }

    hasChanged() {
        const snapshot = this.createSnapshot();
        const previousSnapshot = this.lastSnapshot;
        const changed = previousSnapshot === null
            || previousSnapshot.length !== snapshot.length
            || snapshot.some((value, index) => Math.abs(value - previousSnapshot[index]) > VIEW_CHANGE_TOLERANCE);
        if (changed) {
            this.lastSnapshot = snapshot;
        }
        return changed;
    }

    createSnapshot() {
        const camera = this.viewer.scene.getActiveCamera();
        const direction = camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(DIRECTION_SCALE);
        const projection = camera.isOrthographicCamera
            ? [camera.left, camera.right, camera.top, camera.bottom, camera.zoom]
            : [camera.fov, camera.aspect];
        const { width, height } = this.mapPlane.getRenderSize();
        return [...camera.position.toArray(), ...direction.toArray(), ...projection, width, height, this.mapPlane.height];
    }
}
