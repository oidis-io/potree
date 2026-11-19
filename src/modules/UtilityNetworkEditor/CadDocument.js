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
import { CadFeature } from "./CadFeature.js";

export class CadDocument extends EventDispatcher {
    constructor() {
        super();
        this.features = [];
        this.layers = [];
        this.activeLayerId = null;
        this.layerCounter = 0;
        this.isBulkUpdating = false;
        this.isLayerRemovedWhenEmpty = () => false;
    }

    setEmptyLayerRemovalRule(rule) {
        this.isLayerRemovedWhenEmpty = rule;
    }

    runBulkUpdate(action) {
        const wasBulkUpdating = this.isBulkUpdating;
        this.isBulkUpdating = true;
        try {
            return action();
        } finally {
            this.isBulkUpdating = wasBulkUpdating;
        }
    }

    addLayer(name) {
        let layerId;
        do {
            this.layerCounter++;
            layerId = `layer-${this.layerCounter}`;
        } while (this.findLayer(layerId));
        const layer = { id: layerId, name: name, visible: true };
        this.layers.push(layer);
        this.activeLayerId = layer.id;
        this.dispatchEvent({ type: "layers_changed" });
        this.dispatchEvent({ type: "layer_added", layer: layer });
        return layer;
    }

    findLayer(layerId) {
        return this.layers.find((layer) => layer.id === layerId) ?? null;
    }

    countLayerFeatures(layerId) {
        return this.features.filter((feature) => feature.layerId === layerId).length;
    }

    removeLayer(layerId) {
        const layer = this.findLayer(layerId);
        if (!layer || this.layers.length <= 1) {
            return false;
        }
        this.runBulkUpdate(() => {
            for (const feature of this.features.filter((candidate) => candidate.layerId === layerId)) {
                this.removeFeature(feature);
                feature.dispose();
            }
        });
        this.detachLayer(layer);
        return true;
    }

    removeLayerIfEmpty(layerId) {
        const layer = this.findLayer(layerId);
        if (this.isBulkUpdating || !layer || this.layers.length <= 1 || !this.isLayerRemovedWhenEmpty(layer) || this.countLayerFeatures(layerId) > 0) {
            return;
        }
        this.detachLayer(layer);
    }

    detachLayer(layer) {
        this.layers = this.layers.filter((candidate) => candidate !== layer);
        if (this.activeLayerId === layer.id) {
            this.activeLayerId = this.layers[0].id;
        }
        this.dispatchEvent({ type: "layers_changed" });
        this.dispatchEvent({ type: "layer_removed", layer: layer });
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

    moveFeatureToLayer(feature, layerId) {
        if (!this.findLayer(layerId) || feature.layerId === layerId) {
            return;
        }
        const previousLayerId = feature.layerId;
        feature.layerId = layerId;
        this.setLayerVisible(layerId, true);
        feature.visible = true;
        this.removeLayerIfEmpty(previousLayerId);
        this.dispatchEvent({ type: "feature_layer_changed", feature: feature });
    }

    removeFeature(feature) {
        const index = this.features.indexOf(feature);
        if (index < 0) {
            return;
        }
        this.features.splice(index, 1);
        this.removeLayerIfEmpty(feature.layerId);
        this.dispatchEvent({ type: "feature_removed", feature: feature });
    }

    toData() {
        return this.features.map((feature) => feature.toData());
    }

    toState() {
        return { layers: this.layers.map((layer) => ({ id: layer.id, name: layer.name })), features: this.toData() };
    }

    restoreState(state) {
        const previousLayers = this.layers;
        const visibilityByLayer = new Map(previousLayers.map((layer) => [layer.id, layer.visible]));
        this.layers = state.layers.map((layer) => ({ id: layer.id, name: layer.name, visible: visibilityByLayer.get(layer.id) ?? true }));
        if (!this.findLayer(this.activeLayerId)) {
            this.activeLayerId = this.layers[0]?.id ?? null;
        }
        this.loadData(state.features);
        this.dispatchEvent({ type: "layers_changed" });
        for (const layer of previousLayers.filter((previousLayer) => !this.findLayer(previousLayer.id))) {
            this.dispatchEvent({ type: "layer_removed", layer: layer });
        }
        for (const layer of this.layers.filter((restoredLayer) => !visibilityByLayer.has(restoredLayer.id))) {
            this.dispatchEvent({ type: "layer_added", layer: layer });
        }
    }

    replaceContent(content) {
        this.layers = content.layers.map((layer) => ({ id: layer.id, name: layer.name, visible: layer.visible }));
        this.activeLayerId = content.activeLayerId;
        this.loadData(content.features);
        this.dispatchEvent({ type: "layers_changed" });
    }

    loadData(featureData) {
        this.runBulkUpdate(() => {
            for (const feature of [...this.features]) {
                this.removeFeature(feature);
                feature.dispose();
            }
            for (const data of featureData) {
                const feature = CadFeature.fromData(data);
                feature.visible = this.findLayer(feature.layerId)?.visible !== false;
                this.features.push(feature);
                this.dispatchEvent({ type: "feature_added", feature: feature });
            }
        });
    }
}
