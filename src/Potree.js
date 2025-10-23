/*! ******************************************************************************************************** *
 *
 * Copyright 2011-2020 Markus Schütz
 * Copyright 2025 Oidis
 *
 * SPDX-License-Identifier: BSD-2-Clause
 * The BSD-2-Clause license for this file can be found in the LICENSE.txt file included with this distribution
 * or at https://spdx.org/licenses/BSD-2-Clause.html#licenseText
 *
 * ********************************************************************************************************* */

import PotreeConfig from "./PotreeConfig.js";

import { LRU } from "./LRU.js";
import { PointCloudOctree } from "./PointCloudOctree.js";
import * as TextSprite from "./TextSprite.js";
import * as utils from "./utils.js";
import { WorkerPool } from "./WorkerPool.js";
import { Viewer } from "./viewer/viewer.js";
import { OrbitControls } from "./navigation/OrbitControls.js";
import { FirstPersonControls } from "./navigation/FirstPersonControls.js";
import { EarthControls } from "./navigation/EarthControls.js";
import { DeviceOrientationControls } from "./navigation/DeviceOrientationControls.js";
import { VRControls } from "./navigation/VRControls.js";
import "./extensions/OrthographicCamera.js";
import "./extensions/PerspectiveCamera.js";
import "./extensions/Ray.js";
import { OctreeLoader } from "./modules/loader/2.0/OctreeLoader.js";
import { POCLoader } from "./loader/POCLoader.js";
import { CopcLoader, EptLoader } from "./loader/EptLoader.js";
import { PointShape, PointSizeType } from "./defines.js";
import PotreeRefs from "./PotreeRefs.js";
import { PointCloudArena4DGeometry } from "./arena4d/PointCloudArena4DGeometry.js";
import { PointCloudArena4D } from "./arena4d/PointCloudArena4D.js";
import { Fetcher } from "./utils/Fetcher.js";

const Potree = {
    OrbitControls,
    FirstPersonControls,
    EarthControls,
    DeviceOrientationControls,
    VRControls,
    PotreeConfig,
    PointCloudOctree,
    PointSizeType,
    PointShape,
    LRU,
    WorkerPool,
    utils,
    OctreeLoader,
    POCLoader,
    EptLoader,
    CopcLoader,
    TextSprite,
    Viewer,
    Fetcher,
    pointBudget: PotreeConfig.pointBudget,
    framenumber: PotreeConfig.framenumber,
    numNodesLoading: PotreeConfig.numNodesLoading,
    maxNodesLoading: PotreeConfig.maxNodesLoading,
    debug: {}
};

console.log("Potree " + PotreeConfig.version.major + "." + PotreeConfig.version.minor + PotreeConfig.version.suffix);

Object.defineProperty(Potree, "scriptPath", {
    get() {
        return PotreeConfig.scriptPath;
    },
    set(newPath) {
        PotreeConfig.scriptPath = newPath;
    },
    configurable: true,
    enumerable: true
});

Object.defineProperty(Potree, "resourcePath", {
    get() {
        return PotreeConfig.resourcePath;
    },
    set(newPath) {
        PotreeConfig.resourcePath = newPath;
    },
    configurable: true,
    enumerable: true
});

