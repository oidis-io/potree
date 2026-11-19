/*! ******************************************************************************************************** *
 *
 * Copyright 2026 Oidis
 *
 * SPDX-License-Identifier: BSD-2-Clause
 * The BSD-2-Clause license for this file can be found in the LICENSE.txt file included with this distribution
 * or at https://spdx.org/licenses/BSD-2-Clause.html#licenseText
 *
 * ********************************************************************************************************* */

export const DEFAULT_DXF_COLOR = 0xffffff;
export const BY_BLOCK_COLOR_INDEX = 0;
export const BY_LAYER_COLOR_INDEX = 256;

export const BASIC_COLOR_INDICES = Object.freeze({
    1: 0xff0000,
    2: 0xffff00,
    3: 0x00ff00,
    4: 0x00ffff,
    5: 0x0000ff,
    6: 0xff00ff,
    7: 0xffffff,
    8: 0x808080,
    9: 0xc0c0c0,
    30: 0xff7f00,
    40: 0xffbf00,
    140: 0x007fff,
    210: 0xff00bf
});

function splitChannels(color) {
    return [(color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff];
}

export function findNearestColorIndex(color) {
    const [red, green, blue] = splitChannels(color);
    let nearestIndex = 7;
    let nearestDistance = Infinity;
    for (const [index, candidate] of Object.entries(BASIC_COLOR_INDICES)) {
        const [candidateRed, candidateGreen, candidateBlue] = splitChannels(candidate);
        const distance = (red - candidateRed) ** 2 + (green - candidateGreen) ** 2 + (blue - candidateBlue) ** 2;
        if (distance < nearestDistance) {
            nearestDistance = distance;
            nearestIndex = Number(index);
        }
    }
    return nearestIndex;
}
