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
import { EmbankmentComputation, computeEmbankmentVolumes, computePileVolume } from "../src/utils/EmbankmentComputation.js";
import { densifyOutlineRing, estimatePileBaseUncertaintyPct } from "../src/utils/EmbankmentMath.js";
import { makeTestCloud } from "./helpers/FakeCloud.mjs";

function makeViewer(clouds) {
    return { scene: { pointclouds: clouds.map((c) => c.pointcloud) } };
}

function circleOutline(cx, cy, r, z, segments) {
    const points = [];
    for (let i = 0; i < segments; i++) {
        const angle = (2 * Math.PI * i) / segments;
        points.push({ x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle), z });
    }
    return points;
}

function runProbe(viewer, params) {
    return new Promise((resolve, reject) => {
        const computation = new EmbankmentComputation(viewer, params, {
            onReady: resolve,
            onFailed: reject,
            onCanceled: () => reject(new Error("canceled"))
        });
        computation.start();
    });
}

const flatCloudOptions = {
    surfaceFn: () => 0,
    bounds: { minX: -15, minY: -15, maxX: 35, maxY: 35 },
    density: 300,
    seed: 21
};

const squareOutline = [
    { x: 0, y: 0, z: 0 }, { x: 20, y: 0, z: 0 }, { x: 20, y: 20, z: 0 }, { x: 0, y: 20, z: 0 }
];

test("densifyOutlineRing samples the ring with the requested step", () => {
    const samples = densifyOutlineRing(squareOutline, 0.5);
    assert.equal(samples.length, 4 * 40);
    assert.ok(samples.every((s) => Number.isFinite(s.z)));
});

test("embankment corpus: prism on flat terrain (bevel off) gives A*h, all navazka", async () => {
    const cloud = makeTestCloud(flatCloudOptions);
    const probe = await runProbe(makeViewer([cloud]), { outlinePoints: squareOutline });
    const result = computeEmbankmentVolumes(probe, { heightM: 2, bevelEnabled: false, slopeDeg: 45 });
    assert.ok(Math.abs(result.total - 800) < 1, `total ${result.total}`);
    assert.ok(Math.abs(result.aboveOutlineVolume - 800) < 1, `aboveOutlineVolume ${result.aboveOutlineVolume}`);
    assert.ok(Math.abs(result.belowOutlineVolume) < 1, `belowOutlineVolume ${result.belowOutlineVolume}`);
    assert.equal(result.quality.approximate, false);
});

test("embankment corpus: h=0 over a depression measures the fill-up volume as dosypani", async () => {
    const surfaceFn = (x, y) => {
        const dx = Math.max(0, Math.max(5 - x, x - 15));
        const dy = Math.max(0, Math.max(5 - y, y - 15));
        return -2 + Math.min(2, Math.max(dx, dy));
    };
    const cloud = makeTestCloud({
        surfaceFn,
        bounds: { minX: -15, minY: -15, maxX: 35, maxY: 35 },
        density: 500,
        seed: 22
    });
    const outline = [
        { x: 1, y: 1, z: 0 }, { x: 19, y: 1, z: 0 }, { x: 19, y: 19, z: 0 }, { x: 1, y: 19, z: 0 }
    ];
    const probe = await runProbe(makeViewer([cloud]), { outlinePoints: outline });
    const result = computeEmbankmentVolumes(probe, { heightM: 0, bevelEnabled: false, slopeDeg: 45 });
    const expected = (2 / 3) * (100 + 196 + Math.sqrt(100 * 196));
    assert.ok(Math.abs(result.total - expected) < 1, `total ${result.total} expected ${expected}`);
    assert.ok(Math.abs(result.belowOutlineVolume - expected) < 1, `belowOutlineVolume ${result.belowOutlineVolume}`);
    assert.ok(Math.abs(result.aboveOutlineVolume) < 1, `aboveOutlineVolume ${result.aboveOutlineVolume}`);
});

test("embankment corpus: bevel cuts the top edges inward, matching the analytic erosion integral", async () => {
    const cloud = makeTestCloud(flatCloudOptions);
    const probe = await runProbe(makeViewer([cloud]), { outlinePoints: squareOutline });
    const h = 2;
    const expected = 400 * h - 40 * h * h + (4 / 3) * h * h * h;
    const result = computeEmbankmentVolumes(probe, { heightM: h, bevelEnabled: true, slopeDeg: 45 });
    assert.ok(Math.abs(result.total - expected) < 2, `total ${result.total} expected ${expected}`);
    const plain = computeEmbankmentVolumes(probe, { heightM: h, bevelEnabled: false, slopeDeg: 45 });
    assert.ok(result.total < plain.total, "bevel must not add volume beyond the drawn outline");
    assert.ok(result.crownSurface !== null);
    assert.equal(result.bevelCapM, null, "a fitting bevel must not report a ridge cap");
    assert.equal(result.quality.approximate, false);
    assert.throws(() => computeEmbankmentVolumes(probe, { heightM: h, bevelEnabled: true, slopeDeg: 80 }),
        /mezi 10° a 60°/);
});

test("embankment corpus: tiny outline with bevel reports the ridge cap instead of the full height", async () => {
    const cloud = makeTestCloud(flatCloudOptions);
    const outline = [
        { x: 5, y: 5, z: 0 }, { x: 6, y: 5, z: 0 }, { x: 6, y: 6, z: 0 }, { x: 5, y: 6, z: 0 }
    ];
    const probe = await runProbe(makeViewer([cloud]), { outlinePoints: outline });
    const result = computeEmbankmentVolumes(probe, { heightM: 2, bevelEnabled: true, slopeDeg: 45 });
    assert.ok(Math.abs(result.total - 1 / 6) < 0.06, `total ${result.total} expected ${1 / 6}`);
    assert.ok(result.bevelCapM !== null, "ridge cap must be reported");
    assert.ok(result.bevelCapM > 0.3 && result.bevelCapM < 0.51, `bevelCapM ${result.bevelCapM}`);
});

