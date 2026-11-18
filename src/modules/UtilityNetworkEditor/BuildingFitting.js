/*! ******************************************************************************************************** *
 *
 * Copyright 2026 Oidis
 *
 * SPDX-License-Identifier: BSD-2-Clause
 * The BSD-2-Clause license for this file can be found in the LICENSE.txt file included with this distribution
 * or at https://spdx.org/licenses/BSD-2-Clause.html#licenseText
 *
 * ********************************************************************************************************* */

import { polygonArea, polygonBounds, polygonCentroid } from "../../utils/PolygonMath.js";

export const ALIGNED_OVERLAP = 0.9;

const MASK_CELL_METRES = 0.2;
const MAXIMUM_MASK_CELLS = 40000;
const FINE_CELL_METRES = 0.25;
const MAXIMUM_FINE_SAMPLES = 2500;
const COARSE_CELL_METRES = 0.5;
const MAXIMUM_COARSE_SAMPLES = 600;
const COARSE_OFFSET_METRES = 2;
const COARSE_OFFSET_STEP_METRES = 0.5;
const COARSE_ANGLE_DEGREES = 12;
const COARSE_ANGLE_STEP_DEGREES = 1.5;
const REFINE_OFFSET_STEP_METRES = 0.25;
const REFINE_ANGLE_STEP_DEGREES = 0.5;
const MINIMUM_REFINE_OFFSET_STEP_METRES = 0.05;
const MAXIMUM_REFINE_ITERATIONS = 200;

function toRadians(degrees) {
    return degrees * Math.PI / 180;
}

function toDegrees(radians) {
    return radians * 180 / Math.PI;
}

function chooseCellSize(area, minimumCellSize, maximumCellCount) {
    return Math.max(minimumCellSize, Math.sqrt(area / maximumCellCount));
}

function findRowCrossings(geometry, y) {
    const crossings = [];
    for (const polygon of geometry.polygons) {
        for (let index = 0, previousIndex = polygon.length - 1; index < polygon.length; previousIndex = index++) {
            const start = polygon[previousIndex];
            const end = polygon[index];
            if ((start.y > y) !== (end.y > y)) {
                crossings.push(start.x + (y - start.y) * (end.x - start.x) / (end.y - start.y));
            }
        }
    }
    return crossings.sort((first, second) => first - second);
}

function rasterizeGeometry(geometry, cellSize, visitCell) {
    const { minX, minY, maxX, maxY } = geometry.bounds;
    const columns = Math.max(1, Math.ceil((maxX - minX) / cellSize));
    const rows = Math.max(1, Math.ceil((maxY - minY) / cellSize));
    for (let row = 0; row < rows; row++) {
        const crossings = findRowCrossings(geometry, minY + (row + 0.5) * cellSize);
        for (let index = 0; index + 1 < crossings.length; index += 2) {
            const firstColumn = Math.max(0, Math.ceil((crossings[index] - minX) / cellSize - 0.5));
            const lastColumn = Math.min(columns - 1, Math.floor((crossings[index + 1] - minX) / cellSize - 0.5));
            for (let column = firstColumn; column <= lastColumn; column++) {
                visitCell(column, row);
            }
        }
    }
    return { columns: columns, rows: rows };
}

function mergeBounds(boundsList) {
    return {
        minX: Math.min(...boundsList.map((bounds) => bounds.minX)),
        minY: Math.min(...boundsList.map((bounds) => bounds.minY)),
        maxX: Math.max(...boundsList.map((bounds) => bounds.maxX)),
        maxY: Math.max(...boundsList.map((bounds) => bounds.maxY))
    };
}

function computeWeightedCentroid(centroids, areas, totalArea) {
    return {
        x: centroids.reduce((sum, centroid, index) => sum + centroid.x * areas[index], 0) / totalArea,
        y: centroids.reduce((sum, centroid, index) => sum + centroid.y * areas[index], 0) / totalArea
    };
}

