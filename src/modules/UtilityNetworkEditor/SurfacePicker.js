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
        this.snapper = null;
        this.lastSnap = null;
    }

    setSnapper(snapper) {
        this.snapper = snapper;
    }

    pick(canvasPoint, referenceHeight = null, snapOptions = null) {
        this.lastSnap = null;
        if (snapOptions && this.snapper) {
            this.lastSnap = this.snapper.snap(canvasPoint, snapOptions);
            if (this.lastSnap) {
                return this.lastSnap.position.clone();
            }
        }
        const camera = this.viewer.scene.getActiveCamera();
        const intersection = Utils.getMousePointCloudIntersection(canvasPoint, camera, this.viewer, this.viewer.scene.pointclouds, { pickClipped: true });
        if (intersection && intersection.distance !== null) {
            return intersection.location.clone();
        }
        const height = referenceHeight ?? this.mapPlane.height;
        return this.mapPlane.intersectScreenPointAtHeight(canvasPoint.x, canvasPoint.y, height);
    }

    clearSnapIndicator() {
        this.lastSnap = null;
        this.snapper?.hideIndicator();
    }
}
