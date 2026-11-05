/*! ******************************************************************************************************** *
 *
 * Copyright 2026 Oidis
 *
 * SPDX-License-Identifier: BSD-2-Clause
 * The BSD-2-Clause license for this file can be found in the LICENSE.txt file included with this distribution
 * or at https://spdx.org/licenses/BSD-2-Clause.html#licenseText
 *
 * ********************************************************************************************************* */

const DTM_SERVICE_URL = "https://dmvs.cuzk.gov.cz/api/wms/dtm_ti_ver";
const DTM_LAYERS = "dtm_ti_ver";
const FEATURE_INFO_IMAGE_SIZE = 101;
const FEATURE_INFO_FEATURE_COUNT = 10;
const MINIMUM_FEATURE_INFO_METRES_PER_PIXEL = 0.01;

function createServiceUrl(parameters) {
    const query = new URLSearchParams({
        "SERVICE": "WMS",
        "VERSION": "1.3.0",
        "LAYERS": DTM_LAYERS,
        "STYLES": "",
        "CRS": "EPSG:5514",
        ...parameters
    });
    return `${DTM_SERVICE_URL}?${query.toString()}`;
}

function formatBoundingBox(minimumX, minimumY, maximumX, maximumY) {
    return [minimumX, minimumY, maximumX, maximumY].map((value) => value.toFixed(2)).join(",");
}

export function createDtmMapUrl(extent, width, height) {
    return createServiceUrl({
        "REQUEST": "GetMap",
        "FORMAT": "image/png",
        "TRANSPARENT": "TRUE",
        "BBOX": formatBoundingBox(extent.minimumX, extent.minimumY, extent.maximumX, extent.maximumY),
        "WIDTH": String(width),
        "HEIGHT": String(height)
    });
}

export function createDtmFeatureInfoUrl(x, y, metresPerPixel) {
    const radius = Math.max(metresPerPixel, MINIMUM_FEATURE_INFO_METRES_PER_PIXEL) * FEATURE_INFO_IMAGE_SIZE / 2;
    const imageCenter = Math.floor(FEATURE_INFO_IMAGE_SIZE / 2);
    return createServiceUrl({
        "REQUEST": "GetFeatureInfo",
        "QUERY_LAYERS": DTM_LAYERS,
        "FORMAT": "image/png",
        "INFO_FORMAT": "application/json",
        "FEATURE_COUNT": String(FEATURE_INFO_FEATURE_COUNT),
        "BBOX": formatBoundingBox(x - radius, y - radius, x + radius, y + radius),
        "WIDTH": String(FEATURE_INFO_IMAGE_SIZE),
        "HEIGHT": String(FEATURE_INFO_IMAGE_SIZE),
        "I": String(imageCenter),
        "J": String(imageCenter)
    });
}

export async function fetchDtmFeatureInfo(x, y, metresPerPixel) {
    const response = await fetch(createDtmFeatureInfoUrl(x, y, metresPerPixel));
    if (!response.ok) {
        throw new Error(`DTM feature info request failed with status ${response.status}`);
    }
    const result = await response.json();
    return {
        region: result.isDtmk?.nazev ?? null,
        features: (result.features ?? []).map((feature) => feature.properties ?? {})
    };
}
