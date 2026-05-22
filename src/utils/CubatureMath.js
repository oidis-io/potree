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

export function bestFitPlane(points) {
    if (!points || points.length < 3) {
        return {
            normal: { x: 0, y: 0, z: 1 },
            point: { x: 0, y: 0, z: 0 }
        };
    }

    const n = points.length;
    let sx = 0, sy = 0, sz = 0;
    for (let i = 0; i < n; i++) {
        sx += points[i].x;
        sy += points[i].y;
        sz += points[i].z;
    }
    const cx = sx / n;
    const cy = sy / n;
    const cz = sz / n;

    let xx = 0, xy = 0, yy = 0, xz = 0, yz = 0;
    for (let i = 0; i < n; i++) {
        const dx = points[i].x - cx;
        const dy = points[i].y - cy;
        const dz = points[i].z - cz;
        xx += dx * dx;
        xy += dx * dy;
        yy += dy * dy;
        xz += dx * dz;
        yz += dy * dz;
    }

    const det = xx * yy - xy * xy;
    if (Math.abs(det) < 1e-12) {
        return {
            normal: { x: 0, y: 0, z: 1 },
            point: { x: cx, y: cy, z: cz }
        };
    }

    const a = (yy * xz - xy * yz) / det;
    const b = (xx * yz - xy * xz) / det;

    const nx = a;
    const ny = b;
    const nz = -1;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);

    return {
        normal: { x: nx / len, y: ny / len, z: nz / len },
        point: { x: cx, y: cy, z: cz }
    };
}

export function projectOntoPlane(p, plane) {
    const dx = p.x - plane.point.x;
    const dy = p.y - plane.point.y;
    const dz = p.z - plane.point.z;
    const dot = dx * plane.normal.x + dy * plane.normal.y + dz * plane.normal.z;
    return {
        x: p.x - plane.normal.x * dot,
        y: p.y - plane.normal.y * dot,
        z: p.z - plane.normal.z * dot
    };
}

export function prismVolume(topVerts, bottomVerts) {
    const n = topVerts.length;
    if (n < 3 || bottomVerts.length !== n) {
        return 0;
    }

    let signedXY = 0;
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        signedXY += topVerts[i].x * topVerts[j].y - topVerts[j].x * topVerts[i].y;
    }
    const topOrdered = signedXY < 0 ? topVerts.slice().reverse() : topVerts;
    const botOrdered = signedXY < 0 ? bottomVerts.slice().reverse() : bottomVerts;

    let cx = 0, cy = 0, cz = 0;
    for (const p of topOrdered) {
        cx += p.x;
        cy += p.y;
        cz += p.z;
    }
    for (const p of botOrdered) {
        cx += p.x;
        cy += p.y;
        cz += p.z;
    }
    const total = 2 * n;
    cx /= total;
    cy /= total;
    cz /= total;

    const top = topOrdered.map(p => ({ x: p.x - cx, y: p.y - cy, z: p.z - cz }));
    const bot = botOrdered.map(p => ({ x: p.x - cx, y: p.y - cy, z: p.z - cz }));

    const triangles = [];

    const topShape = top.map(p => new THREE.Vector2(p.x, p.y));
    const topTri = THREE.ShapeUtils.triangulateShape(topShape, []);
    for (const tri of topTri) {
        triangles.push([top[tri[0]], top[tri[1]], top[tri[2]]]);
    }

    const bottomShape = bot.map(p => new THREE.Vector2(p.x, p.y));
    const bottomTri = THREE.ShapeUtils.triangulateShape(bottomShape, []);
    for (const tri of bottomTri) {
        triangles.push([bot[tri[2]], bot[tri[1]], bot[tri[0]]]);
    }

    for (let i = 0; i < n; i++) {
        const next = (i + 1) % n;
        triangles.push([top[i], bot[i], bot[next]]);
        triangles.push([top[i], bot[next], top[next]]);
    }

    let volume = 0;
    for (const tri of triangles) {
        const p1 = tri[0];
        const p2 = tri[1];
        const p3 = tri[2];
        const crX = p2.y * p3.z - p2.z * p3.y;
        const crY = p2.z * p3.x - p2.x * p3.z;
        const crZ = p2.x * p3.y - p2.y * p3.x;
        volume += p1.x * crX + p1.y * crY + p1.z * crZ;
    }
    return Math.abs(volume / 6);
}

export function computeCentroid(points) {
    if (!points || points.length === 0) {
        return { x: 0, y: 0, z: 0 };
    }
    let sx = 0, sy = 0, sz = 0;
    for (const p of points) {
        sx += p.x;
        sy += p.y;
        sz += p.z;
    }
    const n = points.length;
    return { x: sx / n, y: sy / n, z: sz / n };
}
