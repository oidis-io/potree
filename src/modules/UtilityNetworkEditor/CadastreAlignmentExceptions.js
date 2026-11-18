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

export class CadastreAlignmentExceptions extends EventDispatcher {
    constructor() {
        super();
        this.exceptions = new Map();
    }

    get size() {
        return this.exceptions.size;
    }

    get(buildingIdentifier) {
        return this.exceptions.get(String(buildingIdentifier)) ?? null;
    }

    has(buildingIdentifier) {
        return this.exceptions.has(String(buildingIdentifier));
    }

    list() {
        return [...this.exceptions.values()];
    }

    add(buildingIdentifier, label, transform = null) {
        this.exceptions.set(String(buildingIdentifier), { buildingIdentifier: buildingIdentifier, label: label, transform: transform });
        this.dispatchEvent({ type: "changed" });
    }

    remove(buildingIdentifier) {
        if (this.exceptions.delete(String(buildingIdentifier))) {
            this.dispatchEvent({ type: "changed" });
        }
    }

    replace(exceptions) {
        this.exceptions = new Map(exceptions.map((exception) => [String(exception.buildingIdentifier), { ...exception }]));
        this.dispatchEvent({ type: "changed" });
    }

    toData() {
        return this.list().map((exception) => ({ ...exception }));
    }
}
