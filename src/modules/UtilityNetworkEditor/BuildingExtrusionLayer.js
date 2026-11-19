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
import { EventDispatcher } from "../../EventDispatcher.js";
import { polygonCentroid } from "../../utils/PolygonMath.js";
import { BuildingHeightEstimator, BuildingHeightSource, ringToPolygon } from "./BuildingHeightEstimator.js";
import { SurfaceHeightModel, SurfaceHeightModelState } from "./SurfaceHeightModel.js";

const BLOCK_OPACITY = 0.6;
const EDGE_OPACITY = 0.75;
const EDGE_THRESHOLD_DEGREES = 30;
const MINIMUM_BLOCK_HEIGHT_METRES = 0.5;
const SURFACE_MODEL_MARGIN_METRES = 50;
const BLOCK_RENDER_ORDER = 1;
const EDGE_COLOR = 0x20242a;
const BlockStyle = Object.freeze({
    MEASURED: "measured",
    SURFACE: "surface",
    ESTIMATED: "estimated",
    SELECTED: "selected"
});
const BLOCK_COLORS = Object.freeze({
    [BlockStyle.MEASURED]: { wall: 0xe08e2b, roof: 0xffb74d },
    [BlockStyle.SURFACE]: { wall: 0x2f9e8f, roof: 0x6fd6c6 },
    [BlockStyle.ESTIMATED]: { wall: 0x7d8b95, roof: 0xb0bec5 },
    [BlockStyle.SELECTED]: { wall: 0x3d87e6, roof: 0x7db4ff }
});
const SOURCE_STYLES = Object.freeze({
    [BuildingHeightSource.POINT_CLOUD]: BlockStyle.MEASURED,
    [BuildingHeightSource.SURFACE_MODEL]: BlockStyle.SURFACE
});
const SOURCE_PRIORITY = Object.freeze([BuildingHeightSource.POINT_CLOUD, BuildingHeightSource.SURFACE_MODEL, BuildingHeightSource.FLOORS]);

function createSurfaceMaterial(color) {
    return new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: BLOCK_OPACITY, side: THREE.DoubleSide, depthWrite: false });
}

function createMaterials() {
    const materials = {};
    for (const [style, colors] of Object.entries(BLOCK_COLORS)) {
        materials[style] = [createSurfaceMaterial(colors.wall), createSurfaceMaterial(colors.roof)];
    }
    materials.edge = new THREE.LineBasicMaterial({ color: EDGE_COLOR, transparent: true, opacity: EDGE_OPACITY });
    return materials;
}

