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

const FILE_FORMAT = "oidis-utility-network-editor";
const READABLE_FILE_FORMATS = [FILE_FORMAT, "oidis-network-editor"];
const FILE_VERSION = 1;
const FILE_CRS = "EPSG:5514";
const MAXIMUM_FILE_CHARACTERS = 20 * 1024 * 1024;
const MAXIMUM_TEXT_LENGTH = 200;
const MAXIMUM_MANUAL_SHIFT_METRES = 100;
const TRANSFORM_KEYS = ["centerX", "centerY", "shiftX", "shiftY", "rotationDegrees"];
const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

export const CadFileErrorCode = Object.freeze({
    TOO_LARGE: "too_large",
    INVALID_JSON: "invalid_json",
    UNSUPPORTED_FORMAT: "unsupported_format",
    INVALID_CONTENT: "invalid_content"
});

function createFileError(code) {
    const error = new Error(`Invalid utility network editor file: ${code}`);
    error.code = code;
    return error;
}

function requireValid(condition) {
    if (!condition) {
        throw createFileError(CadFileErrorCode.INVALID_CONTENT);
    }
}

function parseLayer(layer) {
    requireValid(layer && typeof layer.id === "string" && layer.id !== "" && typeof layer.name === "string");
    return {
        id: layer.id.slice(0, MAXIMUM_TEXT_LENGTH),
        name: layer.name.slice(0, MAXIMUM_TEXT_LENGTH),
        visible: layer.visible !== false
    };
}

function parsePoint(point) {
    requireValid(Array.isArray(point) && point.length === 3 && point.every((coordinate) => Number.isFinite(coordinate)));
    return [point[0], point[1], point[2]];
}

function parseFeature(feature, layerIds) {
    requireValid(feature && Object.values(CadFeatureType).includes(feature.featureType));
    requireValid(typeof feature.color === "string" && COLOR_PATTERN.test(feature.color));
    requireValid(layerIds.includes(feature.layerId));
    requireValid(Array.isArray(feature.points) && feature.points.length >= MINIMUM_POINT_COUNTS[feature.featureType]);
    requireValid(feature.featureType !== CadFeatureType.POINT || feature.points.length === 1);
    requireValid(feature.featureType !== CadFeatureType.CIRCLE || feature.points.length === 2);
    return {
        featureType: feature.featureType,
        label: typeof feature.label === "string" ? feature.label.slice(0, MAXIMUM_TEXT_LENGTH) : "",
        color: feature.color,
        layerId: feature.layerId,
        points: feature.points.map(parsePoint)
    };
}

function isIdentifier(value) {
    return (typeof value === "number" && Number.isFinite(value)) || (typeof value === "string" && value !== "" && value.length <= MAXIMUM_TEXT_LENGTH);
}

function parseAlignmentTransform(transform) {
    if (transform === undefined || transform === null) {
        return null;
    }
    requireValid(TRANSFORM_KEYS.every((key) => Number.isFinite(transform[key])));
    requireValid(Math.hypot(transform.shiftX, transform.shiftY) <= MAXIMUM_MANUAL_SHIFT_METRES && Math.abs(transform.rotationDegrees) <= 360);
    return Object.fromEntries(TRANSFORM_KEYS.map((key) => [key, transform[key]]));
}

function parseAlignmentException(exception) {
    requireValid(exception && isIdentifier(exception.buildingIdentifier));
    return {
        buildingIdentifier: exception.buildingIdentifier,
        label: typeof exception.label === "string" ? exception.label.slice(0, MAXIMUM_TEXT_LENGTH) : "",
        transform: parseAlignmentTransform(exception.transform)
    };
}

function parseAlignmentExceptions(exceptions) {
    if (exceptions === undefined) {
        return [];
    }
    requireValid(Array.isArray(exceptions));
    const parsedExceptions = exceptions.map(parseAlignmentException);
    const identifiers = parsedExceptions.map((exception) => String(exception.buildingIdentifier));
    requireValid(new Set(identifiers).size === identifiers.length);
    return parsedExceptions;
}

export function createCadFile(cadDocument, alignmentExceptions = null) {
    return {
        format: FILE_FORMAT,
        version: FILE_VERSION,
        crs: FILE_CRS,
        activeLayerId: cadDocument.activeLayerId,
        layers: cadDocument.layers.map((layer) => ({ id: layer.id, name: layer.name, visible: layer.visible })),
        features: cadDocument.toData(),
        cadastreAlignmentExceptions: alignmentExceptions ? alignmentExceptions.toData() : []
    };
}

export function parseCadFile(text) {
    if (typeof text !== "string" || text.length > MAXIMUM_FILE_CHARACTERS) {
        throw createFileError(CadFileErrorCode.TOO_LARGE);
    }
    let file;
    try {
        file = JSON.parse(text);
    } catch (error) {
        throw createFileError(CadFileErrorCode.INVALID_JSON);
    }
    if (!file || !READABLE_FILE_FORMATS.includes(file.format) || file.version !== FILE_VERSION || file.crs !== FILE_CRS) {
        throw createFileError(CadFileErrorCode.UNSUPPORTED_FORMAT);
    }
    requireValid(Array.isArray(file.layers) && file.layers.length > 0 && Array.isArray(file.features));
    const layers = file.layers.map(parseLayer);
    const layerIds = layers.map((layer) => layer.id);
    requireValid(new Set(layerIds).size === layerIds.length);
    return {
        layers: layers,
        activeLayerId: layerIds.includes(file.activeLayerId) ? file.activeLayerId : layerIds[0],
        features: file.features.map((feature) => parseFeature(feature, layerIds)),
        cadastreAlignmentExceptions: parseAlignmentExceptions(file.cadastreAlignmentExceptions)
    };
}
