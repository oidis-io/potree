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

import * as THREE from "../libs/three.js/build/three.module.js";
import { EventDispatcher } from "./EventDispatcher.js";

export class PointCloudTreeNode extends EventDispatcher {
    constructor() {
        super();
        this.needsTransformUpdate = true;
    }

    getChildren() {
        throw new Error("override function");
    }

    getBoundingBox() {
        throw new Error("override function");
    }

    isLoaded() {
        throw new Error("override function");
    }

    isGeometryNode() {
        throw new Error("override function");
    }

    isTreeNode() {
        throw new Error("override function");
    }

    getLevel() {
        throw new Error("override function");
    }

    getBoundingSphere() {
        throw new Error("override function");
    }
}

export class PointCloudTree extends THREE.Object3D {
    constructor() {
        super();
    }

    initialized() {
        return this.root !== null;
    }
}