test("embankment corpus: sloped terrain with outline on it gives pure navazka prism", async () => {
    const cloud = makeTestCloud({
        surfaceFn: (x) => 0.1 * x,
        bounds: { minX: -15, minY: -15, maxX: 35, maxY: 35 },
        density: 300,
        seed: 23
    });
    const outline = [
        { x: 0, y: 0, z: 0 }, { x: 20, y: 0, z: 2 }, { x: 20, y: 20, z: 2 }, { x: 0, y: 20, z: 0 }
    ];
    const probe = await runProbe(makeViewer([cloud]), { outlinePoints: outline });
    const result = computeEmbankmentVolumes(probe, { heightM: 3, bevelEnabled: false, slopeDeg: 45 });
    assert.ok(Math.abs(result.total - 1200) < 1.5, `total ${result.total}`);
    assert.ok(Math.abs(result.belowOutlineVolume) < 1.5, `belowOutlineVolume ${result.belowOutlineVolume}`);
});

test("embankment corpus: bevel taller than the inradius caps the body at the ridge pyramid", async () => {
    const cloud = makeTestCloud(flatCloudOptions);
    const probe = await runProbe(makeViewer([cloud]), { outlinePoints: squareOutline });
    const expected = (4 / 3) * 1000;
    const tall = computeEmbankmentVolumes(probe, { heightM: 20, bevelEnabled: true, slopeDeg: 45 });
    assert.ok(Math.abs(tall.total - expected) < 2, `total ${tall.total} expected ${expected}`);
    const taller = computeEmbankmentVolumes(probe, { heightM: 30, bevelEnabled: true, slopeDeg: 45 });
    assert.ok(Math.abs(tall.total - taller.total) < 1e-9, "above the ridge the height must not matter");
});

test("pile corpus: hemisphere on flat ground matches (2/3)πR³ within 1 %", async () => {
    const R = 6;
    const surfaceFn = (x, y) => {
        const d2 = (x - 10) ** 2 + (y - 10) ** 2;
        return d2 < R * R ? Math.sqrt(R * R - d2) : 0;
    };
    const cloud = makeTestCloud({
        surfaceFn,
        bounds: { minX: -1, minY: -1, maxX: 21, maxY: 21 },
        density: 700,
        seed: 51
    });
    const outline = circleOutline(10, 10, 6.6, 0, 16);
    const probe = await runProbe(makeViewer([cloud]), { outlinePoints: outline, mode: "pile" });
    const result = computePileVolume(probe);
    const expected = (2 / 3) * Math.PI * R * R * R;
    assert.ok(Math.abs(result.total - expected) < 0.01 * expected + 1,
        `pile ${result.total} expected ${expected}`);
    assert.equal(result.uncertaintyPct, 3);
});

test("pile corpus: pile probe uses the upper envelope, clutter below is irrelevant", async () => {
    const R = 5;
    const surfaceFn = (x, y) => {
        const d2 = (x - 10) ** 2 + (y - 10) ** 2;
        return d2 < R * R ? Math.sqrt(R * R - d2) : 0;
    };
    const cloud = makeTestCloud({
        surfaceFn,
        bounds: { minX: -1, minY: -1, maxX: 21, maxY: 21 },
        density: 700,
        seed: 52,
        ghostPlane: { fraction: 0.15, depth: 4, region: { minX: 6, minY: 6, maxX: 14, maxY: 14 } }
    });
    const outline = circleOutline(10, 10, 5.6, 0, 16);
    const probe = await runProbe(makeViewer([cloud]), { outlinePoints: outline, mode: "pile" });
    const result = computePileVolume(probe);
    const expected = (2 / 3) * Math.PI * R * R * R;
    assert.ok(Math.abs(result.total - expected) < 0.01 * expected + 1,
        `pile ${result.total} expected ${expected}`);
});

test("estimatePileBaseUncertaintyPct classifies flat vs sloped foot", () => {
    const flat = [
        { x: 0, y: 0, z: 10 }, { x: 20, y: 0, z: 10.1 }, { x: 20, y: 20, z: 9.9 }, { x: 0, y: 20, z: 10 }
    ];
    assert.equal(estimatePileBaseUncertaintyPct(flat), 3);
    const sloped = [
        { x: 0, y: 0, z: 10 }, { x: 20, y: 0, z: 13 }, { x: 20, y: 20, z: 13 }, { x: 0, y: 20, z: 10 }
    ];
    assert.equal(estimatePileBaseUncertaintyPct(sloped), 10);
});

test("embankment volumes are deterministic and hash-stable across runs", async () => {
    const first = await runProbe(makeViewer([makeTestCloud(flatCloudOptions)]), { outlinePoints: squareOutline });
    const second = await runProbe(makeViewer([makeTestCloud(flatCloudOptions)]), { outlinePoints: squareOutline });
    const a = computeEmbankmentVolumes(first, { heightM: 2, bevelEnabled: true, slopeDeg: 45 });
    const b = computeEmbankmentVolumes(second, { heightM: 2, bevelEnabled: true, slopeDeg: 45 });
    assert.equal(a.total, b.total);
    assert.equal(a.inputHash, b.inputHash);
    const c = computeEmbankmentVolumes(second, { heightM: 2.5, bevelEnabled: true, slopeDeg: 45 });
    assert.notEqual(a.inputHash, c.inputHash);
});
