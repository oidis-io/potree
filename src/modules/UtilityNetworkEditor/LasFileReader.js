/*! ******************************************************************************************************** *
 *
 * Copyright 2026 Oidis
 *
 * SPDX-License-Identifier: BSD-2-Clause
 * The BSD-2-Clause license for this file can be found in the LICENSE.txt file included with this distribution
 * or at https://spdx.org/licenses/BSD-2-Clause.html#licenseText
 *
 * ********************************************************************************************************* */

import { computeThinningStep, PointCloudAccumulator } from "./PointCloudAccumulator.js";
import { createReadError, PointCloudReadErrorCode } from "./PointCloudReadError.js";

export const LAS_SIGNATURE = "LASF";
const HEADER_READ_BYTES = 375;
const MINIMUM_HEADER_BYTES = 227;
const CHUNK_POINT_COUNT = 1000000;
const PROGRESS_POINT_INTERVAL = 250000;
const COMPRESSION_FLAG = 0x80;
const POINT_FORMAT_MASK = 0x3f;
const MAXIMUM_POINT_FORMAT = 10;
const FIRST_EXTENDED_POINT_FORMAT = 6;
const MINIMUM_RECORD_LENGTHS = [20, 28, 26, 34, 57, 63, 30, 36, 38, 59, 67];
const RGB_OFFSETS = { 2: 20, 3: 28, 5: 28, 7: 30, 8: 30, 10: 30 };
const INTENSITY_OFFSET = 12;
const LEGACY_CLASSIFICATION_OFFSET = 15;
const EXTENDED_CLASSIFICATION_OFFSET = 16;
const LEGACY_CLASSIFICATION_MASK = 0x1f;

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
        throw createReadError(PointCloudReadErrorCode.UNSUPPORTED_FILE);
    }
    const view = new DataView(await file.slice(0, HEADER_READ_BYTES).arrayBuffer());
    const signature = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
    if (signature !== LAS_SIGNATURE) {
        throw createReadError(PointCloudReadErrorCode.UNSUPPORTED_FILE);
    }
    const formatByte = view.getUint8(104);
    const isCompressed = (formatByte & COMPRESSION_FLAG) !== 0;
    const pointFormat = formatByte & POINT_FORMAT_MASK;
    const recordLength = view.getUint16(105, true);
    if (pointFormat > MAXIMUM_POINT_FORMAT || recordLength < MINIMUM_RECORD_LENGTHS[pointFormat]) {
        throw createReadError(PointCloudReadErrorCode.UNSUPPORTED_FORMAT);
    }
    const versionMinor = view.getUint8(25);
    const pointCount = readPointCount(view, versionMinor);
    const pointDataOffset = view.getUint32(96, true);
    const isTruncated = !isCompressed && pointDataOffset + pointCount * recordLength > file.size;
    if (pointCount === 0 || isTruncated) {
        throw createReadError(PointCloudReadErrorCode.EMPTY);
    }
    return {
        version: `${view.getUint8(24)}.${versionMinor}`,
        isCompressed: isCompressed,
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

function createRecordParser(header) {
    const colorOffset = RGB_OFFSETS[header.pointFormat];
    const isExtended = header.pointFormat >= FIRST_EXTENDED_POINT_FORMAT;
    const [scaleX, scaleY, scaleZ] = header.scale;
    const [offsetX, offsetY, offsetZ] = header.offset;
    return (view, base, accumulator) => {
        const index = accumulator.addPoint(
            view.getInt32(base, true) * scaleX + offsetX,
            view.getInt32(base + 4, true) * scaleY + offsetY,
            view.getInt32(base + 8, true) * scaleZ + offsetZ
        );
        accumulator.setIntensity(index, view.getUint16(base + INTENSITY_OFFSET, true));
        accumulator.setClassification(index, isExtended
            ? view.getUint8(base + EXTENDED_CLASSIFICATION_OFFSET)
            : view.getUint8(base + LEGACY_CLASSIFICATION_OFFSET) & LEGACY_CLASSIFICATION_MASK);
        if (colorOffset !== undefined) {
            accumulator.setColor(index, view.getUint16(base + colorOffset, true), view.getUint16(base + colorOffset + 2, true), view.getUint16(base + colorOffset + 4, true));
        }
    };
}

async function readUncompressedPoints(file, header, step, parseRecord, accumulator, onProgress) {
    for (let chunkStart = 0; chunkStart < header.pointCount; chunkStart += CHUNK_POINT_COUNT) {
        const chunkEnd = Math.min(header.pointCount, chunkStart + CHUNK_POINT_COUNT);
        const byteStart = header.pointDataOffset + chunkStart * header.recordLength;
        const view = new DataView(await file.slice(byteStart, header.pointDataOffset + chunkEnd * header.recordLength).arrayBuffer());
        for (let index = Math.ceil(chunkStart / step) * step; index < chunkEnd; index += step) {
            parseRecord(view, (index - chunkStart) * header.recordLength, accumulator);
        }
        onProgress?.(chunkEnd / header.pointCount);
    }
}

async function createLazDecoder() {
    const createLazPerf = globalThis.Copc?.Las?.PointData?.createLazPerf;
    if (typeof createLazPerf !== "function") {
        throw createReadError(PointCloudReadErrorCode.FAILED);
    }
    return createLazPerf();
}

function allocate(lazPerf, byteLength) {
    let pointer = 0;
    try {
        pointer = lazPerf._malloc(byteLength);
    } catch {
        pointer = 0;
    }
    if (pointer === 0) {
        throw createReadError(PointCloudReadErrorCode.TOO_LARGE);
    }
    return pointer;
}

async function readFileBytes(file) {
    try {
        return new Uint8Array(await file.arrayBuffer());
    } catch {
        throw createReadError(PointCloudReadErrorCode.TOO_LARGE);
    }
}

async function readCompressedPoints(file, header, step, parseRecord, accumulator, onProgress) {
    const lazPerf = await createLazDecoder();
    const bytes = await readFileBytes(file);
    const filePointer = allocate(lazPerf, bytes.byteLength);
    const pointPointer = allocate(lazPerf, header.recordLength);
    const reader = new lazPerf.LASZip();
    try {
        lazPerf.HEAPU8.set(bytes, filePointer);
        reader.open(filePointer, bytes.byteLength);
        let view = new DataView(lazPerf.HEAPU8.buffer, pointPointer, header.recordLength);
        for (let index = 0; index < header.pointCount; index++) {
            reader.getPoint(pointPointer);
            if (index % step === 0) {
                if (view.buffer !== lazPerf.HEAPU8.buffer) {
                    view = new DataView(lazPerf.HEAPU8.buffer, pointPointer, header.recordLength);
                }
                parseRecord(view, 0, accumulator);
            }
            if ((index + 1) % PROGRESS_POINT_INTERVAL === 0) {
                onProgress?.((index + 1) / header.pointCount);
            }
        }
    } finally {
        reader.delete();
        lazPerf._free(pointPointer);
        lazPerf._free(filePointer);
    }
    onProgress?.(1);
}

export async function readLasFile(file, maximumPointCount, onProgress) {
    const header = await readLasHeader(file);
    const step = computeThinningStep(header.pointCount, maximumPointCount);
    const accumulator = new PointCloudAccumulator({
        capacity: Math.ceil(header.pointCount / step),
        origin: [header.minimum[0], header.minimum[1], 0],
        hasColors: header.hasColors,
        hasIntensities: true,
        hasClassifications: true
    });
    const readPoints = header.isCompressed ? readCompressedPoints : readUncompressedPoints;
    await readPoints(file, header, step, createRecordParser(header), accumulator, onProgress);
    return accumulator.finish(header.pointCount);
}
