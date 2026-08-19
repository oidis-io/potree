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
    AutoCubatureComputation,
    computeAutoCubatureInputHash,
    AUTO_CUBATURE_DEFAULTS
} from "../src/utils/AutoCubatureComputation.js";
import { makeTestCloud } from "./helpers/FakeCloud.mjs";

const outline = [
    { x: 0, y: 0, z: 0 }, { x: 20, y: 0, z: 0 }, { x: 20, y: 20, z: 0 }, { x: 0, y: 20, z: 0 }
];

function makeViewer(clouds) {
    return { scene: { pointclouds: clouds.map((c) => c.pointcloud) } };
}

function runComputation(viewer, params) {
    return new Promise((resolve, reject) => {
        const computation = new AutoCubatureComputation(viewer, params, {
            onCompleted: resolve,
            onFailed: reject,
            onCanceled: () => reject(new Error("canceled"))
        });
        computation.start();
    });
}

test("auto cubature computes a flat pit end to end through the scheduler", async () => {
    const cloud = makeTestCloud({
        surfaceFn: () => -2,
        bounds: { minX: -1, minY: -1, maxX: 21, maxY: 21 },
        density: 400,
        seed: 3,
        loadMode: "async",
        loadDelayMs: 1
    });
    const result = await runComputation(makeViewer([cloud]), { topControlPoints: outline });

    assert.ok(Math.abs(result.volume - 800) < 1, `volume ${result.volume}`);
    assert.equal(result.quality.approximate, false);
    assert.equal(result.bottomZByIndex.length, 4);
    for (const z of result.bottomZByIndex) {
        assert.ok(Math.abs(z + 2) < 0.1, `bottom vertex z ${z}`);
    }
    assert.match(result.inputHash, /^[0-9a-f]{8}$/);
});

test("display bottom plate sits at the pit floor even when the outline is on the rim", async () => {
    const surfaceFn = (x, y) => {
        const dx = Math.max(0, Math.max(5 - x, x - 15));
        const dy = Math.max(0, Math.max(5 - y, y - 15));
        return -2 + Math.min(2, Math.max(dx, dy));
    };
    const cloud = makeTestCloud({
        surfaceFn,
        bounds: { minX: -1, minY: -1, maxX: 21, maxY: 21 },
        density: 500,
        seed: 12
    });
    const rimOutline = [
        { x: 1, y: 1, z: 0 }, { x: 19, y: 1, z: 0 }, { x: 19, y: 19, z: 0 }, { x: 1, y: 19, z: 0 }
    ];
    const result = await runComputation(makeViewer([cloud]), { topControlPoints: rimOutline });
    for (const z of result.bottomZByIndex) {
        assert.ok(Math.abs(z + 2) < 0.15, `bottom plate should sit at the floor (-2), got ${z}`);
    }
});

test("auto cubature merges two overlapping clouds into one grid", async () => {
    const west = makeTestCloud({
        surfaceFn: () => -2,
        bounds: { minX: -1, minY: -1, maxX: 11, maxY: 21 },
        density: 400,
        seed: 4
    });
    const east = makeTestCloud({
        surfaceFn: () => -2,
        bounds: { minX: 9, minY: -1, maxX: 21, maxY: 21 },
        density: 400,
        seed: 5
    });
    const result = await runComputation(makeViewer([west, east]), { topControlPoints: outline });
    assert.ok(Math.abs(result.volume - 800) < 1, `volume ${result.volume}`);
});

test("auto cubature fails loudly on a self-intersecting outline", async () => {
    const cloud = makeTestCloud({
        surfaceFn: () => -2,
        bounds: { minX: -1, minY: -1, maxX: 21, maxY: 21 },
        density: 100,
        seed: 6
    });
    const bowtie = [
        { x: 0, y: 0, z: 0 }, { x: 10, y: 10, z: 0 }, { x: 10, y: 0, z: 0 }, { x: 0, y: 10, z: 0 }
    ];
    await assert.rejects(
        runComputation(makeViewer([cloud]), { topControlPoints: bowtie }),
        /kříží/
    );
});

test("auto cubature fails when the scene has no measurable pointcloud", async () => {
    await assert.rejects(
        runComputation(makeViewer([]), { topControlPoints: outline }),
        /žádné mračno/
    );
});

test("cancel during computation reports onCanceled", async () => {
    const cloud = makeTestCloud({
        surfaceFn: () => -2,
        bounds: { minX: -1, minY: -1, maxX: 21, maxY: 21 },
        density: 400,
        seed: 7,
        loadMode: "async",
        loadDelayMs: 3
    });
    const canceled = await new Promise((resolve, reject) => {
        const computation = new AutoCubatureComputation(makeViewer([cloud]), { topControlPoints: outline }, {
            onCompleted: () => reject(new Error("should not complete")),
            onFailed: reject,
            onCanceled: () => resolve(true)
        });
        computation.start();
        computation.cancel();
    });
    assert.equal(canceled, true);
});

test("input hash is stable for identical input and differs when the outline moves", () => {
    const cloud = makeTestCloud({
        surfaceFn: () => -2,
        bounds: { minX: -1, minY: -1, maxX: 21, maxY: 21 },
        density: 50,
        seed: 8
    });
    const clouds = [cloud.pointcloud];
    const hashA = computeAutoCubatureInputHash(outline, AUTO_CUBATURE_DEFAULTS, clouds);
    const hashB = computeAutoCubatureInputHash(outline, AUTO_CUBATURE_DEFAULTS, clouds);
    const moved = outline.map((p, i) => (i === 0 ? { ...p, x: p.x + 0.01 } : p));
    const hashC = computeAutoCubatureInputHash(moved, AUTO_CUBATURE_DEFAULTS, clouds);
    assert.equal(hashA, hashB);
    assert.notEqual(hashA, hashC);
});