function createSamples(geometry, cellSize) {
    const coordinates = [];
    const { minX, minY } = geometry.bounds;
    rasterizeGeometry(geometry, cellSize, (column, row) => {
        coordinates.push(minX + (column + 0.5) * cellSize - geometry.centroid.x, minY + (row + 0.5) * cellSize - geometry.centroid.y);
    });
    const cellArea = cellSize * cellSize;
    return { coordinates: Float64Array.from(coordinates), area: coordinates.length / 2 * cellArea, cellArea: cellArea };
}

function createMask(geometry, cellSize) {
    const insideCells = [];
    const { columns, rows } = rasterizeGeometry(geometry, cellSize, (column, row) => insideCells.push(row, column));
    const cells = new Uint8Array(columns * rows);
    for (let index = 0; index < insideCells.length; index += 2) {
        cells[insideCells[index] * columns + insideCells[index + 1]] = 1;
    }
    const area = insideCells.length / 2 * cellSize * cellSize;
    return { originX: geometry.bounds.minX, originY: geometry.bounds.minY, columns: columns, rows: rows, cellSize: cellSize, cells: cells, area: area };
}

function getCoarseSamples(geometry) {
    geometry.coarseSamples ??= createSamples(geometry, chooseCellSize(geometry.area, COARSE_CELL_METRES, MAXIMUM_COARSE_SAMPLES));
    return geometry.coarseSamples;
}

function getFineSamples(geometry) {
    geometry.fineSamples ??= createSamples(geometry, chooseCellSize(geometry.area, FINE_CELL_METRES, MAXIMUM_FINE_SAMPLES));
    return geometry.fineSamples;
}

function getMask(geometry) {
    geometry.mask ??= createMask(geometry, chooseCellSize(geometry.area, MASK_CELL_METRES, MAXIMUM_MASK_CELLS));
    return geometry.mask;
}

function isInsideMask(mask, x, y) {
    const column = Math.floor((x - mask.originX) / mask.cellSize);
    const row = Math.floor((y - mask.originY) / mask.cellSize);
    return column >= 0 && row >= 0 && column < mask.columns && row < mask.rows && mask.cells[row * mask.columns + column] === 1;
}

function measureOverlap(samples, geometry, reference, placement) {
    const mask = getMask(reference);
    const cosine = Math.cos(placement.angle);
    const sine = Math.sin(placement.angle);
    const centerX = geometry.centroid.x + placement.shiftX;
    const centerY = geometry.centroid.y + placement.shiftY;
    const coordinates = samples.coordinates;
    let insideCount = 0;
    for (let index = 0; index < coordinates.length; index += 2) {
        const localX = coordinates[index];
        const localY = coordinates[index + 1];
        if (isInsideMask(mask, centerX + localX * cosine - localY * sine, centerY + localX * sine + localY * cosine)) {
            insideCount++;
        }
    }
    const intersection = insideCount * samples.cellArea;
    return Math.min(1, intersection / (samples.area + mask.area - intersection));
}

function evaluatePlacement(samples, geometry, reference, placement) {
    return { angle: placement.angle, shiftX: placement.shiftX, shiftY: placement.shiftY, overlap: measureOverlap(samples, geometry, reference, placement) };
}

function pickBestPlacement(placements) {
    return placements.reduce((best, placement) => (placement.overlap > best.overlap ? placement : best));
}

function createStepsFromCentre(stepCount) {
    const steps = [0];
    for (let step = 1; step <= stepCount; step++) {
        steps.push(step, -step);
    }
    return steps;
}

function searchOffsets(samples, geometry, reference, start, maximumMetres) {
    const steps = createStepsFromCentre(Math.round(maximumMetres / COARSE_OFFSET_STEP_METRES));
    const offsets = steps
        .flatMap((columnStep) => steps.map((rowStep) => ({ columnStep: columnStep, rowStep: rowStep })))
        .sort((first, second) => Math.hypot(first.columnStep, first.rowStep) - Math.hypot(second.columnStep, second.rowStep));
    return pickBestPlacement(offsets.map(({ columnStep, rowStep }) => evaluatePlacement(samples, geometry, reference, {
        angle: start.angle,
        shiftX: start.shiftX + columnStep * COARSE_OFFSET_STEP_METRES,
        shiftY: start.shiftY + rowStep * COARSE_OFFSET_STEP_METRES
    })));
}

