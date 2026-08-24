/*! ******************************************************************************************************** *
 *
 * Copyright 2026 Oidis
 *
 * SPDX-License-Identifier: BSD-2-Clause
 * The BSD-2-Clause license for this file can be found in the LICENSE.txt file included with this distribution
 * or at https://spdx.org/licenses/BSD-2-Clause.html#licenseText
 *
 * ********************************************************************************************************* */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
    buildLidInterpolator,
    buildSurfaceMeshData,
    clusterSurfaceZ,
    evaluateQuality,
    fillEmptyCells
} from "../src/utils/TerrainGridMath.js";
import { mulberry32 } from "./helpers/FakeCloud.mjs";

const clusterOptions = { gapThreshold: 0.15, minClusterShare: 0.3, fromBelow: true };

test("clusterSurfaceZ returns median of the lowest cluster and ignores high clutter", () => {
    const zValues = [];
    for (let i = 0; i < 100; i++) {
        zValues.push(-2 + (i % 10) * 0.005);
    }
    zValues.push(1.5, 1.6, 1.7);
    const result = clusterSurfaceZ(zValues, clusterOptions);
    assert.ok(Math.abs(result.z - (-2 + 0.0225)) < 0.03);
    assert.ok(result.clusterCount >= 90);
});

test("clusterSurfaceZ skips isolated low outliers", () => {
    const random = mulberry32(7);
    const zValues = [];
    for (let i = 0; i < 1000; i++) {
        zValues.push(-2 + (random() - 0.5) * 0.02);
    }
    zValues.push(-2.6, -2.42, -2.7);
    const result = clusterSurfaceZ(zValues, clusterOptions);
    assert.ok(Math.abs(result.z + 2) < 0.02, `expected ~-2, got ${result.z}`);
});

test("clusterSurfaceZ has no low bias on a sloped cell", () => {
    const zValues = [];
    for (let i = 0; i <= 30; i++) {
        zValues.push(-2 + (i / 30) * 0.15);
    }
    const result = clusterSurfaceZ(zValues, clusterOptions);
    assert.ok(Math.abs(result.z - (-2 + 0.075)) < 0.01, `expected cell centre, got ${result.z}`);
});

test("clusterSurfaceZ skips a dense ghost cluster below the main surface", () => {
    const zValues = [];
    for (let i = 0; i < 100; i++) {
        zValues.push(-2 + (i % 10) * 0.005);
    }
    for (let i = 0; i < 20; i++) {
        zValues.push(-5 + (i % 5) * 0.005);
    }
    const result = clusterSurfaceZ(zValues, clusterOptions);
    assert.ok(Math.abs(result.z + 2) < 0.05, `expected main surface ~-2, got ${result.z}`);
    assert.equal(result.skippedWeakClusters, 1);
});

test("clusterSurfaceZ keeps a dominant low cluster (majority wins)", () => {
    const zValues = [];
    for (let i = 0; i < 60; i++) {
        zValues.push(-5 + (i % 5) * 0.005);
    }
    for (let i = 0; i < 40; i++) {
        zValues.push(-2 + (i % 5) * 0.005);
    }
    const result = clusterSurfaceZ(zValues, clusterOptions);
    assert.ok(Math.abs(result.z + 5) < 0.05, `expected dominant low cluster ~-5, got ${result.z}`);
});

test("clusterSurfaceZ fromAbove returns the upper envelope", () => {
    const zValues = [0, 0.01, 0.02, 3.0, 3.01, 3.02, 3.03];
    const result = clusterSurfaceZ(zValues, { gapThreshold: 0.15, minClusterShare: 0.3, fromBelow: false });
    assert.ok(Math.abs(result.z - 3.015) < 0.02);
});

test("clusterSurfaceZ with a small sample skips a single weak outlier cluster", () => {
    const zValues = [-2.6, -2.01, -2.0, -2.02, -1.99, -2.0, -2.01, -2.0, -1.98, -2.0];
    const result = clusterSurfaceZ(zValues, clusterOptions);
    assert.ok(Math.abs(result.z + 2) < 0.02, `expected ~-2, got ${result.z}`);
});

test("fillEmptyCells fills deterministically ring by ring and reports unfilled", () => {
    const cols = 5;
    const rows = 1;
    const surface = Float64Array.from([1, NaN, NaN, NaN, 5]);
    const relevant = Uint8Array.from([1, 1, 1, 1, 1]);
    const result = fillEmptyCells(surface, relevant, cols, rows, 8);
    assert.equal(result.filled, 3);
    assert.equal(result.unfilled, 0);
    assert.deepEqual(Array.from(surface), [1, 1, 3, 5, 5]);

    const limited = Float64Array.from([1, NaN, NaN, NaN, NaN]);
    const relevantLimited = Uint8Array.from([1, 1, 1, 1, 0]);
    const limitedResult = fillEmptyCells(limited, relevantLimited, cols, rows, 1);
    assert.equal(limitedResult.filled, 1);
    assert.equal(limitedResult.unfilled, 2);
});

test("buildLidInterpolator interpolates a planar and non-planar lid", () => {
    const planar = buildLidInterpolator([
        { x: 0, y: 0, z: 5 }, { x: 10, y: 0, z: 5 }, { x: 10, y: 10, z: 5 }, { x: 0, y: 10, z: 5 }
    ]);
    assert.ok(Math.abs(planar.lidZAt(3, 7) - 5) < 1e-12);

    const sloped = buildLidInterpolator([
        { x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, { x: 10, y: 10, z: 10 }, { x: 0, y: 10, z: 10 }
    ]);
    assert.ok(Math.abs(sloped.lidZAt(5, 5) - 5) < 1e-9);
    assert.ok(Math.abs(sloped.lidZAt(2, 0) - 0) < 1e-9);
});

test("buildLidInterpolator throws on degenerate outline", () => {
    assert.throws(() => buildLidInterpolator([{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }]));
});

test("buildSurfaceMeshData triangulates valid cells and averages corner heights", () => {
    const surface = {
        cols: 2,
        rows: 2,
        cellSize: 1,
        surfaceZ: Float64Array.from([0, 2, 4, NaN]),
        weights: Float64Array.from([1, 1, 1, 0])
    };
    const data = buildSurfaceMeshData(surface);
    assert.equal(data.indices.length, 3 * 2 * 3);
    const zAt = (x, y) => {
        for (let i = 0; i < data.positions.length; i += 3) {
            if (data.positions[i] === x && data.positions[i + 1] === y) {
                return data.positions[i + 2];
            }
        }
        return null;
    };
    assert.equal(zAt(0, 0), 0);
    assert.equal(zAt(1, 1), 2);
    assert.equal(zAt(2, 0), 2);
    assert.equal(zAt(0, 2), 4);
});

test("evaluateQuality flags low coverage, filled cells and low density", () => {
    const thresholds = { minCoveragePct: 85, maxFilledPct: 15, minMedianPointsPerCell: 3 };
    const good = evaluateQuality({
        coveragePct: 99, filledPct: 1, unfilled: 0, medianPointsPerCell: 20
    }, thresholds);
    assert.equal(good.approximate, false);
    assert.equal(good.reasons.length, 0);

    const bad = evaluateQuality({
        coveragePct: 60, filledPct: 40, unfilled: 5, medianPointsPerCell: 1
    }, thresholds);
    assert.equal(bad.approximate, true);
    assert.equal(bad.reasons.length, 4);
});
