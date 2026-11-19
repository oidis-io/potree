/*! ******************************************************************************************************** *
 *
 * Copyright 2026 Oidis
 *
 * SPDX-License-Identifier: BSD-2-Clause
 * The BSD-2-Clause license for this file can be found in the LICENSE.txt file included with this distribution
 * or at https://spdx.org/licenses/BSD-2-Clause.html#licenseText
 *
 * ********************************************************************************************************* */

export const DxfReadErrorCode = Object.freeze({
    UNAVAILABLE: "unavailable",
    BINARY: "binary",
    INVALID: "invalid"
});

const BINARY_DXF_SIGNATURE = "AutoCAD Binary DXF";
const POLYLINE_PATH_FLAG = 2;
const HatchEdgeType = Object.freeze({
    LINE: 1,
    ARC: 2,
    ELLIPSE: 3,
    SPLINE: 4
});

function createDxfError(code) {
    const error = new Error(`Cannot read DXF: ${code}`);
    error.code = code;
    return error;
}

function decodeText(bytes) {
    try {
        return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
        return new TextDecoder("windows-1250").decode(bytes);
    }
}

function readExpected(scanner, code) {
    const group = scanner.next();
    if (group.code !== code) {
        scanner.rewind();
        return undefined;
    }
    return group.value;
}

function readPoint(scanner, xCode) {
    const x = readExpected(scanner, xCode);
    const y = readExpected(scanner, xCode + 10);
    return x === undefined || y === undefined ? null : { x: x, y: y };
}

function readPolylinePath(scanner) {
    const hasBulge = readExpected(scanner, 72) === 1;
    const isClosed = readExpected(scanner, 73) === 1;
    const vertexCount = readExpected(scanner, 93) ?? 0;
    const points = [];
    for (let index = 0; index < vertexCount; index++) {
        const point = readPoint(scanner, 10);
        if (!point) {
            break;
        }
        point.bulge = hasBulge ? readExpected(scanner, 42) ?? 0 : 0;
        points.push(point);
    }
    return { isPolyline: true, isClosed: isClosed, points: points, edges: [] };
}

function readSplineEdge(scanner) {
    readExpected(scanner, 94);
    const isRational = readExpected(scanner, 73) === 1;
    readExpected(scanner, 74);
    const knotCount = readExpected(scanner, 95) ?? 0;
    const controlPointCount = readExpected(scanner, 96) ?? 0;
    for (let index = 0; index < knotCount; index++) {
        readExpected(scanner, 40);
    }
    const controlPoints = [];
    for (let index = 0; index < controlPointCount; index++) {
        controlPoints.push(readPoint(scanner, 10));
        if (isRational) {
            readExpected(scanner, 42);
        }
    }
    const fitPointCount = readExpected(scanner, 97) ?? 0;
    const fitPoints = [];
    for (let index = 0; index < fitPointCount; index++) {
        fitPoints.push(readPoint(scanner, 11));
    }
    if (fitPointCount > 0) {
        readPoint(scanner, 12);
        readPoint(scanner, 13);
    }
    return { type: "spline", points: (fitPoints.length > 0 ? fitPoints : controlPoints).filter(Boolean) };
}

function readEdge(scanner, edgeType) {
    switch (edgeType) {
        case HatchEdgeType.LINE:
            return { type: "line", start: readPoint(scanner, 10), end: readPoint(scanner, 11) };
        case HatchEdgeType.ARC:
            return {
                type: "arc",
                center: readPoint(scanner, 10),
                radius: readExpected(scanner, 40),
                startAngle: readExpected(scanner, 50),
                endAngle: readExpected(scanner, 51),
                isCounterClockwise: readExpected(scanner, 73) !== 0
            };
        case HatchEdgeType.ELLIPSE:
            return {
                type: "ellipse",
                center: readPoint(scanner, 10),
                majorAxis: readPoint(scanner, 11),
                axisRatio: readExpected(scanner, 40),
                startAngle: readExpected(scanner, 50),
                endAngle: readExpected(scanner, 51),
                isCounterClockwise: readExpected(scanner, 73) !== 0
            };
        case HatchEdgeType.SPLINE:
            return readSplineEdge(scanner);
        default:
            return null;
    }
}

function readEdgePath(scanner) {
    const edgeCount = readExpected(scanner, 93) ?? 0;
    const edges = [];
    for (let index = 0; index < edgeCount; index++) {
        const edge = readEdge(scanner, readExpected(scanner, 72));
        if (!edge) {
            break;
        }
        edges.push(edge);
    }
    return { isPolyline: false, isClosed: true, points: [], edges: edges };
}

function readBoundaries(scanner, entity, boundaryCount) {
    let group = scanner.next();
    for (let index = 0; index < boundaryCount && group.code === 92; index++) {
        const isPolyline = (group.value & POLYLINE_PATH_FLAG) !== 0;
        entity.boundaries.push(isPolyline ? readPolylinePath(scanner) : readEdgePath(scanner));
        group = scanner.next();
        if (group.code === 97) {
            for (let sourceIndex = 0; sourceIndex < group.value; sourceIndex++) {
                scanner.next();
            }
            group = scanner.next();
        }
    }
    return group;
}

class HatchEntityHandler {
    constructor() {
        this.ForEntityName = "HATCH";
    }

    parseEntity(scanner, current) {
        const entity = { type: current.value, boundaries: [] };
        let group = scanner.next();
        while (!scanner.isEOF() && group.code !== 0) {
            if (group.code === 91) {
                group = readBoundaries(scanner, entity, group.value);
                continue;
            }
            if (group.code === 8) {
                entity.layer = group.value;
            } else if (group.code === 62) {
                entity.colorIndex = group.value;
            } else if (group.code === 420) {
                entity.color = group.value;
            }
            group = scanner.next();
        }
        return entity;
    }
}

export async function readDxfFile(file) {
    const DxfParser = globalThis.DxfParser;
    if (typeof DxfParser !== "function") {
        throw createDxfError(DxfReadErrorCode.UNAVAILABLE);
    }
    const text = decodeText(new Uint8Array(await file.arrayBuffer()));
    if (text.startsWith(BINARY_DXF_SIGNATURE)) {
        throw createDxfError(DxfReadErrorCode.BINARY);
    }
    const parser = new DxfParser();
    parser.registerEntityHandler(HatchEntityHandler);
    let dxf = null;
    try {
        dxf = parser.parseSync(text);
    } catch {
        dxf = null;
    }
    if (!dxf || !Array.isArray(dxf.entities)) {
        throw createDxfError(DxfReadErrorCode.INVALID);
    }
    return dxf;
}
