/*! ******************************************************************************************************** *
 *
 * Copyright 2026 Oidis
 *
 * SPDX-License-Identifier: BSD-2-Clause
 * The BSD-2-Clause license for this file can be found in the LICENSE.txt file included with this distribution
 * or at https://spdx.org/licenses/BSD-2-Clause.html#licenseText
 *
 * ********************************************************************************************************* */

import * as THREE from "../libs/three.js/build/three.module.js";
import { nodeIntersectsPolygonPrism, polygonBounds } from "./utils/PolygonMath.js";
import PotreeRefs from "./PotreeRefs.js";

const FILTER_SLICE_MS = 4;

export class PolygonPointQuery {
    constructor(pointcloud, options, consumer) {
        if (!consumer || typeof consumer.onPoints !== "function" || typeof consumer.onFinish !== "function") {
            throw new Error("PolygonPointQuery requires a consumer with onPoints and onFinish.");
        }
        if (!Array.isArray(options.polygon) || options.polygon.length < 3 ||
            options.polygon.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) {
            throw new Error("PolygonPointQuery requires a polygon with at least 3 finite vertices.");
        }
        if (!Number.isFinite(options.zMin) || !Number.isFinite(options.zMax) || options.zMin >= options.zMax) {
            throw new Error("PolygonPointQuery requires a finite zMin < zMax range.");
        }
        this.pointcloud = pointcloud;
        this.consumer = consumer;
        this.polygon = options.polygon.map((p) => ({ x: p.x, y: p.y }));
        this.bounds = polygonBounds(this.polygon);
        this.zMin = options.zMin;
        this.zMax = options.zMax;
        this.nodesPerUpdate = options.nodesPerUpdate ?? 8;
        this.spacingCutoff = options.spacingCutoff ?? 0;
        this.loadTimeoutMs = options.loadTimeoutMs ?? 60000;

        this.nodesProcessed = 0;
        this.pointsAccepted = 0;
        this.finished = false;
        this.canceled = false;
        this.pendingFilter = null;
        this.loadWaitSince = new Map();
        this.queuedNodeIds = new Set();
        this.traversedNodeIds = new Set();

        this.priorityQueue = new BinaryHeap((x) => 1 / x.weight);
        const root = this.pointcloud.pcoGeometry.root;
        this.queuedNodeIds.add(root.id);
        this.priorityQueue.push({ node: root, weight: Infinity });
    }

    nodeIntersects(node) {
        const boxWorld = node.boundingBox.clone().applyMatrix4(this.pointcloud.matrixWorld);
        const nodeBounds = {
            minX: boxWorld.min.x,
            minY: boxWorld.min.y,
            minZ: boxWorld.min.z,
            maxX: boxWorld.max.x,
            maxY: boxWorld.max.y,
            maxZ: boxWorld.max.z
        };
        return nodeIntersectsPolygonPrism(nodeBounds, this.polygon, this.bounds, this.zMin, this.zMax);
    }

    childAccepted(child) {
        return this.nodeIntersects(child);
    }

    samplingSufficient(node) {
        return this.spacingCutoff > 0 && Number.isFinite(node.spacing) && node.spacing <= this.spacingCutoff;
    }

    traverse(node) {
        if (this.traversedNodeIds.has(node.id)) {
            return;
        }
        this.traversedNodeIds.add(node.id);
        const stack = [];
        const collectChildren = (parent) => {
            if (this.samplingSufficient(parent)) {
                return;
            }
            for (let i = 0; i < 8; i++) {
                const child = parent.children[i];
                if (child && !this.queuedNodeIds.has(child.id) && this.childAccepted(child)) {
                    stack.push(child);
                }
            }
        };
        collectChildren(node);
        while (stack.length > 0) {
            const current = stack.pop();
            this.queuedNodeIds.add(current.id);
            this.priorityQueue.push({ node: current, weight: current.boundingSphere.radius });
            collectChildren(current);
        }
    }

    update() {
        if (this.finished || this.canceled) {
            return { advanced: false, waiting: 0, done: true };
        }
        try {
            return this.updateUnsafe();
        } catch (error) {
            this.fail(error);
            return { advanced: false, waiting: 0, done: true };
        }
    }

