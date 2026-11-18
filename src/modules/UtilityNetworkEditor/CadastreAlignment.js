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
import { measurePointToRingsDistance, prepareGeometry, transformRing } from "./BuildingFitting.js";
import { BuildingMatchStatus, matchBuildings, summarizeMatches } from "./BuildingMatcher.js";
import { CadastreOverlayLayer } from "./CadastreOverlay.js";
import { CadastreLayer } from "./CadastreService.js";
import { extractSurfaceBuildings } from "./SurfaceBuildingExtractor.js";
import { fetchSurfaceRaster } from "./SurfaceModelService.js";

export const AlignmentDisplayMode = Object.freeze({
    ORIGINAL: "original",
    ALIGNED: "aligned",
    BOTH: "both"
});

export const AlignmentReference = Object.freeze({
    MAP: "map",
    SURFACE: "surface"
});

export const AlignmentPhase = Object.freeze({
    ORIGINAL_SHOWN: "original_shown",
    BUILDINGS_HIDDEN: "buildings_hidden",
    LOADING_BUILDINGS: "loading_buildings",
    BUILDINGS_FAILED: "buildings_failed",
    LOADING_REFERENCE: "loading_reference",
    LOADING_SURFACE: "loading_surface",
    NO_BUILDINGS: "no_buildings",
    NO_REFERENCE: "no_reference",
    NO_SURFACE_BUILDINGS: "no_surface_buildings",
    REFERENCE_FAILED: "reference_failed",
    SURFACE_FAILED: "surface_failed",
    READY: "ready"
});

export const AlignmentEntryState = Object.freeze({
    MOVED: "moved",
    KEPT: "kept",
    MANUAL: "manual"
});

const MINIMUM_ARROW_METRES = 0.05;
const ARROW_HEAD_SHARE = 0.3;
const MAXIMUM_ARROW_HEAD_METRES = 1.5;
const ARROW_HEAD_ANGLE = Math.PI / 7;
const MAXIMUM_PICK_DISTANCE_METRES = 1.5;
const SURFACE_MARGIN_METRES = 20;
const SURFACE_MINIMUM_SHIFT_METRES = 1.5;
const PHASES_WITH_BUILDINGS = [
    AlignmentPhase.LOADING_REFERENCE,
    AlignmentPhase.LOADING_SURFACE,
    AlignmentPhase.NO_REFERENCE,
    AlignmentPhase.NO_SURFACE_BUILDINGS,
    AlignmentPhase.REFERENCE_FAILED,
    AlignmentPhase.SURFACE_FAILED,
    AlignmentPhase.READY
];

function isSameExtent(first, second) {
    return first !== null && second !== null
        && first.minimumX === second.minimumX
        && first.minimumY === second.minimumY
        && first.maximumX === second.maximumX
        && first.maximumY === second.maximumY;
}

function expandExtent(extent, margin) {
    return {
        minimumX: extent.minimumX - margin,
        minimumY: extent.minimumY - margin,
        maximumX: extent.maximumX + margin,
        maximumY: extent.maximumY + margin
    };
}

function createMovedFeature(entry) {
    return { identifier: entry.identifier, lines: entry.building.lines.map((line) => transformRing(line, entry.transform)) };
}

function createArrowFeature(entry) {
    const { centerX, centerY, shiftX, shiftY } = entry.transform;
    if (entry.shiftLength < MINIMUM_ARROW_METRES) {
        return { identifier: entry.identifier, lines: [] };
    }
    const endX = centerX + shiftX;
    const endY = centerY + shiftY;
    const direction = Math.atan2(shiftY, shiftX);
    const headLength = Math.min(MAXIMUM_ARROW_HEAD_METRES, entry.shiftLength * ARROW_HEAD_SHARE);
    const createHeadPoint = (angle) => [endX - headLength * Math.cos(direction + angle), endY - headLength * Math.sin(direction + angle)];
    return {
        identifier: entry.identifier,
        lines: [[[centerX, centerY], [endX, endY]], [createHeadPoint(-ARROW_HEAD_ANGLE), [endX, endY], createHeadPoint(ARROW_HEAD_ANGLE)]]
    };
}

function createAutomaticEntry(result, building, exception) {
    return {
        identifier: result.identifier,
        label: result.label,
        state: exception ? AlignmentEntryState.KEPT : AlignmentEntryState.MOVED,
        isEstimate: result.status === BuildingMatchStatus.INTERPOLATED,
        blockSize: result.blockSize,
        neighbourCount: result.neighbourCount,
        transform: result.transform,
        shiftLength: result.shiftLength,
        originalOverlap: result.originalOverlap,
        fittedOverlap: result.fittedOverlap,
        building: building
    };
}

