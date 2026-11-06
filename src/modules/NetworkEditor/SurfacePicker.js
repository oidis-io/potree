/*! ******************************************************************************************************** *
 *
 * Copyright 2026 Oidis
 *
 * SPDX-License-Identifier: BSD-2-Clause
 * The BSD-2-Clause license for this file can be found in the LICENSE.txt file included with this distribution
 * or at https://spdx.org/licenses/BSD-2-Clause.html#licenseText
 *
 * ********************************************************************************************************* */

import { Utils } from "../../utils.js";

export class SurfacePicker {
    constructor(viewer, mapPlane) {
        this.viewer = viewer;
        this.mapPlane = mapPlane;
        this.lastPickHeight = null;
    }

    pick(canvasPoint, referenceHeight = null) {
        const camera = this.viewer.scene.getActiveCamera();
        const intersection = Utils.getMousePointCloudIntersection(canvasPoint, camera, this.viewer, this.viewer.scene.pointclouds, { pickClipped: true });
        if (intersection && intersection.distance !== null) {
            this.lastPickHeight = intersection.location.z;
            return intersection.location.clone();
        }
        const height = referenceHeight ?? this.lastPickHeight ?? this.mapPlane.height;
        return this.mapPlane.intersectScreenPointAtHeight(canvasPoint.x, canvasPoint.y, height);
    }
}
