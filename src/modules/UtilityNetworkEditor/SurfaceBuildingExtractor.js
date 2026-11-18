/*! ******************************************************************************************************** *
 *
 * Copyright 2026 Oidis
 *
 * SPDX-License-Identifier: BSD-2-Clause
 * The BSD-2-Clause license for this file can be found in the LICENSE.txt file included with this distribution
 * or at https://spdx.org/licenses/BSD-2-Clause.html#licenseText
 *
 * ********************************************************************************************************* */

const MINIMUM_BUILDING_HEIGHT_METRES = 2.5;
const VEGETATION_GREEN_EXCESS = 30;
const MINIMUM_BUILDING_AREA_SQUARE_METRES = 15;
const SIMPLIFY_TOLERANCE_METRES = 0.5;
const COLOR_CHANNEL_COUNT = 4;
const NEIGHBOUR_OFFSETS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

function isVegetation(colors, index) {
    const pixel = index * COLOR_CHANNEL_COUNT;
    return 2 * colors[pixel + 1] - colors[pixel] - colors[pixel + 2] > VEGETATION_GREEN_EXCESS;
}

function createBuildingMask(raster) {
    const mask = new Uint8Array(raster.width * raster.height);
    for (let index = 0; index < mask.length; index++) {
        const heightAboveTerrain = raster.surfaceHeights[index] - raster.terrainHeights[index];
        mask[index] = heightAboveTerrain > MINIMUM_BUILDING_HEIGHT_METRES && !isVegetation(raster.colors, index) ? 1 : 0;
    }
    return mask;
}

function applyNeighbourhoodRule(mask, width, height, keepWhen) {
    const result = new Uint8Array(mask.length);
    for (let row = 0; row < height; row++) {
        for (let column = 0; column < width; column++) {
            let count = 0;
            for (let rowOffset = -1; rowOffset <= 1; rowOffset++) {
                for (let columnOffset = -1; columnOffset <= 1; columnOffset++) {
                    const neighbourRow = row + rowOffset;
                    const neighbourColumn = column + columnOffset;
                    if (neighbourRow >= 0 && neighbourRow < height && neighbourColumn >= 0 && neighbourColumn < width) {
                        count += mask[neighbourRow * width + neighbourColumn];
                    }
                }
            }
            result[row * width + column] = keepWhen(count) ? 1 : 0;
        }
    }
    return result;
}

function openMask(mask, width, height) {
    const eroded = applyNeighbourhoodRule(mask, width, height, (count) => count === 9);
    return applyNeighbourhoodRule(eroded, width, height, (count) => count > 0);
}

function labelComponents(mask, width, height) {
    const labels = new Int32Array(mask.length).fill(-1);
    const components = [];
    for (let start = 0; start < mask.length; start++) {
        if (mask[start] !== 1 || labels[start] !== -1) {
            continue;
        }
        const pixels = [];
        const stack = [start];
        labels[start] = components.length;
        while (stack.length > 0) {
            const index = stack.pop();
            pixels.push(index);
            const row = Math.floor(index / width);
            const column = index % width;
            for (const [rowOffset, columnOffset] of NEIGHBOUR_OFFSETS) {
                const neighbourRow = row + rowOffset;
                const neighbourColumn = column + columnOffset;
                const neighbour = neighbourRow * width + neighbourColumn;
                if (neighbourRow >= 0 && neighbourRow < height && neighbourColumn >= 0 && neighbourColumn < width
                    && mask[neighbour] === 1 && labels[neighbour] === -1) {
                    labels[neighbour] = components.length;
                    stack.push(neighbour);
                }
            }
        }
        components.push(pixels);
    }
    return { labels: labels, components: components };
}

