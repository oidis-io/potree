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
import { PointQueryScheduler } from "../src/PointQueryScheduler.js";
import { PolygonPointQuery } from "../src/PolygonPointQuery.js";
import { makeTestCloud } from "./helpers/FakeCloud.mjs";

const polygon = [{ x: 2, y: 2 }, { x: 18, y: 2 }, { x: 18, y: 18 }, { x: 2, y: 18 }];
const cloudOptions = {
    surfaceFn: () => -2,
    bounds: { minX: 0, minY: 0, maxX: 20, maxY: 20 },
    density: 200,
    seed: 5
};

function promiseConsumer(target) {
    let resolveFinish;
    let rejectFinish;
    const finished = new Promise((resolve, reject) => {
        resolveFinish = resolve;
        rejectFinish = reject;
    });
    return {
        finished,
        onPoints(xs, ys, zs, count) {
            target.count += count;
        },
        onFinish() {
            resolveFinish();
        },
        onCancel() {
            rejectFinish(new Error("canceled"));
        },
        onError(error) {
            rejectFinish(error);
        }
    };
}

test("scheduler drains an async-loading query on its own timer and stops afterwards", async () => {
    const scheduler = new PointQueryScheduler({ budgetMs: 12, backoffMs: 5 });
    const cloud = makeTestCloud({ ...cloudOptions, loadMode: "async", loadDelayMs: 2 });
    const target = { count: 0 };
    const consumer = promiseConsumer(target);
    const query = new PolygonPointQuery(cloud.pointcloud, { polygon, zMin: -10, zMax: 10 }, consumer);

    scheduler.enqueue(query);
    await consumer.finished;

    assert.ok(target.count > 10000, `accepted ${target.count}`);
    assert.equal(scheduler.activeQueries.length, 0);
    assert.equal(scheduler.timer, null);
});

test("scheduler runs two queries concurrently and finishes both", async () => {
    const scheduler = new PointQueryScheduler({ budgetMs: 12, backoffMs: 5 });
    const cloudA = makeTestCloud({ ...cloudOptions, seed: 6 });
    const cloudB = makeTestCloud({ ...cloudOptions, seed: 7 });
    const targetA = { count: 0 };
    const targetB = { count: 0 };
    const consumerA = promiseConsumer(targetA);
    const consumerB = promiseConsumer(targetB);

    scheduler.enqueue(new PolygonPointQuery(cloudA.pointcloud, { polygon, zMin: -10, zMax: 10 }, consumerA));
    scheduler.enqueue(new PolygonPointQuery(cloudB.pointcloud, { polygon, zMin: -10, zMax: 10 }, consumerB));
    await Promise.all([consumerA.finished, consumerB.finished]);

    assert.ok(targetA.count > 0);
    assert.ok(targetB.count > 0);
    assert.equal(scheduler.activeQueries.length, 0);
});

test("scheduler cancel removes the query and fires onCancel", async () => {
    const scheduler = new PointQueryScheduler({ budgetMs: 12, backoffMs: 5 });
    const cloud = makeTestCloud({ ...cloudOptions, loadMode: "async", loadDelayMs: 5 });
    const target = { count: 0 };
    const consumer = promiseConsumer(target);
    const query = new PolygonPointQuery(cloud.pointcloud, { polygon, zMin: -10, zMax: 10 }, consumer);

    scheduler.enqueue(query);
    scheduler.cancel(query);

    await assert.rejects(consumer.finished, /canceled/);
    assert.equal(scheduler.activeQueries.length, 0);
});
