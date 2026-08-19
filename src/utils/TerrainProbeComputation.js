/*! ******************************************************************************************************** *
 *
 * Copyright 2026 Oidis
 *
 * SPDX-License-Identifier: BSD-2-Clause
 * The BSD-2-Clause license for this file can be found in the LICENSE.txt file included with this distribution
 * or at https://spdx.org/licenses/BSD-2-Clause.html#licenseText
 *
 * ********************************************************************************************************* */

import { PolygonPointQuery } from "../PolygonPointQuery.js";
import { pointQueryScheduler } from "../PointQueryScheduler.js";
import { isSimplePolygon } from "./PolygonMath.js";
import { TerrainColumnGrid } from "./TerrainColumnGrid.js";

export function selectMeasurablePointclouds(viewer) {
    return viewer.scene.pointclouds.filter((pointcloud) =>
        pointcloud.visible !== false &&
        pointcloud.pcoGeometry &&
        pointcloud.pcoGeometry.root);
}

export class TerrainProbeComputation {
    constructor(viewer, outlinePoints, options, callbacks) {
        if (!callbacks || typeof callbacks.onFailed !== "function") {
            throw new Error("TerrainProbeComputation requires an onFailed callback.");
        }
        if (!Array.isArray(outlinePoints) || outlinePoints.length < 3 ||
            outlinePoints.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z))) {
            throw new Error("TerrainProbeComputation requires an outline with at least 3 finite vertices.");
        }
        this.viewer = viewer;
        this.outlinePoints = outlinePoints.map((p) => ({ x: p.x, y: p.y, z: p.z }));
        this.options = options;
        this.callbacks = callbacks;
        this.state = "idle";
        this.queries = [];
        this.pendingQueries = 0;
        this.grid = null;
        this.pointclouds = [];
    }

    start() {
        if (this.state !== "idle") {
            throw new Error("Computation can only be started once.");
        }
        this.state = "running";
        try {
            this.startValidated();
        } catch (error) {
            this.fail(error);
        }
    }

    startValidated() {
        const polygon = this.outlinePoints.map((p) => ({ x: p.x, y: p.y }));
        if (!isSimplePolygon(polygon)) {
            throw new Error("Obrys se kříží nebo je degenerovaný — upravte vrcholy a spusťte výpočet znovu.");
        }
        this.pointclouds = selectMeasurablePointclouds(this.viewer);
        if (this.pointclouds.length === 0) {
            throw new Error("Ve scéně není žádné mračno bodů, ke kterému by šlo měření přichytit.");
        }

        let zMin = Infinity;
        let zMax = -Infinity;
        for (const pointcloud of this.pointclouds) {
            zMin = Math.min(zMin, pointcloud.boundingBox.min.z + pointcloud.position.z);
            zMax = Math.max(zMax, pointcloud.boundingBox.max.z + pointcloud.position.z);
        }
        zMin -= 1;
        zMax += 1;

        this.grid = new TerrainColumnGrid({
            polygon,
            cellSize: this.options.cellSizeM,
            maxGridCells: this.options.maxGridCells,
            maxPoints: this.options.maxQueryPoints
        });

        this.pendingQueries = this.pointclouds.length;
        for (const pointcloud of this.pointclouds) {
            const query = new PolygonPointQuery(pointcloud, {
                polygon,
                zMin,
                zMax,
                spacingCutoff: this.options.cellSizeM / 4
            }, {
                onPoints: (xs, ys, zs, count) => {
                    this.grid.addPoints(xs, ys, zs, count);
                },
                onProgress: (stats) => {
                    this.reportProgress(stats);
                },
                onFinish: () => {
                    this.handleQueryFinished();
                },
                onCancel: () => {
                    this.handleQueryCanceled();
                },
                onError: (error) => {
                    this.fail(error);
                }
            });
            this.queries.push(query);
        }
        for (const query of this.queries) {
            pointQueryScheduler.enqueue(query);
        }
    }

    reportProgress(lastQueryStats) {
        if (this.state !== "running" || typeof this.callbacks.onProgress !== "function") {
            return;
        }
        let pointsAccepted = 0;
        let nodesProcessed = 0;
        let queueSize = 0;
        for (const query of this.queries) {
            pointsAccepted += query.pointsAccepted;
            nodesProcessed += query.nodesProcessed;
            queueSize += query.priorityQueue.size();
        }
        this.callbacks.onProgress({ pointsAccepted, nodesProcessed, queueSize, lastQueryStats });
    }

    handleQueryFinished() {
        if (this.state !== "running") {
            return;
        }
        this.pendingQueries--;
        if (this.pendingQueries === 0) {
            this.finalize();
        }
    }

    handleQueryCanceled() {
        if (this.state !== "canceling") {
            return;
        }
        this.pendingQueries--;
        if (this.pendingQueries <= 0) {
            this.state = "canceled";
            if (typeof this.callbacks.onCanceled === "function") {
                this.callbacks.onCanceled();
            }
        }
    }

    finalize() {
        let payload;
        try {
            payload = this.buildResult();
        } catch (error) {
            this.fail(error);
            return;
        }
        this.state = "done";
        try {
            this.deliver(payload);
        } catch (error) {
            // A consumer exception must not be remapped to a computation failure; rethrow it out of band.
            setTimeout(() => {
                throw error;
            }, 0);
        }
    }

    buildResult() {
        throw new Error("TerrainProbeComputation.buildResult must be overridden.");
    }

    deliver() {
        throw new Error("TerrainProbeComputation.deliver must be overridden.");
    }

    fail(error) {
        if (this.state === "failed" || this.state === "canceled" || this.state === "done") {
            return;
        }
        this.state = "failed";
        for (const query of this.queries) {
            if (!query.finished && !query.canceled) {
                pointQueryScheduler.cancel(query);
            }
        }
        this.callbacks.onFailed(error);
    }

    cancel() {
        if (this.state !== "running") {
            return;
        }
        this.state = "canceling";
        const pending = this.queries.filter((query) => !query.finished && !query.canceled);
        this.pendingQueries = pending.length;
        if (pending.length === 0) {
            this.state = "canceled";
            if (typeof this.callbacks.onCanceled === "function") {
                this.callbacks.onCanceled();
            }
            return;
        }
        for (const query of pending) {
            pointQueryScheduler.cancel(query);
        }
    }
}