function collectBoundaryEdges(pixels, label, labels, width, height) {
    const isInside = (column, row) => column >= 0 && row >= 0 && column < width && row < height && labels[row * width + column] === label;
    const edges = new Map();
    const addEdge = (fromColumn, fromRow, toColumn, toRow) => {
        const key = `${fromColumn},${fromRow}`;
        if (!edges.has(key)) {
            edges.set(key, []);
        }
        edges.get(key).push([toColumn, toRow]);
    };
    for (const index of pixels) {
        const row = Math.floor(index / width);
        const column = index % width;
        if (!isInside(column, row - 1)) {
            addEdge(column, row, column + 1, row);
        }
        if (!isInside(column + 1, row)) {
            addEdge(column + 1, row, column + 1, row + 1);
        }
        if (!isInside(column, row + 1)) {
            addEdge(column + 1, row + 1, column, row + 1);
        }
        if (!isInside(column - 1, row)) {
            addEdge(column, row + 1, column, row);
        }
    }
    return edges;
}

function traceLongestLoop(edges) {
    const loops = [];
    while (edges.size > 0) {
        const [startKey] = edges.keys();
        let [column, row] = startKey.split(",").map(Number);
        const loop = [[column, row]];
        while (edges.has(`${column},${row}`)) {
            const key = `${column},${row}`;
            const targets = edges.get(key);
            [column, row] = targets.shift();
            if (targets.length === 0) {
                edges.delete(key);
            }
            loop.push([column, row]);
        }
        loops.push(loop);
    }
    return loops.reduce((longest, loop) => (loop.length > longest.length ? loop : longest), []);
}

function simplifyPolyline(points) {
    if (points.length < 3) {
        return points;
    }
    const [startX, startY] = points[0];
    const [endX, endY] = points[points.length - 1];
    const length = Math.hypot(endX - startX, endY - startY) || 1;
    let farthestIndex = 0;
    let farthestDistance = 0;
    for (let index = 1; index < points.length - 1; index++) {
        const [x, y] = points[index];
        const distance = Math.abs((endY - startY) * x - (endX - startX) * y + endX * startY - endY * startX) / length;
        if (distance > farthestDistance) {
            farthestDistance = distance;
            farthestIndex = index;
        }
    }
    if (farthestDistance <= SIMPLIFY_TOLERANCE_METRES) {
        return [points[0], points[points.length - 1]];
    }
    return [...simplifyPolyline(points.slice(0, farthestIndex + 1)).slice(0, -1), ...simplifyPolyline(points.slice(farthestIndex))];
}

function toSimplifiedRing(loop, raster) {
    const points = loop.map(([column, row]) => [raster.minimumX + column * raster.cellSize, raster.maximumY - row * raster.cellSize]);
    const farthestIndex = points.reduce((bestIndex, [x, y], index) => {
        const [bestX, bestY] = points[bestIndex];
        return Math.hypot(x - points[0][0], y - points[0][1]) > Math.hypot(bestX - points[0][0], bestY - points[0][1]) ? index : bestIndex;
    }, 0);
    const ring = [...simplifyPolyline(points.slice(0, farthestIndex + 1)).slice(0, -1), ...simplifyPolyline(points.slice(farthestIndex))];
    const [firstX, firstY] = ring[0];
    const [lastX, lastY] = ring[ring.length - 1];
    if (firstX !== lastX || firstY !== lastY) {
        ring.push([firstX, firstY]);
    }
    return ring;
}

function touchesRasterBorder(pixels, width, height) {
    return pixels.some((index) => {
        const row = Math.floor(index / width);
        const column = index % width;
        return row === 0 || column === 0 || row === height - 1 || column === width - 1;
    });
}

export function extractSurfaceBuildings(raster) {
    const { width, height } = raster;
    const mask = openMask(createBuildingMask(raster), width, height);
    const { labels, components } = labelComponents(mask, width, height);
    const minimumPixelCount = MINIMUM_BUILDING_AREA_SQUARE_METRES / (raster.cellSize * raster.cellSize);
    return components
        .map((pixels, label) => ({ pixels: pixels, label: label }))
        .filter(({ pixels }) => pixels.length >= minimumPixelCount && !touchesRasterBorder(pixels, width, height))
        .map(({ pixels, label }) => ({
            identifier: `surface-${label}`,
            label: "",
            outerRings: [toSimplifiedRing(traceLongestLoop(collectBoundaryEdges(pixels, label, labels, width, height)), raster)]
        }))
        .filter((building) => building.outerRings[0].length >= 4);
}
