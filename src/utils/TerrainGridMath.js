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

function medianOfSorted(sorted, start, end) {
    const count = end - start;
    const mid = start + Math.floor(count / 2);
    if (count % 2 === 1) {
        return sorted[mid];
    }
    return (sorted[mid - 1] + sorted[mid]) / 2;
}

// Gap-separated cluster median instead of a fixed-height band: a band biases the
// surface estimate on slopes, a cluster follows the local terrain sheet exactly.
export function clusterSurfaceZ(zValues, options) {
    const gapThreshold = options.gapThreshold;
    const minClusterShare = options.minClusterShare;
    const fromBelow = options.fromBelow;
    const n = zValues.length;
    if (n === 0) {
        return null;
    }
    const sorted = Array.from(zValues).sort((a, b) => a - b);

    const clusters = [];
    let start = 0;
    for (let i = 1; i <= n; i++) {
        if (i === n || sorted[i] - sorted[i - 1] > gapThreshold) {
            clusters.push({ start, end: i - 1, count: i - start });
            start = i;
        }
    }

    const minSupport = Math.max(3, Math.ceil(minClusterShare * n));
    const ordered = fromBelow ? clusters : [...clusters].reverse();
    let selected = null;
    let skippedWeak = 0;
    for (const cluster of ordered) {
        if (cluster.count >= minSupport || n < 3) {
            selected = cluster;
            break;
        }
        skippedWeak++;
    }
    if (selected === null) {
        selected = clusters.reduce((best, cluster) => (cluster.count > best.count ? cluster : best), clusters[0]);
        skippedWeak = 0;
    }

    return {
        z: medianOfSorted(sorted, selected.start, selected.end + 1),
        clusterCount: selected.count,
        skippedWeakClusters: skippedWeak,
        clusterLevels: clusters.map((cluster) => ({
            z: medianOfSorted(sorted, cluster.start, cluster.end + 1),
            count: cluster.count
        }))
    };
}

export function demoteSpatialGhosts(surface, clusterLevelsByCell, relevant, cols, rows, options) {
    const { demoteThreshold, fromBelow, maxPasses = 4 } = options;
    let demoted = 0;
    for (let pass = 0; pass < maxPasses; pass++) {
        const passResult = demoteSpatialGhostsPass(
            surface, clusterLevelsByCell, relevant, cols, rows, { demoteThreshold, fromBelow });
        demoted += passResult.demoted;
        if (passResult.demoted === 0) {
            break;
        }
    }
    return { demoted };
}

function demoteSpatialGhostsPass(surface, clusterLevelsByCell, relevant, cols, rows, options) {
    const { demoteThreshold, fromBelow } = options;
    const snapshot = Float64Array.from(surface);
    let demoted = 0;
    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
            const index = row * cols + col;
            const levels = clusterLevelsByCell[index];
            if (!relevant[index] || !Number.isFinite(snapshot[index]) || !levels || levels.length < 2) {
                continue;
            }
            const neighbors = [];
            for (let dr = -1; dr <= 1; dr++) {
                for (let dc = -1; dc <= 1; dc++) {
                    if (dr === 0 && dc === 0) {
                        continue;
                    }
                    const nr = row + dr;
                    const nc = col + dc;
                    if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) {
                        continue;
                    }
                    const value = snapshot[nr * cols + nc];
                    if (Number.isFinite(value)) {
                        neighbors.push(value);
                    }
                }
            }
            if (neighbors.length < 3) {
                continue;
            }
            neighbors.sort((a, b) => a - b);
            const neighborMedian = medianOfSorted(neighbors, 0, neighbors.length);
            const isGhost = fromBelow
                ? snapshot[index] < neighborMedian - demoteThreshold
                : snapshot[index] > neighborMedian + demoteThreshold;
            if (!isGhost) {
                continue;
            }
            const viable = levels.filter((level) => (fromBelow
                ? level.z >= neighborMedian - demoteThreshold
                : level.z <= neighborMedian + demoteThreshold));
            if (viable.length === 0) {
                continue;
            }
            viable.sort((a, b) => (fromBelow ? a.z - b.z : b.z - a.z));
            surface[index] = viable[0].z;
            demoted++;
        }
    }
    return { demoted };
}

export function fillEmptyCells(surface, relevant, cols, rows, maxRing) {
    let filled = 0;
    for (let ring = 0; ring < maxRing; ring++) {
        const snapshot = Float64Array.from(surface);
        let filledThisRing = 0;
        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                const index = row * cols + col;
                if (!relevant[index] || Number.isFinite(snapshot[index])) {
                    continue;
                }
                const neighbors = [];
                for (let dr = -1; dr <= 1; dr++) {
                    for (let dc = -1; dc <= 1; dc++) {
                        if (dr === 0 && dc === 0) {
                            continue;
                        }
                        const nr = row + dr;
                        const nc = col + dc;
                        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) {
                            continue;
                        }
                        const value = snapshot[nr * cols + nc];
                        if (Number.isFinite(value)) {
                            neighbors.push(value);
                        }
                    }
                }
                if (neighbors.length > 0) {
                    neighbors.sort((a, b) => a - b);
                    surface[index] = medianOfSorted(neighbors, 0, neighbors.length);
                    filledThisRing++;
                }
            }
        }
        filled += filledThisRing;
        if (filledThisRing === 0) {
            break;
        }
    }
    let unfilled = 0;
    for (let index = 0; index < surface.length; index++) {
        if (relevant[index] && !Number.isFinite(surface[index])) {
            unfilled++;
        }
    }
    return { filled, unfilled };
}

