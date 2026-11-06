/*! ******************************************************************************************************** *
 *
 * Copyright 2026 Oidis
 *
 * SPDX-License-Identifier: BSD-2-Clause
 * The BSD-2-Clause license for this file can be found in the LICENSE.txt file included with this distribution
 * or at https://spdx.org/licenses/BSD-2-Clause.html#licenseText
 *
 * ********************************************************************************************************* */

import { Profile } from "../../utils/Profile.js";
import { CadFeatureType } from "./CadFeature.js";

const PROFILE_WIDTH_METRES = 1;

export class FeatureProfile {
    constructor(viewer) {
        this.viewer = viewer;
        this.profile = null;
    }

    canShow(feature) {
        return Boolean(feature) && feature.featureType !== CadFeatureType.POINT && feature.points.length >= 2;
    }

    show(feature) {
        if (!this.canShow(feature)) {
            return;
        }
        this.clear();
        const points = feature.featureType === CadFeatureType.POLYGON ? [...feature.points, feature.points[0]] : feature.points;
        const profile = new Profile();
        profile.name = feature.label !== "" ? feature.label : profile.name;
        for (const point of points) {
            profile.addMarker(point.clone());
        }
        profile.setWidth(PROFILE_WIDTH_METRES);
        this.viewer.scene.addProfile(profile);
        this.viewer.profileWindow.show();
        this.viewer.profileWindowController.setProfile(profile);
        this.profile = profile;
    }

    clear() {
        if (this.profile) {
            this.viewer.scene.removeProfile(this.profile);
            this.profile = null;
        }
    }
}
