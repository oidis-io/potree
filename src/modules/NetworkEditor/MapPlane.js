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

const MAP_PLANE_OFFSET = 2;

export class MapPlane {
    constructor(viewer) {
        this.viewer = viewer;
        this.raycaster = new THREE.Raycaster();
        this.renderSize = new THREE.Vector2();
    }

    get height() {
        const firstPointCloud = this.viewer.scene.pointclouds[0];
        const centerHeight = firstPointCloud?.boundingSphere?.center?.z;
        return Number.isFinite(centerHeight) ? centerHeight - MAP_PLANE_OFFSET : 0;
    }

    getRenderSize() {
        return this.viewer.renderer.getSize(this.renderSize);
    }

    intersectScreenPoint(screenX, screenY) {
        return this.intersectScreenPointAtHeight(screenX, screenY, this.height);
    }

    intersectScreenPointAtHeight(screenX, screenY, height) {
        const size = this.getRenderSize();
        if (size.width === 0 || size.height === 0) {
            return null;
        }
        const pointer = new THREE.Vector2(screenX / size.width * 2 - 1, -screenY / size.height * 2 + 1);
        this.raycaster.setFromCamera(pointer, this.viewer.scene.getActiveCamera());
        const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -height);
        return this.raycaster.ray.intersectPlane(plane, new THREE.Vector3());
    }

    metresPerPixelAt(screenX, screenY) {
        const point = this.intersectScreenPoint(screenX, screenY);
        const neighbour = this.intersectScreenPoint(screenX + 1, screenY);
        if (!point || !neighbour) {
            return null;
        }
        return point.distanceTo(neighbour);
    }
}
