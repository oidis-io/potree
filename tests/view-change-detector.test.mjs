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
import * as THREE from "../libs/three.js/build/three.module.js";
import { ViewChangeDetector } from "../src/modules/UtilityNetworkEditor/ViewChangeDetector.js";

test("ViewChangeDetector reports a change only after the camera moves", () => {
    const camera = new THREE.PerspectiveCamera(60, 1.5, 0.1, 1000);
    camera.position.set(0, 0, 100);
    camera.lookAt(0, 0, 0);
    const viewer = { scene: { getActiveCamera: () => camera } };
    const mapPlane = { height: 0, getRenderSize: () => ({ width: 800, height: 600 }) };
    const detector = new ViewChangeDetector(viewer, mapPlane);
    assert.equal(detector.hasChanged(), true);
    assert.equal(detector.hasChanged(), false);
    camera.position.x += 5;
    assert.equal(detector.hasChanged(), true);
    assert.equal(detector.hasChanged(), false);
});
