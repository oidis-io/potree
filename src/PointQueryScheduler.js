/*! ******************************************************************************************************** *
 *
 * Copyright 2026 Oidis
 *
 * SPDX-License-Identifier: BSD-2-Clause
 * The BSD-2-Clause license for this file can be found in the LICENSE.txt file included with this distribution
 * or at https://spdx.org/licenses/BSD-2-Clause.html#licenseText
 *
 * ********************************************************************************************************* */

import PotreeConfig from "./PotreeConfig.js";
import PotreeRefs from "./PotreeRefs.js";

export class PointQueryScheduler {
    constructor(options = {}) {
        this.budgetMs = options.budgetMs || 12;
        this.backoffMs = options.backoffMs || 30;
        this.activeQueries = [];
        this.timer = null;
    }

    enqueue(query) {
        this.activeQueries.push(query);
        this.schedule(0);
    }

    cancel(query) {
        this.removeQuery(query);
        query.cancel();
    }

    removeQuery(query) {
        const index = this.activeQueries.indexOf(query);
        if (index >= 0) {
            this.activeQueries.splice(index, 1);
        }
        if (this.activeQueries.length === 0 && this.timer !== null) {
            clearTimeout(this.timer);
            this.timer = null;
        }
    }

    schedule(delay) {
        if (this.timer !== null) {
            clearTimeout(this.timer);
        }
        this.timer = setTimeout(() => {
            this.timer = null;
            this.tick();
        }, delay);
    }

    tick() {
        const start = performance.now();
        let sawProgress = false;
        let roundProgress = true;

        while (roundProgress && this.activeQueries.length > 0 && performance.now() - start < this.budgetMs) {
            roundProgress = false;
            for (const query of [...this.activeQueries]) {
                const result = query.update();
                if (result.done) {
                    this.removeQuery(query);
                    continue;
                }
                if (result.advanced) {
                    roundProgress = true;
                    sawProgress = true;
                }
                if (performance.now() - start >= this.budgetMs) {
                    break;
                }
            }
        }

        if (PotreeConfig.pointLoadLimit > 0) {
            PotreeRefs.lru.freeMemory();
        }

        if (this.activeQueries.length > 0) {
            this.schedule(sawProgress ? 0 : this.backoffMs);
        }
    }
}

export const pointQueryScheduler = new PointQueryScheduler();
