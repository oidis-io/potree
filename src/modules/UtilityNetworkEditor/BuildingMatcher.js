/*! ******************************************************************************************************** *
 *
 * Copyright 2026 Oidis
 *
 * SPDX-License-Identifier: BSD-2-Clause
 * The BSD-2-Clause license for this file can be found in the LICENSE.txt file included with this distribution
 * or at https://spdx.org/licenses/BSD-2-Clause.html#licenseText
 *
 * ********************************************************************************************************* */

import {
    ALIGNED_OVERLAP,
    combineGeometries,
    fitGeometry,
    measureGeometryGap,
    measureMaximumDisplacement,
    measurePairScore,
    prepareGeometry
} from "./BuildingFitting.js";
import { estimateShift } from "./ShiftInterpolation.js";

export const BuildingMatchStatus = Object.freeze({
    ALIGNED: "aligned",
    SHIFTED: "shifted",
    INTERPOLATED: "interpolated",
    DIFFERENT_SHAPE: "different_shape",
    UNMATCHED: "unmatched"
});

const MAXIMUM_PAIR_DISTANCE_METRES = 12;
const MINIMUM_AREA_RATIO = 0.6;
const MAXIMUM_AREA_RATIO = 1.6;
const MINIMUM_PAIR_OVERLAP = 0.4;
const MINIMUM_ORIGINAL_OVERLAP = 0.1;
const MINIMUM_FITTED_OVERLAP = 0.7;
const MINIMUM_OVERLAP_GAIN = 0.15;
const MINIMUM_DISPLACEMENT_METRES = 0.5;
const ADJACENCY_GAP_METRES = 0.5;

function prepareItems(sources) {
    return sources
        .map((source) => ({ source: source, geometry: prepareGeometry(source.outerRings ?? []) }))
        .filter((item) => item.geometry !== null);
}

function isPairable(item, reference) {
    const distance = Math.hypot(reference.geometry.centroid.x - item.geometry.centroid.x, reference.geometry.centroid.y - item.geometry.centroid.y);
    const areaRatio = reference.geometry.area / item.geometry.area;
    return distance <= MAXIMUM_PAIR_DISTANCE_METRES && areaRatio >= MINIMUM_AREA_RATIO && areaRatio <= MAXIMUM_AREA_RATIO;
}

function scorePair(item, reference) {
    return isPairable(item, reference) ? measurePairScore(item.geometry, reference.geometry) : 0;
}

function pairBuildings(buildings, references) {
    const candidates = buildings
        .flatMap((building) => references.map((reference) => ({ building: building, reference: reference, score: scorePair(building, reference) })))
        .filter((candidate) => candidate.score >= MINIMUM_PAIR_OVERLAP)
        .sort((first, second) => second.score - first.score);
    const pairedReferences = new Set();
    const referenceByBuilding = new Map();
    for (const candidate of candidates) {
        if (!referenceByBuilding.has(candidate.building) && !pairedReferences.has(candidate.reference)) {
            referenceByBuilding.set(candidate.building, candidate.reference);
            pairedReferences.add(candidate.reference);
        }
    }
    return referenceByBuilding;
}

function decideStatus(fit, displacement, minimumShiftMetres) {
    if (fit.originalOverlap >= ALIGNED_OVERLAP) {
        return BuildingMatchStatus.ALIGNED;
    }
    if (fit.originalOverlap < MINIMUM_ORIGINAL_OVERLAP || fit.fittedOverlap < MINIMUM_FITTED_OVERLAP) {
        return BuildingMatchStatus.DIFFERENT_SHAPE;
    }
    if (displacement < MINIMUM_DISPLACEMENT_METRES || Math.hypot(fit.transform.shiftX, fit.transform.shiftY) < minimumShiftMetres) {
        return BuildingMatchStatus.ALIGNED;
    }
    return fit.fittedOverlap - fit.originalOverlap >= MINIMUM_OVERLAP_GAIN ? BuildingMatchStatus.SHIFTED : BuildingMatchStatus.DIFFERENT_SHAPE;
}

function evaluateFit(geometry, reference, minimumShiftMetres) {
    const fit = fitGeometry(geometry, reference.geometry);
    const status = decideStatus(fit, measureMaximumDisplacement(geometry, fit.transform), minimumShiftMetres);
    return {
        status: status,
        referenceIdentifier: reference.source.identifier,
        transform: status === BuildingMatchStatus.SHIFTED ? fit.transform : null,
        originalOverlap: fit.originalOverlap,
        fittedOverlap: fit.fittedOverlap,
        shiftLength: Math.hypot(fit.transform.shiftX, fit.transform.shiftY),
        rotationDegrees: fit.transform.rotationDegrees
    };
}

function createResult(item, evaluation = null, details = {}) {
    return {
        identifier: item.source.identifier,
        label: item.source.label ?? "",
        status: BuildingMatchStatus.UNMATCHED,
        referenceIdentifier: null,
        transform: null,
        originalOverlap: null,
        fittedOverlap: null,
        shiftLength: 0,
        rotationDegrees: 0,
        blockSize: 1,
        neighbourCount: 0,
        bounds: item.geometry.bounds,
        ...evaluation,
        ...details
    };
}

