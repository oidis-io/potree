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
import { PolygonPointQuery } from "../src/PolygonPointQuery.js";
import { prismVolume } from "../src/utils/CubatureMath.js";
import { TerrainColumnGrid } from "../src/utils/TerrainColumnGrid.js";
import {
    buildLidInterpolator,
    evaluateQuality,
    integratePitColumns
} from "../src/utils/TerrainGridMath.js";
import { drainQuery, makeTestCloud } from "./helpers/FakeCloud.mjs";

const DEFAULT_DETECTION = { gapThreshold: 0.15, minClusterShare: 0.3, fromBelow: true, maxFillRing: 8 };
const QUALITY_THRESHOLDS = { minCoveragePct: 85, maxFilledPct: 15, minMedianPointsPerCell: 3 };

async function computePit(options) {
    const {
        surfaceFn,
        outline,
        cellSize = 0.15,
        density = 400,
        seed = 11,
        noiseSigma = 0,
        outlierFraction = 0,
        outlierMaxDepth = 0.5,
        ghostPlane = null,
        dropoutRegions = [],
        cloudBounds = { minX: -1, minY: -1, maxX: 21, maxY: 21 },
        maxPoints = 20000000
    } = options;

    const cloud = makeTestCloud({
        surfaceFn, bounds: cloudBounds, density, seed, noiseSigma, outlierFraction, outlierMaxDepth, ghostPlane, dropoutRegions
    });
    const polygon = outline.map((p) => ({ x: p.x, y: p.y }));
    const grid = new TerrainColumnGrid({ polygon, cellSize, maxGridCells: 1000000, maxPoints });
    const lid = buildLidInterpolator(outline);

    const query = new PolygonPointQuery(cloud.pointcloud, {
        polygon,
        zMin: cloud.zRange.minZ - 1,
        zMax: Math.max(...outline.map((p) => p.z)) + 1
    }, {
        onPoints: (xs, ys, zs, count) => grid.addPoints(xs, ys, zs, count),
        onFinish() {},
        onError(error) {
            throw error;
        }
    });
    await drainQuery(query);

    const stats = grid.finalize(DEFAULT_DETECTION);
    const integration = integratePitColumns(grid, lid.lidZAt);
    const quality = evaluateQuality(stats, QUALITY_THRESHOLDS);
    return { volume: integration.volume, integration, stats, quality };
}

const squareOutline = [
    { x: 0, y: 0, z: 0 }, { x: 20, y: 0, z: 0 }, { x: 20, y: 20, z: 0 }, { x: 0, y: 20, z: 0 }
];

test("corpus: flat bottom matches analytic volume and manual prismVolume", async () => {
    const result = await computePit({ surfaceFn: () => -2, outline: squareOutline });
    assert.ok(Math.abs(result.volume - 800) < 1, `volume ${result.volume}`);
    assert.equal(result.quality.approximate, false);

    const bottom = squareOutline.map((p) => ({ x: p.x, y: p.y, z: -2 }));
    const manual = prismVolume(squareOutline, bottom);
    assert.ok(Math.abs(result.volume - manual) < 1, `auto ${result.volume} vs manual ${manual}`);
});

test("corpus: inclined plane bottom", async () => {
    const result = await computePit({
        surfaceFn: (x) => -2 + 0.05 * x,
        outline: squareOutline
    });
    const expected = 20 * 20 * (2 + 1) / 2;
    assert.ok(Math.abs(result.volume - expected) < 1, `volume ${result.volume} expected ${expected}`);
});

test("corpus: curved paraboloid bowl", async () => {
    const result = await computePit({
        surfaceFn: (x, y) => -2 + (Math.pow(x - 10, 2) + Math.pow(y - 10, 2)) / 200,
        outline: squareOutline
    });
    const expected = 800 - 80000 / 600;
    assert.ok(Math.abs(result.volume - expected) < 1, `volume ${result.volume} expected ${expected}`);
});

test("corpus: local depression with 45-degree sides", async () => {
    const surfaceFn = (x, y) => {
        const dx = Math.max(0, Math.max(7 - x, x - 13));
        const dy = Math.max(0, Math.max(7 - y, y - 13));
        const inset = Math.max(dx, dy);
        const depth = Math.max(0, 1 - inset);
        return -2 - depth;
    };
    const result = await computePit({ surfaceFn, outline: squareOutline, density: 600 });
    const expected = 800 + (36 + 64 + Math.sqrt(36 * 64)) / 3;
    assert.ok(Math.abs(result.volume - expected) < 1, `volume ${result.volume} expected ${expected}`);
});

