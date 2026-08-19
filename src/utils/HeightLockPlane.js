/*! ******************************************************************************************************** *
 *
 * Copyright 2026 Oidis
 *
 * SPDX-License-Identifier: BSD-2-Clause
 * The BSD-2-Clause license for this file can be found in the LICENSE.txt file included with this distribution
 * or at https://spdx.org/licenses/BSD-2-Clause.html#licenseText
 *
 * ********************************************************************************************************* */

import * as THREE from "../../libs/three.js/build/three.module.js";

const MAX_LOCK_PLANE_SLOPE = 2;

export function computeLockPlane(points) {
    const n = points.length;
    if (n === 0) {
        return null;
    }
    const first = points[0];
    if (n === 1) {
        return { x0: first.x, y0: first.y, z0: first.z, gx: 0, gy: 0 };
    }
    if (n === 2) {
        const dx = points[1].x - first.x;
        const dy = points[1].y - first.y;
        const len2 = dx * dx + dy * dy;
        if (len2 < 1e-12) {
            return { x0: first.x, y0: first.y, z0: first.z, gx: 0, gy: 0 };
        }
        const slopePerLen2 = (points[1].z - first.z) / len2;
        return { x0: first.x, y0: first.y, z0: first.z, gx: dx * slopePerLen2, gy: dy * slopePerLen2 };
    }

    let cx = 0, cy = 0, cz = 0;
    for (const p of points) {
        cx += p.x;
        cy += p.y;
        cz += p.z;
    }
    cx /= n;
    cy /= n;
    cz /= n;
    let xx = 0, xy = 0, yy = 0, xz = 0, yz = 0;
    for (const p of points) {
        const dx = p.x - cx;
        const dy = p.y - cy;
        const dz = p.z - cz;
        xx += dx * dx;
        xy += dx * dy;
        yy += dy * dy;
        xz += dx * dz;
        yz += dy * dz;
    }
    const det = xx * yy - xy * xy;
    if (!(det > 1e-6 * xx * yy)) {
        return computeLockPlane([points[0], points[n - 1]]);
    }
    const gx = (yy * xz - xy * yz) / det;
    const gy = (xx * yz - xy * xz) / det;
    // Nearly collinear clicks have almost no leverage across the line — the fitted plane
    // then tilts wildly. Such a plane is unusable as a height hold, so fall back to the line.
    if (!(Math.hypot(gx, gy) <= MAX_LOCK_PLANE_SLOPE)) {
        return computeLockPlane([points[0], points[n - 1]]);
    }
    return { x0: cx, y0: cy, z0: cz, gx, gy };
}

export function lockPlaneZAt(plane, x, y) {
    return plane.z0 + plane.gx * (x - plane.x0) + plane.gy * (y - plane.y0);
}

function intersectRayWithLockPlane(raycaster, plane) {
    const normal = new THREE.Vector3(-plane.gx, -plane.gy, 1).normalize();
    const threePlane = new THREE.Plane().setFromNormalAndCoplanarPoint(
        normal, new THREE.Vector3(plane.x0, plane.y0, plane.z0));
    const hit = new THREE.Vector3();
    return raycaster.ray.intersectPlane(threePlane, hit) ? hit : null;
}

export function intersectDragWithLockPlane(dragEnd, viewer, plane) {
    const renderer = viewer.renderer;
    const ndc = new THREE.Vector2(
        (dragEnd.x / renderer.domElement.clientWidth) * 2 - 1,
        -(dragEnd.y / renderer.domElement.clientHeight) * 2 + 1
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, viewer.scene.getActiveCamera());
    return intersectRayWithLockPlane(raycaster, plane);
}

export function refreshHeightLockVisual(owner, lock, sizingPoints) {
    if (owner.heightLockVisual !== null) {
        owner.remove(owner.heightLockVisual);
        owner.heightLockVisual.children[0].geometry.dispose();
        for (const child of owner.heightLockVisual.children) {
            child.material.dispose();
        }
        owner.heightLockVisual = null;
    }
    if (lock === null) {
        return;
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of sizingPoints) {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
    }
    const centerX = Number.isFinite(minX) ? (minX + maxX) / 2 : lock.x0;
    const centerY = Number.isFinite(minY) ? (minY + maxY) / 2 : lock.y0;
    const size = Math.max(40, 2 * Math.max(maxX - minX, maxY - minY, 1));
    owner.heightLockVisual = createLockPlaneVisual(lock, centerX, centerY, size);
    owner.add(owner.heightLockVisual);
}

export function createLockPlaneVisual(plane, centerX, centerY, size) {
    const group = new THREE.Group();
    group.name = "height_lock_plane";
    const geometry = new THREE.PlaneGeometry(size, size, 16, 16);

    const fill = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
        color: 0x4aa3ff,
        transparent: true,
        opacity: 0.08,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide
    }));
    const grid = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
        color: 0x4aa3ff,
        transparent: true,
        opacity: 0.3,
        depthTest: false,
        depthWrite: false,
        wireframe: true
    }));
    group.add(fill);
    group.add(grid);

    const normal = new THREE.Vector3(-plane.gx, -plane.gy, 1).normalize();
    group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    group.position.set(centerX, centerY, lockPlaneZAt(plane, centerX, centerY));
    return group;
}
