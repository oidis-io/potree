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
import { pointInPolygon, polygonBounds } from "../../utils/PolygonMath.js";
import { SurfaceHeightModelState } from "./SurfaceHeightModel.js";

export const BuildingHeightSource = Object.freeze({
    POINT_CLOUD: "point_cloud",
    SURFACE_MODEL: "surface_model",
    FLOORS: "floors",
    NONE: "none"
});

const ROOF_PERCENTILE = 0.9;
const GROUND_PERCENTILE = 0.25;
const SURFACE_TERRAIN_PERCENTILE = 0.5;
const INNER_MARGIN_METRES = 0.5;
const GROUND_SAMPLE_DISTANCE_METRES = 1.5;
const MINIMUM_ROOF_HEIGHT_ABOVE_GROUND_METRES = 2;
const MAXIMUM_BUILDING_HEIGHT_METRES = 200;
const MINIMUM_ROOF_POINT_COUNT = 30;
const MINIMUM_SURFACE_SAMPLE_COUNT = 4;
const QUERY_SPACING_METRES = 0.5;
const FLOOR_HEIGHT_METRES = 3;
const MAXIMUM_FLOOR_COUNT = 60;

export function ringToPolygon(ring) {
    const [firstX, firstY] = ring[0];
    const [lastX, lastY] = ring[ring.length - 1];
    const isClosed = firstX === lastX && firstY === lastY;
    return (isClosed ? ring.slice(0, -1) : ring).map(([x, y]) => ({ x: x, y: y }));
}

function computeSignedArea(polygon) {
    let doubledArea = 0;
    for (let index = 0; index < polygon.length; index++) {
        const current = polygon[index];
        const next = polygon[(index + 1) % polygon.length];
        doubledArea += current.x * next.y - next.x * current.y;
    }
    return doubledArea / 2;
}

function measureDistanceToSegment(x, y, start, end) {
    const deltaX = end.x - start.x;
    const deltaY = end.y - start.y;
    const lengthSquared = deltaX * deltaX + deltaY * deltaY;
    const share = lengthSquared > 0 ? Math.min(1, Math.max(0, ((x - start.x) * deltaX + (y - start.y) * deltaY) / lengthSquared)) : 0;
    return Math.hypot(x - (start.x + share * deltaX), y - (start.y + share * deltaY));
}

function measureDistanceToBoundary(x, y, polygon) {
    let distance = Infinity;
    for (let index = 0; index < polygon.length; index++) {
        distance = Math.min(distance, measureDistanceToSegment(x, y, polygon[index], polygon[(index + 1) % polygon.length]));
    }
    return distance;
}

function computePercentile(values, share) {
    const sorted = Float64Array.from(values).sort();
    return sorted[Math.floor((sorted.length - 1) * share)];
}

function collectGroundSamplePoints(polygon) {
    const orientation = computeSignedArea(polygon) > 0 ? 1 : -1;
    const points = [];
    for (let index = 0; index < polygon.length; index++) {
        const start = polygon[index];
        const end = polygon[(index + 1) % polygon.length];
        const length = Math.hypot(end.x - start.x, end.y - start.y);
        if (length === 0) {
            continue;
        }
        const normalX = orientation * (end.y - start.y) / length;
        const normalY = -orientation * (end.x - start.x) / length;
        for (const share of [0, 0.5]) {
            points.push({
                x: start.x + (end.x - start.x) * share + normalX * GROUND_SAMPLE_DISTANCE_METRES,
                y: start.y + (end.y - start.y) * share + normalY * GROUND_SAMPLE_DISTANCE_METRES
            });
        }
    }
    return points;
}

export class BuildingHeightEstimator extends EventDispatcher {
    constructor(getFallbackGroundHeight) {
        super();
        this.getFallbackGroundHeight = getFallbackGroundHeight;
        this.pointCloud = null;
        this.terrainHeightSampler = null;
        this.surfaceHeightModel = null;
        this.results = new Map();
        this.queries = new Map();
        this.waitingParts = new Map();
    }

    setSources(pointCloud, terrainHeightSampler) {
        this.cancelAll();
        this.pointCloud = pointCloud;
        this.terrainHeightSampler = terrainHeightSampler;
        this.results.clear();
    }

    setSurfaceHeightModel(surfaceHeightModel) {
        this.surfaceHeightModel = surfaceHeightModel;
    }

    getResult(part) {
        return this.results.get(part.key) ?? null;
    }