test("corpus: noise with low outliers stays within tolerance", async () => {
    const result = await computePit({
        surfaceFn: () => -2,
        outline: squareOutline,
        noiseSigma: 0.03,
        outlierFraction: 0.005,
        outlierMaxDepth: 0.5,
        density: 500
    });
    assert.ok(Math.abs(result.volume - 800) < 1, `volume ${result.volume}`);
});

test("corpus: concave boundary is clipped exactly", async () => {
    const lOutline = [
        { x: 0, y: 0, z: 0 }, { x: 20, y: 0, z: 0 }, { x: 20, y: 10, z: 0 },
        { x: 10, y: 10, z: 0 }, { x: 10, y: 20, z: 0 }, { x: 0, y: 20, z: 0 }
    ];
    const result = await computePit({ surfaceFn: () => -2, outline: lOutline });
    assert.ok(Math.abs(result.volume - 600) < 1, `volume ${result.volume}`);
});

test("corpus: determinism — two full runs give the identical number", async () => {
    const first = await computePit({ surfaceFn: (x) => -2 + 0.05 * x, outline: squareOutline });
    const second = await computePit({ surfaceFn: (x) => -2 + 0.05 * x, outline: squareOutline });
    assert.equal(first.volume, second.volume);
});

test("corpus: small dropout is filled from neighbors, large dropout flags orientacni", async () => {
    const small = await computePit({
        surfaceFn: () => -2,
        outline: squareOutline,
        dropoutRegions: [{ minX: 9, minY: 9, maxX: 11.5, maxY: 11.5 }]
    });
    assert.ok(Math.abs(small.volume - 800) < 1, `volume ${small.volume}`);
    assert.ok(small.stats.filled > 0);
    assert.equal(small.quality.approximate, false);

    const large = await computePit({
        surfaceFn: () => -2,
        outline: squareOutline,
        dropoutRegions: [{ minX: 4, minY: 4, maxX: 16, maxY: 16 }]
    });
    assert.equal(large.quality.approximate, true);
    assert.ok(large.quality.reasons.length > 0);
});

test("corpus: wider outline than the pit adds no phantom volume (sloped walls found where they are)", async () => {
    const surfaceFn = (x, y) => {
        const dx = Math.max(0, Math.max(5 - x, x - 15));
        const dy = Math.max(0, Math.max(5 - y, y - 15));
        const outset = Math.max(dx, dy);
        return -2 + Math.min(2, outset);
    };
    const wideOutline = [
        { x: 1, y: 1, z: 0 }, { x: 19, y: 1, z: 0 }, { x: 19, y: 19, z: 0 }, { x: 1, y: 19, z: 0 }
    ];
    const result = await computePit({ surfaceFn, outline: wideOutline, density: 600 });
    const expected = (2 / 3) * (100 + 196 + Math.sqrt(100 * 196));
    assert.ok(Math.abs(result.volume - expected) < 1, `volume ${result.volume} expected ${expected}`);
});

test("corpus: tilted lid with a vertex in the pit at S-JTSK-scale coordinates", async () => {
    const offset = { x: -560000, y: -1110000, z: 240 };
    const surfaceFn = (x, y) => {
        const dx = Math.max(0, Math.max(5 - x, x - 15));
        const dy = Math.max(0, Math.max(5 - y, y - 15));
        return -2 + Math.min(2, Math.max(dx, dy));
    };
    const cloud = makeTestCloud({
        surfaceFn,
        bounds: { minX: -1, minY: -1, maxX: 21, maxY: 21 },
        density: 600,
        seed: 41,
        offset
    });
    const outline = [
        { x: 10 + offset.x, y: 3 + offset.y, z: 0 + offset.z },
        { x: 17 + offset.x, y: 10 + offset.y, z: 0 + offset.z },
        { x: 10 + offset.x, y: 10 + offset.y, z: -2 + offset.z }
    ];
    const polygon = outline.map((p) => ({ x: p.x, y: p.y }));
    const grid = new TerrainColumnGrid({ polygon, cellSize: 0.15, maxGridCells: 1000000, maxPoints: 20000000 });
    const lid = buildLidInterpolator(outline);
    const query = new PolygonPointQuery(cloud.pointcloud, {
        polygon, zMin: offset.z - 10, zMax: offset.z + 10
    }, {
        onPoints: (xs, ys, zs, count) => grid.addPoints(xs, ys, zs, count),
        onFinish() {},
        onError(error) {
            throw error;
        }
    });
    await drainQuery(query);
    grid.finalize(DEFAULT_DETECTION);
    const integration = integratePitColumns(grid, lid.lidZAt);

    const [a, b, c] = outline;
    const det = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
    let reference = 0;
    const step = 0.05;
    for (let x = 3; x <= 17; x += step) {
        for (let y = 3; y <= 10.01; y += step) {
            const wx = x + offset.x + step / 2;
            const wy = y + offset.y + step / 2;
            const l1 = ((b.y - c.y) * (wx - c.x) + (c.x - b.x) * (wy - c.y)) / det;
            const l2 = ((c.y - a.y) * (wx - c.x) + (a.x - c.x) * (wy - c.y)) / det;
            const l3 = 1 - l1 - l2;
            if (l1 < 0 || l2 < 0 || l3 < 0) {
                continue;
            }
            const lidZ = l1 * a.z + l2 * b.z + l3 * c.z;
            const depth = lidZ - (surfaceFn(x + step / 2, y + step / 2) + offset.z);
            if (depth > 0) {
                reference += depth * step * step;
            }
        }
    }
    assert.ok(Math.abs(integration.volume - reference) < 1,
        `volume ${integration.volume} vs reference ${reference}`);
});

