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
import { computeLockPlane, lockPlaneZAt } from "../src/utils/HeightLockPlane.js";

test("one point gives a horizontal plane through it", () => {
    const plane = computeLockPlane([{ x: -560000, y: -1110000, z: 250.5 }]);
    assert.equal(plane.gx, 0);
    assert.equal(plane.gy, 0);
    assert.ok(Math.abs(lockPlaneZAt(plane, -560020, -1110030) - 250.5) < 1e-9);
});

test("two points give a sloped line extended horizontally sideways", () => {
    const a = { x: 0, y: 0, z: 10 };
    const b = { x: 10, y: 0, z: 12 };
    const plane = computeLockPlane([a, b]);
    assert.ok(Math.abs(lockPlaneZAt(plane, 5, 0) - 11) < 1e-9);
    assert.ok(Math.abs(lockPlaneZAt(plane, 20, 0) - 14) < 1e-9);
    assert.ok(Math.abs(lockPlaneZAt(plane, 5, 100) - 11) < 1e-9);
});

test("three and more points give the least-squares plane", () => {
    const planeFn = (x, y) => 5 + 0.1 * x - 0.05 * y;
    const points = [
        { x: 0, y: 0, z: planeFn(0, 0) },
        { x: 10, y: 2, z: planeFn(10, 2) },
        { x: 3, y: 12, z: planeFn(3, 12) },
        { x: -4, y: 7, z: planeFn(-4, 7) }
    ];
    const plane = computeLockPlane(points);
    assert.ok(Math.abs(lockPlaneZAt(plane, 20, -10) - planeFn(20, -10)) < 1e-9);
});

test("collinear points fall back to the endpoint line", () => {
    const points = [
        { x: 0, y: 0, z: 10 }, { x: 5, y: 0, z: 11 }, { x: 10, y: 0, z: 12 }
    ];
    const plane = computeLockPlane(points);
    assert.ok(Math.abs(lockPlaneZAt(plane, 10, 50) - 12) < 1e-9);
    assert.ok(Math.abs(lockPlaneZAt(plane, 0, -50) - 10) < 1e-9);
});

test("nearly collinear points fall back to the endpoint line instead of a wild plane", () => {
    const points = [
        { x: 0, y: 0, z: 10 }, { x: 25, y: 0.01, z: 11.5 }, { x: 50, y: 0, z: 12 }
    ];
    const plane = computeLockPlane(points);
    assert.ok(Math.abs(plane.gy) < 0.05, `gy ${plane.gy}`);
    assert.ok(Math.abs(lockPlaneZAt(plane, 50, 0) - 12) < 0.1);
});