    estimate(part) {
        if (this.results.has(part.key) || this.queries.has(part.key) || this.waitingParts.has(part.key)) {
            return;
        }
        const polygon = ringToPolygon(part.ring);
        const groundHeight = this.estimateGroundHeight(polygon);
        if (!this.pointCloud || groundHeight === null || !this.overlapsPointCloud(polygon)) {
            this.estimateWithoutPointCloud(part, groundHeight);
            return;
        }
        const heights = [];
        const query = new PolygonPointQuery(this.pointCloud, {
            polygon: polygon,
            zMin: groundHeight + MINIMUM_ROOF_HEIGHT_ABOVE_GROUND_METRES,
            zMax: groundHeight + MAXIMUM_BUILDING_HEIGHT_METRES,
            spacingCutoff: QUERY_SPACING_METRES
        }, {
            onPoints: (xs, ys, zs, count) => {
                for (let index = 0; index < count; index++) {
                    if (pointInPolygon(xs[index], ys[index], polygon) && measureDistanceToBoundary(xs[index], ys[index], polygon) >= INNER_MARGIN_METRES) {
                        heights.push(zs[index]);
                    }
                }
            },
            onFinish: () => {
                this.queries.delete(part.key);
                if (heights.length >= MINIMUM_ROOF_POINT_COUNT) {
                    this.finish(part, { source: BuildingHeightSource.POINT_CLOUD, baseHeight: groundHeight, roofHeight: computePercentile(heights, ROOF_PERCENTILE), sampleCount: heights.length });
                } else {
                    this.estimateWithoutPointCloud(part, groundHeight);
                }
            },
            onError: () => {
                this.queries.delete(part.key);
                this.estimateWithoutPointCloud(part, groundHeight);
            }
        });
        this.queries.set(part.key, query);
        pointQueryScheduler.enqueue(query);
    }

    estimateWithoutPointCloud(part, groundHeight) {
        if (this.surfaceHeightModel?.state === SurfaceHeightModelState.LOADING) {
            this.waitingParts.set(part.key, { part: part, groundHeight: groundHeight });
            return;
        }
        this.finish(part, this.estimateFromSurfaceModel(part, groundHeight) ?? this.estimateFromFloors(part, groundHeight));
    }

    resolveWaitingParts() {
        const waitingParts = [...this.waitingParts.values()];
        this.waitingParts.clear();
        for (const { part, groundHeight } of waitingParts) {
            this.estimateWithoutPointCloud(part, groundHeight);
        }
    }

    forgetEstimatesWithoutPointCloud() {
        for (const [key, result] of this.results) {
            if (result.source !== BuildingHeightSource.POINT_CLOUD) {
                this.results.delete(key);
            }
        }
    }

    estimateGroundHeight(polygon) {
        if (!this.terrainHeightSampler) {
            return this.pointCloud ? null : this.getFallbackGroundHeight();
        }
        const heights = collectGroundSamplePoints(polygon)
            .map((point) => this.terrainHeightSampler.measuredHeightAt(point.x, point.y))
            .filter((height) => height !== null);
        return heights.length > 0 ? computePercentile(heights, GROUND_PERCENTILE) : this.terrainHeightSampler.heightAt(polygon[0].x, polygon[0].y);
    }

    overlapsPointCloud(polygon) {
        const geometry = this.pointCloud.pcoGeometry;
        const box = (geometry.tightBoundingBox ?? geometry.boundingBox).clone().translate(this.pointCloud.position);
        const bounds = polygonBounds(polygon);
        return bounds.minX <= box.max.x && bounds.maxX >= box.min.x && bounds.minY <= box.max.y && bounds.maxY >= box.min.y;
    }

    estimateFromSurfaceModel(part, groundHeight) {
        const samples = this.surfaceHeightModel?.measure(ringToPolygon(part.ring)) ?? null;
        if (!samples || samples.surfaceHeights.length < MINIMUM_SURFACE_SAMPLE_COUNT) {
            return null;
        }
        const buildingHeight = computePercentile(samples.surfaceHeights, ROOF_PERCENTILE) - computePercentile(samples.terrainHeights, SURFACE_TERRAIN_PERCENTILE);
        if (buildingHeight < MINIMUM_ROOF_HEIGHT_ABOVE_GROUND_METRES || buildingHeight > MAXIMUM_BUILDING_HEIGHT_METRES) {
            return null;
        }
        const baseHeight = groundHeight ?? this.getFallbackGroundHeight();
        return { source: BuildingHeightSource.SURFACE_MODEL, baseHeight: baseHeight, roofHeight: baseHeight + buildingHeight, sampleCount: samples.surfaceHeights.length };
    }

    estimateFromFloors(part, groundHeight) {
        const baseHeight = groundHeight ?? this.getFallbackGroundHeight();
        const floorCount = part.attributes?.floorCount ?? null;
        if (!(floorCount > 0 && floorCount <= MAXIMUM_FLOOR_COUNT)) {
            return { source: BuildingHeightSource.NONE, baseHeight: baseHeight, roofHeight: null, sampleCount: 0 };
        }
        return { source: BuildingHeightSource.FLOORS, baseHeight: baseHeight, roofHeight: baseHeight + floorCount * FLOOR_HEIGHT_METRES, sampleCount: 0 };
    }

    finish(part, result) {
        this.results.set(part.key, result);
        this.dispatchEvent({ type: "estimated", key: part.key, result: result });
    }

    cancelAll() {
        for (const query of this.queries.values()) {
            pointQueryScheduler.cancel(query);
        }
        this.queries.clear();
        this.waitingParts.clear();
    }
}
