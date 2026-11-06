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
import { isSimplePolygon, polygonArea, polygonCentroid } from "../../utils/PolygonMath.js";

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
const SELECTED_MARKER_RADIUS_PIXELS = 9;
const SELECTED_VERTEX_RADIUS_PIXELS = 11;
const SELECTED_VERTEX_COLOR = 0xffffff;
const LABEL_SCALE_PIXELS = 60;
const LABEL_FONT_SIZE = 24;
const LINE_WIDTH_PIXELS = 3;
const SELECTED_LINE_WIDTH_PIXELS = 6;
const FILL_OPACITY = 0.2;
const SELECTED_FILL_OPACITY = 0.35;
const FILL_RENDER_ORDER = 1;
const EDGE_RENDER_ORDER = 2;
const MARKER_RENDER_ORDER = 3;
const LABEL_RENDER_ORDER = 4;

export class CadFeature extends THREE.Object3D {
    constructor(featureType, style) {
        super();
        this.featureType = featureType;
        this.label = "";
        this.layerId = null;
        this.color = new THREE.Color(style.color);
        this.points = [];
        this.isDrawing = false;
        this.isSelected = false;
        this.selectedVertexIndex = null;
        this.trailingPoint = null;

        this.markerGeometry = new THREE.SphereGeometry(1, 12, 12);
        this.markerMaterial = new THREE.MeshBasicMaterial({ color: this.color, transparent: true, depthTest: false, depthWrite: false });
        this.selectedVertexMaterial = new THREE.MeshBasicMaterial({
            color: SELECTED_VERTEX_COLOR,
            transparent: true,
            depthTest: false,
            depthWrite: false
        });
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
        this.rebuild();
    }

    setSelected(isSelected) {
        this.isSelected = isSelected;
        this.selectedVertexIndex = null;
        this.lineMaterial.linewidth = isSelected ? SELECTED_LINE_WIDTH_PIXELS : LINE_WIDTH_PIXELS;
        this.fillMaterial.opacity = isSelected ? SELECTED_FILL_OPACITY : FILL_OPACITY;
        this.rebuild();
    }

    setSelectedVertex(index) {
        this.selectedVertexIndex = index;
        this.syncMarkers();
    }

    addPoint(position) {
        this.points.push(position.clone());
        this.rebuild();
    }

    setPoints(points) {
        this.points = points.map((point) => point.clone());
        this.rebuild();
    }

    setPointAt(index, position) {
        this.points[index].copy(position);
        this.rebuild();
    }

    insertPointAt(index, position) {
        this.points.splice(index, 0, position.clone());
        this.selectedVertexIndex = index;
        this.rebuild();
    }

    removePointAt(index) {
        this.points.splice(index, 1);
        this.selectedVertexIndex = null;
        this.rebuild();
    }

    computeHorizontalLength() {
        return this.computeEdgeSegments().reduce((sum, [start, end]) => sum + Math.hypot(end.x - start.x, end.y - start.y), 0);
    }

    computeSlopeLength() {
        return this.computeEdgeSegments().reduce((sum, [start, end]) => sum + start.distanceTo(end), 0);
    }

    computeArea() {
        return this.featureType === CadFeatureType.POLYGON && this.hasSimpleOutline() ? polygonArea(this.getRelativeOutline()) : null;
    }

    toData() {
        return {
            featureType: this.featureType,
            label: this.label,
            color: `#${this.color.getHexString()}`,
            layerId: this.layerId,
            points: this.points.map((point) => point.toArray())
        };
    }

    static fromData(data) {
        const feature = new CadFeature(data.featureType, { label: data.label, color: data.color });
        feature.layerId = data.layerId;
        feature.setPoints(data.points.map((coordinates) => new THREE.Vector3().fromArray(coordinates)));
        return feature;
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
        this.syncEdges(this.trailingGroup, this.computeTrailingSegments());
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
        this.syncMarkers();
        this.syncEdges(this.edgeGroup, this.computeEdgeSegments());
        this.syncEdges(this.trailingGroup, this.computeTrailingSegments());
        this.removeFill();
        if (this.isClosed() && this.hasSimpleOutline()) {
            this.createFill();
        }
        this.updateLabelPosition();
    }

    isClosed() {
        return this.featureType === CadFeatureType.POLYGON && !this.isDrawing;
    }

    syncMarkers() {
        const showsMarkers = this.featureType === CadFeatureType.POINT || this.isDrawing || this.isSelected;
        const markerCount = showsMarkers ? this.points.length : 0;
        while (this.markerGroup.children.length > markerCount) {
            this.markerGroup.remove(this.markerGroup.children[this.markerGroup.children.length - 1]);
        }
        while (this.markerGroup.children.length < markerCount) {
            const marker = new THREE.Mesh(this.markerGeometry, this.markerMaterial);
            marker.renderOrder = MARKER_RENDER_ORDER;
            this.markerGroup.add(marker);
        }
        this.markerGroup.children.forEach((marker, index) => {
            marker.position.copy(this.points[index]);
            marker.material = index === this.selectedVertexIndex ? this.selectedVertexMaterial : this.markerMaterial;
        });
    }

    computeEdgeSegments() {
        const segmentCount = this.isClosed() ? this.points.length : this.points.length - 1;
        const segments = [];
        for (let index = 0; index < segmentCount; index++) {
            segments.push([this.points[index], this.points[(index + 1) % this.points.length]]);
        }
        return segments;
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

    syncEdges(group, segments) {
        while (group.children.length > segments.length) {
            const edge = group.children[group.children.length - 1];
            group.remove(edge);
            edge.geometry.dispose();
        }
        segments.forEach(([start, end], index) => {
            let edge = group.children[index];
            if (!edge) {
                edge = new Line2(new LineGeometry(), this.lineMaterial);
                edge.renderOrder = EDGE_RENDER_ORDER;
                group.add(edge);
            }
            edge.geometry.setPositions([0, 0, 0, end.x - start.x, end.y - start.y, end.z - start.z]);
            edge.position.copy(start);
        });
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
        const markerRadius = this.isSelected ? SELECTED_MARKER_RADIUS_PIXELS : MARKER_RADIUS_PIXELS;
        this.markerGroup.children.forEach((marker, index) => {
            const radius = index === this.selectedVertexIndex ? SELECTED_VERTEX_RADIUS_PIXELS : markerRadius;
            marker.scale.setScalar(radius / this.computePixelsPerMetre(marker.position, camera, renderWidth, renderHeight));
        });
        if (this.labelSprite.visible) {
            const labelScale = LABEL_SCALE_PIXELS / this.computePixelsPerMetre(this.labelSprite.position, camera, renderWidth, renderHeight);
            this.labelSprite.scale.setScalar(labelScale);
        }
    }

    computePixelsPerMetre(position, camera, renderWidth, renderHeight) {
        return Utils.projectedRadius(1, camera, camera.position.distanceTo(position), renderWidth, renderHeight);
    }

    dispose() {
        this.syncEdges(this.edgeGroup, []);
        this.syncEdges(this.trailingGroup, []);
        this.removeFill();
        this.markerGroup.clear();
        this.markerGeometry.dispose();
        this.markerMaterial.dispose();
        this.selectedVertexMaterial.dispose();
        this.fillMaterial.dispose();
        this.lineMaterial.dispose();
        this.labelSprite.material.map?.dispose();
        this.labelSprite.material.dispose();
    }
}
