/*! ******************************************************************************************************** *
 *
 * Copyright 2026 Oidis
 *
 * SPDX-License-Identifier: BSD-2-Clause
 * The BSD-2-Clause license for this file can be found in the LICENSE.txt file included with this distribution
 * or at https://spdx.org/licenses/BSD-2-Clause.html#licenseText
 *
 * ********************************************************************************************************* */

const LAS_SIGNATURE = "LASF";
const HEADER_READ_BYTES = 375;
const MINIMUM_HEADER_BYTES = 227;
const CHUNK_POINT_COUNT = 1000000;
const COMPRESSION_FLAG = 0x80;
const POINT_FORMAT_MASK = 0x3f;
const MAXIMUM_POINT_FORMAT = 10;
const MINIMUM_RECORD_LENGTHS = [20, 28, 26, 34, 57, 63, 30, 36, 38, 59, 67];
const RGB_OFFSETS = { 2: 20, 3: 28, 5: 28, 7: 30, 8: 30, 10: 30 };
const EIGHT_BIT_COLOR_MAXIMUM = 255;

export const LasReadErrorCode = Object.freeze({
    NOT_LAS: "not_las",
    COMPRESSED: "compressed",
    UNSUPPORTED_FORMAT: "unsupported_format",
    EMPTY: "empty"
});

function createReadError(code) {
    const error = new Error(`Cannot read LAS file: ${code}`);
    error.code = code;
    return error;
}

function readPointCount(view, versionMinor) {
    const legacyPointCount = view.getUint32(107, true);
    if (versionMinor >= 4 && view.byteLength >= HEADER_READ_BYTES) {
        const pointCount = Number(view.getBigUint64(247, true));
        return pointCount > 0 ? pointCount : legacyPointCount;
    }
    return legacyPointCount;
}

export async function readLasHeader(file) {
    if (file.size < MINIMUM_HEADER_BYTES) {
        throw createReadError(LasReadErrorCode.NOT_LAS);
    }
    const view = new DataView(await file.slice(0, HEADER_READ_BYTES).arrayBuffer());
    const signature = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
    if (signature !== LAS_SIGNATURE) {
        throw createReadError(LasReadErrorCode.NOT_LAS);
    }
    const formatByte = view.getUint8(104);
    if ((formatByte & COMPRESSION_FLAG) !== 0) {
        throw createReadError(LasReadErrorCode.COMPRESSED);
    }
    const pointFormat = formatByte & POINT_FORMAT_MASK;
    const recordLength = view.getUint16(105, true);
    if (pointFormat > MAXIMUM_POINT_FORMAT || recordLength < MINIMUM_RECORD_LENGTHS[pointFormat]) {
        throw createReadError(LasReadErrorCode.UNSUPPORTED_FORMAT);
    }
    const versionMinor = view.getUint8(25);
    const pointCount = readPointCount(view, versionMinor);
    const pointDataOffset = view.getUint32(96, true);
    if (pointCount === 0 || pointDataOffset + pointCount * recordLength > file.size) {
        throw createReadError(LasReadErrorCode.EMPTY);
    }
    return {
        version: `${view.getUint8(24)}.${versionMinor}`,
        pointFormat: pointFormat,
        recordLength: recordLength,
        pointCount: pointCount,
        pointDataOffset: pointDataOffset,
        scale: [view.getFloat64(131, true), view.getFloat64(139, true), view.getFloat64(147, true)],
        offset: [view.getFloat64(155, true), view.getFloat64(163, true), view.getFloat64(171, true)],
        minimum: [view.getFloat64(187, true), view.getFloat64(203, true), view.getFloat64(219, true)],
        maximum: [view.getFloat64(179, true), view.getFloat64(195, true), view.getFloat64(211, true)],
        hasColors: RGB_OFFSETS[pointFormat] !== undefined
    };
}

function toHorizontalOrigin(minimum) {
    return [minimum[0], minimum[1], 0];
}

function convertColors(wideColors) {
    const isSixteenBit = wideColors.some((value) => value > EIGHT_BIT_COLOR_MAXIMUM);
    const colors = new Uint8Array(wideColors.length);
    for (let index = 0; index < wideColors.length; index++) {
        colors[index] = isSixteenBit ? wideColors[index] >> 8 : wideColors[index];
    }
    return colors;
}

export async function readLasPoints(file, header, maximumPointCount, onProgress) {
    const step = Math.max(1, Math.ceil(header.pointCount / maximumPointCount));
    const keptCount = Math.ceil(header.pointCount / step);
    const headerOrigin = toHorizontalOrigin(header.minimum);
    const positions = new Float32Array(keptCount * 3);
    const wideColors = header.hasColors ? new Uint16Array(keptCount * 3) : null;
    const colorOffset = RGB_OFFSETS[header.pointFormat];
    const minimum = [Infinity, Infinity, Infinity];
    const maximum = [-Infinity, -Infinity, -Infinity];
    let kept = 0;
    for (let chunkStart = 0; chunkStart < header.pointCount; chunkStart += CHUNK_POINT_COUNT) {
        const chunkEnd = Math.min(header.pointCount, chunkStart + CHUNK_POINT_COUNT);
        const byteStart = header.pointDataOffset + chunkStart * header.recordLength;
        const view = new DataView(await file.slice(byteStart, header.pointDataOffset + chunkEnd * header.recordLength).arrayBuffer());
        for (let index = Math.ceil(chunkStart / step) * step; index < chunkEnd && kept < keptCount; index += step) {
            const base = (index - chunkStart) * header.recordLength;
            for (let axis = 0; axis < 3; axis++) {
                const coordinate = view.getInt32(base + axis * 4, true) * header.scale[axis] + header.offset[axis];
                positions[kept * 3 + axis] = coordinate - headerOrigin[axis];
                minimum[axis] = Math.min(minimum[axis], coordinate);
                maximum[axis] = Math.max(maximum[axis], coordinate);
            }
            if (wideColors) {
                wideColors[kept * 3] = view.getUint16(base + colorOffset, true);
                wideColors[kept * 3 + 1] = view.getUint16(base + colorOffset + 2, true);
                wideColors[kept * 3 + 2] = view.getUint16(base + colorOffset + 4, true);
            }
            kept++;
        }
        onProgress?.(chunkEnd / header.pointCount);
    }
    const origin = toHorizontalOrigin(minimum);
    const shift = origin.map((value, axis) => value - headerOrigin[axis]);
    if (shift.some((value) => value !== 0)) {
        for (let index = 0; index < kept * 3; index++) {
            positions[index] -= shift[index % 3];
        }
    }
    return {
        pointCount: kept,
        sourcePointCount: header.pointCount,
        origin: origin,
        minimum: minimum,
        maximum: maximum,
        positions: positions,
        colors: wideColors ? convertColors(wideColors) : null
    };
}
