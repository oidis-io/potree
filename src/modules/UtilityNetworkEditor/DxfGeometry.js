/*! ******************************************************************************************************** *
 *
 * Copyright 2026 Oidis
 *
 * SPDX-License-Identifier: BSD-2-Clause
 * The BSD-2-Clause license for this file can be found in the LICENSE.txt file included with this distribution
 * or at https://spdx.org/licenses/BSD-2-Clause.html#licenseText
 *
 * ********************************************************************************************************* */

import { BASIC_COLOR_INDICES, BY_BLOCK_COLOR_INDEX, BY_LAYER_COLOR_INDEX, DEFAULT_DXF_COLOR } from "./DxfColors.js";

export const DxfPrimitiveKind = Object.freeze({
    LINE: "line",
    CIRCLE: "circle",
    POINT: "point",
    TEXT: "text"
});

const CURVE_SEGMENT_RADIANS = Math.PI / 32;
const MINIMUM_CURVE_SEGMENTS = 8;
const MINIMUM_BULGE_SEGMENTS = 4;
const BULGE_EPSILON = 1e-9;
const FLAT_HEIGHT_TOLERANCE = 0.001;
const MAXIMUM_BLOCK_DEPTH = 8;
const MAXIMUM_ARRAY_COPIES = 100;
const MAXIMUM_PRIMITIVE_COUNT = 200000;
const DEGREES_TO_RADIANS = Math.PI / 180;
const FULL_TURN = 2 * Math.PI;
const UNIT_SCALES = Object.freeze({ 1: 0.0254, 2: 0.3048, 4: 0.001, 5: 0.01, 6: 1, 7: 1000 });
const KROVAK_RANGE = Object.freeze({ minimumX: -950000, maximumX: -300000, minimumY: -1350000, maximumY: -900000 });
const AXIS_TRANSFORMS = Object.freeze([
    { name: "original", apply: (x, y) => [x, y] },
    { name: "negated", apply: (x, y) => [-x, -y] },
    { name: "swapped", apply: (x, y) => [y, x] },
    { name: "swapped_negated", apply: (x, y) => [-y, -x] }
]);
const SPECIAL_CHARACTERS = Object.freeze({ "%%c": "ø", "%%C": "ø", "%%d": "°", "%%D": "°", "%%p": "±", "%%P": "±" });

