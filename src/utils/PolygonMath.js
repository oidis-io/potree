/*! ******************************************************************************************************** *
 *
 * Copyright 2026 Oidis
 *
 * SPDX-License-Identifier: BSD-2-Clause
 * The BSD-2-Clause license for this file can be found in the LICENSE.txt file included with this distribution
 * or at https://spdx.org/licenses/BSD-2-Clause.html#licenseText
 *
 * ********************************************************************************************************* */

const AREA_EPSILON = 1e-9;

export function polygonBounds(polygon) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of polygon) {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
    }
    return { minX, minY, maxX, maxY };
}

export function polygonArea(polygon) {
    const n = polygon.length;
    if (n < 3) {
        return 0;
    }
    let signed = 0;
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        signed += polygon[i].x * polygon[j].y - polygon[j].x * polygon[i].y;
    }
    return Math.abs(signed / 2);
}

export function polygonCentroid(polygon) {
    const n = polygon.length;
    let signed = 0;
    let cx = 0;
    let cy = 0;
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const cross = polygon[i].x * polygon[j].y - polygon[j].x * polygon[i].y;
        signed += cross;
        cx += (polygon[i].x + polygon[j].x) * cross;
        cy += (polygon[i].y + polygon[j].y) * cross;
    }
    if (Math.abs(signed) < AREA_EPSILON) {
        let sx = 0;
        let sy = 0;
        for (const p of polygon) {
            sx += p.x;
            sy += p.y;
        }
        return { x: sx / n, y: sy / n };
    }
    const factor = 1 / (3 * signed);
    return { x: cx * factor, y: cy * factor };
}

export function pointInPolygon(x, y, polygon) {
    const n = polygon.length;
    let inside = false;
    for (let i = 0, j = n - 1; i < n; j = i++) {
        const xi = polygon[i].x;
        const yi = polygon[i].y;
        const xj = polygon[j].x;
        const yj = polygon[j].y;
        const crossesRay = (yi > y) !== (yj > y);
        if (crossesRay && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
            inside = !inside;
        }
    }
    return inside;
}

function segmentsIntersect(a1, a2, b1, b2) {
    const d1x = a2.x - a1.x;
    const d1y = a2.y - a1.y;
    const d2x = b2.x - b1.x;
    const d2y = b2.y - b1.y;
    const denom = d1x * d2y - d1y * d2x;
    if (Math.abs(denom) < 1e-12) {
        return false;
    }
    const t = ((b1.x - a1.x) * d2y - (b1.y - a1.y) * d2x) / denom;
    const u = ((b1.x - a1.x) * d1y - (b1.y - a1.y) * d1x) / denom;
    return t > 0 && t < 1 && u > 0 && u < 1;
}

export function isSimplePolygon(polygon) {
    const n = polygon.length;
    if (n < 3 || polygonArea(polygon) < AREA_EPSILON) {
        return false;
    }
    for (let i = 0; i < n; i++) {
        const a1 = polygon[i];
        const a2 = polygon[(i + 1) % n];
        for (let j = i + 1; j < n; j++) {
            const adjacent = j === i + 1 || (i === 0 && j === n - 1);
            if (adjacent) {
                continue;
            }
            const b1 = polygon[j];
            const b2 = polygon[(j + 1) % n];
            if (segmentsIntersect(a1, a2, b1, b2)) {
                return false;
            }
        }
    }
    return true;
}

function clipAgainstEdge(polygon, isInside, intersectAt) {
    const result = [];
    const n = polygon.length;
    for (let i = 0; i < n; i++) {
        const current = polygon[i];
        const previous = polygon[(i + n - 1) % n];
        const currentInside = isInside(current);
        const previousInside = isInside(previous);
        if (currentInside) {
            if (!previousInside) {
                result.push(intersectAt(previous, current));
            }
            result.push(current);
        } else if (previousInside) {
            result.push(intersectAt(previous, current));
        }
    }
    return result;
}

export function clipPolygonToRect(polygon, minX, minY, maxX, maxY) {
    let clipped = polygon;
    const lerpAtX = (a, b, x) => ({ x, y: a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x) });
    const lerpAtY = (a, b, y) => ({ x: a.x + ((b.x - a.x) * (y - a.y)) / (b.y - a.y), y });

    clipped = clipAgainstEdge(clipped, (p) => p.x >= minX, (a, b) => lerpAtX(a, b, minX));
    if (clipped.length === 0) {
        return clipped;
    }
    clipped = clipAgainstEdge(clipped, (p) => p.x <= maxX, (a, b) => lerpAtX(a, b, maxX));
    if (clipped.length === 0) {
        return clipped;
    }
    clipped = clipAgainstEdge(clipped, (p) => p.y >= minY, (a, b) => lerpAtY(a, b, minY));
    if (clipped.length === 0) {
        return clipped;
    }
    clipped = clipAgainstEdge(clipped, (p) => p.y <= maxY, (a, b) => lerpAtY(a, b, maxY));
    return clipped;
}

export function clippedAreaInRect(polygon, minX, minY, maxX, maxY) {
    return polygonArea(clipPolygonToRect(polygon, minX, minY, maxX, maxY));
}

export function rectIntersectsPolygon(polygon, bounds, minX, minY, maxX, maxY) {
    if (bounds.minX > maxX || bounds.maxX < minX || bounds.minY > maxY || bounds.maxY < minY) {
        return false;
    }
    const localPolygon = polygon.map((p) => ({ x: p.x - minX, y: p.y - minY }));
    return clippedAreaInRect(localPolygon, 0, 0, maxX - minX, maxY - minY) > AREA_EPSILON;
}

export function nodeIntersectsPolygonPrism(nodeBounds, polygon, bounds, zMin, zMax) {
    if (nodeBounds.maxZ < zMin || nodeBounds.minZ > zMax) {
        return false;
    }
    return rectIntersectsPolygon(
        polygon,
        bounds,
        nodeBounds.minX,
        nodeBounds.minY,
        nodeBounds.maxX,
        nodeBounds.maxY
    );
}
