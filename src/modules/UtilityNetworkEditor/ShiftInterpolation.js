/*! ******************************************************************************************************** *
 *
 * Copyright 2026 Oidis
 *
 * SPDX-License-Identifier: BSD-2-Clause
 * The BSD-2-Clause license for this file can be found in the LICENSE.txt file included with this distribution
 * or at https://spdx.org/licenses/BSD-2-Clause.html#licenseText
 *
 * ********************************************************************************************************* */

const INTERPOLATION_RADIUS_METRES = 40;
const MINIMUM_NEIGHBOUR_COUNT = 2;
const MAXIMUM_NEIGHBOUR_DEVIATION_METRES = 0.5;
const MINIMUM_WEIGHT_DISTANCE_METRES = 1;

export function estimateShift(position, controlPoints) {
    const neighbours = controlPoints
        .map((point) => ({ ...point, distance: Math.hypot(point.x - position.x, point.y - position.y) }))
        .filter((point) => point.distance <= INTERPOLATION_RADIUS_METRES);
    if (neighbours.length < MINIMUM_NEIGHBOUR_COUNT) {
        return null;
    }
    const weights = neighbours.map((point) => 1 / Math.max(point.distance, MINIMUM_WEIGHT_DISTANCE_METRES) ** 2);
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    const shiftX = neighbours.reduce((sum, point, index) => sum + point.shiftX * weights[index], 0) / totalWeight;
    const shiftY = neighbours.reduce((sum, point, index) => sum + point.shiftY * weights[index], 0) / totalWeight;
    const largestDeviation = Math.max(...neighbours.map((point) => Math.hypot(point.shiftX - shiftX, point.shiftY - shiftY)));
    return largestDeviation <= MAXIMUM_NEIGHBOUR_DEVIATION_METRES ? { shiftX: shiftX, shiftY: shiftY, neighbourCount: neighbours.length } : null;
}
