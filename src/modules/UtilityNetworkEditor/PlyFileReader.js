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
import { forEachLine } from "./TextLineReader.js";

export const PLY_SIGNATURE = "ply";
const HEADER_SEARCH_BYTES = 65536;
const HEADER_END_PATTERN = /end_header\r?\n/;
const CHUNK_RECORD_COUNT = 500000;
const FLOAT_COLOR_SCALE = 255;
const COLOR_PROPERTY_NAMES = [["red", "green", "blue"], ["r", "g", "b"], ["diffuse_red", "diffuse_green", "diffuse_blue"]];
const INTENSITY_PROPERTY_NAMES = ["intensity", "scalar_intensity", "scalar_Intensity"];
const PlyFormat = Object.freeze({
    ASCII: "ascii",
    BINARY_LITTLE_ENDIAN: "binary_little_endian",
    BINARY_BIG_ENDIAN: "binary_big_endian"
});
const PROPERTY_TYPES = Object.freeze({
    char: { size: 1, getter: DataView.prototype.getInt8, isFloat: false },
    int8: { size: 1, getter: DataView.prototype.getInt8, isFloat: false },
    uchar: { size: 1, getter: DataView.prototype.getUint8, isFloat: false },
    uint8: { size: 1, getter: DataView.prototype.getUint8, isFloat: false },
    short: { size: 2, getter: DataView.prototype.getInt16, isFloat: false },
    int16: { size: 2, getter: DataView.prototype.getInt16, isFloat: false },
    ushort: { size: 2, getter: DataView.prototype.getUint16, isFloat: false },
    uint16: { size: 2, getter: DataView.prototype.getUint16, isFloat: false },
    int: { size: 4, getter: DataView.prototype.getInt32, isFloat: false },
    int32: { size: 4, getter: DataView.prototype.getInt32, isFloat: false },
    uint: { size: 4, getter: DataView.prototype.getUint32, isFloat: false },
    uint32: { size: 4, getter: DataView.prototype.getUint32, isFloat: false },
    float: { size: 4, getter: DataView.prototype.getFloat32, isFloat: true },
    float32: { size: 4, getter: DataView.prototype.getFloat32, isFloat: true },
    double: { size: 8, getter: DataView.prototype.getFloat64, isFloat: true },
    float64: { size: 8, getter: DataView.prototype.getFloat64, isFloat: true }
});

function parseHeaderLines(lines) {
    let format = null;
    const elements = [];
    for (const line of lines) {
        const [keyword, ...words] = line.split(/\s+/);
        if (keyword === "format") {
            format = words[0];
        } else if (keyword === "element") {
            elements.push({ name: words[0], count: Number(words[1]), properties: [], hasList: false });
        } else if (keyword === "property" && elements.length > 0) {
            const element = elements[elements.length - 1];
            if (words[0] === "list") {
                element.hasList = true;
            } else {
                element.properties.push({ type: words[0], name: words[1] });
            }
        }
    }
    return { format: format, elements: elements };
}

async function readHeader(file) {
    const text = new TextDecoder("latin1").decode(await file.slice(0, HEADER_SEARCH_BYTES).arrayBuffer());
    const match = HEADER_END_PATTERN.exec(text);
    if (!text.startsWith(PLY_SIGNATURE) || !match) {
        throw createReadError(PointCloudReadErrorCode.UNSUPPORTED_FILE);
    }
    const lines = text.slice(0, match.index).split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== "");
    const { format, elements } = parseHeaderLines(lines.slice(1));
    const vertexElement = elements[0];
    const isSupported = Object.values(PlyFormat).includes(format)
        && vertexElement?.name === "vertex"
        && !vertexElement.hasList
        && vertexElement.properties.every((property) => PROPERTY_TYPES[property.type] !== undefined);
    if (!isSupported) {
        throw createReadError(PointCloudReadErrorCode.UNSUPPORTED_FORMAT);
    }
    if (!(vertexElement.count > 0)) {
        throw createReadError(PointCloudReadErrorCode.EMPTY);
    }
    return { format: format, vertexCount: vertexElement.count, properties: vertexElement.properties, bodyOffset: match.index + match[0].length };
}