function createManualEntry(exception, building) {
    return {
        identifier: exception.buildingIdentifier,
        label: exception.label,
        state: AlignmentEntryState.MANUAL,
        isEstimate: false,
        blockSize: 1,
        neighbourCount: 0,
        transform: exception.transform,
        shiftLength: Math.hypot(exception.transform.shiftX, exception.transform.shiftY),
        originalOverlap: null,
        fittedOverlap: null,
        building: building
    };
}

function createIdentityTransform(feature) {
    const centroid = prepareGeometry(feature.outerRings)?.centroid ?? { x: feature.outerRings[0][0][0], y: feature.outerRings[0][0][1] };
    return { centerX: centroid.x, centerY: centroid.y, shiftX: 0, shiftY: 0, rotationDegrees: 0 };
}

export class CadastreAlignment extends EventDispatcher {
    constructor(cadastreOverlay, alignmentExceptions) {
        super();
        this.cadastreOverlay = cadastreOverlay;
        this.alignmentExceptions = alignmentExceptions;
        this.displayMode = AlignmentDisplayMode.ORIGINAL;
        this.reference = AlignmentReference.MAP;
        this.isInterpolationEnabled = true;
        this.surfaceBuildings = [];
        this.surfaceExtent = null;
        this.surfaceRequestExtent = null;
        this.isSurfaceFailed = false;
        this.renderedSurfaceBuildings = null;
        this.phase = AlignmentPhase.ORIGINAL_SHOWN;
        this.matchResults = [];
        this.matchSummary = null;
        this.isMatchCurrent = false;
        this.buildingsExtent = null;
        this.isBuildingsFailed = false;
        this.referenceExtent = null;
        this.referenceRequestExtent = null;
        this.isReferenceFailed = false;
        this.shiftLabelFormatter = (entry) => `${entry.shiftLength.toFixed(1)} m`;

        cadastreOverlay.addEventListener("layer_loading", (event) => {
            if (event.layerId === CadastreLayer.BUILDINGS) {
                this.isBuildingsFailed = false;
                this.update();
            }
        });
        cadastreOverlay.addEventListener("layer_loaded", (event) => this.onLayerLoaded(event));
        cadastreOverlay.addEventListener("layer_failed", (event) => this.onLayerFailed(event));
        cadastreOverlay.addEventListener("layer_visibility_changed", (event) => {
            if (event.layerId === CadastreLayer.BUILDINGS) {
                this.update();
            }
        });
        alignmentExceptions.addEventListener("changed", () => this.render());
    }

    setShiftLabelFormatter(formatter) {
        this.shiftLabelFormatter = formatter;
        this.render();
    }

    setDisplayMode(displayMode) {
        this.displayMode = displayMode;
        this.update();
    }

    setInterpolationEnabled(isEnabled) {
        this.isInterpolationEnabled = isEnabled;
        this.isMatchCurrent = false;
        this.update();
    }

    setReference(reference) {
        this.reference = reference;
        this.isSurfaceFailed = false;
        this.isMatchCurrent = false;
        this.update();
    }

    keepOriginalPosition(identifier, label) {
        this.alignmentExceptions.add(identifier, label);
    }

    setManualTransform(identifier, label, transform) {
        this.alignmentExceptions.add(identifier, label, transform);
    }

    alignAgain(identifier) {
        this.alignmentExceptions.remove(identifier);
    }

    onLayerLoaded(event) {
        if (event.layerId === CadastreLayer.BUILDINGS) {
            this.buildingsExtent = event.extent;
            this.isReferenceFailed = false;
            this.isSurfaceFailed = false;
            this.isMatchCurrent = false;
            this.update();
        } else if (event.layerId === CadastreLayer.REFERENCE_BUILDINGS) {
            this.referenceExtent = event.extent;
            this.referenceRequestExtent = null;
            this.isMatchCurrent = false;
            this.update();
        }
    }

    onLayerFailed(event) {
        if (event.layerId === CadastreLayer.BUILDINGS) {
            this.isBuildingsFailed = true;
            this.update();
        } else if (event.layerId === CadastreLayer.REFERENCE_BUILDINGS && this.referenceRequestExtent !== null) {
            this.referenceRequestExtent = null;
            this.isReferenceFailed = true;
            this.update();
        }
    }

    update() {
        this.phase = this.preparePhase();
        this.render();
    }

