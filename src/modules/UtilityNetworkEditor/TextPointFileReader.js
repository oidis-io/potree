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

export const TEXT_POINT_EXTENSIONS = Object.freeze([".xyz", ".txt", ".pts", ".csv"]);
const PTS_EXTENSION = ".pts";
const SAMPLE_BYTES = 1024 * 1024;
const POSITION_COLUMN_COUNT = 3;
const INTENSITY_COLUMN_COUNT = 4;
const COLOR_COLUMN_COUNT = 6;
const INTENSITY_AND_COLOR_COLUMN_COUNT = 7;
const PTS_INTENSITY_OFFSET = 2048;
const MAXIMUM_INTENSITY = 65535;
const CAPACITY_RESERVE = 1.1;
const DATA_LINE_START = /^[-+.\d]/;
const WHITESPACE = /\s+/;

function readExtension(fileName) {
    const dotIndex = fileName.lastIndexOf(".");
    return dotIndex >= 0 ? fileName.slice(dotIndex).toLowerCase() : "";
}

function detectDelimiter(line) {
    if (line.includes(";")) {
        return ";";
    }
    if (line.includes("\t")) {
        return "\t";
    }
    if (WHITESPACE.test(line)) {
        return " ";
    }
    return line.includes(",") ? "," : " ";
}

function splitValues(line, format) {
    const tokens = format.delimiter === " " ? line.split(WHITESPACE) : line.split(format.delimiter);
    return tokens
        .map((token) => token.trim())
        .filter((token) => token !== "")
        .map((token) => Number(format.hasDecimalComma ? token.replace(",", ".") : token));
}

function hasPosition(values) {
    return values.length >= POSITION_COLUMN_COUNT && values.slice(0, POSITION_COLUMN_COUNT).every(Number.isFinite);
}

function detectFormat(lines) {
    for (const line of lines) {
        const trimmedLine = line.trim();
        if (!DATA_LINE_START.test(trimmedLine)) {
            continue;
        }
        const delimiter = detectDelimiter(trimmedLine);
        const format = { delimiter: delimiter, hasDecimalComma: delimiter !== "," && /\d,\d/.test(trimmedLine) };
        const values = splitValues(trimmedLine, format);
        if (hasPosition(values)) {
            return { ...format, columnCount: values.length };
        }
    }
    throw createReadError(PointCloudReadErrorCode.UNSUPPORTED_FORMAT);
}

function describeColumns(columnCount) {
    if (columnCount >= INTENSITY_AND_COLOR_COLUMN_COUNT) {
        return { intensityColumn: 3, colorColumn: 4 };
    }
    if (columnCount === COLOR_COLUMN_COUNT) {
        return { intensityColumn: null, colorColumn: 3 };
    }
    if (columnCount === INTENSITY_COLUMN_COUNT) {
        return { intensityColumn: 3, colorColumn: null };
    }
    return { intensityColumn: null, colorColumn: null };
}

function readDeclaredPointCount(lines) {
    const firstLine = lines.map((line) => line.trim()).find((line) => line !== "") ?? "";
    return /^\d+$/.test(firstLine) ? Number(firstLine) : null;
}

async function readSample(file) {
    const byteLength = Math.min(file.size, SAMPLE_BYTES);
    const lines = new TextDecoder("utf-8").decode(await file.slice(0, byteLength).arrayBuffer()).split("\n");
    if (byteLength < file.size) {
        lines.pop();
    }
    return { lines: lines, byteLength: byteLength };
}

function estimatePointCount(file, sample) {
    const dataLineCount = sample.lines.filter((line) => DATA_LINE_START.test(line.trim())).length;
    return Math.max(1, Math.ceil(file.size * dataLineCount / Math.max(1, sample.byteLength)));
}

function clampIntensity(value) {
    return Math.min(MAXIMUM_INTENSITY, Math.max(0, Math.round(value)));
}

export async function readTextPointFile(file, maximumPointCount, onProgress) {
    const sample = await readSample(file);
    const format = detectFormat(sample.lines);
    const { intensityColumn, colorColumn } = describeColumns(format.columnCount);
    const intensityOffset = readExtension(file.name) === PTS_EXTENSION ? PTS_INTENSITY_OFFSET : 0;
    const expectedPointCount = readDeclaredPointCount(sample.lines) ?? estimatePointCount(file, sample);
    const step = computeThinningStep(expectedPointCount, maximumPointCount);
    const accumulator = new PointCloudAccumulator({
        capacity: Math.ceil(expectedPointCount / step) * CAPACITY_RESERVE,
        hasColors: colorColumn !== null,
        hasIntensities: intensityColumn !== null,
        hasClassifications: false
    });
    let dataLineIndex = 0;
    await forEachLine(file, 0, (line) => {
        const trimmedLine = line.trim();
        if (!DATA_LINE_START.test(trimmedLine)) {
            return true;
        }
        const currentIndex = dataLineIndex++;
        if (currentIndex % step !== 0) {
            return true;
        }
        const values = splitValues(trimmedLine, format);
        if (!hasPosition(values)) {
            dataLineIndex--;
            return true;
        }
        const index = accumulator.addPoint(values[0], values[1], values[2]);
        if (intensityColumn !== null && Number.isFinite(values[intensityColumn])) {
            accumulator.setIntensity(index, clampIntensity(values[intensityColumn] + intensityOffset));
        }
        if (colorColumn !== null) {
            accumulator.setColor(index, values[colorColumn] || 0, values[colorColumn + 1] || 0, values[colorColumn + 2] || 0);
        }
        return true;
    }, onProgress);
    return accumulator.finish(dataLineIndex);
}