function searchAngles(samples, geometry, reference, start) {
    const steps = createStepsFromCentre(Math.round(COARSE_ANGLE_DEGREES / COARSE_ANGLE_STEP_DEGREES));
    return pickBestPlacement(steps.map((step) => evaluatePlacement(samples, geometry, reference, {
        ...start,
        angle: start.angle + toRadians(step * COARSE_ANGLE_STEP_DEGREES)
    })));
}

function refinePlacement(samples, geometry, reference, start) {
    let best = evaluatePlacement(samples, geometry, reference, start);
    let offsetStep = REFINE_OFFSET_STEP_METRES;
    let angleStep = toRadians(REFINE_ANGLE_STEP_DEGREES);
    for (let iteration = 0; iteration < MAXIMUM_REFINE_ITERATIONS && offsetStep >= MINIMUM_REFINE_OFFSET_STEP_METRES; iteration++) {
        const neighbour = pickBestPlacement([
            { ...best, shiftX: best.shiftX + offsetStep },
            { ...best, shiftX: best.shiftX - offsetStep },
            { ...best, shiftY: best.shiftY + offsetStep },
            { ...best, shiftY: best.shiftY - offsetStep },
            { ...best, angle: best.angle + angleStep },
            { ...best, angle: best.angle - angleStep }
        ].map((placement) => evaluatePlacement(samples, geometry, reference, placement)));
        if (neighbour.overlap > best.overlap) {
            best = neighbour;
        } else {
            offsetStep /= 2;
            angleStep /= 2;
        }
    }
    return best;
}

function createCentroidPlacement(geometry, reference) {
    return { angle: 0, shiftX: reference.centroid.x - geometry.centroid.x, shiftY: reference.centroid.y - geometry.centroid.y };
}

function measurePointToSegmentDistance(point, start, end) {
    const deltaX = end.x - start.x;
    const deltaY = end.y - start.y;
    const lengthSquared = deltaX * deltaX + deltaY * deltaY;
    const share = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - start.x) * deltaX + (point.y - start.y) * deltaY) / lengthSquared));
    return Math.hypot(point.x - start.x - share * deltaX, point.y - start.y - share * deltaY);
}

function measurePolygonToPolygonDistance(first, second) {
    let minimum = Infinity;
    for (const point of first) {
        for (let index = 0, previousIndex = second.length - 1; index < second.length; previousIndex = index++) {
            minimum = Math.min(minimum, measurePointToSegmentDistance(point, second[previousIndex], second[index]));
        }
    }
    return minimum;
}

export function prepareGeometry(outerRings) {
    const polygons = outerRings.map((ring) => ring.map(([x, y]) => ({ x: x, y: y })));
    const areas = polygons.map((polygon) => polygonArea(polygon));
    const area = areas.reduce((sum, value) => sum + value, 0);
    if (area <= 0) {
        return null;
    }
    return {
        outerRings: outerRings,
        polygons: polygons,
        area: area,
        centroid: computeWeightedCentroid(polygons.map((polygon) => polygonCentroid(polygon)), areas, area),
        bounds: mergeBounds(polygons.map((polygon) => polygonBounds(polygon)))
    };
}

export function combineGeometries(geometries) {
    const area = geometries.reduce((sum, geometry) => sum + geometry.area, 0);
    return {
        outerRings: geometries.flatMap((geometry) => geometry.outerRings),
        polygons: geometries.flatMap((geometry) => geometry.polygons),
        area: area,
        centroid: computeWeightedCentroid(geometries.map((geometry) => geometry.centroid), geometries.map((geometry) => geometry.area), area),
        bounds: mergeBounds(geometries.map((geometry) => geometry.bounds))
    };
}

