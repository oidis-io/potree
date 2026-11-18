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
import { extractSurfaceBuildings } from "../src/modules/UtilityNetworkEditor/SurfaceBuildingExtractor.js";
import { createSurfaceGrid, readFloatTiff } from "../src/modules/UtilityNetworkEditor/SurfaceModelService.js";
import { polygonArea, polygonBounds } from "../src/utils/PolygonMath.js";

const ROOF_COLOR = [150, 60, 50];
const GRASS_COLOR = [70, 140, 60];

function createRaster({ width, height, blocks }) {
    const surfaceHeights = new Float32Array(width * height);
    const terrainHeights = new Float32Array(width * height);
    const colors = new Uint8ClampedArray(width * height * 4).fill(120);
    for (const block of blocks) {
        for (let row = block.row; row < block.row + block.height; row++) {
            for (let column = block.column; column < block.column + block.width; column++) {
                const index = row * width + column;
                surfaceHeights[index] = block.heightAboveTerrain;
                colors.set([...block.color, 255], index * 4);
            }
        }
    }
    return { width: width, height: height, cellSize: 0.5, minimumX: 1000, maximumY: 2000, surfaceHeights: surfaceHeights, terrainHeights: terrainHeights, colors: colors };
}

function createFloatTiff(width, height, values) {
    const entries = [[256, width], [257, height], [258, 32], [259, 1], [273, 0], [277, 1], [278, height], [339, 3]];
    const directoryOffset = 8;
    const dataOffset = directoryOffset + 2 + entries.length * 12 + 4;
    const buffer = new ArrayBuffer(dataOffset + values.length * 4);
    const view = new DataView(buffer);
    view.setUint16(0, 0x4949, false);
    view.setUint16(2, 42, true);
    view.setUint32(4, directoryOffset, true);
    view.setUint16(directoryOffset, entries.length, true);
    entries.forEach(([tag, value], index) => {
        const entry = directoryOffset + 2 + index * 12;
        const isOffset = tag === 273;
        view.setUint16(entry, tag, true);
        view.setUint16(entry + 2, isOffset ? 4 : 3, true);
        view.setUint32(entry + 4, 1, true);
        if (isOffset) {
            view.setUint32(entry + 8, dataOffset, true);
        } else {
            view.setUint16(entry + 8, value, true);
        }
    });
    values.forEach((value, index) => view.setFloat32(dataOffset + index * 4, value, true));
    return buffer;
}

test("extractSurfaceBuildings finds a raised roof and ignores trees and low objects", () => {
    const raster = createRaster({
        width: 80,
        height: 60,
        blocks: [
            { column: 10, row: 10, width: 24, height: 16, heightAboveTerrain: 6, color: ROOF_COLOR },
            { column: 50, row: 30, width: 12, height: 12, heightAboveTerrain: 9, color: GRASS_COLOR },
            { column: 50, row: 5, width: 12, height: 12, heightAboveTerrain: 1.5, color: ROOF_COLOR }
        ]
    });
    const buildings = extractSurfaceBuildings(raster);
    assert.equal(buildings.length, 1);
    const polygon = buildings[0].outerRings[0].map(([x, y]) => ({ x: x, y: y }));
    assert.ok(Math.abs(polygonArea(polygon) - 12 * 8) < 1, `area ${polygonArea(polygon)}`);
    assert.deepEqual(polygonBounds(polygon), { minX: 1005, minY: 1987, maxX: 1017, maxY: 1995 });
});

test("extractSurfaceBuildings drops roofs smaller than a shed", () => {
    const raster = createRaster({ width: 40, height: 40, blocks: [{ column: 10, row: 10, width: 6, height: 6, heightAboveTerrain: 5, color: ROOF_COLOR }] });
    assert.equal(extractSurfaceBuildings(raster).length, 0);
});

test("extractSurfaceBuildings drops a roof cut off by the edge of the raster", () => {
    const raster = createRaster({
        width: 40,
        height: 40,
        blocks: [
            { column: 0, row: 10, width: 16, height: 16, heightAboveTerrain: 6, color: ROOF_COLOR },
            { column: 22, row: 10, width: 14, height: 14, heightAboveTerrain: 6, color: ROOF_COLOR }
        ]
    });
    const buildings = extractSurfaceBuildings(raster);
    assert.equal(buildings.length, 1);
    const polygon = buildings[0].outerRings[0].map(([x, y]) => ({ x: x, y: y }));
    assert.deepEqual(polygonBounds(polygon), { minX: 1011, minY: 1988, maxX: 1018, maxY: 1995 });
});

test("readFloatTiff reads an uncompressed float raster", () => {
    const raster = readFloatTiff(createFloatTiff(3, 2, [1.5, 2.5, 3.5, 4.5, 5.5, 6.5]));
    assert.equal(raster.width, 3);
    assert.equal(raster.height, 2);
    assert.deepEqual([...raster.values], [1.5, 2.5, 3.5, 4.5, 5.5, 6.5]);
});

test("createSurfaceGrid keeps half-metre cells for a village and coarsens large areas", () => {
    const village = createSurfaceGrid({ minimumX: 0, minimumY: 0, maximumX: 400, maximumY: 300 });
    assert.equal(village.cellSize, 0.5);
    assert.equal(village.width, 800);
    assert.equal(village.height, 600);
    const town = createSurfaceGrid({ minimumX: 0, minimumY: 0, maximumX: 1500, maximumY: 1500 });
    assert.equal(town.cellSize, 0.75);
    assert.equal(town.width, 2000);
});

test("createSurfaceGrid aligns cells to whole multiples so a building gets the same raster in any view", () => {
    const first = createSurfaceGrid({ minimumX: 1000.3, minimumY: 2000.1, maximumX: 1300.3, maximumY: 2200.1 });
    const second = createSurfaceGrid({ minimumX: 1000.1, minimumY: 2000.4, maximumX: 1300.6, maximumY: 2200.9 });
    assert.equal(first.cellSize, 0.5);
    assert.equal(second.cellSize, 0.5);
    assert.equal(first.minimumX, 1000);
    assert.equal(second.minimumX, 1000);
    assert.equal(first.maximumY, 2200.5);
    assert.equal(second.maximumY, 2201);
    assert.equal(first.width, 601);
    assert.equal(first.height, 401);
});

test("createSurfaceGrid uses only whole quarter-metre steps for larger areas", () => {
    const wider = createSurfaceGrid({ minimumX: 0, minimumY: 0, maximumX: 1100, maximumY: 900 });
    const widest = createSurfaceGrid({ minimumX: 0, minimumY: 0, maximumX: 1540, maximumY: 1540 });
    assert.equal(wider.cellSize, 0.75);
    assert.equal(widest.cellSize, 0.75);
    assert.equal(widest.width, 2054);
});
