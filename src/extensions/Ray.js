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

THREE.Ray.prototype.distanceToPlaneWithNegative = function (plane) {
    let denominator = plane.normal.dot(this.direction);
    if (denominator === 0) {
        // line is coplanar, return origin
        if (plane.distanceToPoint(this.origin) === 0) {
            return 0;
        }

        // Null is preferable to undefined since undefined means.... it is undefined
        return null;
    }
    let t = -(this.origin.dot(plane.normal) + plane.constant) / denominator;

    return t;
};