function createLayout(properties) {
    const indexOf = (name) => properties.findIndex((property) => property.name === name);
    const positionIndices = ["x", "y", "z"].map(indexOf);
    if (positionIndices.some((index) => index < 0)) {
        throw createReadError(PointCloudReadErrorCode.UNSUPPORTED_FORMAT);
    }
    const colorIndices = COLOR_PROPERTY_NAMES.map((names) => names.map(indexOf)).find((indices) => indices.every((index) => index >= 0)) ?? null;
    const intensityIndex = INTENSITY_PROPERTY_NAMES.map(indexOf).find((index) => index >= 0 && !PROPERTY_TYPES[properties[index].type].isFloat) ?? null;
    const offsets = [];
    let recordSize = 0;
    for (const property of properties) {
        offsets.push(recordSize);
        recordSize += PROPERTY_TYPES[property.type].size;
    }
    const colorScale = colorIndices && PROPERTY_TYPES[properties[colorIndices[0]].type].isFloat ? FLOAT_COLOR_SCALE : 1;
    return { positionIndices: positionIndices, colorIndices: colorIndices, intensityIndex: intensityIndex, offsets: offsets, recordSize: recordSize, colorScale: colorScale };
}

function addVertex(accumulator, layout, readValue) {
    const [xIndex, yIndex, zIndex] = layout.positionIndices;
    const x = readValue(xIndex);
    const y = readValue(yIndex);
    const z = readValue(zIndex);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
        return false;
    }
    const index = accumulator.addPoint(x, y, z);
    if (layout.colorIndices) {
        const [redIndex, greenIndex, blueIndex] = layout.colorIndices;
        accumulator.setColor(index, readValue(redIndex) * layout.colorScale, readValue(greenIndex) * layout.colorScale, readValue(blueIndex) * layout.colorScale);
    }
    if (layout.intensityIndex !== null) {
        accumulator.setIntensity(index, readValue(layout.intensityIndex));
    }
    return true;
}

async function readBinaryVertices(file, header, layout, step, accumulator, onProgress) {
    const isLittleEndian = header.format === PlyFormat.BINARY_LITTLE_ENDIAN;
    const getters = header.properties.map((property) => PROPERTY_TYPES[property.type].getter);
    let skippedVertexCount = 0;
    for (let chunkStart = 0; chunkStart < header.vertexCount; chunkStart += CHUNK_RECORD_COUNT) {
        const chunkEnd = Math.min(header.vertexCount, chunkStart + CHUNK_RECORD_COUNT);
        const byteStart = header.bodyOffset + chunkStart * layout.recordSize;
        const view = new DataView(await file.slice(byteStart, header.bodyOffset + chunkEnd * layout.recordSize).arrayBuffer());
        const availableEnd = chunkStart + Math.floor(view.byteLength / layout.recordSize);
        for (let vertexIndex = Math.ceil(chunkStart / step) * step; vertexIndex < availableEnd; vertexIndex += step) {
            const base = (vertexIndex - chunkStart) * layout.recordSize;
            const readValue = (propertyIndex) => getters[propertyIndex].call(view, base + layout.offsets[propertyIndex], isLittleEndian);
            if (!addVertex(accumulator, layout, readValue)) {
                skippedVertexCount++;
            }
        }
        onProgress?.(chunkEnd / header.vertexCount);
        if (availableEnd < chunkEnd) {
            return skippedVertexCount;
        }
    }
    return skippedVertexCount;
}

async function readAsciiVertices(file, header, layout, step, accumulator, onProgress) {
    let vertexIndex = 0;
    let skippedVertexCount = 0;
    await forEachLine(file, header.bodyOffset, (line) => {
        if (vertexIndex >= header.vertexCount) {
            return false;
        }
        const trimmedLine = line.trim();
        if (trimmedLine === "") {
            return true;
        }
        const currentIndex = vertexIndex++;
        if (currentIndex % step === 0) {
            const values = trimmedLine.split(/\s+/).map(Number);
            if (!addVertex(accumulator, layout, (propertyIndex) => values[propertyIndex])) {
                skippedVertexCount++;
            }
        }
        return true;
    }, onProgress);
    return skippedVertexCount;
}

export async function readPlyFile(file, maximumPointCount, onProgress) {
    const header = await readHeader(file);
    const layout = createLayout(header.properties);
    const step = computeThinningStep(header.vertexCount, maximumPointCount);
    const accumulator = new PointCloudAccumulator({
        capacity: Math.ceil(header.vertexCount / step),
        hasColors: layout.colorIndices !== null,
        hasIntensities: layout.intensityIndex !== null,
        hasClassifications: false
    });
    const readVertices = header.format === PlyFormat.ASCII ? readAsciiVertices : readBinaryVertices;
    const skippedVertexCount = await readVertices(file, header, layout, step, accumulator, onProgress);
    return accumulator.finish(header.vertexCount - skippedVertexCount * step);
}