function createBlockGeometry(polygon, wallHeight) {
    const origin = polygon[0];
    const contour = polygon.map((point) => new THREE.Vector2(point.x - origin.x, point.y - origin.y));
    if (THREE.ShapeUtils.isClockWise(contour)) {
        contour.reverse();
    }
    const positions = [];
    contour.forEach((start, index) => {
        const end = contour[(index + 1) % contour.length];
        positions.push(
            start.x, start.y, 0, end.x, end.y, 0, end.x, end.y, wallHeight,
            start.x, start.y, 0, end.x, end.y, wallHeight, start.x, start.y, wallHeight
        );
    });
    const wallVertexCount = positions.length / 3;
    for (const triangle of THREE.ShapeUtils.triangulateShape(contour, [])) {
        for (const vertexIndex of triangle) {
            positions.push(contour[vertexIndex].x, contour[vertexIndex].y, wallHeight);
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.addGroup(0, wallVertexCount, 0);
    geometry.addGroup(wallVertexCount, positions.length / 3 - wallVertexCount, 1);
    return geometry;
}

function chooseStyle(result, isSelected) {
    if (isSelected) {
        return BlockStyle.SELECTED;
    }
    return SOURCE_STYLES[result.source] ?? BlockStyle.ESTIMATED;
}

function createPartKey(building, ring, ringIndex) {
    const centroid = polygonCentroid(ringToPolygon(ring));
    return `${building.identifier}:${ringIndex}:${centroid.x.toFixed(2)}:${centroid.y.toFixed(2)}`;
}

function computePartsExtent(parts) {
    const extent = { minimumX: Infinity, minimumY: Infinity, maximumX: -Infinity, maximumY: -Infinity };
    for (const part of parts) {
        for (const [x, y] of part.ring) {
            extent.minimumX = Math.min(extent.minimumX, x);
            extent.minimumY = Math.min(extent.minimumY, y);
            extent.maximumX = Math.max(extent.maximumX, x);
            extent.maximumY = Math.max(extent.maximumY, y);
        }
    }
    return extent;
}

function expandExtent(extent, margin) {
    return { minimumX: extent.minimumX - margin, minimumY: extent.minimumY - margin, maximumX: extent.maximumX + margin, maximumY: extent.maximumY + margin };
}

export class BuildingExtrusionLayer extends EventDispatcher {
    constructor(viewer, mapPlane) {
        super();
        this.viewer = viewer;
        this.mapPlane = mapPlane;
        this.estimator = new BuildingHeightEstimator(() => mapPlane.height);
        this.materials = createMaterials();
        this.group = new THREE.Group();
        this.group.visible = false;
        this.visible = false;
        this.entries = new Map();
        this.pointCloud = null;
        this.terrainHeightSampler = null;
        this.selectedIdentifier = null;
        this.raycaster = new THREE.Raycaster();
        this.surfaceHeightModel = new SurfaceHeightModel();
        this.estimator.setSurfaceHeightModel(this.surfaceHeightModel);
        viewer.scene.scene.add(this.group);
        this.estimator.addEventListener("estimated", (event) => this.onEstimated(event.key));
        this.surfaceHeightModel.addEventListener("state_changed", (event) => this.onSurfaceModelStateChanged(event.state));
    }

    setVisible(visible) {
        this.visible = visible;
        this.group.visible = visible;
        if (visible) {
            this.ensureSurfaceModel();
            this.estimateAll();
        }
        this.dispatchEvent({ type: "visibility_changed", visible: visible });
    }

    ensureSurfaceModel() {
        const parts = [...this.entries.values()].map((entry) => entry.part);
        if (parts.length === 0) {
            return;
        }
        const extent = computePartsExtent(parts);
        if (!this.surfaceHeightModel.covers(extent)) {
            this.surfaceHeightModel.load(expandExtent(extent, SURFACE_MODEL_MARGIN_METRES));
        }
    }

    onSurfaceModelStateChanged(state) {
        if (state === SurfaceHeightModelState.READY) {
            this.estimator.forgetEstimatesWithoutPointCloud();
            for (const entry of this.entries.values()) {
                if (entry.object && !this.estimator.getResult(entry.part)) {
                    this.removeObject(entry);
                }
            }
        }
        if (state === SurfaceHeightModelState.READY || state === SurfaceHeightModelState.FAILED) {
            this.estimator.resolveWaitingParts();
            if (this.visible) {
                this.estimateAll();
            }
        }
        this.dispatchProgress();
    }

    setPointCloud(pointCloud) {
        this.pointCloud = pointCloud;
        this.resetEstimates();
    }

    setTerrainHeightSampler(terrainHeightSampler) {
        this.terrainHeightSampler = terrainHeightSampler;
        terrainHeightSampler.addEventListener("ready", () => {
            if (this.terrainHeightSampler === terrainHeightSampler) {
                this.resetEstimates();
            }
        });
        this.resetEstimates();
    }

    isWaitingForTerrain() {
        return this.pointCloud !== null && !(this.terrainHeightSampler?.isReady ?? false);
    }

    resetEstimates() {
        this.estimator.setSources(this.pointCloud, this.isWaitingForTerrain() ? null : this.terrainHeightSampler);
        for (const entry of this.entries.values()) {
            this.removeObject(entry);
        }
        if (this.visible) {
            this.estimateAll();
        }
        this.dispatchProgress();
    }

    setBuildings(buildings) {
        const parts = buildings.flatMap((building) => building.outerRings.map((ring, ringIndex) => ({
            key: createPartKey(building, ring, ringIndex),
            identifier: building.identifier,
            label: building.label,
            attributes: building.attributes ?? {},
            isAligned: building.isAligned === true,
            ring: ring
        })));
        const nextKeys = new Set(parts.map((part) => part.key));
        for (const [key, entry] of this.entries) {
            if (!nextKeys.has(key)) {
                this.removeObject(entry);
                this.entries.delete(key);
            }
        }
        for (const part of parts) {
            if (!this.entries.has(part.key)) {
                this.entries.set(part.key, { part: part, object: null });
            }
        }
        if (this.visible) {
            this.ensureSurfaceModel();
            this.estimateAll();
        }
        this.dispatchProgress();
    }

    estimateAll() {
        if (this.isWaitingForTerrain()) {
            return;
        }
        for (const entry of this.entries.values()) {
            const result = this.estimator.getResult(entry.part);
            if (!result) {
                this.estimator.estimate(entry.part);
            } else if (!entry.object) {
                this.createObject(entry, result);
            }
        }
    }

    onEstimated(key) {
        const entry = this.entries.get(key);
        if (entry && !entry.object && this.visible) {
            this.createObject(entry, this.estimator.getResult(entry.part));
        }
        this.dispatchProgress();
    }

    createObject(entry, result) {
        if (result.roofHeight === null || result.roofHeight - result.baseHeight < MINIMUM_BLOCK_HEIGHT_METRES) {
            return;
        }
        const polygon = ringToPolygon(entry.part.ring);
        const geometry = createBlockGeometry(polygon, result.roofHeight - result.baseHeight);
        const mesh = new THREE.Mesh(geometry, this.materials[chooseStyle(result, entry.part.identifier === this.selectedIdentifier)]);
        mesh.renderOrder = BLOCK_RENDER_ORDER;
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry, EDGE_THRESHOLD_DEGREES), this.materials.edge);
        const object = new THREE.Group();
        object.add(mesh, edges);
        object.position.set(polygon[0].x, polygon[0].y, result.baseHeight);
        object.userData.partKey = entry.part.key;
        this.group.add(object);
        entry.object = object;
    }

    removeObject(entry) {
        if (!entry.object) {
            return;
        }
        this.group.remove(entry.object);
        entry.object.traverse((node) => node.geometry?.dispose());
        entry.object = null;
    }

    dispatchProgress() {
        const results = [...this.entries.values()].map((entry) => this.estimator.getResult(entry.part));
        const countSource = (source) => results.filter((result) => result?.source === source).length;
        this.dispatchEvent({
            type: "progress",
            buildingCount: this.entries.size,
            isWaitingForTerrain: this.isWaitingForTerrain(),
            isLoadingSurfaceModel: this.surfaceHeightModel.state === SurfaceHeightModelState.LOADING,
            pendingCount: results.filter((result) => result === null).length,
            measuredCount: countSource(BuildingHeightSource.POINT_CLOUD),
            surfaceCount: countSource(BuildingHeightSource.SURFACE_MODEL),
            estimatedCount: countSource(BuildingHeightSource.FLOORS),
            unknownCount: countSource(BuildingHeightSource.NONE)
        });
    }

    describeBuilding(identifier) {
        const parts = [...this.entries.values()].filter((entry) => entry.part.identifier === identifier);
        if (parts.length === 0) {
            return null;
        }
        const results = parts.map((entry) => this.estimator.getResult(entry.part)).filter(Boolean);
        const source = SOURCE_PRIORITY.find((candidate) => results.some((result) => result.source === candidate)) ?? BuildingHeightSource.NONE;
        const usedResults = results.filter((result) => result.source === source);
        const { label, attributes, isAligned } = parts[0].part;
        return {
            identifier: identifier,
            label: label,
            attributes: attributes,
            isAligned: isAligned,
            source: source,
            baseHeight: usedResults.length > 0 ? Math.min(...usedResults.map((result) => result.baseHeight)) : null,
            roofHeight: usedResults.length > 0 ? Math.max(...usedResults.map((result) => result.roofHeight)) : null,
            sampleCount: usedResults.reduce((sum, result) => sum + result.sampleCount, 0)
        };
    }

    pickBuilding(screenX, screenY) {
        if (!this.visible) {
            return null;
        }
        const { width, height } = this.mapPlane.getRenderSize();
        this.raycaster.setFromCamera(new THREE.Vector2(screenX / width * 2 - 1, 1 - screenY / height * 2), this.viewer.scene.getActiveCamera());
        const meshes = [...this.entries.values()].filter((entry) => entry.object).map((entry) => entry.object.children[0]);
        const hit = this.raycaster.intersectObjects(meshes, false)[0];
        const entry = hit ? this.entries.get(hit.object.parent.userData.partKey) : null;
        return entry ? this.describeBuilding(entry.part.identifier) : null;
    }

    setSelectedIdentifier(identifier) {
        this.selectedIdentifier = identifier;
        for (const entry of this.entries.values()) {
            if (entry.object) {
                const result = this.estimator.getResult(entry.part);
                entry.object.children[0].material = this.materials[chooseStyle(result, entry.part.identifier === identifier)];
            }
        }
    }
}