    updateUnsafe() {
        if (this.pendingFilter !== null) {
            const result = this.pendingFilter.next();
            if (result.done) {
                this.pendingFilter = null;
                this.nodesProcessed++;
            }
            return { advanced: true, waiting: 0, done: false };
        }

        let attempts = 0;
        let processed = 0;
        let waiting = 0;
        const now = performance.now();

        while (attempts < this.nodesPerUpdate && this.pendingFilter === null && this.priorityQueue.size() > 0) {
            attempts++;
            const element = this.priorityQueue.pop();
            const node = element.node;

            if (node.loaded) {
                this.loadWaitSince.delete(node);
                PotreeRefs.lru.touch(node);

                const geom = node.pcoGeometry;
                const hierarchyStepSize = geom ? geom.hierarchyStepSize : 1;
                const doTraverse = node.getLevel() === 0 ||
                    (node.level % hierarchyStepSize === 0 && node.hasChildren);
                if (doTraverse) {
                    this.traverse(node);
                }

                const filter = this.filterNodePoints(node);
                const result = filter.next();
                if (result.done) {
                    this.nodesProcessed++;
                    processed++;
                } else {
                    this.pendingFilter = filter;
                }
            } else {
                node.load();
                const since = this.loadWaitSince.get(node);
                if (since === undefined) {
                    this.loadWaitSince.set(node, now);
                } else if (now - since > this.loadTimeoutMs) {
                    this.fail(new Error("Načítání části mračna vypršelo — výpočet nelze dokončit."));
                    return { advanced: false, waiting: 0, done: true };
                }
                this.priorityQueue.push(element);
                waiting++;
            }
        }

        if (processed > 0 && typeof this.consumer.onProgress === "function") {
            this.consumer.onProgress({
                nodesProcessed: this.nodesProcessed,
                pointsAccepted: this.pointsAccepted,
                queueSize: this.priorityQueue.size()
            });
        }

        if (this.priorityQueue.size() === 0 && this.pendingFilter === null) {
            this.finished = true;
            this.consumer.onFinish();
            return { advanced: processed > 0, waiting: 0, done: true };
        }

        return { advanced: processed > 0 || this.pendingFilter !== null, waiting, done: false };
    }

    * filterNodePoints(node) {
        const numPoints = node.numPoints;
        const geometry = node.geometry;
        if (!numPoints || !geometry || !geometry.attributes || !geometry.attributes.position) {
            return;
        }
        const view = new Float32Array(geometry.attributes.position.array);
        const nodeMatrix = new THREE.Matrix4().makeTranslation(
            node.boundingBox.min.x, node.boundingBox.min.y, node.boundingBox.min.z);
        const matrix = new THREE.Matrix4().multiplyMatrices(this.pointcloud.matrixWorld, nodeMatrix);

        const xs = new Float64Array(numPoints);
        const ys = new Float64Array(numPoints);
        const zs = new Float64Array(numPoints);
        let accepted = 0;
        const position = new THREE.Vector3();
        let checkpoint = performance.now();

        for (let i = 0; i < numPoints; i++) {
            position.set(view[i * 3], view[i * 3 + 1], view[i * 3 + 2]);
            position.applyMatrix4(matrix);

            if (position.x >= this.bounds.minX && position.x <= this.bounds.maxX &&
                position.y >= this.bounds.minY && position.y <= this.bounds.maxY &&
                position.z >= this.zMin && position.z <= this.zMax) {
                xs[accepted] = position.x;
                ys[accepted] = position.y;
                zs[accepted] = position.z;
                accepted++;
                this.pointsAccepted++;
            }

            if ((i % 1000) === 0 && performance.now() - checkpoint > FILTER_SLICE_MS) {
                yield false;
                checkpoint = performance.now();
            }
        }

        if (accepted > 0) {
            this.consumer.onPoints(xs, ys, zs, accepted);
        }
    }

    fail(error) {
        if (this.finished || this.canceled) {
            return;
        }
        this.canceled = true;
        this.pendingFilter = null;
        this.priorityQueue = new BinaryHeap((x) => 1 / x.weight);
        if (typeof this.consumer.onError === "function") {
            this.consumer.onError(error);
        } else {
            throw error;
        }
    }

    cancel() {
        if (this.finished || this.canceled) {
            return;
        }
        this.canceled = true;
        this.pendingFilter = null;
        this.priorityQueue = new BinaryHeap((x) => 1 / x.weight);
        if (typeof this.consumer.onCancel === "function") {
            this.consumer.onCancel();
        }
    }
}
