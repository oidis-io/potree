/*! ******************************************************************************************************** *
 *
 * Copyright 2026 Oidis
 *
 * SPDX-License-Identifier: BSD-2-Clause
 * The BSD-2-Clause license for this file can be found in the LICENSE.txt file included with this distribution
 * or at https://spdx.org/licenses/BSD-2-Clause.html#licenseText
 *
 * ********************************************************************************************************* */

import { clipPolygonToRect, polygonArea, polygonBounds, polygonCentroid } from "./PolygonMath.js";
import { clusterSurfaceZ, demoteSpatialGhosts, fillEmptyCells } from "./TerrainGridMath.js";

const WEIGHT_EPSILON = 1e-9;

export class TerrainColumnGrid {
    constructor(options) {
        const { polygon, cellSize, maxGridCells, maxPoints } = options;
        if (!(cellSize > 0)) {
            throw new Error("Velikost buňky výpočetní mřížky musí být kladná.");
        }
        if (!Number.isFinite(maxGridCells) || maxGridCells <= 0 || !Number.isFinite(maxPoints) || maxPoints <= 0) {
            throw new Error("TerrainColumnGrid requires positive finite maxGridCells and maxPoints.");
        }
        this.cellSize = cellSize;
        this.cellArea = cellSize * cellSize;
        this.maxPoints = maxPoints;

        const bounds = polygonBounds(polygon);
        this.originX = bounds.minX;
        this.originY = bounds.minY;
        this.cols = Math.max(1, Math.ceil((bounds.maxX - this.originX) / cellSize));
        this.rows = Math.max(1, Math.ceil((bounds.maxY - this.originY) / cellSize));

        const cellCount = this.cols * this.rows;
        if (cellCount > maxGridCells) {
            throw new Error(
                `Výpočetní mřížka je příliš velká (${cellCount} buněk, limit ${maxGridCells}). ` +
                "Zmenšete obrys, nebo zvyšte velikost buňky v nastavení."
            );
        }

        this.weights = new Float64Array(cellCount);
        this.centroidX = new Float64Array(cellCount);
        this.centroidY = new Float64Array(cellCount);
        this.relevant = new Uint8Array(cellCount);
        this.surfaceZ = new Float64Array(cellCount).fill(NaN);
        this.zLists = new Array(cellCount).fill(null);
        this.totalPoints = 0;
        this.relevantCells = 0;

        const localPolygon = polygon.map((p) => ({ x: p.x - this.originX, y: p.y - this.originY }));
        for (let row = 0; row < this.rows; row++) {
            for (let col = 0; col < this.cols; col++) {
                const index = row * this.cols + col;
                const minX = col * cellSize;
                const minY = row * cellSize;
                const clipped = clipPolygonToRect(localPolygon, minX, minY, minX + cellSize, minY + cellSize);
                const area = polygonArea(clipped);
                if (area > WEIGHT_EPSILON * this.cellArea) {
                    this.weights[index] = Math.min(1, area / this.cellArea);
                    const centroid = polygonCentroid(clipped);
                    this.centroidX[index] = centroid.x + this.originX;
                    this.centroidY[index] = centroid.y + this.originY;
                    this.relevant[index] = 1;
                    this.relevantCells++;
                }
            }
        }
    }

    cellIndexAt(x, y) {
        const col = Math.floor((x - this.originX) / this.cellSize);
        const row = Math.floor((y - this.originY) / this.cellSize);
        if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) {
            return -1;
        }
        return row * this.cols + col;
    }

    addPoints(xArray, yArray, zArray, count) {
        let accepted = 0;
        for (let i = 0; i < count; i++) {
            const index = this.cellIndexAt(xArray[i], yArray[i]);
            if (index === -1 || !this.relevant[index]) {
                continue;
            }
            let list = this.zLists[index];
            if (list === null) {
                list = [];
                this.zLists[index] = list;
            }
            list.push(zArray[i]);
            accepted++;
        }
        this.totalPoints += accepted;
        if (this.totalPoints > this.maxPoints) {
            throw new Error(
                `Výpočet překročil limit ${this.maxPoints} bodů. ` +
                "Zmenšete obrys, nebo zvyšte limit v nastavení."
            );
        }
        return accepted;
    }

    finalize(options) {
        const { gapThreshold, minClusterShare, fromBelow, maxFillRing, ghostDemoteM = 0.5 } = options;
        let cellsWithPoints = 0;
        let ghostSkippedCells = 0;
        const pointCounts = [];
        const clusterLevelsByCell = new Array(this.zLists.length).fill(null);
        for (let index = 0; index < this.zLists.length; index++) {
            const list = this.zLists[index];
            if (!this.relevant[index] || list === null || list.length === 0) {
                continue;
            }
            const cluster = clusterSurfaceZ(list, { gapThreshold, minClusterShare, fromBelow });
            this.surfaceZ[index] = cluster.z;
            if (cluster.clusterLevels.length > 1) {
                clusterLevelsByCell[index] = cluster.clusterLevels;
            }
            if (cluster.skippedWeakClusters > 0) {
                ghostSkippedCells++;
            }
            cellsWithPoints++;
            pointCounts.push(list.length);
        }

        const demotion = demoteSpatialGhosts(
            this.surfaceZ, clusterLevelsByCell, this.relevant, this.cols, this.rows,
            { demoteThreshold: ghostDemoteM, fromBelow });
        ghostSkippedCells += demotion.demoted;

        const fillResult = fillEmptyCells(this.surfaceZ, this.relevant, this.cols, this.rows, maxFillRing);

        pointCounts.sort((a, b) => a - b);
        const medianPointsPerCell = pointCounts.length === 0
            ? 0
            : pointCounts[Math.floor(pointCounts.length / 2)];

        this.stats = {
            relevantCells: this.relevantCells,
            cellsWithPoints,
            filled: fillResult.filled,
            unfilled: fillResult.unfilled,
            coveragePct: this.relevantCells === 0 ? 0 : (100 * cellsWithPoints) / this.relevantCells,
            filledPct: this.relevantCells === 0 ? 0 : (100 * fillResult.filled) / this.relevantCells,
            ghostSkippedCells,
            ghostSkippedPct: cellsWithPoints === 0 ? 0 : (100 * ghostSkippedCells) / cellsWithPoints,
            medianPointsPerCell,
            totalPoints: this.totalPoints
        };
        this.zLists = new Array(this.zLists.length).fill(null);
        return this.stats;
    }
}
