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

const RECTANGLE_CORNER_COUNT = 4;
const RIGHT_ANGLE_TOLERANCE_COSINE = 0.005;

function findTerrainHeight(terrainHeightSampler, x, y, fallbackHeight) {
    return terrainHeightSampler?.measuredHeightAt(x, y) ?? fallbackHeight;
}

function measurePolyline(feature, terrainHeightSampler) {
    const first = feature.points[0];
    const last = feature.points[feature.points.length - 1];
    const horizontalLength = feature.computeHorizontalLength();
    const heightDifference = findTerrainHeight(terrainHeightSampler, last.x, last.y, last.z)
        - findTerrainHeight(terrainHeightSampler, first.x, first.y, first.z);
    return {
        length: feature.computeEdgeSegments().reduce((sum, [start, end]) => sum + start.distanceTo(end), 0),
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
