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

export class CadDocument extends EventDispatcher {
    constructor() {
        super();
        this.features = [];
        this.layers = [];
        this.activeLayerId = null;
        this.layerCounter = 0;
    }

    addLayer(name) {
        this.layerCounter++;
        const layer = { id: `layer-${this.layerCounter}`, name: name, visible: true };
        this.layers.push(layer);
        this.activeLayerId = layer.id;
        this.dispatchEvent({ type: "layers_changed" });
        return layer;
    }

    findLayer(layerId) {
        return this.layers.find((layer) => layer.id === layerId) ?? null;
    }

    setActiveLayer(layerId) {
        if (this.findLayer(layerId) && this.activeLayerId !== layerId) {
            this.activeLayerId = layerId;
            this.dispatchEvent({ type: "layers_changed" });
        }
    }

    setLayerVisible(layerId, visible) {
        const layer = this.findLayer(layerId);
        if (!layer || layer.visible === visible) {
            return;
        }
        layer.visible = visible;
        for (const feature of this.features) {
            if (feature.layerId === layerId) {
                feature.visible = visible;
            }
        }
        this.dispatchEvent({ type: "layers_changed" });
    }

    addFeature(feature) {
        feature.layerId = feature.layerId ?? this.activeLayerId;
        this.setLayerVisible(feature.layerId, true);
        this.features.push(feature);
        this.dispatchEvent({ type: "feature_added", feature: feature });
    }

    removeFeature(feature) {
        const index = this.features.indexOf(feature);
        if (index < 0) {
            return;
        }
        this.features.splice(index, 1);
        this.dispatchEvent({ type: "feature_removed", feature: feature });
    }
}
