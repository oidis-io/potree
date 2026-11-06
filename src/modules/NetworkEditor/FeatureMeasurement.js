/*! ******************************************************************************************************** *
 *
 * Copyright 2026 Oidis
 *
 * SPDX-License-Identifier: BSD-2-Clause
 * The BSD-2-Clause license for this file can be found in the LICENSE.txt file included with this distribution
 * or at https://spdx.org/licenses/BSD-2-Clause.html#licenseText
 *
 * ********************************************************************************************************* */

import { CadFeatureType } from "./CadFeature.js";

const TERRAIN_SAMPLE_SPACING_METRES = 1;
const MAXIMUM_SAMPLES_PER_SEGMENT = 2000;
const RECTANGLE_CORNER_COUNT = 4;
const RIGHT_ANGLE_TOLERANCE_COSINE = 0.005;

function findTerrainHeight(terrainHeightSampler, x, y, fallbackHeight) {
    return terrainHeightSampler?.measuredHeightAt(x, y) ?? fallbackHeight;
}

function measureTerrainSegment(start, end, terrainHeightSampler) {
    const horizontalLength = Math.hypot(end.x - start.x, end.y - start.y);
    const sampleCount = Math.min(MAXIMUM_SAMPLES_PER_SEGMENT, Math.max(1, Math.ceil(horizontalLength / TERRAIN_SAMPLE_SPACING_METRES)));
    const sampleSpacing = horizontalLength / sampleCount;
    let length = 0;
    let previousHeight = null;
    for (let index = 0; index <= sampleCount; index++) {
        const share = index / sampleCount;
        const height = findTerrainHeight(terrainHeightSampler, start.x + (end.x - start.x) * share, start.y + (end.y - start.y) * share, null);
        if (index > 0) {
            const climb = height !== null && previousHeight !== null ? height - previousHeight : 0;
            length += Math.hypot(sampleSpacing, climb);
        }
        if (height !== null) {
            previousHeight = height;
        }
    }
    return previousHeight === null ? start.distanceTo(end) : length;
}

function measurePolyline(feature, terrainHeightSampler) {
    const first = feature.points[0];
    const last = feature.points[feature.points.length - 1];
    const horizontalLength = feature.computeHorizontalLength();
    const heightDifference = findTerrainHeight(terrainHeightSampler, last.x, last.y, last.z)
        - findTerrainHeight(terrainHeightSampler, first.x, first.y, first.z);
    return {
        horizontalLength: horizontalLength,
        terrainLength: feature.computeEdgeSegments().reduce((sum, [start, end]) => sum + measureTerrainSegment(start, end, terrainHeightSampler), 0),
        heightDifference: heightDifference,
        slopePercent: horizontalLength > 0 ? heightDifference / horizontalLength * 100 : null
    };
}

export function findRectangleSides(points) {
    if (points.length !== RECTANGLE_CORNER_COUNT) {
        return null;
    }
    const edges = points.map((point, index) => {
        const next = points[(index + 1) % points.length];
        return { x: next.x - point.x, y: next.y - point.y, length: Math.hypot(next.x - point.x, next.y - point.y) };
    });
    if (edges.some((edge) => edge.length === 0)) {
        return null;
    }
    const hasRightAngles = edges.every((edge, index) => {
        const next = edges[(index + 1) % edges.length];
        return Math.abs((edge.x * next.x + edge.y * next.y) / (edge.length * next.length)) <= RIGHT_ANGLE_TOLERANCE_COSINE;
    });
    return hasRightAngles ? [edges[0].length, edges[1].length] : null;
}

export function measureFeature(feature, terrainHeightSampler) {
    if (feature.featureType === CadFeatureType.POINT) {
        const point = feature.points[0];
        return { coordinateY: -point.x, coordinateX: -point.y, height: point.z };
    }
    if (feature.featureType === CadFeatureType.POLYGON) {
        return { area: feature.computeArea(), perimeter: feature.computeHorizontalLength(), rectangleSides: findRectangleSides(feature.points) };
    }
    if (feature.featureType === CadFeatureType.CIRCLE) {
        const radius = feature.computeRadius();
        return { radius: radius, diameter: 2 * radius, circumference: feature.computeHorizontalLength(), area: feature.computeArea() };
    }
    return measurePolyline(feature, terrainHeightSampler);
}
