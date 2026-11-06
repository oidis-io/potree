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

export class ScreenProjector {
    constructor(viewer) {
        this.viewer = viewer;
        this.renderSize = new THREE.Vector2();
        this.raycaster = new THREE.Raycaster();
    }

    getCamera() {
        return this.viewer.scene.getActiveCamera();
    }

    toViewSpace(position) {
        return position.clone().applyMatrix4(this.getCamera().matrixWorldInverse);
    }

    isInFrontOfCamera(viewPosition) {
        return viewPosition.z <= -this.getCamera().near;
    }

    clipToNearPlane(visiblePosition, hiddenPosition) {
        const nearDepth = -this.getCamera().near;
        const share = (nearDepth - visiblePosition.z) / (hiddenPosition.z - visiblePosition.z);
        return visiblePosition.clone().lerp(hiddenPosition, share);
    }

    viewToScreen(viewPosition) {
        const projected = viewPosition.clone().applyMatrix4(this.getCamera().projectionMatrix);
        const { width, height } = this.viewer.renderer.getSize(this.renderSize);
        return { x: (projected.x + 1) / 2 * width, y: (1 - projected.y) / 2 * height };
    }

    projectPoint(position) {
        const viewPosition = this.toViewSpace(position);
        return this.isInFrontOfCamera(viewPosition) ? this.viewToScreen(viewPosition) : null;
    }

    projectSegment(start, end) {
        let viewStart = this.toViewSpace(start);
        let viewEnd = this.toViewSpace(end);
        const isStartVisible = this.isInFrontOfCamera(viewStart);
        const isEndVisible = this.isInFrontOfCamera(viewEnd);
        if (!isStartVisible && !isEndVisible) {
            return null;
        }
        if (!isStartVisible) {
            viewStart = this.clipToNearPlane(viewEnd, viewStart);
        }
        if (!isEndVisible) {
            viewEnd = this.clipToNearPlane(viewStart, viewEnd);
        }
        return [this.viewToScreen(viewStart), this.viewToScreen(viewEnd)];
    }

    projectRing(points) {
        const viewPoints = points.map((point) => this.toViewSpace(point));
        const clippedRing = [];
        viewPoints.forEach((current, index) => {
            const next = viewPoints[(index + 1) % viewPoints.length];
            const isCurrentVisible = this.isInFrontOfCamera(current);
            const isNextVisible = this.isInFrontOfCamera(next);
            if (isCurrentVisible) {
                clippedRing.push(current);
            }
            if (isCurrentVisible && !isNextVisible) {
                clippedRing.push(this.clipToNearPlane(current, next));
            } else if (!isCurrentVisible && isNextVisible) {
                clippedRing.push(this.clipToNearPlane(next, current));
            }
        });
        return clippedRing.map((viewPoint) => this.viewToScreen(viewPoint));
    }

    measureDistanceToSegment(point, start, end) {
        const segmentX = end.x - start.x;
        const segmentY = end.y - start.y;
        const lengthSquared = segmentX * segmentX + segmentY * segmentY;
        const share = lengthSquared === 0 ? 0 : THREE.MathUtils.clamp(((point.x - start.x) * segmentX + (point.y - start.y) * segmentY) / lengthSquared, 0, 1);
        return Math.hypot(point.x - (start.x + share * segmentX), point.y - (start.y + share * segmentY));
    }

    closestPointOnSegment(canvasPoint, start, end) {
        const { width, height } = this.viewer.renderer.getSize(this.renderSize);
        const pointer = new THREE.Vector2(canvasPoint.x / width * 2 - 1, -canvasPoint.y / height * 2 + 1);
        this.raycaster.setFromCamera(pointer, this.getCamera());
        const pointOnSegment = new THREE.Vector3();
        this.raycaster.ray.distanceSqToSegment(start, end, null, pointOnSegment);
        return pointOnSegment;
    }
}