export function buildLidInterpolator(points) {
    if (points.length < 3) {
        throw new Error("Obrys musí mít alespoň 3 vrcholy.");
    }
    const shape = points.map((p) => new THREE.Vector2(p.x, p.y));
    const indexTriples = THREE.ShapeUtils.triangulateShape(shape, []);
    if (indexTriples.length === 0) {
        throw new Error("Obrys se nepodařilo triangulovat — zkontrolujte, zda se nekříží.");
    }
    const triangles = indexTriples.map((tri) => [points[tri[0]], points[tri[1]], points[tri[2]]]);

    const barycentric = (a, b, c, x, y) => {
        const detT = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
        if (Math.abs(detT) < 1e-12) {
            return null;
        }
        const l1 = ((b.y - c.y) * (x - c.x) + (c.x - b.x) * (y - c.y)) / detT;
        const l2 = ((c.y - a.y) * (x - c.x) + (a.x - c.x) * (y - c.y)) / detT;
        return [l1, l2, 1 - l1 - l2];
    };

    const lidZAt = (x, y) => {
        let bestScore = -Infinity;
        let bestZ = null;
        for (const [a, b, c] of triangles) {
            const bary = barycentric(a, b, c, x, y);
            if (bary === null) {
                continue;
            }
            const score = Math.min(bary[0], bary[1], bary[2]);
            if (score > bestScore) {
                bestScore = score;
                bestZ = bary[0] * a.z + bary[1] * b.z + bary[2] * c.z;
            }
            if (score >= 0) {
                return bestZ;
            }
        }
        if (bestZ === null) {
            throw new Error("Obrys je degenerovaný — víko nelze vyhodnotit.");
        }
        return bestZ;
    };

    return { lidZAt };
}

export function integratePitColumns(grid, lidZAt) {
    let volume = 0;
    let usedCells = 0;
    let clampedCells = 0;
    const { surfaceZ, weights, centroidX, centroidY, cellArea } = grid;
    for (let index = 0; index < surfaceZ.length; index++) {
        const weight = weights[index];
        if (weight <= 0 || !Number.isFinite(surfaceZ[index])) {
            continue;
        }
        const depth = lidZAt(centroidX[index], centroidY[index]) - surfaceZ[index];
        usedCells++;
        if (depth <= 0) {
            if (depth < -1e-6) {
                clampedCells++;
            }
            continue;
        }
        volume += depth * weight * cellArea;
    }
    return { volume, usedCells, clampedCells };
}

export function buildSurfaceMeshData(surface) {
    const { cols, rows, cellSize, surfaceZ, weights } = surface;
    const cornerCols = cols + 1;
    const cornerRows = rows + 1;
    const cornerZ = new Float64Array(cornerCols * cornerRows).fill(NaN);
    for (let cr = 0; cr < cornerRows; cr++) {
        for (let cc = 0; cc < cornerCols; cc++) {
            let sum = 0;
            let count = 0;
            for (let dr = -1; dr <= 0; dr++) {
                for (let dc = -1; dc <= 0; dc++) {
                    const r = cr + dr;
                    const c = cc + dc;
                    if (r < 0 || r >= rows || c < 0 || c >= cols) {
                        continue;
                    }
                    const index = r * cols + c;
                    if (weights[index] > 0 && Number.isFinite(surfaceZ[index])) {
                        sum += surfaceZ[index];
                        count++;
                    }
                }
            }
            if (count > 0) {
                cornerZ[cr * cornerCols + cc] = sum / count;
            }
        }
    }

    const positions = [];
    const indices = [];
    const cornerIndexMap = new Int32Array(cornerCols * cornerRows).fill(-1);
    const cornerAt = (cr, cc) => {
        const ci = cr * cornerCols + cc;
        if (cornerIndexMap[ci] === -1) {
            cornerIndexMap[ci] = positions.length / 3;
            positions.push(cc * cellSize, cr * cellSize, cornerZ[ci]);
        }
        return cornerIndexMap[ci];
    };
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const index = r * cols + c;
            if (!(weights[index] > 0) || !Number.isFinite(surfaceZ[index])) {
                continue;
            }
            const a = cornerAt(r, c);
            const b = cornerAt(r, c + 1);
            const d = cornerAt(r + 1, c + 1);
            const e = cornerAt(r + 1, c);
            indices.push(a, b, d, a, d, e);
        }
    }
    return { positions: Float32Array.from(positions), indices: Uint32Array.from(indices) };
}

export function evaluateQuality(stats, thresholds) {
    const reasons = [];
    if (stats.coveragePct < thresholds.minCoveragePct) {
        reasons.push(`Mračno pokrývá jen ${stats.coveragePct.toFixed(0)} % plochy obrysu`);
    }
    if (stats.filledPct > thresholds.maxFilledPct) {
        reasons.push(`${stats.filledPct.toFixed(0)} % sloupců bylo doplněno z okolí`);
    }
    if (stats.unfilled > 0) {
        reasons.push(`${stats.unfilled} sloupců zůstalo bez dat`);
    }
    if (stats.medianPointsPerCell < thresholds.minMedianPointsPerCell) {
        reasons.push("Hustota bodů je pro spolehlivé přichycení příliš nízká");
    }
    if (Number.isFinite(stats.clampedPct) && stats.clampedPct > thresholds.maxClampedPct) {
        reasons.push(`Terén leží nad rovinou víka u ${stats.clampedPct.toFixed(0)} % sloupců — obrys je pod okrajem`);
    }
    return { approximate: reasons.length > 0, reasons };
}