function cleanText(text) {
    return String(text ?? "")
        .replace(/\\U\+([0-9A-Fa-f]{4})/g, (match, code) => String.fromCharCode(parseInt(code, 16)))
        .replace(/\\P/g, " ")
        .replace(/\\[ACFHQSTWacfhqstw][^;]*;/g, "")
        .replace(/\\[LlOoKk]/g, "")
        .replace(/%%[cCdDpP]/g, (match) => SPECIAL_CHARACTERS[match])
        .replace(/[{}]/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

function toPoint(point, defaultHeight = 0) {
    return { x: point?.x ?? 0, y: point?.y ?? 0, z: point?.z ?? defaultHeight };
}

function computeSegmentCount(sweep, minimumSegmentCount) {
    return Math.max(minimumSegmentCount, Math.ceil(Math.abs(sweep) / CURVE_SEGMENT_RADIANS));
}

function createArcPoints(center, radius, startAngle, sweep, height) {
    const segmentCount = computeSegmentCount(sweep, MINIMUM_CURVE_SEGMENTS);
    return Array.from({ length: segmentCount + 1 }, (unused, index) => {
        const angle = startAngle + sweep * index / segmentCount;
        return { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius, z: height };
    });
}

function createEllipsePoints(center, majorAxis, axisRatio, startParameter, endParameter, height) {
    let sweep = endParameter - startParameter;
    if (sweep <= 0) {
        sweep += FULL_TURN;
    }
    const minorAxis = { x: -majorAxis.y * axisRatio, y: majorAxis.x * axisRatio };
    const segmentCount = computeSegmentCount(sweep, MINIMUM_CURVE_SEGMENTS);
    return Array.from({ length: segmentCount + 1 }, (unused, index) => {
        const parameter = startParameter + sweep * index / segmentCount;
        return {
            x: center.x + majorAxis.x * Math.cos(parameter) + minorAxis.x * Math.sin(parameter),
            y: center.y + majorAxis.y * Math.cos(parameter) + minorAxis.y * Math.sin(parameter),
            z: height
        };
    });
}

function appendBulgeArc(points, start, end, bulge) {
    const angle = 4 * Math.atan(bulge);
    const chordX = end.x - start.x;
    const chordY = end.y - start.y;
    const chord = Math.hypot(chordX, chordY);
    if (chord === 0) {
        return;
    }
    const radius = chord / (2 * Math.sin(angle / 2));
    const distance = radius * Math.cos(angle / 2);
    const centerX = (start.x + end.x) / 2 - distance * chordY / chord;
    const centerY = (start.y + end.y) / 2 + distance * chordX / chord;
    const startAngle = Math.atan2(start.y - centerY, start.x - centerX);
    const segmentCount = computeSegmentCount(angle, MINIMUM_BULGE_SEGMENTS);
    for (let index = 1; index < segmentCount; index++) {
        const share = index / segmentCount;
        const pointAngle = startAngle + angle * share;
        points.push({
            x: centerX + Math.cos(pointAngle) * Math.abs(radius),
            y: centerY + Math.sin(pointAngle) * Math.abs(radius),
            z: start.z + (end.z - start.z) * share
        });
    }
}

function expandBulgeVertices(vertices, isClosed, defaultHeight) {
    const points = [];
    const vertexCount = vertices.length;
    const segmentCount = isClosed ? vertexCount : vertexCount - 1;
    for (let index = 0; index < vertexCount; index++) {
        const vertex = toPoint(vertices[index], defaultHeight);
        points.push(vertex);
        const bulge = vertices[index].bulge ?? 0;
        if (index < segmentCount && Math.abs(bulge) > BULGE_EPSILON) {
            appendBulgeArc(points, vertex, toPoint(vertices[(index + 1) % vertexCount], defaultHeight), bulge);
        }
    }
    return points;
}

function createHatchEdgePoints(edge) {
    switch (edge.type) {
        case "line":
            return edge.start && edge.end ? [toPoint(edge.start), toPoint(edge.end)] : [];
        case "arc": {
            if (!edge.center || !(edge.radius > 0)) {
                return [];
            }
            const startDegrees = edge.isCounterClockwise ? edge.startAngle : 360 - edge.endAngle;
            const endDegrees = edge.isCounterClockwise ? edge.endAngle : 360 - edge.startAngle;
            let sweep = (endDegrees - startDegrees) * DEGREES_TO_RADIANS;
            if (sweep <= 0) {
                sweep += FULL_TURN;
            }
            return createArcPoints(edge.center, edge.radius, startDegrees * DEGREES_TO_RADIANS, sweep, 0);
        }
        case "ellipse":
            return edge.center && edge.majorAxis
                ? createEllipsePoints(edge.center, edge.majorAxis, edge.axisRatio ?? 1, (edge.startAngle ?? 0) * DEGREES_TO_RADIANS, (edge.endAngle ?? 360) * DEGREES_TO_RADIANS, 0)
                : [];
        case "spline":
            return edge.points.map((point) => toPoint(point));
        default:
            return [];
    }
}

function createHatchBoundaryPoints(boundary) {
    if (boundary.isPolyline) {
        return expandBulgeVertices(boundary.points, true, 0);
    }
    return boundary.edges.flatMap(createHatchEdgePoints);
}

function createInsertTransform(insert, block, offset, parentTransform) {
    const base = toPoint(block.position);
    const position = toPoint(insert.position);
    const scaleX = insert.xScale ?? 1;
    const scaleY = insert.yScale ?? 1;
    const scaleZ = insert.zScale ?? 1;
    const rotation = (insert.rotation ?? 0) * DEGREES_TO_RADIANS;
    const cosine = Math.cos(rotation);
    const sine = Math.sin(rotation);
    return (point) => {
        const localX = (point.x - base.x) * scaleX + offset.x;
        const localY = (point.y - base.y) * scaleY + offset.y;
        return parentTransform({
            x: position.x + localX * cosine - localY * sine,
            y: position.y + localX * sine + localY * cosine,
            z: position.z + (point.z - base.z) * scaleZ
        });
    };
}

class DxfPrimitiveCollector {
    constructor(dxf) {
        this.layers = dxf.tables?.layer?.layers ?? {};
        this.blocks = dxf.blocks ?? {};
        this.primitives = [];
        this.unsupportedEntityCount = 0;
        this.isTruncated = false;
    }

    resolveLayer(entity, context) {
        const layer = entity.layer ?? "0";
        return layer === "0" && context.layer ? context.layer : layer;
    }

    resolveColor(entity, context, layer) {
        if (entity.colorIndex === BY_BLOCK_COLOR_INDEX && context.color !== null) {
            return context.color;
        }
        if (typeof entity.color === "number" && entity.colorIndex !== BY_LAYER_COLOR_INDEX) {
            return entity.color;
        }
        if (entity.colorIndex !== undefined && BASIC_COLOR_INDICES[entity.colorIndex] !== undefined) {
            return BASIC_COLOR_INDICES[entity.colorIndex];
        }
        return this.layers[layer]?.color ?? DEFAULT_DXF_COLOR;
    }

    addPrimitive(primitive) {
        if (this.primitives.length >= MAXIMUM_PRIMITIVE_COUNT) {
            this.isTruncated = true;
            return;
        }
        this.primitives.push(primitive);
    }

    addLine(entity, context, points, isClosed) {
        if (points.length < 2) {
            return;
        }
        const layer = this.resolveLayer(entity, context);
        this.addPrimitive({
            kind: DxfPrimitiveKind.LINE,
            layer: layer,
            color: this.resolveColor(entity, context, layer),
            points: points.map(context.transform),
            isClosed: isClosed,
            isSymbol: context.isSymbol
        });
    }

    addCircle(entity, context) {
        if (!(entity.radius > 0)) {
            return;
        }
        const center = toPoint(entity.center);
        const layer = this.resolveLayer(entity, context);
        const ring = createArcPoints(center, entity.radius, 0, FULL_TURN, center.z).slice(0, -1);
        this.addPrimitive({
            kind: DxfPrimitiveKind.CIRCLE,
            layer: layer,
            color: this.resolveColor(entity, context, layer),
            center: context.transform(center),
            radius: entity.radius,
            points: ring.map(context.transform),
            isClosed: true,
            isSymbol: context.isSymbol
        });
    }

    addMarker(entity, context, kind, position, text = "") {
        const layer = this.resolveLayer(entity, context);
        this.addPrimitive({
            kind: kind,
            layer: layer,
            color: this.resolveColor(entity, context, layer),
            position: context.transform(toPoint(position)),
            text: text,
            isSymbol: context.isSymbol
        });
    }

    addInsert(entity, context) {
        const block = this.blocks[entity.name];
        if (!block || context.depth >= MAXIMUM_BLOCK_DEPTH) {
            this.unsupportedEntityCount++;
            return;
        }
        const layer = this.resolveLayer(entity, context);
        const color = this.resolveColor(entity, context, layer);
        const columnCount = Math.max(1, Math.min(MAXIMUM_ARRAY_COPIES, entity.columnCount ?? 1));
        const rowCount = Math.max(1, Math.min(MAXIMUM_ARRAY_COPIES, entity.rowCount ?? 1));
        for (let column = 0; column < columnCount; column++) {
            for (let row = 0; row < rowCount; row++) {
                const offset = { x: column * (entity.columnSpacing ?? 0), y: row * (entity.rowSpacing ?? 0) };
                const blockContext = {
                    transform: createInsertTransform(entity, block, offset, context.transform),
                    layer: layer,
                    color: color,
                    isSymbol: true,
                    depth: context.depth + 1
                };
                for (const blockEntity of block.entities ?? []) {
                    this.addEntity(blockEntity, blockContext);
                }
            }
        }
    }

    addEntity(entity, context) {
        switch (entity.type) {
            case "LINE":
                this.addLine(entity, context, (entity.vertices ?? []).map((vertex) => toPoint(vertex)), false);
                break;
            case "LWPOLYLINE":
                this.addLine(entity, context, expandBulgeVertices(entity.vertices ?? [], entity.shape === true, entity.elevation ?? 0), entity.shape === true);
                break;
            case "POLYLINE":
                if (entity.isPolyfaceMesh) {
                    this.unsupportedEntityCount++;
                } else {
                    this.addLine(entity, context, expandBulgeVertices(entity.vertices ?? [], entity.shape === true, 0), entity.shape === true);
                }
                break;
            case "CIRCLE":
                this.addCircle(entity, context);
                break;
            case "ARC": {
                let sweep = (entity.endAngle ?? 0) - (entity.startAngle ?? 0);
                if (sweep <= 0) {
                    sweep += FULL_TURN;
                }
                const center = toPoint(entity.center);
                this.addLine(entity, context, createArcPoints(center, entity.radius ?? 0, entity.startAngle ?? 0, sweep, center.z), false);
                break;
            }
            case "ELLIPSE": {
                const center = toPoint(entity.center);
                const points = createEllipsePoints(center, toPoint(entity.majorAxisEndPoint), entity.axisRatio ?? 1, entity.startAngle ?? 0, entity.endAngle ?? FULL_TURN, center.z);
                this.addLine(entity, context, points, false);
                break;
            }
            case "SPLINE": {
                const sourcePoints = (entity.fitPoints?.length ?? 0) > 1 ? entity.fitPoints : entity.controlPoints ?? [];
                this.addLine(entity, context, sourcePoints.map((point) => toPoint(point)), entity.closed === true);
                break;
            }
            case "SOLID":
            case "3DFACE": {
                const corners = (entity.points ?? entity.vertices ?? []).map((point) => toPoint(point));
                const outline = entity.type === "SOLID" && corners.length === 4 ? [corners[0], corners[1], corners[3], corners[2]] : corners;
                this.addLine(entity, { ...context, isSymbol: true }, outline, true);
                break;
            }
            case "HATCH":
                for (const boundary of entity.boundaries ?? []) {
                    this.addLine(entity, { ...context, isSymbol: true }, createHatchBoundaryPoints(boundary), true);
                }
                break;
            case "POINT":
                this.addMarker(entity, context, DxfPrimitiveKind.POINT, entity.position);
                break;
            case "TEXT": {
                const text = cleanText(entity.text);
                if (text !== "") {
                    this.addMarker(entity, context, DxfPrimitiveKind.TEXT, entity.startPoint, text);
                }
                break;
            }
            case "MTEXT": {
                const text = cleanText(entity.text);
                if (text !== "") {
                    this.addMarker(entity, context, DxfPrimitiveKind.TEXT, entity.position, text);
                }
                break;
            }
            case "INSERT":
                this.addInsert(entity, context);
                break;
            case "DIMENSION":
                if (entity.block) {
                    this.addInsert({ ...entity, name: entity.block, position: { x: 0, y: 0, z: 0 } }, context);
                }
                break;
            default:
                this.unsupportedEntityCount++;
                break;
        }
    }
}

function collectPoints(primitive) {
    if (primitive.kind === DxfPrimitiveKind.POINT || primitive.kind === DxfPrimitiveKind.TEXT) {
        return [primitive.position];
    }
    return primitive.kind === DxfPrimitiveKind.CIRCLE ? [primitive.center, ...primitive.points] : primitive.points;
}

function computeBounds(primitives) {
    const bounds = { minimumX: Infinity, minimumY: Infinity, minimumZ: Infinity, maximumX: -Infinity, maximumY: -Infinity, maximumZ: -Infinity };
    for (const primitive of primitives) {
        for (const point of collectPoints(primitive)) {
            bounds.minimumX = Math.min(bounds.minimumX, point.x);
            bounds.minimumY = Math.min(bounds.minimumY, point.y);
            bounds.minimumZ = Math.min(bounds.minimumZ, point.z);
            bounds.maximumX = Math.max(bounds.maximumX, point.x);
            bounds.maximumY = Math.max(bounds.maximumY, point.y);
            bounds.maximumZ = Math.max(bounds.maximumZ, point.z);
        }
    }
    return bounds;
}

function isInKrovakRange(x, y) {
    return x > KROVAK_RANGE.minimumX && x < KROVAK_RANGE.maximumX && y > KROVAK_RANGE.minimumY && y < KROVAK_RANGE.maximumY;
}

function chooseAxisTransform(bounds, unitScale) {
    const centerX = (bounds.minimumX + bounds.maximumX) / 2 * unitScale;
    const centerY = (bounds.minimumY + bounds.maximumY) / 2 * unitScale;
    return AXIS_TRANSFORMS.find((axisTransform) => isInKrovakRange(...axisTransform.apply(centerX, centerY))) ?? null;
}

function normalizePrimitive(primitive, convertPoint, unitScale) {
    const normalized = { ...primitive };
    if (primitive.points) {
        normalized.points = primitive.points.map(convertPoint);
    }
    if (primitive.center) {
        normalized.center = convertPoint(primitive.center);
        normalized.radius = primitive.radius * unitScale;
    }
    if (primitive.position) {
        normalized.position = convertPoint(primitive.position);
    }
    return normalized;
}

function describeLayers(primitives, layerTable) {
    const counts = new Map();
    for (const primitive of primitives) {
        counts.set(primitive.layer, (counts.get(primitive.layer) ?? 0) + 1);
    }
    return [...counts.entries()]
        .map(([name, primitiveCount]) => ({ name: name, color: layerTable[name]?.color ?? DEFAULT_DXF_COLOR, primitiveCount: primitiveCount }))
        .sort((first, second) => first.name.localeCompare(second.name, "cs"));
}

export function createDxfDocument(dxf) {
    const collector = new DxfPrimitiveCollector(dxf);
    const rootContext = { transform: (point) => point, layer: null, color: null, isSymbol: false, depth: 0 };
    for (const entity of dxf.entities) {
        collector.addEntity(entity, rootContext);
    }
    const unitScale = UNIT_SCALES[dxf.header?.$INSUNITS] ?? 1;
    const sourceBounds = computeBounds(collector.primitives);
    const axisTransform = collector.primitives.length > 0 ? chooseAxisTransform(sourceBounds, unitScale) : null;
    const applyAxes = axisTransform?.apply ?? AXIS_TRANSFORMS[0].apply;
    const convertPoint = (point) => {
        const [x, y] = applyAxes(point.x * unitScale, point.y * unitScale);
        return { x: x, y: y, z: point.z * unitScale };
    };
    const primitives = collector.primitives.map((primitive) => normalizePrimitive(primitive, convertPoint, unitScale));
    const bounds = computeBounds(primitives);
    return {
        primitives: primitives,
        layers: describeLayers(primitives, collector.layers),
        bounds: bounds,
        isFlat: !(Math.abs(bounds.minimumZ) > FLAT_HEIGHT_TOLERANCE || Math.abs(bounds.maximumZ) > FLAT_HEIGHT_TOLERANCE),
        isKrovak: axisTransform !== null,
        axisTransform: axisTransform?.name ?? null,
        unitScale: unitScale,
        unsupportedEntityCount: collector.unsupportedEntityCount,
        isTruncated: collector.isTruncated
    };
}
