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
import { encodeSurfaceGrid, decodeSurfaceGrid, NO_SURFACE } from "../src/utils/SurfaceGridCodec.js";

function makeSurface(cols, rows, zAt) {
    const surfaceZ = new Float64Array(cols * rows).fill(NaN);
    const weights = new Float64Array(cols * rows);
    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
            const z = zAt(col, row);
            if (z !== null) {
                surfaceZ[row * cols + col] = z;
                weights[row * cols + col] = 0.0225;
            }
        }
    }
    return { originX: -560680.125, originY: -1109530.5, cellSize: 0.15, cols, rows, surfaceZ, weights };
}

test("round trip keeps geometry and heights within a centimetre", () => {
    const source = makeSurface(40, 30, (col, row) => 248.37 + col * 0.013 - row * 0.021);
    const restored = decodeSurfaceGrid(encodeSurfaceGrid(source));

    assert.equal(restored.cols, 40);
    assert.equal(restored.rows, 30);
    assert.equal(restored.cellSize, 0.15);
    assert.equal(restored.originX, -560680.125);
    assert.equal(restored.originY, -1109530.5);
    for (let index = 0; index < source.surfaceZ.length; index++) {
        assert.ok(Math.abs(restored.surfaceZ[index] - source.surfaceZ[index]) <= 0.005);
        assert.ok(restored.weights[index] > 0);
    }
});

test("cells without measured points stay empty", () => {
    const source = makeSurface(10, 10, (col, row) => ((col + row) % 3 === 0 ? null : 100 + col));
    const restored = decodeSurfaceGrid(encodeSurfaceGrid(source));

    for (let row = 0; row < 10; row++) {
        for (let col = 0; col < 10; col++) {
            const index = row * 10 + col;
            if ((col + row) % 3 === 0) {
                assert.ok(Number.isNaN(restored.surfaceZ[index]));
                assert.equal(restored.weights[index], 0);
            } else {
                assert.ok(Number.isFinite(restored.surfaceZ[index]));
            }
        }
    }
});

test("oversized grids are coarsened below the cell limit", () => {
    const source = makeSurface(300, 300, (col, row) => 200 + col * 0.01 + row * 0.01);
    const restored = decodeSurfaceGrid(encodeSurfaceGrid(source, 10000));

    assert.ok(restored.cols * restored.rows <= 10000);
    assert.equal(restored.cols, 100);
    assert.equal(restored.rows, 100);
    assert.equal(Math.round(restored.cellSize * 100) / 100, 0.45);
    assert.equal(restored.originX, source.originX);
    assert.ok(Math.abs(restored.surfaceZ[0] - 200.02) <= 0.01);
});

test("missing surface encodes to an explicit marker instead of an empty string", () => {
    const source = makeSurface(5, 5, () => null);

    assert.equal(encodeSurfaceGrid(source), NO_SURFACE);
    assert.equal(encodeSurfaceGrid(null), NO_SURFACE);
    assert.equal(decodeSurfaceGrid(NO_SURFACE), null);
    assert.equal(decodeSurfaceGrid(""), null);
    assert.equal(decodeSurfaceGrid(undefined), null);
});

test("height ranges beyond centimetre resolution fall back to a coarser scale", () => {
    const source = makeSurface(4, 4, (col, row) => (col === 0 && row === 0 ? 0 : 900));
    const restored = decodeSurfaceGrid(encodeSurfaceGrid(source));

    assert.ok(Math.abs(restored.surfaceZ[0] - 0) <= 0.05);
    assert.ok(Math.abs(restored.surfaceZ[5] - 900) <= 0.05);
});

test("damaged payloads are rejected instead of silently ignored", () => {
    const payload = encodeSurfaceGrid(makeSurface(6, 6, () => 12.5));

    assert.throws(() => decodeSurfaceGrid("nonsense"), /neplatný formát/);
    assert.throws(() => decodeSurfaceGrid(payload.replace("|6|6|", "|7|6|")), /neplatnou velikost/);
});
