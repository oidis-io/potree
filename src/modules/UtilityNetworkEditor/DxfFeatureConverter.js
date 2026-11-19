/*! ******************************************************************************************************** *
 *
 * Copyright 2026 Oidis
 *
 * SPDX-License-Identifier: BSD-2-Clause
 * The BSD-2-Clause license for this file can be found in the LICENSE.txt file included with this distribution
 * or at https://spdx.org/licenses/BSD-2-Clause.html#licenseText
 *
 * ********************************************************************************************************* */

import { CadFeatureType, MINIMUM_POINT_COUNTS } from "./CadFeature.js";
import { DxfPrimitiveKind } from "./DxfGeometry.js";

const MAXIMUM_LABEL_LENGTH = 80;
const DUPLICATE_POINT_TOLERANCE_METRES = 0.001;

function toHexColor(color) {
    return `#${color.toString(16).padStart(6, "0")}`;
}

function isSamePoint(first, second) {
    return Math.hypot(first.x - second.x, first.y - second.y, first.z - second.z) <= DUPLICATE_POINT_TOLERANCE_METRES;
}

function removeRepeatedPoints(points) {
    const unique = points.filter((point, index) => index === 0 || !isSamePoint(point, points[index - 1]));
    return unique.length > 1 && isSamePoint(unique[0], unique[unique.length - 1]) ? unique.slice(0, -1) : unique;
}

function convertLine(primitive, toCoordinates, base) {
    const points = removeRepeatedPoints(primitive.points);
    if (primitive.isClosed && points.length >= MINIMUM_POINT_COUNTS[CadFeatureType.POLYGON]) {
        return { ...base, featureType: CadFeatureType.POLYGON, points: points.map(toCoordinates) };
    }
    const openPoints = primitive.isClosed && points.length > 1 ? [...points, points[0]] : points;
    if (openPoints.length < MINIMUM_POINT_COUNTS[CadFeatureType.POLYLINE]) {
        return null;
    }
    return { ...base, featureType: CadFeatureType.POLYLINE, points: openPoints.map(toCoordinates) };
}

function convertPrimitive(primitive, toCoordinates, layerId) {
    const base = { label: "", color: toHexColor(primitive.color), layerId: layerId };
    switch (primitive.kind) {
        case DxfPrimitiveKind.LINE:
            return convertLine(primitive, toCoordinates, base);
        case DxfPrimitiveKind.CIRCLE: {
            const rimPoint = { x: primitive.center.x + primitive.radius, y: primitive.center.y, z: primitive.center.z };
            return { ...base, featureType: CadFeatureType.CIRCLE, points: [toCoordinates(primitive.center), toCoordinates(rimPoint)] };
        }
        case DxfPrimitiveKind.POINT:
            return { ...base, featureType: CadFeatureType.POINT, points: [toCoordinates(primitive.position)] };
        case DxfPrimitiveKind.TEXT:
            return { ...base, featureType: CadFeatureType.POINT, label: primitive.text.slice(0, MAXIMUM_LABEL_LENGTH), points: [toCoordinates(primitive.position)] };
        default:
            return null;
    }
}

export function countConvertibleSegments(primitives) {
    return primitives
        .filter((primitive) => !primitive.isSymbol)
        .reduce((count, primitive) => count + Math.max(1, (primitive.points?.length ?? 1) - 1), 0);
}

export function convertDxfPrimitivesToFeatureData(primitives, layerId, resolveHeight) {
    const toCoordinates = (point) => [point.x, point.y, resolveHeight(point)];
    return primitives
        .filter((primitive) => !primitive.isSymbol)
        .map((primitive) => convertPrimitive(primitive, toCoordinates, layerId))
        .filter(Boolean);
}
