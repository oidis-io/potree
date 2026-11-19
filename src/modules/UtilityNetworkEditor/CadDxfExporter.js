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
import { findNearestColorIndex } from "./DxfColors.js";

const COORDINATE_FRACTION_DIGITS = 4;
const TEXT_HEIGHT_METRES = 1;
const DEFAULT_LAYER_NAME = "0";
const DEFAULT_LAYER_COLOR_INDEX = 7;
const POLYLINE_THREE_DIMENSIONAL_FLAG = 8;
const POLYLINE_CLOSED_FLAG = 1;
const VERTEX_THREE_DIMENSIONAL_FLAG = 32;
const INVALID_LAYER_NAME_CHARACTERS = /[<>/\\":;?*|=`,]/g;
const COMBINING_MARKS = /[̀-ͯ]/g;
const NON_ASCII_CHARACTERS = /[^\x20-\x7e]/g;

function formatCoordinate(value) {
    return value.toFixed(COORDINATE_FRACTION_DIGITS);
}

function sanitizeLayerName(name) {
    return name.normalize("NFD").replace(COMBINING_MARKS, "").replace(NON_ASCII_CHARACTERS, "_").replace(INVALID_LAYER_NAME_CHARACTERS, "_").trim() || DEFAULT_LAYER_NAME;
}

function escapeText(text) {
    return text.replace(NON_ASCII_CHARACTERS, (character) => `\\U+${character.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")}`);
}

function createPointGroups(point, firstCode = 10) {
    return [[firstCode, formatCoordinate(point.x)], [firstCode + 10, formatCoordinate(point.y)], [firstCode + 20, formatCoordinate(point.z)]];
}

function createEntityHeader(type, layerName, colorIndex) {
    return [[0, type], [8, layerName], [62, colorIndex]];
}

function createFeatureGroups(feature, layerName) {
    const colorIndex = findNearestColorIndex(feature.color.getHex());
    if (feature.featureType === CadFeatureType.POINT) {
        return [...createEntityHeader("POINT", layerName, colorIndex), ...createPointGroups(feature.points[0])];
    }
    if (feature.featureType === CadFeatureType.CIRCLE) {
        return [...createEntityHeader("CIRCLE", layerName, colorIndex), ...createPointGroups(feature.points[0]), [40, formatCoordinate(feature.computeRadius())]];
    }
    const isClosed = feature.featureType === CadFeatureType.POLYGON;
    const flags = POLYLINE_THREE_DIMENSIONAL_FLAG | (isClosed ? POLYLINE_CLOSED_FLAG : 0);
    return [
        ...createEntityHeader("POLYLINE", layerName, colorIndex),
        [66, 1],
        [10, formatCoordinate(0)],
        [20, formatCoordinate(0)],
        [30, formatCoordinate(0)],
        [70, flags],
        ...feature.points.flatMap((point) => [[0, "VERTEX"], [8, layerName], ...createPointGroups(point), [70, VERTEX_THREE_DIMENSIONAL_FLAG]]),
        [0, "SEQEND"],
        [8, layerName]
    ];
}

function createLabelGroups(feature, layerName) {
    if (feature.label === "" || feature.points.length === 0) {
        return [];
    }
    return [
        ...createEntityHeader("TEXT", layerName, findNearestColorIndex(feature.color.getHex())),
        ...createPointGroups(feature.computeLabelAnchor()),
        [40, formatCoordinate(TEXT_HEIGHT_METRES)],
        [1, escapeText(feature.label)]
    ];
}

function computeExtent(features) {
    const minimum = { x: Infinity, y: Infinity, z: Infinity };
    const maximum = { x: -Infinity, y: -Infinity, z: -Infinity };
    for (const point of features.flatMap((feature) => feature.points)) {
        for (const axis of ["x", "y", "z"]) {
            minimum[axis] = Math.min(minimum[axis], point[axis]);
            maximum[axis] = Math.max(maximum[axis], point[axis]);
        }
    }
    return features.length > 0 ? { minimum: minimum, maximum: maximum } : { minimum: { x: 0, y: 0, z: 0 }, maximum: { x: 0, y: 0, z: 0 } };
}

function createLayerTableGroups(layerNames) {
    return [
        [0, "TABLE"], [2, "LTYPE"], [70, 1],
        [0, "LTYPE"], [2, "CONTINUOUS"], [70, 0], [3, "Solid line"], [72, 65], [73, 0], [40, formatCoordinate(0)],
        [0, "ENDTAB"],
        [0, "TABLE"], [2, "LAYER"], [70, layerNames.length],
        ...layerNames.flatMap((layerName) => [[0, "LAYER"], [2, layerName], [70, 0], [62, DEFAULT_LAYER_COLOR_INDEX], [6, "CONTINUOUS"]]),
        [0, "ENDTAB"]
    ];
}

export function createDxfFile(cadDocument) {
    const layerNames = new Map(cadDocument.layers.map((layer) => [layer.id, sanitizeLayerName(layer.name)]));
    const usedLayerNames = [...new Set([DEFAULT_LAYER_NAME, ...layerNames.values()])];
    const features = cadDocument.features.filter((feature) => feature.points.length > 0);
    const extent = computeExtent(features);
    const groups = [
        [0, "SECTION"], [2, "HEADER"],
        [9, "$ACADVER"], [1, "AC1009"],
        [9, "$EXTMIN"], ...createPointGroups(extent.minimum),
        [9, "$EXTMAX"], ...createPointGroups(extent.maximum),
        [0, "ENDSEC"],
        [0, "SECTION"], [2, "TABLES"], ...createLayerTableGroups(usedLayerNames), [0, "ENDSEC"],
        [0, "SECTION"], [2, "ENTITIES"],
        ...features.flatMap((feature) => {
            const layerName = layerNames.get(feature.layerId) ?? DEFAULT_LAYER_NAME;
            return [...createFeatureGroups(feature, layerName), ...createLabelGroups(feature, layerName)];
        }),
        [0, "ENDSEC"],
        [0, "EOF"]
    ];
    return `${groups.map(([code, value]) => `${String(code).padStart(3, " ")}\n${value}`).join("\n")}\n`;
}
