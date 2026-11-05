/*! ******************************************************************************************************** *
 *
 * Copyright 2026 Oidis
 *
 * SPDX-License-Identifier: BSD-2-Clause
 * The BSD-2-Clause license for this file can be found in the LICENSE.txt file included with this distribution
 * or at https://spdx.org/licenses/BSD-2-Clause.html#licenseText
 *
 * ********************************************************************************************************* */

import * as THREE from "../../../libs/three.js/build/three.module.js";
import { Line2 } from "../../../libs/three.js/lines/Line2.js";
import { LineGeometry } from "../../../libs/three.js/lines/LineGeometry.js";
import { LineMaterial } from "../../../libs/three.js/lines/LineMaterial.js";
import { TextSprite } from "../../TextSprite.js";
import { Utils } from "../../utils.js";
import { isSimplePolygon, polygonCentroid } from "../../utils/PolygonMath.js";

export const CadFeatureType = Object.freeze({
    POINT: "point",
    POLYLINE: "polyline",
    POLYGON: "polygon"
});

export const MINIMUM_POINT_COUNTS = Object.freeze({
    [CadFeatureType.POINT]: 1,
    [CadFeatureType.POLYLINE]: 2,
    [CadFeatureType.POLYGON]: 3
});

const MARKER_RADIUS_PIXELS = 6;
const LABEL_SCALE_PIXELS = 60;
const LABEL_FONT_SIZE = 24;
const LINE_WIDTH_PIXELS = 3;
const FILL_OPACITY = 0.2;
const FILL_RENDER_ORDER = 1;
const EDGE_RENDER_ORDER = 2;
const MARKER_RENDER_ORDER = 3;
const LABEL_RENDER_ORDER = 4;

export class CadFeature extends THREE.Object3D {
    constructor(featureType, style) {
        super();
        this.featureType = featureType;
        this.label = "";
        this.color = new THREE.Color(style.color);
        this.points = [];
        this.isDrawing = false;
        this.trailingPoint = null;

        this.markerGeometry = new THREE.SphereGeometry(1, 12, 12);
        this.markerMaterial = new THREE.MeshBasicMaterial({ color: this.color, transparent: true, depthTest: false, depthWrite: false });
        this.fillMaterial = new THREE.MeshBasicMaterial({
            color: this.color,
            transparent: true,
            opacity: FILL_OPACITY,
            side: THREE.DoubleSide,
            depthTest: false,
            depthWrite: false
        });
        this.lineMaterial = new LineMaterial({
            color: this.color.getHex(),
            linewidth: LINE_WIDTH_PIXELS,
            resolution: new THREE.Vector2(1000, 1000)
        });
        this.lineMaterial.transparent = true;
        this.lineMaterial.depthTest = false;
        this.lineMaterial.depthWrite = false;
        this.fill = null;
        this.markerGroup = new THREE.Group();
        this.edgeGroup = new THREE.Group();
        this.trailingGroup = new THREE.Group();
        this.labelSprite = this.createLabelSprite();
        this.add(this.markerGroup, this.edgeGroup, this.trailingGroup, this.labelSprite);
        this.setLabel(style.label);
    }

    createLabelSprite() {
        const labelSprite = new TextSprite("");
        labelSprite.fontsize = LABEL_FONT_SIZE;
        labelSprite.setTextColor({ r: 255, g: 255, b: 255, a: 1.0 });
        labelSprite.setBackgroundColor({ r: 0, g: 0, b: 0, a: 0.6 });
        labelSprite.setBorderColor(this.toLabelColor(this.color));
        labelSprite.sprite.center.set(0.5, -0.4);
        labelSprite.sprite.renderOrder = LABEL_RENDER_ORDER;
        labelSprite.visible = false;
        return labelSprite;
    }

    toLabelColor(color) {
        return { r: Math.round(color.r * 255), g: Math.round(color.g * 255), b: Math.round(color.b * 255), a: 1.0 };
    }

    setDrawing(isDrawing) {
        this.isDrawing = isDrawing;
        this.trailingPoint = null;
        if (!isDrawing) {
            this.disposeEdges(this.trailingGroup);
        }
        this.rebuild();
    }

    addPoint(position) {
        this.points.push(position.clone());
        this.rebuild();
    }

    removeLastPoint() {
        if (this.points.length === 0) {
            return;
        }
        this.points.pop();
        this.rebuild();
    }

    setTrailingPoint(position) {
        this.trailingPoint = position ? position.clone() : null;
        this.updateTrailingEdges();
    }

    setColor(color) {
        this.color.set(color);
        this.markerMaterial.color.copy(this.color);
        this.fillMaterial.color.copy(this.color);
        this.lineMaterial.color.copy(this.color);
        this.updateLabelTexture(() => this.labelSprite.setBorderColor(this.toLabelColor(this.color)));
    }

    setLabel(label) {
        this.label = label ?? "";
        this.updateLabelTexture(() => this.labelSprite.setText(this.label));
        this.updateLabelPosition();
    }

    updateLabelTexture(applyChange) {
        const previousTexture = this.labelSprite.material.map;
        applyChange();
        if (previousTexture && previousTexture !== this.labelSprite.material.map) {
            previousTexture.dispose();
        }
    }

    rebuild() {
        this.markerGroup.clear();
        this.disposeEdges(this.edgeGroup);
        this.removeFill();
        if (this.featureType === CadFeatureType.POINT || this.isDrawing) {
            for (const point of this.points) {
                const marker = new THREE.Mesh(this.markerGeometry, this.markerMaterial);
                marker.position.copy(point);
                marker.renderOrder = MARKER_RENDER_ORDER;
                this.markerGroup.add(marker);
            }
        }
        const isClosed = this.featureType === CadFeatureType.POLYGON && !this.isDrawing;
        const segmentCount = isClosed ? this.points.length : this.points.length - 1;
        for (let index = 0; index < segmentCount; index++) {
            this.edgeGroup.add(this.createEdge(this.points[index], this.points[(index + 1) % this.points.length]));
        }
        if (isClosed && this.hasSimpleOutline()) {
            this.createFill();
        }
        this.updateTrailingEdges();
        this.updateLabelPosition();
    }

