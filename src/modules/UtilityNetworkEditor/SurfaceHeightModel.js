/*! ******************************************************************************************************** *
 *
 * Copyright 2026 Oidis
 *
 * SPDX-License-Identifier: BSD-2-Clause
 * The BSD-2-Clause license for this file can be found in the LICENSE.txt file included with this distribution
 * or at https://spdx.org/licenses/BSD-2-Clause.html#licenseText
 *
 * ********************************************************************************************************* */

import { EventDispatcher } from "../../EventDispatcher.js";
import { pointInPolygon, polygonBounds } from "../../utils/PolygonMath.js";
import { fetchHeightRasters } from "./SurfaceModelService.js";

export const SurfaceHeightModelState = Object.freeze({
    EMPTY: "empty",
    LOADING: "loading",
    READY: "ready",
    FAILED: "failed"
});

const MINIMUM_VALID_HEIGHT_METRES = -500;
const MAXIMUM_VALID_HEIGHT_METRES = 5000;

function isValidHeight(height) {
    return Number.isFinite(height) && height > MINIMUM_VALID_HEIGHT_METRES && height < MAXIMUM_VALID_HEIGHT_METRES;
}

function containsExtent(outer, inner) {
    return outer.minimumX <= inner.minimumX && outer.minimumY <= inner.minimumY && outer.maximumX >= inner.maximumX && outer.maximumY >= inner.maximumY;
}

export class SurfaceHeightModel extends EventDispatcher {
    constructor() {
        super();
        this.state = SurfaceHeightModelState.EMPTY;
        this.raster = null;
        this.requestedExtent = null;
        this.requestIndex = 0;
    }

    covers(extent) {
        return this.requestedExtent !== null && this.state !== SurfaceHeightModelState.FAILED && containsExtent(this.requestedExtent, extent);
    }

    async load(extent) {
        const requestIndex = ++this.requestIndex;
        this.requestedExtent = extent;
        this.setState(SurfaceHeightModelState.LOADING);
        try {
            const raster = await fetchHeightRasters(extent);
            if (requestIndex === this.requestIndex) {
                this.raster = raster;
                this.setState(SurfaceHeightModelState.READY);
            }
        } catch {
            if (requestIndex === this.requestIndex) {
                this.setState(SurfaceHeightModelState.FAILED);
            }
        }
    }

    setState(state) {
        this.state = state;
        this.dispatchEvent({ type: "state_changed", state: state });
    }

    measure(polygon) {
        const raster = this.raster;
        if (this.state !== SurfaceHeightModelState.READY || !raster) {
            return null;
        }
        const bounds = polygonBounds(polygon);
        const firstColumn = Math.max(0, Math.floor((bounds.minX - raster.minimumX) / raster.cellSize));
        const lastColumn = Math.min(raster.width - 1, Math.floor((bounds.maxX - raster.minimumX) / raster.cellSize));
        const firstRow = Math.max(0, Math.floor((raster.maximumY - bounds.maxY) / raster.cellSize));
        const lastRow = Math.min(raster.height - 1, Math.floor((raster.maximumY - bounds.minY) / raster.cellSize));
        const surfaceHeights = [];
        const terrainHeights = [];
        for (let row = firstRow; row <= lastRow; row++) {
            for (let column = firstColumn; column <= lastColumn; column++) {
                const x = raster.minimumX + (column + 0.5) * raster.cellSize;
                const y = raster.maximumY - (row + 0.5) * raster.cellSize;
                const index = row * raster.width + column;
                if (pointInPolygon(x, y, polygon) && isValidHeight(raster.surfaceHeights[index]) && isValidHeight(raster.terrainHeights[index])) {
                    surfaceHeights.push(raster.surfaceHeights[index]);
                    terrainHeights.push(raster.terrainHeights[index]);
                }
            }
        }
        return { surfaceHeights: surfaceHeights, terrainHeights: terrainHeights };
    }
}
