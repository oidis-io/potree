/*! ******************************************************************************************************** *
 *
 * Copyright 2026 Oidis
 *
 * SPDX-License-Identifier: BSD-2-Clause
 * The BSD-2-Clause license for this file can be found in the LICENSE.txt file included with this distribution
 * or at https://spdx.org/licenses/BSD-2-Clause.html#licenseText
 *
 * ********************************************************************************************************* */

export function densifyOutlineRing(points, step) {
    const samples = [];
    const n = points.length;
    for (let i = 0; i < n; i++) {
        const a = points[i];
        const b = points[(i + 1) % n];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dz = b.z - a.z;
        const length = Math.sqrt(dx * dx + dy * dy);
        const segments = Math.max(1, Math.ceil(length / step));
        for (let s = 0; s < segments; s++) {
            const t = s / segments;
            samples.push({ x: a.x + dx * t, y: a.y + dy * t, z: a.z + dz * t });
        }
    }
    return samples;
}

// Inward bevel invariant: the drawn outline is the maximum footprint — slopes rise
// from the outline edge, so the crown can only shrink and nothing ever grows outward.
export function computeBevelCapZ(grid, outlinePoints, heightM, tanAlpha) {
    const { cols, rows, originX, originY, cellSize } = grid;
    const length = cols * rows;
    const capZ = new Float64Array(length).fill(Infinity);
    if (!(heightM > 0)) {
        return capZ;
    }
    const localSamples = densifyOutlineRing(outlinePoints, cellSize / 2)
        .map((s) => ({ x: s.x - originX, y: s.y - originY, z: s.z }));
    let maxRingZ = -Infinity;
    for (const sample of localSamples) {
        maxRingZ = Math.max(maxRingZ, sample.z);
    }

    for (const sample of localSamples) {
        const reachCells = Math.ceil((maxRingZ - sample.z + heightM) / tanAlpha / cellSize) + 1;
        const centerCol = Math.floor(sample.x / cellSize);
        const centerRow = Math.floor(sample.y / cellSize);
        const minCol = Math.max(0, centerCol - reachCells);
        const maxCol = Math.min(cols - 1, centerCol + reachCells);
        const minRow = Math.max(0, centerRow - reachCells);
        const maxRow = Math.min(rows - 1, centerRow + reachCells);
        for (let row = minRow; row <= maxRow; row++) {
            const cellY = (row + 0.5) * cellSize;
            for (let col = minCol; col <= maxCol; col++) {
                const cellX = (col + 0.5) * cellSize;
                const distance = Math.sqrt((cellX - sample.x) ** 2 + (cellY - sample.y) ** 2);
                const candidate = sample.z + distance * tanAlpha;
                const index = row * cols + col;
                if (candidate < capZ[index]) {
                    capZ[index] = candidate;
                }
            }
        }
    }
    return capZ;
}

export function integratePileColumns(grid, lidZAt) {
    const { surfaceZ, weights, centroidX, centroidY, cellArea, relevant } = grid;
    let total = 0;
    for (let index = 0; index < surfaceZ.length; index++) {
        if (!relevant[index] || !Number.isFinite(surfaceZ[index]) || !(weights[index] > 0)) {
            continue;
        }
        const height = surfaceZ[index] - lidZAt(centroidX[index], centroidY[index]);
        if (height > 0) {
            total += height * weights[index] * cellArea;
        }
    }
    return { total };
}

// Approved business rule: a flat foot supports a reliable base plane (±3 %),
// a sloped foot makes the interpolated base uncertain (±10 %).
const FLAT_FOOT_UNCERTAINTY_PCT = 3;
const SLOPED_FOOT_UNCERTAINTY_PCT = 10;
const FLAT_FOOT_SLOPE_LIMIT = 0.09;

export function estimatePileBaseUncertaintyPct(footPoints) {
    const n = footPoints.length;
    if (n < 3) {
        throw new Error("estimatePileBaseUncertaintyPct requires at least 3 foot points.");
    }
    let sx = 0, sy = 0, sz = 0;
    for (const p of footPoints) {
        sx += p.x;
        sy += p.y;
        sz += p.z;
    }
    const cx = sx / n;
    const cy = sy / n;
    const cz = sz / n;
    let xx = 0, xy = 0, yy = 0, xz = 0, yz = 0;
    for (const p of footPoints) {
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
    if (Math.abs(det) < 1e-9) {
        return SLOPED_FOOT_UNCERTAINTY_PCT;
    }
    const a = (yy * xz - xy * yz) / det;
    const b = (xx * yz - xy * xz) / det;
    const slope = Math.sqrt(a * a + b * b);
    return slope <= FLAT_FOOT_SLOPE_LIMIT ? FLAT_FOOT_UNCERTAINTY_PCT : SLOPED_FOOT_UNCERTAINTY_PCT;
}

export function integrateEmbankmentColumns(grid, lidZAt, heightM, capZ) {
    const { surfaceZ, weights, centroidX, centroidY, cellArea, relevant } = grid;
    let total = 0;
    let aboveOutlineVolume = 0;

    for (let index = 0; index < surfaceZ.length; index++) {
        if (!relevant[index] || !Number.isFinite(surfaceZ[index]) || !(weights[index] > 0)) {
            continue;
        }
        const terrain = surfaceZ[index];
        const levelU = lidZAt(centroidX[index], centroidY[index]);
        let crownS = levelU + heightM;
        if (capZ !== null && capZ[index] < crownS) {
            crownS = capZ[index];
        }
        const depth = crownS - terrain;
        if (depth > 0) {
            const share = weights[index] * cellArea;
            total += depth * share;
            aboveOutlineVolume += Math.max(0, crownS - Math.max(terrain, levelU)) * share;
        }
    }
    return { total, aboveOutlineVolume, belowOutlineVolume: total - aboveOutlineVolume };
}
