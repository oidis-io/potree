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
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { composeTransforms, measurePointToRingsDistance, transformRing } from "../src/modules/UtilityNetworkEditor/BuildingFitting.js";
import { BuildingMatchStatus, matchBuildings, summarizeMatches } from "../src/modules/UtilityNetworkEditor/BuildingMatcher.js";

const vilemov = JSON.parse(readFileSync(new URL("./fixtures/vilemov-buildings.json", import.meta.url), "utf8"));
const vilemovResults = matchBuildings(vilemov.cadastreBuildings, vilemov.referenceBuildings);

function findResult(label) {
    return vilemovResults.find((result) => result.label === label);
}

function listLabels(status) {
    return vilemovResults.filter((result) => result.status === status).map((result) => result.label).sort();
}

function createRectangle(x, y, width, height) {
    return [[x, y], [x + width, y], [x + width, y + height], [x, y + height], [x, y]];
}

function shiftRing(ring, shiftX, shiftY) {
    return transformRing(ring, { centerX: 0, centerY: 0, shiftX: shiftX, shiftY: shiftY, rotationDegrees: 0 });
}

function assertNear(actual, expected, tolerance, message) {
    assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} is not within ${tolerance} of ${expected}`);
}

test("Vilémov: shifted old buildings and the block of č. 128 with its annex get a correction", () => {
    assert.deepEqual(listLabels(BuildingMatchStatus.SHIFTED), ["", "128", "148", "172", "231", "65", "71"]);
    for (const result of vilemovResults.filter((item) => item.status === BuildingMatchStatus.SHIFTED)) {
        assert.ok(result.fittedOverlap >= 0.7, result.label);
        assert.ok(result.fittedOverlap - result.originalOverlap >= 0.1, result.label);
        assert.ok(result.shiftLength >= 2 && result.shiftLength <= 8, result.label);
    }
    assert.equal(findResult("128").blockSize, 2);
    assert.deepEqual(findResult("").transform, findResult("128").transform);
});

test("Vilémov: buildings that fit, including the block of č. 173 and 182, stay untouched", () => {
    for (const label of ["173", "182", "196", "280", "281", "282", "283", "284", "285", "286", "287", "288", "289"]) {
        assert.equal(findResult(label).status, BuildingMatchStatus.ALIGNED, label);
    }
    assert.equal(findResult("173").blockSize, 2);
    for (const label of ["64", "162"]) {
        assert.equal(findResult(label).status, BuildingMatchStatus.DIFFERENT_SHAPE, label);
        assert.equal(findResult(label).transform, null, label);
    }
});

test("Vilémov: buildings without a reliable counterpart stay in place", () => {
    for (const label of ["75", "175"]) {
        assert.equal(findResult(label).status, BuildingMatchStatus.UNMATCHED, label);
    }
    assert.deepEqual(summarizeMatches(vilemovResults), {
        [BuildingMatchStatus.ALIGNED]: 13,
        [BuildingMatchStatus.SHIFTED]: 7,
        [BuildingMatchStatus.INTERPOLATED]: 0,
        [BuildingMatchStatus.DIFFERENT_SHAPE]: 2,
        [BuildingMatchStatus.UNMATCHED]: 2
    });
});

test("matchBuildings recovers a known shift and rotation", () => {
    const rectangle = createRectangle(0, 0, 20, 10);
    const reference = transformRing(rectangle, { centerX: 10, centerY: 5, shiftX: 3, shiftY: -2, rotationDegrees: 4 });
    const [result] = matchBuildings([{ identifier: 1, label: "1", outerRings: [rectangle] }], [{ identifier: "a", outerRings: [reference] }]);
    assert.equal(result.status, BuildingMatchStatus.SHIFTED);
    assert.equal(result.referenceIdentifier, "a");
    assertNear(result.transform.shiftX, 3, 0.15, "shiftX");
    assertNear(result.transform.shiftY, -2, 0.15, "shiftY");
    assertNear(result.transform.rotationDegrees, 4, 0.6, "rotation");
    assert.ok(result.fittedOverlap > 0.95);
});

test("matchBuildings leaves a building that already fits in place", () => {
    const rectangle = createRectangle(0, 0, 20, 10);
    const [result] = matchBuildings([{ identifier: 1, outerRings: [rectangle] }], [{ identifier: "a", outerRings: [rectangle] }]);
    assert.equal(result.status, BuildingMatchStatus.ALIGNED);
    assert.equal(result.transform, null);
    assert.equal(result.label, "");
});

test("matchBuildings treats a shift below the minimum of a coarse reference as aligned", () => {
    const building = { identifier: 1, outerRings: [createRectangle(0, 0, 10, 8)] };
    const nearReference = [{ identifier: "near", outerRings: [shiftRing(building.outerRings[0], 1.2, 0)] }];
    const farReference = [{ identifier: "far", outerRings: [shiftRing(building.outerRings[0], 3, 0)] }];
    assert.equal(matchBuildings([building], nearReference)[0].status, BuildingMatchStatus.SHIFTED);
    const [near] = matchBuildings([building], nearReference, { minimumShiftMetres: 1.5 });
    assert.equal(near.status, BuildingMatchStatus.ALIGNED);
    assert.equal(near.transform, null);
    assert.equal(matchBuildings([building], farReference, { minimumShiftMetres: 1.5 })[0].status, BuildingMatchStatus.SHIFTED);
});

test("matchBuildings aligns adjacent buildings together when the reference draws them as one block", () => {
    const buildings = [
        { identifier: 1, outerRings: [createRectangle(0, 0, 8, 8)] },
        { identifier: 2, outerRings: [createRectangle(8, 0, 8, 8)] }
    ];
    const results = matchBuildings(buildings, [{ identifier: "block", outerRings: [shiftRing(createRectangle(0, 0, 16, 8), 2, 1)] }]);
    for (const result of results) {
        assert.equal(result.status, BuildingMatchStatus.SHIFTED);
        assert.equal(result.blockSize, 2);
        assertNear(result.transform.shiftX, 2, 0.15, "shiftX");
        assertNear(result.transform.shiftY, 1, 0.15, "shiftY");
    }
});

test("matchBuildings estimates the shift of a building without a counterpart from its neighbours", () => {
    const neighbours = [[0, 0], [30, 0], [0, 30]].map(([x, y], index) => ({ identifier: index, outerRings: [createRectangle(x, y, 10, 8)] }));
    const references = neighbours.map((neighbour) => ({ identifier: `r${neighbour.identifier}`, outerRings: [shiftRing(neighbour.outerRings[0], 3, 0)] }));
    const results = matchBuildings([...neighbours, { identifier: "shed", outerRings: [createRectangle(15, 15, 6, 6)] }], references);
    const shed = results.find((result) => result.identifier === "shed");
    assert.equal(shed.status, BuildingMatchStatus.INTERPOLATED);
    assert.equal(shed.neighbourCount, 3);
    assertNear(shed.transform.shiftX, 3, 0.2, "shiftX");
    assertNear(shed.transform.shiftY, 0, 0.2, "shiftY");
});

test("matchBuildings leaves the estimate out when interpolation is switched off", () => {
    const neighbours = [[0, 0], [30, 0], [0, 30]].map(([x, y], index) => ({ identifier: index, outerRings: [createRectangle(x, y, 10, 8)] }));
    const references = neighbours.map((neighbour) => ({ identifier: `r${neighbour.identifier}`, outerRings: [shiftRing(neighbour.outerRings[0], 3, 0)] }));
    const results = matchBuildings([...neighbours, { identifier: "shed", outerRings: [createRectangle(15, 15, 6, 6)] }], references, { interpolate: false });
    assert.equal(results.find((result) => result.identifier === "shed").status, BuildingMatchStatus.UNMATCHED);
});

test("matchBuildings keeps a building in place when its neighbours disagree", () => {
    const neighbours = [{ identifier: "still", outerRings: [createRectangle(0, 0, 10, 8)] }, { identifier: "moved", outerRings: [createRectangle(30, 0, 10, 8)] }];
    const references = [
        { identifier: "a", outerRings: [neighbours[0].outerRings[0]] },
        { identifier: "b", outerRings: [shiftRing(neighbours[1].outerRings[0], 5, 0)] }
    ];
    const results = matchBuildings([...neighbours, { identifier: "shed", outerRings: [createRectangle(15, 15, 6, 6)] }], references);
    assert.equal(results.find((result) => result.identifier === "shed").status, BuildingMatchStatus.UNMATCHED);
});

test("matchBuildings does not average a neighbour that moved with one that fits", () => {
    const neighbours = [{ identifier: "still", outerRings: [createRectangle(0, 0, 10, 8)] }, { identifier: "moved", outerRings: [createRectangle(30, 0, 10, 8)] }];
    const references = [
        { identifier: "a", outerRings: [neighbours[0].outerRings[0]] },
        { identifier: "b", outerRings: [shiftRing(neighbours[1].outerRings[0], 2.4, 1.5)] }
    ];
    const results = matchBuildings([...neighbours, { identifier: "shed", outerRings: [createRectangle(15, 15, 6, 6)] }], references);
    assert.equal(results.find((result) => result.identifier === "still").status, BuildingMatchStatus.ALIGNED);
    assert.equal(results.find((result) => result.identifier === "moved").status, BuildingMatchStatus.SHIFTED);
    assert.equal(results.find((result) => result.identifier === "shed").status, BuildingMatchStatus.UNMATCHED);
});

test("matchBuildings reports a building without a counterpart and without neighbours as unmatched", () => {
    const rectangle = createRectangle(0, 0, 20, 10);
    const [result] = matchBuildings([{ identifier: 1, outerRings: [rectangle] }], [{ identifier: "a", outerRings: [shiftRing(rectangle, 100, 0)] }]);
    assert.equal(result.status, BuildingMatchStatus.UNMATCHED);
    assert.equal(result.referenceIdentifier, null);
});

test("composeTransforms applies a manual move on top of an automatic correction", () => {
    const automatic = { centerX: 5, centerY: 5, shiftX: 2, shiftY: 0, rotationDegrees: 0 };
    const manualRotation = { centerX: 7, centerY: 5, shiftX: 1, shiftY: 1, rotationDegrees: 90 };
    const composed = composeTransforms(automatic, manualRotation);
    const expected = transformRing(transformRing([[6, 5], [5, 7]], automatic), manualRotation);
    const actual = transformRing([[6, 5], [5, 7]], composed);
    actual.forEach(([x, y], index) => {
        assertNear(x, expected[index][0], 1e-9, `x of point ${index}`);
        assertNear(y, expected[index][1], 1e-9, `y of point ${index}`);
    });
    assert.equal(composed.centerX, 5);
    assert.equal(composed.rotationDegrees, 90);
});

test("measurePointToRingsDistance is zero inside a building and the edge distance outside", () => {
    const rings = [createRectangle(0, 0, 10, 8)];
    assert.equal(measurePointToRingsDistance(rings, 5, 4), 0);
    assertNear(measurePointToRingsDistance(rings, 12, 4), 2, 1e-9, "right side");
    assertNear(measurePointToRingsDistance(rings, 13, 12), 5, 1e-9, "corner");
});

test("transformRing rotates around the centre and then shifts", () => {
    const moved = transformRing([[1, 0], [0, 1]], { centerX: 0, centerY: 0, shiftX: 10, shiftY: 0, rotationDegrees: 90 });
    assertNear(moved[0][0], 10, 1e-9, "first x");
    assertNear(moved[0][1], 1, 1e-9, "first y");
    assertNear(moved[1][0], 9, 1e-9, "second x");
    assertNear(moved[1][1], 0, 1e-9, "second y");
});
