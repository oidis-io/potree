/*! ******************************************************************************************************** *
 *
 * Copyright 2026 Oidis
 *
 * SPDX-License-Identifier: BSD-2-Clause
 * The BSD-2-Clause license for this file can be found in the LICENSE.txt file included with this distribution
 * or at https://spdx.org/licenses/BSD-2-Clause.html#licenseText
 *
 * ********************************************************************************************************* */

const RUIAN_SERVICE_URL = "https://ags.cuzk.gov.cz/arcgis/rest/services/RUIAN/MapServer";
const ZABAGED_SERVICE_URL = "https://ags.cuzk.gov.cz/arcgis/rest/services/ZABAGED_POLOHOPIS/MapServer";

export const CadastreLayer = Object.freeze({
    PARCELS: "parcels",
    BUILDINGS: "buildings",
    REFERENCE_BUILDINGS: "reference_buildings",
    ROADS: "roads"
});

const LAYER_SOURCES = Object.freeze({
    [CadastreLayer.PARCELS]: [{ url: `${RUIAN_SERVICE_URL}/5` }],
    [CadastreLayer.BUILDINGS]: [{ url: `${RUIAN_SERVICE_URL}/3`, identifierField: "kod", labelField: "cisladomovni" }],
    [CadastreLayer.REFERENCE_BUILDINGS]: [{ url: `${ZABAGED_SERVICE_URL}/99`, identifierField: "fid_zbg" }],
    [CadastreLayer.ROADS]: [{ url: `${ZABAGED_SERVICE_URL}/79` }, { url: `${ZABAGED_SERVICE_URL}/83` }, { url: `${ZABAGED_SERVICE_URL}/84` }]
});

function createQueryUrl(source, extent) {
    const query = new URLSearchParams({
        "geometry": [extent.minimumX, extent.minimumY, extent.maximumX, extent.maximumY].map((value) => value.toFixed(2)).join(","),
        "geometryType": "esriGeometryEnvelope",
        "inSR": "5514",
        "spatialRel": "esriSpatialRelIntersects",
        "outFields": [source.identifierField, source.labelField].filter(Boolean).join(","),
        "returnGeometry": "true",
        "outSR": "5514",
        "f": "geojson"
    });
    return `${source.url}/query?${query.toString()}`;
}

function extractLines(geometry) {
    switch (geometry?.type) {
        case "LineString":
            return [geometry.coordinates];
        case "MultiLineString":
        case "Polygon":
            return geometry.coordinates;
        case "MultiPolygon":
            return geometry.coordinates.flat();
        default:
            return [];
    }
}

function extractOuterRings(geometry) {
    switch (geometry?.type) {
        case "Polygon":
            return [geometry.coordinates[0]];
        case "MultiPolygon":
            return geometry.coordinates.map((polygon) => polygon[0]);
        default:
            return [];
    }
}

function readFeature(feature, source) {
    const properties = feature.properties ?? {};
    return {
        identifier: source.identifierField ? properties[source.identifierField] ?? null : null,
        label: source.labelField ? String(properties[source.labelField] ?? "") : "",
        lines: extractLines(feature.geometry).filter((line) => line.length >= 2),
        outerRings: extractOuterRings(feature.geometry).filter((ring) => ring.length >= 4)
    };
}

async function fetchSourceFeatures(source, extent) {
    const response = await fetch(createQueryUrl(source, extent));
    if (!response.ok) {
        throw new Error(`Cadastre request failed with status ${response.status}`);
    }
    const collection = await response.json();
    if (collection.error) {
        throw new Error(`Cadastre request failed: ${collection.error.message}`);
    }
    return {
        features: (collection.features ?? []).map((feature) => readFeature(feature, source)),
        isTruncated: collection.properties?.exceededTransferLimit === true || collection.exceededTransferLimit === true
    };
}

export async function fetchCadastreFeatures(layer, extent) {
    const results = await Promise.all(LAYER_SOURCES[layer].map((source) => fetchSourceFeatures(source, extent)));
    return {
        features: results.flatMap((result) => result.features).filter((feature) => feature.lines.length > 0),
        isTruncated: results.some((result) => result.isTruncated)
    };
}