    preparePhase() {
        if (this.displayMode === AlignmentDisplayMode.ORIGINAL) {
            return AlignmentPhase.ORIGINAL_SHOWN;
        }
        if (!this.cadastreOverlay.isLayerVisible(CadastreLayer.BUILDINGS)) {
            return AlignmentPhase.BUILDINGS_HIDDEN;
        }
        if (this.isBuildingsFailed) {
            return AlignmentPhase.BUILDINGS_FAILED;
        }
        if (this.buildingsExtent === null) {
            return AlignmentPhase.LOADING_BUILDINGS;
        }
        if (this.cadastreOverlay.getLayerFeatures(CadastreLayer.BUILDINGS).length === 0) {
            return AlignmentPhase.NO_BUILDINGS;
        }
        const referencePhase = this.reference === AlignmentReference.SURFACE ? this.prepareSurfacePhase() : this.prepareMapPhase();
        if (referencePhase !== null) {
            return referencePhase;
        }
        if (!this.isMatchCurrent) {
            this.matchResults = matchBuildings(
                this.cadastreOverlay.getLayerFeatures(CadastreLayer.BUILDINGS),
                this.getReferenceBuildings(),
                {
                    interpolate: this.isInterpolationEnabled,
                    minimumShiftMetres: this.reference === AlignmentReference.SURFACE ? SURFACE_MINIMUM_SHIFT_METRES : 0
                }
            );
            this.matchSummary = summarizeMatches(this.matchResults);
            this.isMatchCurrent = true;
        }
        return AlignmentPhase.READY;
    }

    prepareMapPhase() {
        if (!isSameExtent(this.referenceExtent, this.buildingsExtent)) {
            if (this.isReferenceFailed) {
                return AlignmentPhase.REFERENCE_FAILED;
            }
            this.requestReference();
            return AlignmentPhase.LOADING_REFERENCE;
        }
        return this.cadastreOverlay.getLayerFeatures(CadastreLayer.REFERENCE_BUILDINGS).length === 0 ? AlignmentPhase.NO_REFERENCE : null;
    }

    prepareSurfacePhase() {
        if (!isSameExtent(this.surfaceExtent, this.buildingsExtent)) {
            if (this.isSurfaceFailed) {
                return AlignmentPhase.SURFACE_FAILED;
            }
            this.requestSurface();
            return AlignmentPhase.LOADING_SURFACE;
        }
        return this.surfaceBuildings.length === 0 ? AlignmentPhase.NO_SURFACE_BUILDINGS : null;
    }

    getReferenceBuildings() {
        return this.reference === AlignmentReference.SURFACE ? this.surfaceBuildings : this.cadastreOverlay.getLayerFeatures(CadastreLayer.REFERENCE_BUILDINGS);
    }

    async requestSurface() {
        if (isSameExtent(this.surfaceRequestExtent, this.buildingsExtent)) {
            return;
        }
        const extent = this.buildingsExtent;
        this.surfaceRequestExtent = extent;
        let buildings = null;
        try {
            buildings = extractSurfaceBuildings(await fetchSurfaceRaster(expandExtent(extent, SURFACE_MARGIN_METRES)));
        } catch {
            buildings = null;
        }
        if (this.surfaceRequestExtent !== extent) {
            return;
        }
        this.surfaceRequestExtent = null;
        if (buildings) {
            this.surfaceBuildings = buildings;
            this.surfaceExtent = extent;
        } else {
            this.isSurfaceFailed = true;
        }
        this.isMatchCurrent = false;
        this.update();
    }

    requestReference() {
        if (isSameExtent(this.referenceRequestExtent, this.buildingsExtent)) {
            return;
        }
        this.referenceRequestExtent = this.buildingsExtent;
        this.cadastreOverlay.loadLayer(CadastreLayer.REFERENCE_BUILDINGS, this.buildingsExtent);
    }

    listEntries() {
        if (!PHASES_WITH_BUILDINGS.includes(this.phase)) {
            return [];
        }
        const buildings = new Map(this.cadastreOverlay.getLayerFeatures(CadastreLayer.BUILDINGS).map((feature) => [String(feature.identifier), feature]));
        const entries = new Map();
        if (this.phase === AlignmentPhase.READY) {
            const movedStatuses = [BuildingMatchStatus.SHIFTED, BuildingMatchStatus.INTERPOLATED];
            for (const result of this.matchResults.filter((item) => movedStatuses.includes(item.status) && buildings.has(String(item.identifier)))) {
                entries.set(String(result.identifier), createAutomaticEntry(result, buildings.get(String(result.identifier)), this.alignmentExceptions.get(result.identifier)));
            }
        }
        for (const exception of this.alignmentExceptions.list()) {
            if (exception.transform && buildings.has(String(exception.buildingIdentifier))) {
                entries.set(String(exception.buildingIdentifier), createManualEntry(exception, buildings.get(String(exception.buildingIdentifier))));
            }
        }
        return [...entries.values()].sort((first, second) => second.shiftLength - first.shiftLength);
    }

