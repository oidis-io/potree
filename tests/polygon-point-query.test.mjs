/*! ******************************************************************************************************** *
 *
 * Copyright 2026 Oidis
 *
 * SPDX-License-Identifier: BSD-2-Clause
 * The BSD-2-Clause license for this file can be found in the LICENSE.txt file included with this distribution
 * or at https://spdx.org/licenses/BSD-2-Clause.html#licenseText
 *
 * ********************************************************************************************************* */

import assert from "node:assert/strict";
import { test } from "node:test";
import { PolygonPointQuery } from "../src/PolygonPointQuery.js";
import { pointInPolygon, polygonBounds } from "../src/utils/PolygonMath.js";
import { drainQuery, makeTestCloud } from "./helpers/FakeCloud.mjs";

const polygon = [{ x: 2, y: 2 }, { x: 18, y: 2 }, { x: 18, y: 18 }, { x: 2, y: 18 }];
const cloudOptions = {
    surfaceFn: (x, y) => -2 + 0.01 * x + 0.02 * y,
    bounds: { minX: 0, minY: 0, maxX: 20, maxY: 20 },
    density: 400,
    seed: 42
};

function collectingConsumer() {
    const collected = { xs: [], ys: [], zs: [], finished: false, canceled: false, progressEvents: 0 };
    return {
        collected,
        onPoints(xs, ys, zs, count) {
            for (let i = 0; i < count; i++) {
                collected.xs.push(xs[i]);
                collected.ys.push(ys[i]);
                collected.zs.push(zs[i]);
            }
        },
        onProgress() {
            collected.progressEvents++;
        },
        onFinish() {
            collected.finished = true;
        },
        onCancel() {
            collected.canceled = true;
        },
        onError(error) {
            throw error;
        }
    };
}

function queryOptions(extra = {}) {
    return { polygon, zMin: -10, zMax: 10, ...extra };
}

function referenceCount(points, bounds) {
    let count = 0;
    for (const p of points) {
        if (p[0] >= bounds.minX && p[0] <= bounds.maxX && p[1] >= bounds.minY && p[1] <= bounds.maxY) {
            count++;
        }
    }
    return count;
}

test("query finds exactly the points inside the acceptance rect, each once", async () => {
    const cloud = makeTestCloud(cloudOptions);
    const consumer = collectingConsumer();
    const query = new PolygonPointQuery(cloud.pointcloud, queryOptions(), consumer);
    await drainQuery(query);

    assert.equal(consumer.collected.finished, true);
    const expected = referenceCount(cloud.points, polygonBounds(polygon));
    assert.equal(consumer.collected.xs.length, expected);
    assert.ok(expected > 50000, `scene too small for a meaningful test: ${expected}`);
});

test("query is deterministic across two runs", async () => {
    const first = makeTestCloud(cloudOptions);
    const second = makeTestCloud(cloudOptions);

    const consumerA = collectingConsumer();
    const consumerB = collectingConsumer();
    await drainQuery(new PolygonPointQuery(first.pointcloud, queryOptions(), consumerA));
    await drainQuery(new PolygonPointQuery(second.pointcloud, queryOptions(), consumerB));

    assert.equal(consumerA.collected.xs.length, consumerB.collected.xs.length);
    let checksumA = 0;
    let checksumB = 0;
    for (let i = 0; i < consumerA.collected.zs.length; i++) {
        checksumA += consumerA.collected.zs[i];
        checksumB += consumerB.collected.zs[i];
    }
    assert.equal(checksumA, checksumB);
});

test("query respects pointcloud world offset", async () => {
    const shifted = makeTestCloud({ ...cloudOptions, offset: { x: 100, y: 200, z: 10 } });
    const shiftedPolygon = polygon.map((p) => ({ x: p.x + 100, y: p.y + 200 }));
    const consumer = collectingConsumer();
    const query = new PolygonPointQuery(
        shifted.pointcloud,
        { polygon: shiftedPolygon, zMin: 0, zMax: 20 },
        consumer
    );
    await drainQuery(query);
    const expected = referenceCount(shifted.points, polygonBounds(polygon));
    assert.equal(consumer.collected.xs.length, expected);
    assert.ok(consumer.collected.zs.every((z) => z > 5 && z < 11));
});

