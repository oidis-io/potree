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
    clipPolygonToRect,
    clippedAreaInRect,
    isSimplePolygon,
    nodeIntersectsPolygonPrism,
    pointInPolygon,
    polygonArea,
    polygonBounds,
    polygonCentroid
} from "../src/utils/PolygonMath.js";

const rect = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
const lShape = [
    { x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 },
    { x: 10, y: 10 }, { x: 10, y: 20 }, { x: 0, y: 20 }
];

test("polygonArea computes rectangle and L-shape areas", () => {
    assert.equal(polygonArea(rect), 100);
    assert.equal(polygonArea(lShape), 300);
    assert.equal(polygonArea([...rect].reverse()), 100);
});

test("polygonBounds and centroid", () => {
    assert.deepEqual(polygonBounds(rect), { minX: 0, minY: 0, maxX: 10, maxY: 10 });
    const centroid = polygonCentroid(rect);
    assert.ok(Math.abs(centroid.x - 5) < 1e-12);
    assert.ok(Math.abs(centroid.y - 5) < 1e-12);
});

test("pointInPolygon on convex and concave polygons", () => {
    assert.equal(pointInPolygon(5, 5, rect), true);
    assert.equal(pointInPolygon(-1, 5, rect), false);
    assert.equal(pointInPolygon(5, 5, lShape), true);
    assert.equal(pointInPolygon(15, 15, lShape), false);
});

test("isSimplePolygon rejects self-intersection and degenerate input", () => {
    assert.equal(isSimplePolygon(rect), true);
    assert.equal(isSimplePolygon(lShape), true);
    const bowtie = [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 10, y: 0 }, { x: 0, y: 10 }];
    assert.equal(isSimplePolygon(bowtie), false);
    assert.equal(isSimplePolygon([{ x: 0, y: 0 }, { x: 1, y: 1 }]), false);
});

test("clipPolygonToRect covers interior, boundary and outside cells", () => {
    const inside = clipPolygonToRect(rect, 2, 2, 4, 4);
    assert.ok(Math.abs(polygonArea(inside) - 4) < 1e-12);

    const cut = clippedAreaInRect(rect, -5, -5, 5, 5);
    assert.ok(Math.abs(cut - 25) < 1e-12);

    const outside = clipPolygonToRect(rect, 20, 20, 25, 25);
    assert.equal(polygonArea(outside), 0);

    const wholePolygon = clipPolygonToRect(rect, -10, -10, 30, 30);
    assert.ok(Math.abs(polygonArea(wholePolygon) - 100) < 1e-12);
});

test("clipped areas of concave polygon sum to full area over a grid", () => {
    const cell = 2.5;
    let sum = 0;
    for (let x = 0; x < 20; x += cell) {
        for (let y = 0; y < 20; y += cell) {
            sum += clippedAreaInRect(lShape, x, y, x + cell, y + cell);
        }
    }
    assert.ok(Math.abs(sum - 300) < 1e-9);
});

test("nodeIntersectsPolygonPrism prunes by z-range and XY overlap", () => {
    const bounds = polygonBounds(rect);
    const boxHit = { minX: 4, minY: 4, minZ: -5, maxX: 6, maxY: 6, maxZ: 5 };
    const boxAbove = { minX: 4, minY: 4, minZ: 10, maxX: 6, maxY: 6, maxZ: 20 };
    const boxAside = { minX: 50, minY: 50, minZ: -5, maxX: 60, maxY: 60, maxZ: 5 };
    assert.equal(nodeIntersectsPolygonPrism(boxHit, rect, bounds, -10, 5), true);
    assert.equal(nodeIntersectsPolygonPrism(boxAbove, rect, bounds, -10, 5), false);
    assert.equal(nodeIntersectsPolygonPrism(boxAside, rect, bounds, -10, 5), false);
});
