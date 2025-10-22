/*! ******************************************************************************************************** *
 *
 * Copyright 2025 Oidis
 *
 * SPDX-License-Identifier: BSD-2-Clause
 * The BSD-2-Clause license for this file can be found in the LICENSE.txt file included with this distribution
 * or at https://spdx.org/licenses/BSD-2-Clause.html#licenseText
 *
 * ********************************************************************************************************* */

import { Version } from "./Version.js";

let _scriptPath = "";
let _resourcePath = "";

const PotreeConfig = {
    version: {
        major: 2025,
        minor: 3,
        suffix: ".0"
    },
    measureTimings: false,
    debug: {},
    pointBudget: 1000 * 1000,
    framenumber: 0,
    numNodesLoading: 0,
    maxNodesLoading: 4,
    pointLoadLimit: 0,
    // TODO(mkelnar) create loader class for this method
    loadPointCloud: function (path, name, callback) {
        throw new Error(`Not implemented loadPointCloud`);
    },
    Version
};

Object.defineProperty(PotreeConfig, "scriptPath", {
    get() {
        return _scriptPath;
    },
    set(newPath) {
        _scriptPath = newPath.replace(/\/$/, "");
    },
    configurable: true,
    enumerable: true
});

Object.defineProperty(PotreeConfig, "resourcePath", {
    get() {
        return _resourcePath;
    },
    set(newPath) {
        _resourcePath = newPath.replace(/\/$/, "");
    },
    configurable: true,
    enumerable: true
});

let path = "";
if (document.currentScript && document.currentScript.src) {
    path = new URL(document.currentScript.src + "/..").href;
    if (path.slice(-1) === "/") {
        path = path.slice(0, -1);
    }
} else if (import.meta) {
    path = new URL(import.meta.url + "/..").href;
    if (path.slice(-1) === "/") {
        path = path.slice(0, -1);
    }
} else {
    console.error("Potree was unable to find its script path using document.currentScript. Is Potree included with a script tag? Does your browser support this function?");
}

PotreeConfig.scriptPath = path;
PotreeConfig.resourcePath = path + "/resources";

export default PotreeConfig;