test("query survives async loads with loader throttle", async () => {
    const cloud = makeTestCloud({ ...cloudOptions, loadMode: "async", loadDelayMs: 1 });
    const consumer = collectingConsumer();
    const query = new PolygonPointQuery(cloud.pointcloud, queryOptions(), consumer);
    let sawWaiting = false;
    await drainQuery(query, {
        onIteration: (i, result) => {
            if (result.waiting > 0) {
                sawWaiting = true;
            }
        }
    });
    assert.equal(consumer.collected.finished, true);
    assert.equal(sawWaiting, true);
    const expected = referenceCount(cloud.points, polygonBounds(polygon));
    assert.equal(consumer.collected.xs.length, expected);
});

test("query result is unchanged when processed nodes are evicted mid-run", async () => {
    const reference = makeTestCloud(cloudOptions);
    const referenceConsumer = collectingConsumer();
    await drainQuery(new PolygonPointQuery(reference.pointcloud, queryOptions(), referenceConsumer));

    const evicted = makeTestCloud(cloudOptions);
    const evictedConsumer = collectingConsumer();
    const query = new PolygonPointQuery(evicted.pointcloud, queryOptions(), evictedConsumer);
    await drainQuery(query, {
        onIteration: (i) => {
            if (i === 40 || i === 90) {
                let parity = 0;
                for (const node of evicted.allNodes) {
                    if (node.loaded) {
                        parity++;
                        if (parity % 2 === 0) {
                            node.dispose();
                        }
                    }
                }
            }
        }
    });
    assert.equal(evictedConsumer.collected.xs.length, referenceConsumer.collected.xs.length);
});

test("spacing cutoff skips fine levels deterministically", async () => {
    const cloud = makeTestCloud({ ...cloudOptions, density: 800 });
    const cutoff = cloud.pointcloud.pcoGeometry.spacing / 4;
    const consumer = collectingConsumer();
    const query = new PolygonPointQuery(cloud.pointcloud, queryOptions({ spacingCutoff: cutoff }), consumer);
    await drainQuery(query);

    const full = collectingConsumer();
    const fullCloud = makeTestCloud({ ...cloudOptions, density: 800 });
    await drainQuery(new PolygonPointQuery(fullCloud.pointcloud, queryOptions(), full));

    assert.ok(consumer.collected.xs.length > 0);
    assert.ok(consumer.collected.xs.length < full.collected.xs.length);

    const repeatCloud = makeTestCloud({ ...cloudOptions, density: 800 });
    const repeat = collectingConsumer();
    await drainQuery(new PolygonPointQuery(repeatCloud.pointcloud, queryOptions({ spacingCutoff: cutoff }), repeat));
    assert.equal(consumer.collected.xs.length, repeat.collected.xs.length);
});

test("cancel stops the query and fires onCancel", async () => {
    const cloud = makeTestCloud(cloudOptions);
    const consumer = collectingConsumer();
    const query = new PolygonPointQuery(cloud.pointcloud, queryOptions(), consumer);
    query.update();
    query.cancel();
    assert.equal(consumer.collected.canceled, true);
    const afterCancel = query.update();
    assert.equal(afterCancel.done, true);
    assert.equal(consumer.collected.finished, false);
});

test("consumer rect filtering matches pointInPolygon expectations for interior points", async () => {
    const cloud = makeTestCloud(cloudOptions);
    const consumer = collectingConsumer();
    const query = new PolygonPointQuery(cloud.pointcloud, queryOptions(), consumer);
    await drainQuery(query);
    const c = consumer.collected;
    for (let i = 0; i < c.xs.length; i += 997) {
        assert.equal(pointInPolygon(c.xs[i], c.ys[i], polygon), true);
    }
});
