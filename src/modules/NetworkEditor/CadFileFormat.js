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

const FILE_FORMAT = "oidis-network-editor";
const FILE_VERSION = 1;
const FILE_CRS = "EPSG:5514";
const MAXIMUM_FILE_CHARACTERS = 20 * 1024 * 1024;
const MAXIMUM_TEXT_LENGTH = 200;
const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

export const CadFileErrorCode = Object.freeze({
    TOO_LARGE: "too_large",
    INVALID_JSON: "invalid_json",
    UNSUPPORTED_FORMAT: "unsupported_format",
    INVALID_CONTENT: "invalid_content"
});

function createFileError(code) {
    const error = new Error(`Invalid network editor file: ${code}`);
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

export function createCadFile(cadDocument) {
    return {
        format: FILE_FORMAT,
        version: FILE_VERSION,
        crs: FILE_CRS,
        activeLayerId: cadDocument.activeLayerId,
        layers: cadDocument.layers.map((layer) => ({ id: layer.id, name: layer.name, visible: layer.visible })),
        features: cadDocument.toData()
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
    if (!file || file.format !== FILE_FORMAT || file.version !== FILE_VERSION || file.crs !== FILE_CRS) {
        throw createFileError(CadFileErrorCode.UNSUPPORTED_FORMAT);
    }
    requireValid(Array.isArray(file.layers) && file.layers.length > 0 && Array.isArray(file.features));
    const layers = file.layers.map(parseLayer);
    const layerIds = layers.map((layer) => layer.id);
    requireValid(new Set(layerIds).size === layerIds.length);
    return {
        layers: layers,
        activeLayerId: layerIds.includes(file.activeLayerId) ? file.activeLayerId : layerIds[0],
        features: file.features.map((feature) => parseFeature(feature, layerIds))
    };
}
