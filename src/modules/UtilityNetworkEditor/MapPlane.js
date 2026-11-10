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
const SCREEN_SAMPLES = [0, 0.25, 0.5, 0.75, 1];

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

    computeViewExtent(maximumExtentMetres) {
        const camera = this.viewer.scene.getActiveCamera();
        if (camera.position.z <= this.height) {
            return null;
        }
        const { width: renderWidth, height: renderHeight } = this.getRenderSize();
        const points = [];
        for (const horizontalShare of SCREEN_SAMPLES) {
            for (const verticalShare of SCREEN_SAMPLES) {
                const point = this.intersectScreenPoint(horizontalShare * renderWidth, verticalShare * renderHeight);
                if (point) {
                    points.push(point);
                }
            }
        }
        if (points.length === 0) {
            return null;
        }
        const nearestPoint = points.reduce((nearest, point) => {
            return point.distanceToSquared(camera.position) < nearest.distanceToSquared(camera.position) ? point : nearest;
        });
        const viewDirection = camera.getWorldDirection(new THREE.Vector3());
        const halfExtent = maximumExtentMetres / 2;
        const windowCenterX = nearestPoint.x + viewDirection.x * halfExtent;
        const windowCenterY = nearestPoint.y + viewDirection.y * halfExtent;
        const extent = {
            minimumX: Math.max(Math.min(...points.map((point) => point.x)), windowCenterX - halfExtent),
            minimumY: Math.max(Math.min(...points.map((point) => point.y)), windowCenterY - halfExtent),
            maximumX: Math.min(Math.max(...points.map((point) => point.x)), windowCenterX + halfExtent),
            maximumY: Math.min(Math.max(...points.map((point) => point.y)), windowCenterY + halfExtent)
        };
        if (extent.maximumX <= extent.minimumX || extent.maximumY <= extent.minimumY) {
            return null;
        }
        return extent;
    }
}
