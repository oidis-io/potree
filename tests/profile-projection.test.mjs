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
import { ProfileProjection } from "../src/viewer/ProfileProjection.js";

const tolerance = 1e-9;

function assertProjection(actual, mileage, elevation) {
    assert.notEqual(actual, null);
    assert.ok(Math.abs(actual.mileage - mileage) < tolerance, `mileage ${actual.mileage} !== ${mileage}`);
    assert.ok(Math.abs(actual.elevation - elevation) < tolerance, `elevation ${actual.elevation} !== ${elevation}`);
}

test("straight profile projects mileage along the axis and keeps elevation", () => {
    const projection = new ProfileProjection([{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 5 }], 2);

    assertProjection(projection.project({ x: 4, y: 0.5, z: 250.25 }), 4, 250.25);
});

test("point outside the profile width is not projected", () => {
    const projection = new ProfileProjection([{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }], 2);

    assert.equal(projection.project({ x: 4, y: 1.5, z: 0 }), null);
});

test("point beyond the profile end is not projected", () => {
    const projection = new ProfileProjection([{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }], 2);

    assert.equal(projection.project({ x: 15, y: 0, z: 0 }), null);
});

test("second segment of a bent profile continues the mileage of the first one", () => {
    const projection = new ProfileProjection([{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, { x: 10, y: 10, z: 0 }], 2);

    assertProjection(projection.project({ x: 10.5, y: 4, z: 12 }), 14, 12);
});

test("point inside the bend belongs to the segment it is perpendicularly closest to", () => {
    const projection = new ProfileProjection([{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, { x: 10, y: 10, z: 0 }], 2);

    assertProjection(projection.project({ x: 9.2, y: 0.5, z: 3 }), 9.2, 3);
    assertProjection(projection.project({ x: 9.5, y: 0.8, z: 3 }), 10.8, 3);
});

test("point outside the bend is snapped to the bend mileage", () => {
    const projection = new ProfileProjection([{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, { x: 10, y: 10, z: 0 }], 2);

    assertProjection(projection.project({ x: 10.5, y: -0.5, z: 7 }), 10, 7);
});

test("zero length segment does not shift the mileage", () => {
    const projection = new ProfileProjection([{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }], 2);

    assertProjection(projection.project({ x: 6, y: 0, z: 1 }), 6, 1);
});