    updateTrailingEdges() {
        const segments = this.computeTrailingSegments();
        while (this.trailingGroup.children.length < segments.length) {
            const [start, end] = segments[this.trailingGroup.children.length];
            this.trailingGroup.add(this.createEdge(start, end));
        }
        this.trailingGroup.children.forEach((edge, index) => {
            const segment = segments[index];
            edge.visible = segment !== undefined;
            if (segment) {
                this.placeEdge(edge, segment[0], segment[1]);
            }
        });
    }

    computeTrailingSegments() {
        if (!this.isDrawing || !this.trailingPoint || this.points.length === 0) {
            return [];
        }
        const segments = [[this.points[this.points.length - 1], this.trailingPoint]];
        if (this.featureType === CadFeatureType.POLYGON && this.points.length >= 2) {
            segments.push([this.trailingPoint, this.points[0]]);
        }
        return segments;
    }

    createEdge(start, end) {
        const edge = new Line2(new LineGeometry(), this.lineMaterial);
        edge.renderOrder = EDGE_RENDER_ORDER;
        this.placeEdge(edge, start, end);
        return edge;
    }

    placeEdge(edge, start, end) {
        edge.geometry.setPositions([0, 0, 0, end.x - start.x, end.y - start.y, end.z - start.z]);
        edge.position.copy(start);
    }

    getRelativeOutline() {
        const origin = this.points[0];
        return this.points.map((point) => ({ x: point.x - origin.x, y: point.y - origin.y }));
    }

    hasSimpleOutline() {
        return this.points.length >= MINIMUM_POINT_COUNTS[CadFeatureType.POLYGON] && isSimplePolygon(this.getRelativeOutline());
    }

    createFill() {
        const origin = this.points[0];
        const contour = this.getRelativeOutline().map((point) => new THREE.Vector2(point.x, point.y));
        const triangles = THREE.ShapeUtils.triangulateShape(contour, []);
        const positions = this.points.flatMap((point) => [point.x - origin.x, point.y - origin.y, point.z - origin.z]);
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
        geometry.setIndex(triangles.flat());
        this.fill = new THREE.Mesh(geometry, this.fillMaterial);
        this.fill.position.copy(origin);
        this.fill.renderOrder = FILL_RENDER_ORDER;
        this.add(this.fill);
    }

    removeFill() {
        if (this.fill) {
            this.remove(this.fill);
            this.fill.geometry.dispose();
            this.fill = null;
        }
    }

    disposeEdges(group) {
        for (const edge of [...group.children]) {
            group.remove(edge);
            edge.geometry.dispose();
        }
    }

    updateLabelPosition() {
        this.labelSprite.visible = this.label !== "" && this.points.length > 0;
        if (this.labelSprite.visible) {
            this.labelSprite.position.copy(this.computeLabelAnchor());
        }
    }

    computeLabelAnchor() {
        if (this.featureType !== CadFeatureType.POLYGON || this.points.length < MINIMUM_POINT_COUNTS[CadFeatureType.POLYGON]) {
            return this.computePointAtHalfLength();
        }
        const averagePoint = this.points.reduce((sum, point) => sum.add(point), new THREE.Vector3()).divideScalar(this.points.length);
        if (!this.hasSimpleOutline()) {
            return averagePoint;
        }
        const origin = this.points[0];
        const centroid = polygonCentroid(this.getRelativeOutline());
        return new THREE.Vector3(origin.x + centroid.x, origin.y + centroid.y, averagePoint.z);
    }

    computePointAtHalfLength() {
        const segmentLengths = this.points.slice(1).map((point, index) => point.distanceTo(this.points[index]));
        let remainingLength = segmentLengths.reduce((sum, length) => sum + length, 0) / 2;
        for (let index = 0; index < segmentLengths.length; index++) {
            if (remainingLength <= segmentLengths[index] && segmentLengths[index] > 0) {
                return this.points[index].clone().lerp(this.points[index + 1], remainingLength / segmentLengths[index]);
            }
            remainingLength -= segmentLengths[index];
        }
        return this.points[this.points.length - 1].clone();
    }

    updateScreenSize(camera, renderWidth, renderHeight) {
        this.lineMaterial.resolution.set(renderWidth, renderHeight);
        for (const marker of this.markerGroup.children) {
            marker.scale.setScalar(MARKER_RADIUS_PIXELS / this.computePixelsPerMetre(marker.position, camera, renderWidth, renderHeight));
        }
        if (this.labelSprite.visible) {
            const labelScale = LABEL_SCALE_PIXELS / this.computePixelsPerMetre(this.labelSprite.position, camera, renderWidth, renderHeight);
            this.labelSprite.scale.setScalar(labelScale);
        }
    }

    computePixelsPerMetre(position, camera, renderWidth, renderHeight) {
        return Utils.projectedRadius(1, camera, camera.position.distanceTo(position), renderWidth, renderHeight);
    }

    dispose() {
        this.disposeEdges(this.edgeGroup);
        this.disposeEdges(this.trailingGroup);
        this.removeFill();
        this.markerGroup.clear();
        this.markerGeometry.dispose();
        this.markerMaterial.dispose();
        this.fillMaterial.dispose();
        this.lineMaterial.dispose();
        this.labelSprite.material.map?.dispose();
        this.labelSprite.material.dispose();
    }
}