    isAlignmentShown() {
        return this.displayMode !== AlignmentDisplayMode.ORIGINAL
            && this.cadastreOverlay.isLayerVisible(CadastreLayer.BUILDINGS)
            && this.listEntries().some((entry) => entry.state !== AlignmentEntryState.KEPT);
    }

    findDisplayedBuildingAt(position) {
        const displayedTransforms = new Map(this.listEntries()
            .filter((entry) => entry.state !== AlignmentEntryState.KEPT)
            .map((entry) => [String(entry.identifier), entry.transform]));
        let nearest = null;
        for (const feature of this.cadastreOverlay.getLayerFeatures(CadastreLayer.BUILDINGS)) {
            const transform = displayedTransforms.get(String(feature.identifier)) ?? null;
            const rings = transform ? feature.outerRings.map((ring) => transformRing(ring, transform)) : feature.outerRings;
            const distance = measurePointToRingsDistance(rings, position.x, position.y);
            if (distance <= MAXIMUM_PICK_DISTANCE_METRES && (!nearest || distance < nearest.distance)) {
                nearest = { feature: feature, transform: transform, distance: distance };
            }
        }
        if (!nearest) {
            return null;
        }
        return {
            identifier: nearest.feature.identifier,
            label: nearest.feature.label,
            transform: nearest.transform ?? createIdentityTransform(nearest.feature)
        };
    }

    render() {
        const entries = this.listEntries();
        const shownEntries = entries.filter((entry) => entry.state !== AlignmentEntryState.KEPT);
        const areBuildingsShown = this.cadastreOverlay.isLayerVisible(CadastreLayer.BUILDINGS);
        const isAlignedShown = areBuildingsShown && this.displayMode !== AlignmentDisplayMode.ORIGINAL;
        const isComparisonShown = areBuildingsShown && this.displayMode === AlignmentDisplayMode.BOTH;
        const isAutomatic = (entry) => entry.state === AlignmentEntryState.MOVED;
        this.updateStaticLayer(
            CadastreOverlayLayer.ALIGNED_BUILDINGS,
            shownEntries.filter((entry) => isAutomatic(entry) && !entry.isEstimate).map(createMovedFeature),
            [],
            isAlignedShown
        );
        this.updateStaticLayer(
            CadastreOverlayLayer.ESTIMATED_BUILDINGS,
            shownEntries.filter((entry) => isAutomatic(entry) && entry.isEstimate).map(createMovedFeature),
            [],
            isAlignedShown
        );
        this.updateStaticLayer(
            CadastreOverlayLayer.MANUAL_BUILDINGS,
            shownEntries.filter((entry) => entry.state === AlignmentEntryState.MANUAL).map(createMovedFeature),
            [],
            isAlignedShown
        );
        this.updateStaticLayer(
            CadastreOverlayLayer.SHIFT_ARROWS,
            shownEntries.map(createArrowFeature),
            shownEntries.map((entry) => this.createArrowLabel(entry)),
            isComparisonShown
        );
        const hiddenIdentifiers = this.displayMode === AlignmentDisplayMode.ALIGNED ? shownEntries.map((entry) => entry.identifier) : [];
        this.cadastreOverlay.setHiddenFeatures(CadastreLayer.BUILDINGS, hiddenIdentifiers);
        this.renderSurfaceBuildings(isComparisonShown && this.reference === AlignmentReference.SURFACE);
        this.dispatchEvent({ type: "changed", entries: entries, phase: this.phase, summary: this.matchSummary });
    }

    renderSurfaceBuildings(visible) {
        if (this.renderedSurfaceBuildings !== this.surfaceBuildings) {
            this.renderedSurfaceBuildings = this.surfaceBuildings;
            this.cadastreOverlay.setStaticLayer(
                CadastreOverlayLayer.SURFACE_BUILDINGS,
                this.surfaceBuildings.map((building) => ({ identifier: building.identifier, lines: building.outerRings }))
            );
        }
        this.cadastreOverlay.setLayerVisible(CadastreOverlayLayer.SURFACE_BUILDINGS, visible);
    }

    updateStaticLayer(layerId, features, labels, visible) {
        this.cadastreOverlay.setStaticLayer(layerId, features, labels);
        this.cadastreOverlay.setLayerVisible(layerId, visible);
    }

    createArrowLabel(entry) {
        return {
            x: entry.transform.centerX + entry.transform.shiftX / 2,
            y: entry.transform.centerY + entry.transform.shiftY / 2,
            text: this.shiftLabelFormatter(entry)
        };
    }
}
