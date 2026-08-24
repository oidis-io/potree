/*! ******************************************************************************************************** *
 *
 * Copyright 2026 Oidis
 *
 * SPDX-License-Identifier: BSD-2-Clause
 * The BSD-2-Clause license for this file can be found in the LICENSE.txt file included with this distribution
 * or at https://spdx.org/licenses/BSD-2-Clause.html#licenseText
 *
 * ********************************************************************************************************* */

import test from "node:test";
import assert from "node:assert/strict";
import {
    selectVertex, clearVertexSelection, selectedSphereIndex, applySelectedVertexLook, sphereRestEmissive,
    sphereHoverEmissive, createVertexClickTracker, SELECTED_VERTEX_SCALE
} from "../src/utils/VertexSelection.js";

function fakeSphere() {
    return {
        material: {
            emissive: {
                hex: 0,
                setHex(value) {
                    this.hex = value;
                }
            }
        },
        scale: {
            x: 1,
            y: 1,
            z: 1,
            set(x, y, z) {
                this.x = x;
                this.y = y;
                this.z = z;
            }
        }
    };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 1));
const click = (x, y) => ({ clientX: x, clientY: y });

test("exactly one vertex is selected at a time", () => {
    const spheres = [fakeSphere(), fakeSphere(), fakeSphere()];
    assert.equal(selectedSphereIndex(spheres), -1);
    selectVertex(spheres[1]);
    assert.equal(selectedSphereIndex(spheres), 1);
    assert.equal(spheres[1].material.emissive.hex, 0xff8800);
    selectVertex(spheres[2]);
    assert.equal(selectedSphereIndex(spheres), 2);
    assert.equal(spheres[1].material.emissive.hex, 0x000000);
    clearVertexSelection();
    assert.equal(selectedSphereIndex(spheres), -1);
});

test("host layer highlight does not count as a selected vertex", () => {
    const spheres = [fakeSphere(), fakeSphere()];
    spheres.forEach((sphere) => {
        sphere.isElementSelected = true;
    });
    assert.equal(selectedSphereIndex(spheres), -1);
    assert.equal(sphereRestEmissive(spheres[0]), 0x888888);
    selectVertex(spheres[0]);
    assert.equal(sphereRestEmissive(spheres[0]), 0xff8800);
    assert.equal(sphereHoverEmissive(spheres[0]), 0xff8800);
    assert.equal(sphereHoverEmissive(spheres[1]), 0x888888);
    clearVertexSelection();
    assert.equal(spheres[0].material.emissive.hex, 0x888888);
});

test("selected vertex is drawn larger and keeps its colour on every update", () => {
    const sphere = fakeSphere();
    applySelectedVertexLook(sphere, 2);
    assert.equal(sphere.scale.x, 2);
    selectVertex(sphere);
    sphere.material.emissive.setHex(0x888888);
    applySelectedVertexLook(sphere, 2);
    assert.equal(sphere.scale.x, 2 * SELECTED_VERTEX_SCALE);
    assert.equal(sphere.material.emissive.hex, 0xff8800);
    clearVertexSelection();
});

test("click tracker selects on a still click, ignores drags and clears on an empty click", async () => {
    const spheres = [fakeSphere(), fakeSphere()];
    const tracker = createVertexClickTracker();
    tracker.press(click(10, 10), { sphere: spheres[0] });
    tracker.release(click(30, 10));
    assert.equal(selectedSphereIndex(spheres), -1, "a drag must not select");
    tracker.press(click(10, 10), { sphere: spheres[0] });
    tracker.release(click(11, 11));
    assert.equal(selectedSphereIndex(spheres), 0);
    tracker.press(click(50, 50), { keep: true });
    tracker.release(click(50, 50));
    await tick();
    assert.equal(selectedSphereIndex(spheres), 0, "a handle click keeps the selection");
    tracker.press(click(80, 80), null);
    tracker.release(click(80, 80));
    await tick();
    assert.equal(selectedSphereIndex(spheres), -1, "an empty click clears the selection");
});

test("an empty click seen by another tool does not clear a selection made for the same click", async () => {
    const spheres = [fakeSphere()];
    const selecting = createVertexClickTracker();
    const other = createVertexClickTracker();
    const down = click(5, 5);
    const up = click(5, 5);
    other.press(down, null);
    selecting.press(down, { sphere: spheres[0] });
    other.release(up);
    selecting.release(up);
    await tick();
    assert.equal(selectedSphereIndex(spheres), 0);
    clearVertexSelection();
});
