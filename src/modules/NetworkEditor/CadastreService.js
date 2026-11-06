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
    ROADS: "roads"
});

const LAYER_SOURCES = Object.freeze({
    [CadastreLayer.PARCELS]: [`${RUIAN_SERVICE_URL}/5`],
    [CadastreLayer.BUILDINGS]: [`${RUIAN_SERVICE_URL}/3`],
    [CadastreLayer.ROADS]: [`${ZABAGED_SERVICE_URL}/79`, `${ZABAGED_SERVICE_URL}/83`, `${ZABAGED_SERVICE_URL}/84`]
});

function createQueryUrl(sourceUrl, extent) {
    const query = new URLSearchParams({
        "geometry": [extent.minimumX, extent.minimumY, extent.maximumX, extent.maximumY].map((value) => value.toFixed(2)).join(","),
        "geometryType": "esriGeometryEnvelope",
        "inSR": "5514",
        "spatialRel": "esriSpatialRelIntersects",
        "returnGeometry": "true",
        "outSR": "5514",
        "f": "geojson"
    });
    return `${sourceUrl}/query?${query.toString()}`;
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

async function fetchSourceLines(sourceUrl, extent) {
    const response = await fetch(createQueryUrl(sourceUrl, extent));
    if (!response.ok) {
        throw new Error(`Cadastre request failed with status ${response.status}`);
    }
    const collection = await response.json();
    if (collection.error) {
        throw new Error(`Cadastre request failed: ${collection.error.message}`);
    }
    return {
        lines: (collection.features ?? []).flatMap((feature) => extractLines(feature.geometry)),
        isTruncated: collection.properties?.exceededTransferLimit === true || collection.exceededTransferLimit === true
    };
}

export async function fetchCadastreLines(layer, extent) {
    const results = await Promise.all(LAYER_SOURCES[layer].map((sourceUrl) => fetchSourceLines(sourceUrl, extent)));
    return {
        lines: results.flatMap((result) => result.lines).filter((line) => line.length >= 2),
        isTruncated: results.some((result) => result.isTruncated)
    };
}
