/*! ******************************************************************************************************** *
 *
 * Copyright 2025 Oidis
 *
 * SPDX-License-Identifier: BSD-2-Clause
 * The BSD-2-Clause license for this file can be found in the LICENSE.txt file included with this distribution
 * or at https://spdx.org/licenses/BSD-2-Clause.html#licenseText
 *
 * ********************************************************************************************************* */

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
    resourcePath: "",
    scriptPath: (() => {
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
        return path;
    })(),
    // TODO(mkelnar) create loader class for this method
    loadPointCloud: function (path, name, callback) {
        throw new Error(`Not implemented loadPointCloud`);
    }
};

PotreeConfig.resourcePath = PotreeConfig.scriptPath + "/resources";

export default PotreeConfig;
