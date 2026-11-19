/*! ******************************************************************************************************** *
 *
 * Copyright 2026 Oidis
 *
 * SPDX-License-Identifier: BSD-2-Clause
 * The BSD-2-Clause license for this file can be found in the LICENSE.txt file included with this distribution
 * or at https://spdx.org/licenses/BSD-2-Clause.html#licenseText
 *
 * ********************************************************************************************************* */

import { createReadError, PointCloudReadErrorCode } from "./PointCloudReadError.js";

const EIGHT_BIT_COLOR_MAXIMUM = 255;
const SIXTEEN_BIT_COLOR_SHIFT = 8;
const MINIMUM_CAPACITY = 1024;
const GROWTH_FACTOR = 2;

export function computeThinningStep(sourcePointCount, maximumPointCount) {
    return Math.max(1, Math.ceil(sourcePointCount / maximumPointCount));
}

function resizeArray(array, length) {
    if (!array || array.length === length) {
        return array;
    }
    const resized = new array.constructor(length);
    resized.set(array.subarray(0, Math.min(array.length, length)));
    return resized;
}

function convertColors(wideColors) {
    const isSixteenBit = wideColors.some((value) => value > EIGHT_BIT_COLOR_MAXIMUM);
    const colors = new Uint8Array(wideColors.length);
    for (let index = 0; index < wideColors.length; index++) {
        colors[index] = isSixteenBit ? wideColors[index] >> SIXTEEN_BIT_COLOR_SHIFT : wideColors[index];
    }
    return colors;
}

function computeRange(values) {
    let minimum = Infinity;
    let maximum = -Infinity;
    for (let index = 0; index < values.length; index++) {
        minimum = Math.min(minimum, values[index]);
        maximum = Math.max(maximum, values[index]);
    }
    return [minimum, maximum];
}

function isConstant(values) {
    const [minimum, maximum] = computeRange(values);
    return minimum === maximum;
}

export class PointCloudAccumulator {
    constructor(options) {
        this.capacity = Math.max(MINIMUM_CAPACITY, Math.ceil(options.capacity));
        this.provisionalOrigin = options.origin ?? null;
        this.positions = new Float32Array(this.capacity * 3);
        this.colors = options.hasColors ? new Uint16Array(this.capacity * 3) : null;
        this.intensities = options.hasIntensities ? new Uint16Array(this.capacity) : null;
        this.classifications = options.hasClassifications ? new Uint8Array(this.capacity) : null;
        this.minimum = [Infinity, Infinity, Infinity];
        this.maximum = [-Infinity, -Infinity, -Infinity];
        this.pointCount = 0;
    }

    addPoint(x, y, z) {
        if (this.pointCount === this.capacity) {
            this.grow();
        }
        if (this.provisionalOrigin === null) {
            this.provisionalOrigin = [x, y, 0];
        }
        const index = this.pointCount;
        const base = index * 3;
        this.positions[base] = x - this.provisionalOrigin[0];
        this.positions[base + 1] = y - this.provisionalOrigin[1];
        this.positions[base + 2] = z - this.provisionalOrigin[2];
        this.minimum[0] = Math.min(this.minimum[0], x);
        this.minimum[1] = Math.min(this.minimum[1], y);
        this.minimum[2] = Math.min(this.minimum[2], z);
        this.maximum[0] = Math.max(this.maximum[0], x);
        this.maximum[1] = Math.max(this.maximum[1], y);
        this.maximum[2] = Math.max(this.maximum[2], z);
        this.pointCount++;
        return index;
    }

    setColor(index, red, green, blue) {
        const base = index * 3;
        this.colors[base] = red;
        this.colors[base + 1] = green;
        this.colors[base + 2] = blue;
    }

    setIntensity(index, intensity) {
        this.intensities[index] = intensity;
    }

    setClassification(index, classification) {
        this.classifications[index] = classification;
    }

    grow() {
        this.capacity = Math.ceil(this.capacity * GROWTH_FACTOR);
        this.positions = resizeArray(this.positions, this.capacity * 3);
        this.colors = resizeArray(this.colors, this.capacity * 3);
        this.intensities = resizeArray(this.intensities, this.capacity);
        this.classifications = resizeArray(this.classifications, this.capacity);
    }

    shiftToOrigin(positions, origin) {
        const shift = origin.map((value, axis) => value - this.provisionalOrigin[axis]);
        if (shift.every((value) => value === 0)) {
            return;
        }
        for (let index = 0; index < positions.length; index++) {
            positions[index] -= shift[index % 3];
        }
    }

    finish(sourcePointCount) {
        if (this.pointCount === 0) {
            throw createReadError(PointCloudReadErrorCode.EMPTY);
        }
        const count = this.pointCount;
        const origin = [this.minimum[0], this.minimum[1], 0];
        const positions = resizeArray(this.positions, count * 3);
        this.shiftToOrigin(positions, origin);
        const intensities = this.intensities && !isConstant(this.intensities.subarray(0, count)) ? resizeArray(this.intensities, count) : null;
        const classifications = this.classifications && !isConstant(this.classifications.subarray(0, count)) ? resizeArray(this.classifications, count) : null;
        return {
            pointCount: count,
            sourcePointCount: sourcePointCount,
            origin: origin,
            minimum: [...this.minimum],
            maximum: [...this.maximum],
            positions: positions,
            colors: this.colors ? convertColors(this.colors.subarray(0, count * 3)) : null,
            intensities: intensities,
            intensityRange: intensities ? computeRange(intensities) : null,
            classifications: classifications
        };
    }
}