export function measurePointToRingsDistance(rings, x, y) {
    const point = { x: x, y: y };
    let isInside = false;
    let minimum = Infinity;
    for (const ring of rings) {
        for (let index = 0, previousIndex = ring.length - 1; index < ring.length; previousIndex = index++) {
            const start = { x: ring[previousIndex][0], y: ring[previousIndex][1] };
            const end = { x: ring[index][0], y: ring[index][1] };
            if ((start.y > y) !== (end.y > y) && x < (end.x - start.x) * (y - start.y) / (end.y - start.y) + start.x) {
                isInside = !isInside;
            }
            minimum = Math.min(minimum, measurePointToSegmentDistance(point, start, end));
        }
    }
    return isInside ? 0 : minimum;
}

export function measureGeometryGap(first, second) {
    let minimum = Infinity;
    for (const firstPolygon of first.polygons) {
        for (const secondPolygon of second.polygons) {
            minimum = Math.min(minimum, measurePolygonToPolygonDistance(firstPolygon, secondPolygon), measurePolygonToPolygonDistance(secondPolygon, firstPolygon));
        }
    }
    return minimum;
}

export function measurePairScore(geometry, reference) {
    return measureOverlap(getCoarseSamples(geometry), geometry, reference, createCentroidPlacement(geometry, reference));
}

export function fitGeometry(geometry, reference) {
    const identity = { angle: 0, shiftX: 0, shiftY: 0 };
    const toResult = (originalOverlap, placement) => ({
        originalOverlap: originalOverlap,
        fittedOverlap: placement.overlap ?? originalOverlap,
        transform: {
            centerX: geometry.centroid.x,
            centerY: geometry.centroid.y,
            shiftX: placement.shiftX,
            shiftY: placement.shiftY,
            rotationDegrees: toDegrees(placement.angle)
        }
    });
    const coarseOverlap = measureOverlap(getCoarseSamples(geometry), geometry, reference, identity);
    if (coarseOverlap >= ALIGNED_OVERLAP) {
        return toResult(coarseOverlap, identity);
    }
    const fineSamples = getFineSamples(geometry);
    const originalOverlap = measureOverlap(fineSamples, geometry, reference, identity);
    if (originalOverlap >= ALIGNED_OVERLAP) {
        return toResult(originalOverlap, identity);
    }
    const coarseSamples = getCoarseSamples(geometry);
    const shifted = searchOffsets(coarseSamples, geometry, reference, createCentroidPlacement(geometry, reference), COARSE_OFFSET_METRES);
    const rotated = searchAngles(coarseSamples, geometry, reference, shifted);
    const coarse = searchOffsets(coarseSamples, geometry, reference, rotated, COARSE_OFFSET_STEP_METRES * 2);
    return toResult(originalOverlap, refinePlacement(fineSamples, geometry, reference, coarse));
}

export function transformRing(ring, transform) {
    const angle = toRadians(transform.rotationDegrees);
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    return ring.map(([x, y]) => {
        const localX = x - transform.centerX;
        const localY = y - transform.centerY;
        return [
            transform.centerX + localX * cosine - localY * sine + transform.shiftX,
            transform.centerY + localX * sine + localY * cosine + transform.shiftY
        ];
    });
}

export function composeTransforms(first, second) {
    const [[movedCenterX, movedCenterY]] = transformRing([[first.centerX + first.shiftX, first.centerY + first.shiftY]], second);
    return {
        centerX: first.centerX,
        centerY: first.centerY,
        shiftX: movedCenterX - first.centerX,
        shiftY: movedCenterY - first.centerY,
        rotationDegrees: first.rotationDegrees + second.rotationDegrees
    };
}

export function measureMaximumDisplacement(geometry, transform) {
    return Math.max(...geometry.outerRings.flatMap((ring) => {
        const movedRing = transformRing(ring, transform);
        return ring.map(([x, y], index) => Math.hypot(movedRing[index][0] - x, movedRing[index][1] - y));
    }));
}
