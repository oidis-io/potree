/*! ******************************************************************************************************** *
 *
 * Copyright 2026 Oidis
 *
 * SPDX-License-Identifier: BSD-2-Clause
 * The BSD-2-Clause license for this file can be found in the LICENSE.txt file included with this distribution
 * or at https://spdx.org/licenses/BSD-2-Clause.html#licenseText
 *
 * ********************************************************************************************************* */

import { TerrainProbeComputation, selectMeasurablePointclouds } from "./TerrainProbeComputation.js";
import { buildLidInterpolator, evaluateQuality, integratePitColumns } from "./TerrainGridMath.js";

export const AUTO_CUBATURE_DEFAULTS = Object.freeze({
    cellSizeM: 0.15,
    clusterGapM: 0.15,
    minClusterShare: 0.3,
    maxFillRing: 8,
    maxGridCells: 250000,
    maxQueryPoints: 10000000,
    minCoveragePct: 85,
    maxFilledPct: 15,
    maxClampedPct: 15,
    minMedianPointsPerCell: 3
});

export { selectMeasurablePointclouds };

export function cloudIdentifier(pointcloud) {
    const geometry = pointcloud.pcoGeometry;
    const source = (geometry && geometry.url) || pointcloud.name || "cloud";
    const rootPoints = (geometry && geometry.root && geometry.root.numPoints) || 0;
    return `${source}:${rootPoints}`;
}

export function fnv1aHex(text) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
}

export function computeAutoCubatureInputHash(topControlPoints, options, pointclouds) {
    const parts = [];
    for (const p of topControlPoints) {
        parts.push(Math.round(p.x * 1000), Math.round(p.y * 1000), Math.round(p.z * 1000));
    }
    parts.push(
        Math.round(options.cellSizeM * 1000),
        Math.round(options.clusterGapM * 1000),
        Math.round(options.minClusterShare * 1000),
        options.maxFillRing
    );
    for (const pointcloud of pointclouds) {
        parts.push(cloudIdentifier(pointcloud));
    }
    return fnv1aHex(parts.join("|"));
}

export class AutoCubatureComputation extends TerrainProbeComputation {
    constructor(viewer, params, callbacks) {
        super(viewer, params.topControlPoints, { ...AUTO_CUBATURE_DEFAULTS, ...params.options }, callbacks);
        if (typeof callbacks.onCompleted !== "function") {
            throw new Error("AutoCubatureComputation requires an onCompleted callback.");
        }
    }

    buildResult() {
        const stats = this.grid.finalize({
            gapThreshold: this.options.clusterGapM,
            minClusterShare: this.options.minClusterShare,
            fromBelow: true,
            maxFillRing: this.options.maxFillRing
        });
        const lid = buildLidInterpolator(this.outlinePoints);
        const integration = integratePitColumns(this.grid, lid.lidZAt);
        stats.clampedPct = integration.usedCells === 0
            ? 0
            : (100 * integration.clampedCells) / integration.usedCells;
        const quality = evaluateQuality(stats, {
            minCoveragePct: this.options.minCoveragePct,
            maxFilledPct: this.options.maxFilledPct,
            maxClampedPct: this.options.maxClampedPct,
            minMedianPointsPerCell: this.options.minMedianPointsPerCell
        });

        const floorZ = this.computeDisplayFloorZ();
        const bottomZByIndex = this.outlinePoints.map((vertex) =>
            (floorZ === null ? vertex.z : Math.min(floorZ, vertex.z)));

        return {
            volume: integration.volume,
            stats,
            quality,
            bottomZByIndex,
            inputHash: computeAutoCubatureInputHash(this.outlinePoints, this.options, this.pointclouds),
            options: this.options,
            surface: {
                originX: this.grid.originX,
                originY: this.grid.originY,
                cellSize: this.grid.cellSize,
                cols: this.grid.cols,
                rows: this.grid.rows,
                surfaceZ: this.grid.surfaceZ,
                weights: this.grid.weights
            }
        };
    }

    deliver(payload) {
        this.callbacks.onCompleted(payload);
    }

    computeDisplayFloorZ() {
        const { surfaceZ, weights } = this.grid;
        const values = [];
        for (let index = 0; index < surfaceZ.length; index++) {
            if (weights[index] > 0 && Number.isFinite(surfaceZ[index])) {
                values.push(surfaceZ[index]);
            }
        }
        if (values.length === 0) {
            return null;
        }
        values.sort((a, b) => a - b);
        return values[Math.floor(0.05 * (values.length - 1))];
    }
}
