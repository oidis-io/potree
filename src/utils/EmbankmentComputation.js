/*! ******************************************************************************************************** *
 *
 * Copyright 2026 Oidis
 *
 * SPDX-License-Identifier: BSD-2-Clause
 * The BSD-2-Clause license for this file can be found in the LICENSE.txt file included with this distribution
 * or at https://spdx.org/licenses/BSD-2-Clause.html#licenseText
 *
 * ********************************************************************************************************* */

import { AUTO_CUBATURE_DEFAULTS, cloudIdentifier, fnv1aHex } from "./AutoCubatureComputation.js";
import { TerrainProbeComputation } from "./TerrainProbeComputation.js";
import {
    computeBevelCapZ,
    estimatePileBaseUncertaintyPct,
    integrateEmbankmentColumns,
    integratePileColumns
} from "./EmbankmentMath.js";
import { buildLidInterpolator, evaluateQuality } from "./TerrainGridMath.js";

export const EMBANKMENT_DEFAULTS = Object.freeze({
    ...AUTO_CUBATURE_DEFAULTS,
    slopeDeg: 45
});

export function resolveEmbankmentMode(mode) {
    if (mode === undefined) {
        return "prism";
    }
    if (mode !== "prism" && mode !== "pile") {
        throw new Error(`Unknown embankment mode: ${mode}`);
    }
    return mode;
}

export class EmbankmentComputation extends TerrainProbeComputation {
    constructor(viewer, params, callbacks) {
        super(viewer, params.outlinePoints, { ...EMBANKMENT_DEFAULTS, ...params.options }, callbacks);
        if (typeof callbacks.onReady !== "function") {
            throw new Error("EmbankmentComputation requires an onReady callback.");
        }
        this.mode = resolveEmbankmentMode(params.mode);
    }

    buildResult() {
        const stats = this.grid.finalize({
            gapThreshold: this.options.clusterGapM,
            minClusterShare: this.options.minClusterShare,
            fromBelow: this.mode !== "pile",
            maxFillRing: this.options.maxFillRing
        });
        const lid = buildLidInterpolator(this.outlinePoints);
        return {
            grid: this.grid,
            stats,
            lidZAt: lid.lidZAt,
            outlinePoints: this.outlinePoints,
            mode: this.mode,
            options: this.options,
            pointclouds: this.pointclouds
        };
    }

    deliver(probe) {
        this.callbacks.onReady(probe);
    }
}

export function computeEmbankmentVolumes(probe, settings) {
    const { heightM, bevelEnabled, slopeDeg } = settings;
    if (!(heightM >= 0)) {
        throw new Error("Výška náspu musí být nezáporná.");
    }
    const options = probe.options;
    let capZ = null;
    if (bevelEnabled) {
        if (!(slopeDeg >= 10 && slopeDeg <= 60)) {
            throw new Error("Úhel zkosení musí být mezi 10° a 60°.");
        }
        const tanAlpha = Math.tan((slopeDeg * Math.PI) / 180);
        capZ = computeBevelCapZ(probe.grid, probe.outlinePoints, heightM, tanAlpha);
    }

    const crown = integrateEmbankmentColumns(probe.grid, probe.lidZAt, heightM, capZ);
    const quality = evaluateQuality(probe.stats, {
        minCoveragePct: options.minCoveragePct,
        maxFilledPct: options.maxFilledPct,
        maxClampedPct: options.maxClampedPct,
        minMedianPointsPerCell: options.minMedianPointsPerCell
    });

    const parts = [];
    for (const p of probe.outlinePoints) {
        parts.push(Math.round(p.x * 1000), Math.round(p.y * 1000), Math.round(p.z * 1000));
    }
    parts.push(
        Math.round(heightM * 1000),
        bevelEnabled ? 1 : 0,
        Math.round(slopeDeg * 10),
        Math.round(options.cellSizeM * 1000),
        Math.round(options.clusterGapM * 1000)
    );
    for (const pointcloud of probe.pointclouds) {
        parts.push(cloudIdentifier(pointcloud));
    }
    const inputHash = fnv1aHex(parts.join("|"));

    const grid = probe.grid;
    let bevelCapM = null;
    if (capZ !== null) {
        let ridge = 0;
        for (let index = 0; index < capZ.length; index++) {
            if (!grid.relevant[index] || !(grid.weights[index] > 0)) {
                continue;
            }
            const levelU = probe.lidZAt(grid.centroidX[index], grid.centroidY[index]);
            const crownS = Math.min(levelU + heightM, capZ[index]);
            ridge = Math.max(ridge, crownS - levelU);
        }
        if (ridge < heightM - 0.005) {
            bevelCapM = ridge;
        }
    }
    let crownSurface = null;
    if (capZ !== null) {
        const length = grid.cols * grid.rows;
        const crownZ = new Float64Array(length).fill(NaN);
        for (let index = 0; index < length; index++) {
            if (!grid.relevant[index] || !(grid.weights[index] > 0)) {
                continue;
            }
            const levelU = probe.lidZAt(grid.centroidX[index], grid.centroidY[index]);
            crownZ[index] = Math.min(levelU + heightM, capZ[index]);
        }
        crownSurface = {
            originX: grid.originX,
            originY: grid.originY,
            cellSize: grid.cellSize,
            cols: grid.cols,
            rows: grid.rows,
            surfaceZ: crownZ,
            weights: grid.weights
        };
    }
    return {
        total: crown.total,
        belowOutlineVolume: crown.belowOutlineVolume,
        aboveOutlineVolume: crown.aboveOutlineVolume,
        surface: {
            originX: grid.originX,
            originY: grid.originY,
            cellSize: grid.cellSize,
            cols: grid.cols,
            rows: grid.rows,
            surfaceZ: grid.surfaceZ,
            weights: grid.weights
        },
        crownSurface,
        bevelCapM,
        stats: probe.stats,
        quality,
        heightM,
        bevelEnabled,
        slopeDeg,
        inputHash
    };
}

export function computePileVolume(probe) {
    if (probe.mode !== "pile") {
        throw new Error("computePileVolume requires a probe in pile mode.");
    }
    const options = probe.options;
    const integration = integratePileColumns(probe.grid, probe.lidZAt);
    const uncertaintyPct = estimatePileBaseUncertaintyPct(probe.outlinePoints);
    const quality = evaluateQuality(probe.stats, {
        minCoveragePct: options.minCoveragePct,
        maxFilledPct: options.maxFilledPct,
        maxClampedPct: options.maxClampedPct,
        minMedianPointsPerCell: options.minMedianPointsPerCell
    });

    const parts = ["pile"];
    for (const p of probe.outlinePoints) {
        parts.push(Math.round(p.x * 1000), Math.round(p.y * 1000), Math.round(p.z * 1000));
    }
    parts.push(Math.round(options.cellSizeM * 1000), Math.round(options.clusterGapM * 1000));
    for (const pointcloud of probe.pointclouds) {
        parts.push(cloudIdentifier(pointcloud));
    }

    const grid = probe.grid;
    return {
        total: integration.total,
        uncertaintyPct,
        surface: {
            originX: grid.originX,
            originY: grid.originY,
            cellSize: grid.cellSize,
            cols: grid.cols,
            rows: grid.rows,
            surfaceZ: grid.surfaceZ,
            weights: grid.weights
        },
        stats: probe.stats,
        quality,
        inputHash: fnv1aHex(parts.join("|"))
    };
}
