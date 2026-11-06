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
import { PolygonPointQuery } from "../../PolygonPointQuery.js";
import { pointQueryScheduler } from "../../PointQueryScheduler.js";

const CELL_SIZE_METRES = 2;
const SPACING_CUTOFF_METRES = 1;
const FILL_PASS_COUNT = 3;
const NEIGHBOUR_OFFSETS = [-1, 0, 1];

export class TerrainHeightSampler extends EventDispatcher {
    constructor(pointCloud) {
        super();
        this.pointCloud = pointCloud;
        this.isReady = false;
        this.fallbackHeight = null;
        this.minimumX = 0;
        this.minimumY = 0;
        this.columnCount = 0;
        this.rowCount = 0;
        this.heights = null;
    }

    start() {
        const geometry = this.pointCloud.pcoGeometry;
        const box = (geometry.tightBoundingBox ?? geometry.boundingBox).clone().translate(this.pointCloud.position);
        this.minimumX = box.min.x;
        this.minimumY = box.min.y;
        this.columnCount = Math.max(1, Math.ceil((box.max.x - box.min.x) / CELL_SIZE_METRES));
        this.rowCount = Math.max(1, Math.ceil((box.max.y - box.min.y) / CELL_SIZE_METRES));
        this.heights = new Float64Array(this.columnCount * this.rowCount).fill(Infinity);
        const polygon = [
            { x: box.min.x, y: box.min.y },
            { x: box.max.x, y: box.min.y },
            { x: box.max.x, y: box.max.y },
            { x: box.min.x, y: box.max.y }
        ];
        const query = new PolygonPointQuery(this.pointCloud, {
            polygon: polygon,
            zMin: box.min.z - 1,
            zMax: box.max.z + 1,
            spacingCutoff: SPACING_CUTOFF_METRES
        }, {
            onPoints: (xs, ys, zs, count) => this.addPoints(xs, ys, zs, count),
            onFinish: () => this.finish(),
            onError: (error) => this.dispatchEvent({ type: "failed", error: error })
        });
        pointQueryScheduler.enqueue(query);
    }

    addPoints(xs, ys, zs, count) {
        for (let index = 0; index < count; index++) {
            const cellIndex = this.findCellIndex(xs[index], ys[index]);
            if (cellIndex !== null && zs[index] < this.heights[cellIndex]) {
                this.heights[cellIndex] = zs[index];
            }
        }
    }

    findCellIndex(x, y) {
        const column = Math.floor((x - this.minimumX) / CELL_SIZE_METRES);
        const row = Math.floor((y - this.minimumY) / CELL_SIZE_METRES);
        return this.toCellIndex(Math.min(column, this.columnCount - 1), Math.min(row, this.rowCount - 1));
    }

    toCellIndex(column, row) {
        if (column < 0 || row < 0 || column >= this.columnCount || row >= this.rowCount) {
            return null;
        }
        return row * this.columnCount + column;
    }

    collectNeighbourHeights(heights, column, row) {
        const neighbourHeights = [];
        for (const rowOffset of NEIGHBOUR_OFFSETS) {
            for (const columnOffset of NEIGHBOUR_OFFSETS) {
                const cellIndex = this.toCellIndex(column + columnOffset, row + rowOffset);
                if (cellIndex !== null && Number.isFinite(heights[cellIndex])) {
                    neighbourHeights.push(heights[cellIndex]);
                }
            }
        }
        return neighbourHeights;
    }

    applyMedianFilter() {
        const filtered = new Float64Array(this.heights.length).fill(Infinity);
        for (let row = 0; row < this.rowCount; row++) {
            for (let column = 0; column < this.columnCount; column++) {
                const cellIndex = this.toCellIndex(column, row);
                if (!Number.isFinite(this.heights[cellIndex])) {
                    continue;
                }
                const neighbourHeights = this.collectNeighbourHeights(this.heights, column, row).sort((first, second) => first - second);
                filtered[cellIndex] = neighbourHeights[Math.floor(neighbourHeights.length / 2)];
            }
        }
        this.heights = filtered;
    }

    fillEmptyCells() {
        for (let pass = 0; pass < FILL_PASS_COUNT; pass++) {
            const filled = this.heights.slice();
            for (let row = 0; row < this.rowCount; row++) {
                for (let column = 0; column < this.columnCount; column++) {
                    const cellIndex = this.toCellIndex(column, row);
                    if (Number.isFinite(this.heights[cellIndex])) {
                        continue;
                    }
                    const neighbourHeights = this.collectNeighbourHeights(this.heights, column, row);
                    if (neighbourHeights.length > 0) {
                        filled[cellIndex] = neighbourHeights.reduce((sum, height) => sum + height, 0) / neighbourHeights.length;
                    }
                }
            }
            this.heights = filled;
        }
    }

    finish() {
        this.applyMedianFilter();
        this.fillEmptyCells();
        const knownHeights = Array.from(this.heights).filter((height) => Number.isFinite(height)).sort((first, second) => first - second);
        this.fallbackHeight = knownHeights.length > 0 ? knownHeights[Math.floor(knownHeights.length / 2)] : null;
        this.isReady = true;
        this.dispatchEvent({ type: "ready" });
    }

    getCellHeight(column, row) {
        const cellIndex = this.toCellIndex(column, row);
        return cellIndex !== null && Number.isFinite(this.heights[cellIndex]) ? this.heights[cellIndex] : null;
    }

    heightAt(x, y) {
        if (!this.isReady) {
            return null;
        }
        const gridX = (x - this.minimumX) / CELL_SIZE_METRES - 0.5;
        const gridY = (y - this.minimumY) / CELL_SIZE_METRES - 0.5;
        const column = Math.floor(gridX);
        const row = Math.floor(gridY);
        const shareX = gridX - column;
        const shareY = gridY - row;
        const corners = [
            [column, row, (1 - shareX) * (1 - shareY)],
            [column + 1, row, shareX * (1 - shareY)],
            [column, row + 1, (1 - shareX) * shareY],
            [column + 1, row + 1, shareX * shareY]
        ];
        let weightedSum = 0;
        let weightSum = 0;
        for (const [cornerColumn, cornerRow, weight] of corners) {
            const height = this.getCellHeight(cornerColumn, cornerRow);
            if (height !== null && weight > 0) {
                weightedSum += height * weight;
                weightSum += weight;
            }
        }
        return weightSum > 0 ? weightedSum / weightSum : this.fallbackHeight;
    }
}