function areAdjacent(first, second) {
    const isNear = first.bounds.minX - ADJACENCY_GAP_METRES <= second.bounds.maxX
        && second.bounds.minX - ADJACENCY_GAP_METRES <= first.bounds.maxX
        && first.bounds.minY - ADJACENCY_GAP_METRES <= second.bounds.maxY
        && second.bounds.minY - ADJACENCY_GAP_METRES <= first.bounds.maxY;
    return isNear && measureGeometryGap(first, second) <= ADJACENCY_GAP_METRES;
}

function findAdjacentGroups(buildings) {
    const parents = buildings.map((building, index) => index);
    const findRoot = (index) => {
        let root = index;
        while (parents[root] !== root) {
            root = parents[root];
        }
        return root;
    };
    for (let firstIndex = 0; firstIndex < buildings.length; firstIndex++) {
        for (let secondIndex = firstIndex + 1; secondIndex < buildings.length; secondIndex++) {
            if (areAdjacent(buildings[firstIndex].geometry, buildings[secondIndex].geometry)) {
                parents[findRoot(firstIndex)] = findRoot(secondIndex);
            }
        }
    }
    const groups = new Map();
    buildings.forEach((building, index) => {
        const root = findRoot(index);
        groups.set(root, [...(groups.get(root) ?? []), building]);
    });
    return [...groups.values()].filter((group) => group.length > 1);
}

function findBestReference(item, references) {
    const scored = references.map((reference) => ({ reference: reference, score: scorePair(item, reference) }));
    const best = scored.reduce((winner, candidate) => (candidate.score > (winner?.score ?? 0) ? candidate : winner), null);
    return best && best.score >= MINIMUM_PAIR_OVERLAP ? best.reference : null;
}

function isBlockFitBetter(evaluation, memberResults) {
    if (evaluation.status !== BuildingMatchStatus.SHIFTED && evaluation.status !== BuildingMatchStatus.ALIGNED) {
        return false;
    }
    return memberResults.every((result) => result.status !== BuildingMatchStatus.SHIFTED || evaluation.fittedOverlap >= result.fittedOverlap);
}

function matchBlocks(buildings, references, referenceByBuilding, results, minimumShiftMetres) {
    const pairedReferences = new Set(referenceByBuilding.values());
    const blockCandidates = buildings.filter((building) => results.get(building).status !== BuildingMatchStatus.ALIGNED);
    for (const members of findAdjacentGroups(blockCandidates)) {
        const block = { source: {}, geometry: combineGeometries(members.map((member) => member.geometry)) };
        const memberReferences = new Set(members.map((member) => referenceByBuilding.get(member)).filter((reference) => reference !== undefined));
        const reference = findBestReference(block, references.filter((candidate) => !pairedReferences.has(candidate) || memberReferences.has(candidate)));
        if (!reference) {
            continue;
        }
        const evaluation = evaluateFit(block.geometry, reference, minimumShiftMetres);
        if (isBlockFitBetter(evaluation, members.map((member) => results.get(member)))) {
            pairedReferences.add(reference);
            members.forEach((member) => results.set(member, createResult(member, evaluation, { blockSize: members.length })));
        }
    }
}

function interpolateUnmatched(buildings, results, minimumShiftMetres) {
    const measuredStatuses = [BuildingMatchStatus.ALIGNED, BuildingMatchStatus.SHIFTED];
    const controlPoints = buildings
        .filter((building) => measuredStatuses.includes(results.get(building).status))
        .map((building) => ({
            x: building.geometry.centroid.x,
            y: building.geometry.centroid.y,
            shiftX: results.get(building).transform?.shiftX ?? 0,
            shiftY: results.get(building).transform?.shiftY ?? 0
        }));
    for (const building of buildings.filter((item) => results.get(item).status === BuildingMatchStatus.UNMATCHED)) {
        const estimate = estimateShift(building.geometry.centroid, controlPoints);
        if (!estimate) {
            continue;
        }
        const shiftLength = Math.hypot(estimate.shiftX, estimate.shiftY);
        const isShifted = shiftLength >= Math.max(MINIMUM_DISPLACEMENT_METRES, minimumShiftMetres);
        const transform = { centerX: building.geometry.centroid.x, centerY: building.geometry.centroid.y, shiftX: estimate.shiftX, shiftY: estimate.shiftY, rotationDegrees: 0 };
        results.set(building, createResult(building, {
            status: isShifted ? BuildingMatchStatus.INTERPOLATED : BuildingMatchStatus.ALIGNED,
            transform: isShifted ? transform : null,
            shiftLength: shiftLength
        }, { neighbourCount: estimate.neighbourCount }));
    }
}

export function matchBuildings(cadastreBuildings, referenceBuildings, options = {}) {
    const minimumShiftMetres = options.minimumShiftMetres ?? 0;
    const buildings = prepareItems(cadastreBuildings);
    const references = prepareItems(referenceBuildings);
    const referenceByBuilding = pairBuildings(buildings, references);
    const results = new Map(buildings.map((building) => {
        const reference = referenceByBuilding.get(building);
        return [building, createResult(building, reference ? evaluateFit(building.geometry, reference, minimumShiftMetres) : null)];
    }));
    matchBlocks(buildings, references, referenceByBuilding, results, minimumShiftMetres);
    if (options.interpolate !== false) {
        interpolateUnmatched(buildings, results, minimumShiftMetres);
    }
    return buildings.map((building) => results.get(building));
}

export function summarizeMatches(results) {
    const summary = Object.fromEntries(Object.values(BuildingMatchStatus).map((status) => [status, 0]));
    for (const result of results) {
        summary[result.status]++;
    }
    return summary;
}
