/*! ******************************************************************************************************** *
 *
 * Copyright 2026 Oidis
 *
 * SPDX-License-Identifier: BSD-2-Clause
 * The BSD-2-Clause license for this file can be found in the LICENSE.txt file included with this distribution
 * or at https://spdx.org/licenses/BSD-2-Clause.html#licenseText
 *
 * ********************************************************************************************************* */

const FORMAT = "g1";
const EMPTY = -32768;
const MIN_VALUE = -32767;
const MAX_VALUE = 32767;
export const DEFAULT_MAX_STORED_CELLS = 20000;
// Host models transport empty strings as "no value at all", which would keep a stale payload in storage,
// so absence has to be written as an explicit marker.
export const NO_SURFACE = "none";

function toBase64(int16) {
    const bytes = new Uint8Array(int16.buffer, int16.byteOffset, int16.byteLength);
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 8192) {
        binary += String.fromCharCode.apply(null, bytes.subarray(offset, offset + 8192));
    }
    return btoa(binary);
}

function fromBase64(text) {
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) {
        bytes[index] = binary.charCodeAt(index);
    }
    return new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
}

function coarsenSurface(surface, factor) {
    const cols = Math.ceil(surface.cols / factor);
    const rows = Math.ceil(surface.rows / factor);
    const surfaceZ = new Float64Array(cols * rows).fill(NaN);
    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
            let sum = 0;
            let count = 0;
            for (let sourceRow = row * factor; sourceRow < Math.min((row + 1) * factor, surface.rows); sourceRow++) {
                for (let sourceCol = col * factor; sourceCol < Math.min((col + 1) * factor, surface.cols); sourceCol++) {
                    const source = sourceRow * surface.cols + sourceCol;
                    if (surface.weights[source] > 0 && Number.isFinite(surface.surfaceZ[source])) {
                        sum += surface.surfaceZ[source];
                        count++;
                    }
                }
            }
            if (count > 0) {
                surfaceZ[row * cols + col] = sum / count;
            }
        }
    }
    return {
        originX: surface.originX,
        originY: surface.originY,
        cellSize: surface.cellSize * factor,
        cols,
        rows,
        surfaceZ,
        weights: surfaceZ.map((z) => (Number.isFinite(z) ? 1 : 0))
    };
}

export function encodeSurfaceGrid(surface, maxCells = DEFAULT_MAX_STORED_CELLS) {
    if (!surface) {
        return NO_SURFACE;
    }
    const factor = Math.max(1, Math.ceil(Math.sqrt((surface.cols * surface.rows) / maxCells)));
    const source = factor === 1 ? surface : coarsenSurface(surface, factor);

    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let index = 0; index < source.surfaceZ.length; index++) {
        if (source.weights[index] > 0 && Number.isFinite(source.surfaceZ[index])) {
            minZ = Math.min(minZ, source.surfaceZ[index]);
            maxZ = Math.max(maxZ, source.surfaceZ[index]);
        }
    }
    if (minZ === Infinity) {
        return NO_SURFACE;
    }

    let scale = 100;
    while (scale > 1 && (maxZ - minZ) * scale > MAX_VALUE) {
        scale /= 10;
    }
    if ((maxZ - minZ) * scale > MAX_VALUE) {
        throw new Error("Rozsah výšek povrchu je mimo rozsah ukládaného formátu.");
    }

    const values = new Int16Array(source.cols * source.rows);
    for (let index = 0; index < values.length; index++) {
        if (source.weights[index] > 0 && Number.isFinite(source.surfaceZ[index])) {
            const quantized = Math.round((source.surfaceZ[index] - minZ) * scale);
            values[index] = Math.max(MIN_VALUE, Math.min(MAX_VALUE, quantized));
        } else {
            values[index] = EMPTY;
        }
    }

    return [
        FORMAT,
        source.originX.toFixed(3),
        source.originY.toFixed(3),
        source.cellSize.toFixed(6),
        source.cols,
        source.rows,
        scale,
        minZ.toFixed(3),
        toBase64(values)
    ].join("|");
}

export function decodeSurfaceGrid(payload) {
    if (typeof payload !== "string" || payload === "" || payload === NO_SURFACE) {
        return null;
    }
    const parts = payload.split("|");
    if (parts.length !== 9 || parts[0] !== FORMAT) {
        throw new Error("Uložený povrch má neplatný formát.");
    }
    const originX = Number(parts[1]);
    const originY = Number(parts[2]);
    const cellSize = Number(parts[3]);
    const cols = Number(parts[4]);
    const rows = Number(parts[5]);
    const scale = Number(parts[6]);
    const baseZ = Number(parts[7]);
    if (!Number.isFinite(originX) || !Number.isFinite(originY) || !(cellSize > 0) ||
        !Number.isInteger(cols) || cols <= 0 || !Number.isInteger(rows) || rows <= 0 ||
        !(scale > 0) || !Number.isFinite(baseZ)) {
        throw new Error("Uložený povrch má neplatnou hlavičku.");
    }

    const values = fromBase64(parts[8]);
    if (values.length !== cols * rows) {
        throw new Error("Uložený povrch má neplatnou velikost dat.");
    }
    const surfaceZ = new Float64Array(values.length).fill(NaN);
    const weights = new Float64Array(values.length);
    for (let index = 0; index < values.length; index++) {
        if (values[index] !== EMPTY) {
            surfaceZ[index] = baseZ + values[index] / scale;
            weights[index] = 1;
        }
    }
    return { originX, originY, cellSize, cols, rows, surfaceZ, weights };
}