PotreeConfig.loadPointCloud = (path, name, callback) => {
    let loaded = function (e) {
        e.pointcloud.name = name;
        callback(e);
    };

    let promise = new Promise(resolve => {
        if (!path) {
            // TODO: callback? comment? Hello? Bueller? Anyone?
        } else if (path.includes("ept.json")) {
            EptLoader.load(path, function (geometry) {
                if (!geometry) {
                    console.error(new Error(`failed to load point cloud from URL: ${path}`));
                } else {
                    let pointcloud = new PointCloudOctree(geometry);
                    resolve({ type: "pointcloud_loaded", pointcloud: pointcloud });
                }
            });
        } else if (path.includes(".copc.laz")) {
            CopcLoader.load(path, function (geometry) {
                if (!geometry) {
                    console.error(new Error(`failed to load point cloud from URL: ${path}`));
                } else {
                    let pointcloud = new PointCloudOctree(geometry);
                    resolve({ type: "pointcloud_loaded", pointcloud: pointcloud });
                }
            });
        } else if (path.indexOf("cloud.js") > 0) {
            POCLoader.load(path, function (geometry) {
                if (!geometry) {
                    console.error(new Error(`failed to load point cloud from URL: ${path}`));
                } else {
                    let pointcloud = new PointCloudOctree(geometry);
                    resolve({ type: "pointcloud_loaded", pointcloud: pointcloud });
                }
            });
        } else if (path.indexOf("metadata.json") > 0) {
            OctreeLoader.load(path).then(e => {
                let geometry = e.geometry;

                if (!geometry) {
                    console.error(new Error(`failed to load point cloud from URL: ${path}`));
                } else {
                    let pointcloud = new PointCloudOctree(geometry);

                    let aPosition = pointcloud.getAttribute("position");

                    let material = pointcloud.material;
                    material.elevationRange = [
                        aPosition.range[0][2],
                        aPosition.range[1][2],
                    ];

                    resolve({ type: "pointcloud_loaded", pointcloud: pointcloud });
                }
            });

            OctreeLoader.load(path, function (geometry) {
                if (!geometry) {
                    console.error(new Error(`failed to load point cloud from URL: ${path}`));
                } else {
                    let pointcloud = new PointCloudOctree(geometry);
                    resolve({ type: "pointcloud_loaded", pointcloud: pointcloud });
                }
            });
        } else if (path.indexOf(".vpc") > 0) {
            PointCloudArena4DGeometry.load(path, function (geometry) {
                if (!geometry) {
                    console.error(new Error(`failed to load point cloud from URL: ${path}`));
                } else {
                    let pointcloud = new PointCloudArena4D(geometry);
                    resolve({ type: "pointcloud_loaded", pointcloud: pointcloud });
                }
            });
        } else {
            console.error(new Error(`failed to load point cloud from URL: ${path}`));
        }
    });

    if (callback) {
        promise.then(pointcloud => {
            loaded(pointcloud);
        });
    } else {
        return promise;
    }
};

// TODO(mkelnar) for plasio/laz and other not refactored refs
Potree.workerPool = PotreeRefs.workerPool;
Potree.loadPointCloud = PotreeConfig.loadPointCloud;

(function ($) {
    if (!$) {
        return;
    }
    $.fn.extend({
        selectgroup: function (args = {}) {
            // Original implementation preserved
            let elGroup = $(this);
            let rootID = elGroup.prop("id");
            let groupID = `${rootID}`;
            let groupTitle = (args.title !== undefined) ? args.title : "";

            let elButtons = [];
            elGroup.find("option").each((index, value) => {
                let buttonID = $(value).prop("id");
                let label = $(value).html();
                let optionValue = $(value).prop("value");

                let elButton = $(`
                    <span style="flex-grow: 1; display: inherit">
                    <label for="${buttonID}" class="ui-button" style="width: 100%; padding: .4em .1em">${label}</label>
                    <input type="radio" name="${groupID}" id="${buttonID}" value="${optionValue}" style="display: none"/>
                    </span>
                `);
                let elLabel = elButton.find("label");
                let elInput = elButton.find("input");

                elInput.change(() => {
                    elGroup.find("label").removeClass("ui-state-active");
                    elGroup.find("label").addClass("ui-state-default");
                    if (elInput.is(":checked")) {
                        elLabel.addClass("ui-state-active");
                    }
                });

                elButtons.push(elButton);
            });

            let elFieldset = $(`
                <fieldset style="border: none; margin: 0px; padding: 0px">
                    <legend>${groupTitle}</legend>
                    <span style="display: flex">

                    </span>
                </fieldset>
            `);

            let elButtonContainer = elFieldset.find("span");
            for (let elButton of elButtons) {
                elButtonContainer.append(elButton);
            }

            elButtonContainer.find("label").each((index, value) => {
                $(value).css("margin", "0px");
                $(value).css("border-radius", "0px");
                $(value).css("border", "1px solid black");
                $(value).css("border-left", "none");
            });
            elButtonContainer.find("label:first").each((index, value) => {
                $(value).css("border-radius", "4px 0px 0px 4px");
            });
            elButtonContainer.find("label:last").each((index, value) => {
                $(value).css("border-radius", "0px 4px 4px 0px");
                $(value).css("border-left", "none");
            });

            elGroup.empty();
            elGroup.append(elFieldset);
        }
    });
})(jQuery);

export default Potree;
