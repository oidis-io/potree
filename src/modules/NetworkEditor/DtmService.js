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
const FEATURE_INFO_IMAGE_SIZE = 101;
const FEATURE_INFO_FEATURE_COUNT = 10;
const MINIMUM_FEATURE_INFO_METRES_PER_PIXEL = 0.01;

export const DtmNetworkLayer = Object.freeze({
    ELECTRIC_LINE: "el_ved",
    ELECTRONIC_COMMUNICATION: "el_kom",
    GAS_PIPELINE: "plyn",
    WATER_PIPELINE: "voda",
    SEWER: "kan",
    HEATING_PIPELINE: "teplo",
    PRODUCT_PIPELINE: "produkt",
    SURFACE_WATER_SUPPLY: "priv_vody",
    SHARED_STRUCTURE: "sdil_st_ti",
    TRANSPORT_EQUIPMENT: "zar_dopr_st",
    FLOOD_PROTECTION: "st_ochr_pov",
    LAND_DRAINAGE: "st_mel_poz",
    WATERCOURSE_STRUCTURE: "st_kor_vod_tok"
});

function createServiceUrl(layerIds, parameters) {
    const query = new URLSearchParams({
        "SERVICE": "WMS",
        "VERSION": "1.3.0",
        "LAYERS": layerIds.join(","),
        "STYLES": "",
        "CRS": "EPSG:5514",
        ...parameters
    });
    return `${DTM_SERVICE_URL}?${query.toString()}`;
}

function formatBoundingBox(minimumX, minimumY, maximumX, maximumY) {
    return [minimumX, minimumY, maximumX, maximumY].map((value) => value.toFixed(2)).join(",");
}

export function createDtmMapUrl(extent, width, height, layerIds) {
    return createServiceUrl(layerIds, {
        "REQUEST": "GetMap",
        "FORMAT": "image/png",
        "TRANSPARENT": "TRUE",
        "BBOX": formatBoundingBox(extent.minimumX, extent.minimumY, extent.maximumX, extent.maximumY),
        "WIDTH": String(width),
        "HEIGHT": String(height)
    });
}

export function createDtmFeatureInfoUrl(x, y, metresPerPixel, layerIds) {
    const radius = Math.max(metresPerPixel, MINIMUM_FEATURE_INFO_METRES_PER_PIXEL) * FEATURE_INFO_IMAGE_SIZE / 2;
    const imageCenter = Math.floor(FEATURE_INFO_IMAGE_SIZE / 2);
    return createServiceUrl(layerIds, {
        "REQUEST": "GetFeatureInfo",
        "QUERY_LAYERS": layerIds.join(","),
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

export async function fetchDtmFeatureInfo(x, y, metresPerPixel, layerIds) {
    const response = await fetch(createDtmFeatureInfoUrl(x, y, metresPerPixel, layerIds));
    if (!response.ok) {
        throw new Error(`DTM feature info request failed with status ${response.status}`);
    }
    const result = await response.json();
    return {
        region: result.isDtmk?.nazev ?? null,
        features: (result.features ?? []).map((feature) => feature.properties ?? {})
    };
}
