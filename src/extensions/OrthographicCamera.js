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

import * as THREE from "../../libs/three.js/build/three.module.js";

THREE.OrthographicCamera.prototype.zoomTo = function (node, factor = 1) {
    if (!node.geometry && !node.boundingBox) {
        return;
    }

    // TODO

    // let minWS = new THREE.Vector4(node.boundingBox.min.x, node.boundingBox.min.y, node.boundingBox.min.z, 1);
    // let minVS = minWS.applyMatrix4(this.matrixWorldInverse);

    // let right = node.boundingBox.max.x;
    // let bottom    = node.boundingBox.min.y;
    // let top = node.boundingBox.max.y;

    this.updateProjectionMatrix();
};