test("corpus: pit dug into a hillside — outline follows the slope, lid is tilted", async () => {
    const offset = { x: -560000, y: -1110000, z: 240 };
    const slope = 0.15;
    const surfaceFn = (x, y) => {
        const dx = Math.max(0, Math.max(5 - x, x - 15));
        const dy = Math.max(0, Math.max(5 - y, y - 15));
        const pitDepth = Math.max(0, 2 - Math.max(dx, dy));
        return slope * x - pitDepth;
    };
    const cloud = makeTestCloud({
        surfaceFn,
        bounds: { minX: -1, minY: -1, maxX: 21, maxY: 21 },
        density: 600,
        seed: 42,
        offset
    });
    const outline = [1, 19].flatMap((x, i) => (i === 0
        ? [{ x: 1, y: 1 }, { x: 19, y: 1 }]
        : [{ x: 19, y: 19 }, { x: 1, y: 19 }]))
        .map((p) => ({ x: p.x + offset.x, y: p.y + offset.y, z: slope * p.x + offset.z }));
    const polygon = outline.map((p) => ({ x: p.x, y: p.y }));
    const grid = new TerrainColumnGrid({ polygon, cellSize: 0.15, maxGridCells: 1000000, maxPoints: 20000000 });
    const lid = buildLidInterpolator(outline);
    const query = new PolygonPointQuery(cloud.pointcloud, {
        polygon, zMin: offset.z - 10, zMax: offset.z + 10
    }, {
        onPoints: (xs, ys, zs, count) => grid.addPoints(xs, ys, zs, count),
        onFinish() {},
        onError(error) {
            throw error;
        }
    });
    await drainQuery(query);
    grid.finalize(DEFAULT_DETECTION);
    const integration = integratePitColumns(grid, lid.lidZAt);
    const expected = (2 / 3) * (100 + 196 + Math.sqrt(100 * 196));
    assert.ok(Math.abs(integration.volume - expected) < 1,
        `volume ${integration.volume} expected ${expected}`);
});

test("corpus: dense ghost reflections below the floor are skipped, not measured", async () => {
    const result = await computePit({
        surfaceFn: () => -2,
        outline: squareOutline,
        density: 800,
        noiseSigma: 0.02,
        ghostPlane: { fraction: 0.25, depth: 3, region: { minX: 5, minY: 5, maxX: 15, maxY: 15 } }
    });
    assert.ok(Math.abs(result.volume - 800) < 1, `volume ${result.volume} (ghost plane must not deepen the pit)`);
    assert.ok(result.stats.ghostSkippedCells > 100, `ghostSkippedCells ${result.stats.ghostSkippedCells}`);
});

test("corpus: point budget guard throws a loud error", async () => {
    await assert.rejects(
        computePit({ surfaceFn: () => -2, outline: squareOutline, maxPoints: 1000 }),
        /limit 1000 bodů/
    );
});

test("grid guard: too many cells throws before any computation", () => {
    assert.throws(() => new TerrainColumnGrid({
        polygon: squareOutline.map((p) => ({ x: p.x * 100, y: p.y * 100 })),
        cellSize: 0.15,
        maxGridCells: 250000,
        maxPoints: 1
    }), /příliš velká/);
});
