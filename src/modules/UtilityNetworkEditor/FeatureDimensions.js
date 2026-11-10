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
import { findRectangleSides } from "./FeatureMeasurement.js";

export const DimensionKind = Object.freeze({
    LENGTH: "length",
    AREA: "area",
    RADIUS: "radius",
    HEIGHT: "height"
});

function createSegmentDimension(kind, start, end, isSpatial = false) {
    return {
        kind: kind,
        value: isSpatial ? start.distanceTo(end) : Math.hypot(end.x - start.x, end.y - start.y),
        position: start.clone().lerp(end, 0.5),
        segment: [start, end]
    };
}

function computeEdgeDimensions(feature) {
    const edges = feature.computeEdgeSegments();
    const isRectangle = feature.featureType === CadFeatureType.POLYGON && feature.isClosed() && findRectangleSides(feature.points) !== null;
    const dimensionEdges = isRectangle ? edges.slice(0, 2) : edges;
    const isSpatial = feature.featureType === CadFeatureType.POLYLINE;
    const dimensions = dimensionEdges.map(([start, end]) => createSegmentDimension(DimensionKind.LENGTH, start, end, isSpatial));
    const lastPoint = feature.points[feature.points.length - 1];
    if (feature.isDrawing && feature.trailingPoint && lastPoint) {
        dimensions.push(createSegmentDimension(DimensionKind.LENGTH, lastPoint, feature.trailingPoint, isSpatial));
    }
    const area = feature.isClosed() ? feature.computeArea() : null;
    if (area !== null) {
        dimensions.push({ kind: DimensionKind.AREA, value: area, position: feature.computeLabelAnchor(), segment: null });
    }
    return dimensions;
}

function computeCircleDimensions(feature) {
    const center = feature.points[0];
    const rimPoint = feature.isDrawing ? feature.trailingPoint : feature.points[1];
    if (!center || !rimPoint) {
        return [];
    }
    const radiusEnd = rimPoint.clone().setZ(center.z);
    const dimensions = [createSegmentDimension(DimensionKind.RADIUS, center, radiusEnd)];
    if (!feature.isDrawing) {
        dimensions.push({ kind: DimensionKind.AREA, value: feature.computeArea(), position: center.clone(), segment: null });
    }
    return dimensions;
}

export function computeFeatureDimensions(feature) {
    if (feature.featureType === CadFeatureType.POINT) {
        const point = feature.points[0];
        return point ? [{ kind: DimensionKind.HEIGHT, value: point.z, position: point.clone(), segment: null }] : [];
    }
    if (feature.featureType === CadFeatureType.CIRCLE) {
        return computeCircleDimensions(feature);
    }
    return computeEdgeDimensions(feature);
}
