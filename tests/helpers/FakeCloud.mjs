/*! ******************************************************************************************************** *
 *
 * Copyright 2026 Oidis
 *
 * SPDX-License-Identifier: BSD-2-Clause
 * The BSD-2-Clause license for this file can be found in the LICENSE.txt file included with this distribution
 * or at https://spdx.org/licenses/BSD-2-Clause.html#licenseText
 *
 * ********************************************************************************************************* */

import * as THREE from "../../libs/three.js/build/three.module.js";
import PotreeConfig from "../../src/PotreeConfig.js";

export function mulberry32(seed) {
    let state = seed >>> 0;
    return function () {
        state |= 0;
        state = (state + 0x6D2B79F5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function gaussian(random) {
    let u = 0;
    let v = 0;
    while (u === 0) {
        u = random();
    }
    while (v === 0) {
        v = random();
    }
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

let fakeNodeCounter = 0;

class FakeGeometryNode {
    constructor(points, boundingBox, level, options) {
        this.id = `fake-${fakeNodeCounter++}`;
        this.name = this.id;
        this.level = level;
        this.boundingBox = boundingBox;
        this.boundingSphere = boundingBox.getBoundingSphere(new THREE.Sphere());
        this.spacing = options.rootSpacing / Math.pow(2, level);
        this.children = {};
        this.hiddenChildren = {};
        this.hasChildren = false;
        this.loaded = false;
        this.geometry = null;
        this.numPoints = points.length;
        this.loadInvocations = 0;
        this.ownPoints = points;
        this.loadMode = options.loadMode;
        this.loadDelayMs = options.loadDelayMs;
    }

    getLevel() {
        return this.level;
    }

    revealChildren() {
        this.children = this.hiddenChildren;
        this.hasChildren = Object.keys(this.children).length > 0;
    }

    buildGeometry() {
        const positions = new Float32Array(this.ownPoints.length * 3);
        const min = this.boundingBox.min;
        for (let i = 0; i < this.ownPoints.length; i++) {
            positions[i * 3] = this.ownPoints[i][0] - min.x;
            positions[i * 3 + 1] = this.ownPoints[i][1] - min.y;
            positions[i * 3 + 2] = this.ownPoints[i][2] - min.z;
        }
        return { attributes: { position: { array: positions } } };
    }

    load() {
        this.loadInvocations++;
        if (this.loaded) {
            return;
        }
        if (this.loadMode === "sync") {
            this.geometry = this.buildGeometry();
            this.revealChildren();
            this.loaded = true;
            return;
        }
        if (PotreeConfig.numNodesLoading >= PotreeConfig.maxNodesLoading) {
            return;
        }
        if (this.loadStarted) {
            return;
        }
        this.loadStarted = true;
        PotreeConfig.numNodesLoading++;
        setTimeout(() => {
            this.geometry = this.buildGeometry();
            this.revealChildren();
            this.loaded = true;
            this.loadStarted = false;
            PotreeConfig.numNodesLoading--;
        }, this.loadDelayMs);
    }

    dispose() {
        this.geometry = null;
        this.loaded = false;
    }
}

function buildNode(points, box, level, options, allNodes) {
    const own = [];
    const rest = [];
    if (points.length <= options.leafCapacity || level >= options.maxDepth) {
        own.push(...points);
    } else {
        for (let i = 0; i < points.length; i++) {
            if (i % options.subsampleEvery === 0) {
                own.push(points[i]);
            } else {
                rest.push(points[i]);
            }
        }
    }

    const node = new FakeGeometryNode(own, box, level, options);
    allNodes.push(node);

    if (rest.length > 0) {
        const center = box.getCenter(new THREE.Vector3());
        const buckets = new Array(8).fill(null).map(() => []);
        for (const p of rest) {
            const index = (p[0] >= center.x ? 1 : 0) + (p[1] >= center.y ? 2 : 0) + (p[2] >= center.z ? 4 : 0);
            buckets[index].push(p);
        }
        for (let i = 0; i < 8; i++) {
            if (buckets[i].length === 0) {
                continue;
            }
            const childMin = new THREE.Vector3(
                (i & 1) ? center.x : box.min.x,
                (i & 2) ? center.y : box.min.y,
                (i & 4) ? center.z : box.min.z
            );
            const childMax = new THREE.Vector3(
                (i & 1) ? box.max.x : center.x,
                (i & 2) ? box.max.y : center.y,
                (i & 4) ? box.max.z : center.z
            );
            const childBox = new THREE.Box3(childMin, childMax);
            node.hiddenChildren[i] = buildNode(buckets[i], childBox, level + 1, options, allNodes);
        }
    }
    return node;
}

export function makeTestCloud(options) {
    const {
        surfaceFn,
        bounds,
        density,
        seed = 1,
        noiseSigma = 0,
        outlierFraction = 0,
        outlierMaxDepth = 0.5,
        ghostPlane = null,
        dropoutRegions = [],
        leafCapacity = 2000,
        subsampleEvery = 8,
        maxDepth = 12,
        loadMode = "sync",
        loadDelayMs = 1,
        offset = { x: 0, y: 0, z: 0 }
    } = options;

    const random = mulberry32(seed);
    const width = bounds.maxX - bounds.minX;
    const height = bounds.maxY - bounds.minY;
    const count = Math.floor(density * width * height);

    const points = [];
    for (let i = 0; i < count; i++) {
        const x = bounds.minX + random() * width;
        const y = bounds.minY + random() * height;
        let dropped = false;
        for (const region of dropoutRegions) {
            if (x >= region.minX && x <= region.maxX && y >= region.minY && y <= region.maxY) {
                dropped = true;
                break;
            }
        }
        if (dropped) {
            continue;
        }
        let z = surfaceFn(x, y);
        if (noiseSigma > 0) {
            z += gaussian(random) * noiseSigma;
        }
        if (outlierFraction > 0 && random() < outlierFraction) {
            z -= random() * outlierMaxDepth;
        }
        if (ghostPlane !== null && random() < ghostPlane.fraction) {
            const region = ghostPlane.region;
            const inRegion = !region ||
                (x >= region.minX && x <= region.maxX && y >= region.minY && y <= region.maxY);
            if (inRegion) {
                z = surfaceFn(x, y) - ghostPlane.depth + gaussian(random) * 0.01;
            }
        }
        points.push([x, y, z]);
    }

    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const p of points) {
        minZ = Math.min(minZ, p[2]);
        maxZ = Math.max(maxZ, p[2]);
    }

    const rootBox = new THREE.Box3(
        new THREE.Vector3(bounds.minX, bounds.minY, minZ),
        new THREE.Vector3(bounds.maxX, bounds.maxY, maxZ + 0.01)
    );
    const rootSpacing = Math.max(width, height) / 8;

    const allNodes = [];
    const buildOptions = { leafCapacity, subsampleEvery, maxDepth, rootSpacing, loadMode, loadDelayMs };
    const root = buildNode(points, rootBox, 0, buildOptions, allNodes);

    const matrixWorld = new THREE.Matrix4().makeTranslation(offset.x, offset.y, offset.z);
    const pointcloud = {
        pcoGeometry: { root, spacing: rootSpacing },
        matrixWorld,
        position: new THREE.Vector3(offset.x, offset.y, offset.z),
        boundingBox: rootBox.clone(),
        visible: true
    };

    return { pointcloud, points, allNodes, zRange: { minZ, maxZ } };
}

export async function drainQuery(query, options = {}) {
    const maxIterations = options.maxIterations || 2000000;
    const onIteration = options.onIteration || null;
    for (let i = 0; i < maxIterations; i++) {
        const result = query.update();
        if (onIteration !== null) {
            onIteration(i, result);
        }
        if (result.done) {
            return;
        }
        if (result.waiting > 0 && !result.advanced) {
            await new Promise((resolve) => setTimeout(resolve, 1));
        }
    }
    throw new Error("drainQuery: query did not finish within iteration limit");
}
