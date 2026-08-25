/*! ******************************************************************************************************** *
 *
 * Copyright 2026 Oidis
 *
 * SPDX-License-Identifier: BSD-2-Clause
 * The BSD-2-Clause license for this file can be found in the LICENSE.txt file included with this distribution
 * or at https://spdx.org/licenses/BSD-2-Clause.html#licenseText
 *
 * ********************************************************************************************************* */

import * as THREE from "../../libs/three.js/build/three.module.js";
import { TextSprite } from "../TextSprite.js";
import { Utils } from "../utils.js";
import { bindDuplicateDrag } from "./DuplicateDrag.js";
import { Line2 } from "../../libs/three.js/lines/Line2.js";
import { LineGeometry } from "../../libs/three.js/lines/LineGeometry.js";
import { LineMaterial } from "../../libs/three.js/lines/LineMaterial.js";
import { prismVolume, computeCentroid, shadeColor } from "./CubatureMath.js";
import { buildSurfaceMeshData } from "./TerrainGridMath.js";
import { encodeSurfaceGrid, decodeSurfaceGrid } from "./SurfaceGridCodec.js";
import { intersectDragWithLockPlane, lockPlaneZAt, refreshHeightLockVisual } from "./HeightLockPlane.js";
import { sphereHoverEmissive, sphereRestEmissive } from "./VertexSelection.js";

function isValidPosition(p) {
    return p
        && Number.isFinite(p.x)
        && Number.isFinite(p.y)
        && Number.isFinite(p.z);
}

function createVolumeLabel() {
    const label = new TextSprite("");
    label.setTextColor({ r: 140, g: 250, b: 140, a: 1.0 });
    label.setBorderColor({ r: 0, g: 0, b: 0, a: 1.0 });
    label.setBackgroundColor({ r: 0, g: 0, b: 0, a: 1.0 });
    label.fontsize = 16;
    label.material.depthTest = false;
    label.material.opacity = 1;
    label.visible = false;
    return label;
}

function createEdgeLabel() {
    const label = new TextSprite("");
    label.setTextColor({ r: 210, g: 230, b: 255, a: 1.0 });
    label.setBorderColor({ r: 0, g: 0, b: 0, a: 1.0 });
    label.setBackgroundColor({ r: 0, g: 0, b: 0, a: 1.0 });
    label.fontsize = 14;
    label.material.depthTest = false;
    label.material.opacity = 1;
    label.visible = false;
    return label;
}

function formatLengthCs(value, unitCode) {
    const text = value.toLocaleString("cs-CZ", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
    return text + " " + unitCode;
}

export class Cubature extends THREE.Object3D {
    constructor(args = {}) {
        super();

        this.constructor.counter = (this.constructor.counter === undefined) ? 0 : this.constructor.counter + 1;
        this.name = args.name !== undefined ? args.name : "Cubature_" + this.constructor.counter;

        this.phase = "insertion";
        this.enabled = true;

        this.topControlPoints = [];
        this.bottomControlPoints = [];

        this.autoMode = false;
        this.heightLock = null;
        this.heightLockVisual = null;
        this.autoOptions = null;
        this.autoStale = false;
        this.computationState = "idle";
        this.computationProgress = null;
        this.computedVolume = null;
        this.computedQuality = null;
        this.computedStats = null;
        this.computedInputHash = null;
        this.detectedSurface = null;
        this.detectedSurfaceMesh = null;
        this._suppressAutoStale = false;
        this._loadingFromDb = false;
        this._autoRecomputeWired = false;
        this._autoRecomputeTimer = null;

        this.topSpheres = [];
        this.bottomSpheres = [];
        this.topEdges = [];
        this.bottomEdges = [];
        this.sideEdges = [];
        this.sideMeshes = [];
        this.topEdgeLabels = [];
        this.bottomEdgeLabels = [];
        this.sideEdgeLabels = [];
        this.showEdgeLengths = true;
        this.permanentLabelsVisible = true;
        this.isHovered = false;
        this.isListHovered = false;
        this.isPinned = false;

        this.baseColor = args.color !== undefined ? args.color : 0xff0000;
        this.topColor = args.topColor !== undefined ? args.topColor : shadeColor(this.baseColor, -0.35);
        this.bottomColor = args.bottomColor !== undefined ? args.bottomColor : shadeColor(this.baseColor, 0.5);
        this.sideColor = args.sideColor !== undefined ? args.sideColor : this.baseColor;
        this.sideMeshColor = args.sideMeshColor !== undefined ? args.sideMeshColor : shadeColor(this.baseColor, 0.5);

        this.sphereGeometry = new THREE.SphereGeometry(0.4, 10, 10);
        this.settingsHandle = this.createSettingsHandle();
        this.add(this.settingsHandle);

        this.topMesh = this.createPolygonMesh(this.topColor);
        this.bottomMesh = this.createPolygonMesh(this.bottomColor);
        this.add(this.topMesh);
        this.add(this.bottomMesh);

        this.volumeLabel = createVolumeLabel();
        this.add(this.volumeLabel);

        this.lengthUnit = null;
        this.lengthUnitDisplay = null;
    }

    createSphereMaterial(color) {
        return new THREE.MeshLambertMaterial({
            color: color,
            depthTest: false,
            depthWrite: false
        });
    }

    createSettingsHandle() {
        const handle = new THREE.Mesh(this.sphereGeometry, new THREE.MeshLambertMaterial({
            color: 0xffffff, depthTest: false, depthWrite: false
        }));
        handle.name = "cubature_settings_handle";
        handle.visible = false;
        handle.addEventListener("mouseover", () => {
            if (this.enabled) {
                handle.material.emissive.setHex(0x888888);
            }
        });
        handle.addEventListener("mouseleave", () => {
            handle.material.emissive.setHex(handle.isElementSelected === true ? 0x888888 : 0x000000);
        });
        // A drag listener makes InputHandler route pointer presses to the handle instead of the camera.
        handle.addEventListener("drag", () => undefined);
        return handle;
    }

    pickSettingsHandle(raycaster) {
        if (!this.settingsHandle.visible) {
            return false;
        }
        const intersects = [];
        this.settingsHandle.raycast(raycaster, intersects);
        return intersects.length > 0;
    }

    setShowLabels(visible) {
        this.permanentLabelsVisible = visible;
    }

    isRevealed() {
        return this.isHovered === true || this.isListHovered === true || this.isPinned === true;
    }

    detailLabelsVisible() {
        return this.phase === "insertion" || this.phase === "pushpull" || this.isRevealed();
    }

    createEdge(color, linewidth) {
        const geometry = new LineGeometry();
        geometry.setPositions([0, 0, 0, 0, 0, 0]);
        const material = new LineMaterial({
            color: color,
            linewidth: linewidth,
            resolution: new THREE.Vector2(1000, 1000)
        });
        material.depthTest = false;
        const edge = new Line2(geometry, material);
        this.attachDuplicateDrag(edge);
        return edge;
    }

    createDuplicatePreview() {
        const group = new THREE.Group();
        group.renderOrder = 9999;
        const allEdges = [...this.topEdges, ...this.bottomEdges, ...this.sideEdges];
        for (const edge of allEdges) {
            if (edge.visible === false) {
                continue;
            }
            const clone = edge.clone();
            clone.material = edge.material.clone();
            clone.material.color.set(0x00ffff);
            clone.material.transparent = true;
            clone.material.opacity = 0.6;
            clone.material.depthTest = false;
            clone.renderOrder = 9999;
            group.add(clone);
        }
        return group;
    }

    attachDuplicateDrag(target) {
        bindDuplicateDrag(this, target, {
            eventType: "cubature_duplicate",
            payloadKey: "cubature",
            useGroundFallback: true,
            getReferenceZ: () => this.topControlPoints.length > 0 ? this.topControlPoints[0].z : 0
        });
    }

    createSideMesh() {
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(18);
        geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
        const material = new THREE.MeshBasicMaterial({
            color: this.sideMeshColor,
            transparent: true,
            opacity: 0.15,
            depthTest: true,
            depthWrite: false,
            side: THREE.DoubleSide
        });
        const mesh = new THREE.Mesh(geometry, material);
        return mesh;
    }

    createPolygonMesh(color) {
        const geometry = new THREE.BufferGeometry();
        const material = new THREE.MeshBasicMaterial({
            color: color,
            transparent: true,
            opacity: 0.18,
            depthTest: true,
            depthWrite: false,
            side: THREE.DoubleSide
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.visible = false;
        return mesh;
    }

    updatePolygonMesh(mesh, controlPoints) {
        const N = controlPoints.length;
        if (N < 3) {
            mesh.visible = false;
            return;
        }
        const shape2D = controlPoints.map(p => new THREE.Vector2(p.x, p.y));
        const triangles = THREE.ShapeUtils.triangulateShape(shape2D, []);
        if (triangles.length === 0) {
            mesh.visible = false;
            return;
        }
        const positions = new Float32Array(N * 3);
        for (let i = 0; i < N; i++) {
            positions[i * 3] = controlPoints[i].x;
            positions[i * 3 + 1] = controlPoints[i].y;
            positions[i * 3 + 2] = controlPoints[i].z;
        }
        const indices = new Uint32Array(triangles.length * 3);
        for (let i = 0; i < triangles.length; i++) {
            indices[i * 3] = triangles[i][0];
            indices[i * 3 + 1] = triangles[i][1];
            indices[i * 3 + 2] = triangles[i][2];
        }
        mesh.geometry.dispose();
        mesh.geometry = new THREE.BufferGeometry();
        mesh.geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
        mesh.geometry.setIndex(new THREE.BufferAttribute(indices, 1));
        mesh.geometry.computeVertexNormals();
        mesh.geometry.computeBoundingSphere();
        mesh.visible = true;
    }

    attachSphereHandlers(sphere, polygonId) {
        const mouseover = (e) => {
            if (!this.enabled) {
                return;
            }
            e.object.material.emissive.setHex(sphereHoverEmissive(e.object));
        };
        const mouseleave = (e) => {
            e.object.material.emissive.setHex(sphereRestEmissive(e.object));
        };
        const drag = (e) => {
            if (!this.enabled || this.phase === "pushpull" || this.phase === "computing") {
                return;
            }
            const list = polygonId === "top" ? this.topSpheres : this.bottomSpheres;
            const index = list.indexOf(e.drag.object);
            if (index === -1) {
                return;
            }
            const lockActive = this.heightLock !== null && polygonId === "top";
            const intersection = Utils.getMousePointCloudIntersection(
                e.drag.end,
                e.viewer.scene.getActiveCamera(),
                e.viewer,
                e.viewer.scene.pointclouds,
                { pickClipped: true }
            );
            let target = null;
            if (intersection && intersection.distance !== null) {
                target = intersection.location.clone();
                if (lockActive) {
                    target.z = lockPlaneZAt(this.heightLock, target.x, target.y);
                }
            } else if (lockActive) {
                target = intersectDragWithLockPlane(e.drag.end, e.viewer, this.heightLock);
            } else {
                const camera = e.viewer.scene.getActiveCamera();
                const renderer = e.viewer.renderer;
                const ndc = new THREE.Vector2(
                    (e.drag.end.x / renderer.domElement.clientWidth) * 2 - 1,
                    -(e.drag.end.y / renderer.domElement.clientHeight) * 2 + 1
                );
                const raycaster = new THREE.Raycaster();
                raycaster.setFromCamera(ndc, camera);
                const list2 = polygonId === "top" ? this.topControlPoints : this.bottomControlPoints;
                const currentPoint = list2[index];
                const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -currentPoint.z);
                const hit = new THREE.Vector3();
                if (raycaster.ray.intersectPlane(plane, hit)) {
                    target = hit;
                }
            }
            if (!target) {
                return;
            }
            if (polygonId === "top") {
                this.setTopPoint(index, target);
            } else {
                this.setBottomPoint(index, target);
            }
        };

        sphere.addEventListener("mouseover", mouseover);
        sphere.addEventListener("mouseleave", mouseleave);
        sphere.addEventListener("drag", drag);
    }

    addTopMarker(position) {
        if (!isValidPosition(position)) {
            return;
        }
        this.topControlPoints.push(position.clone());

        const sphere = new THREE.Mesh(this.sphereGeometry, this.createSphereMaterial(this.topColor));
        this.add(sphere);
        this.topSpheres.push(sphere);
        this.attachSphereHandlers(sphere, "top");

        if (this.topControlPoints.length >= 2) {
            const edge = this.createEdge(this.topColor, 2);
            this.add(edge);
            this.topEdges.push(edge);
            const lbl = createEdgeLabel();
            this.add(lbl);
            this.topEdgeLabels.push(lbl);
        }

        this.update();
        this.dispatchEvent({ type: "marker_added", cubature: this, polygonId: "top" });
    }

    removeTopMarker(index) {
        if (index < 0 || index >= this.topControlPoints.length) {
            return;
        }
        const sphere = this.topSpheres[index];
        this.remove(sphere);
        sphere.material.dispose();
        this.topSpheres.splice(index, 1);
        this.topControlPoints.splice(index, 1);

        if (this.topEdges.length > 0) {
            const lastEdge = this.topEdges.pop();
            this.remove(lastEdge);
            lastEdge.geometry.dispose();
            lastEdge.material.dispose();
        }
        if (this.topEdgeLabels.length > 0) {
            const lastLabel = this.topEdgeLabels.pop();
            this.remove(lastLabel);
        }

        this.update();
        this.dispatchEvent({ type: "marker_removed", cubature: this, polygonId: "top" });
    }

    closeTopPolygon() {
        if (this.topControlPoints.length < 3) {
            return false;
        }

        const closingEdge = this.createEdge(this.topColor, 2);
        this.add(closingEdge);
        this.topEdges.push(closingEdge);
        const closingLabel = createEdgeLabel();
        this.add(closingLabel);
        this.topEdgeLabels.push(closingLabel);

        for (let i = 0; i < this.topControlPoints.length; i++) {
            const bottomPoint = this.topControlPoints[i].clone();
            this.bottomControlPoints.push(bottomPoint);

            const bsphere = new THREE.Mesh(this.sphereGeometry, this.createSphereMaterial(this.bottomColor));
            this.add(bsphere);
            this.bottomSpheres.push(bsphere);
            this.attachSphereHandlers(bsphere, "bottom");

            const bedge = this.createEdge(this.bottomColor, 2);
            this.add(bedge);
            this.bottomEdges.push(bedge);

            const sedge = this.createEdge(this.sideColor, 1);
            this.add(sedge);
            this.sideEdges.push(sedge);

            const smesh = this.createSideMesh();
            this.add(smesh);
            this.sideMeshes.push(smesh);

            const blbl = createEdgeLabel();
            this.add(blbl);
            this.bottomEdgeLabels.push(blbl);

            const slbl = createEdgeLabel();
            this.add(slbl);
            this.sideEdgeLabels.push(slbl);
        }

        this.phase = "pushpull";
        this.update();
        this.dispatchEvent({ type: "phase_changed", cubature: this, phase: this.phase });
        return true;
    }

    setPushPullOffset(deltaZ) {
        const clamped = Math.max(-100, Math.min(100, deltaZ));
        for (let i = 0; i < this.topControlPoints.length; i++) {
            const top = this.topControlPoints[i];
            const bottom = this.bottomControlPoints[i];
            bottom.x = top.x;
            bottom.y = top.y;
            bottom.z = top.z + clamped;
        }
        this.update();
    }

    commitPushPull() {
        this.phase = "edit";
        this.update();
        this.dispatchEvent({ type: "phase_changed", cubature: this, phase: this.phase });
    }

    setTopPoint(index, newPosition) {
        if (!isValidPosition(newPosition)) {
            return;
        }
        if (index < 0 || index >= this.topControlPoints.length) {
            return;
        }
        this.topControlPoints[index].copy(newPosition);
        this.markAutoStale();
        this.update();
        this.dispatchEvent({ type: "marker_moved", cubature: this, polygonId: "top", index: index });
    }

    setBottomPoint(index, newPosition) {
        if (!isValidPosition(newPosition)) {
            return;
        }
        if (index < 0 || index >= this.bottomControlPoints.length) {
            return;
        }
        this.bottomControlPoints[index].copy(newPosition);
        this.markAutoStale();
        this.update();
        this.dispatchEvent({ type: "marker_moved", cubature: this, polygonId: "bottom", index: index });
    }

    applyHeightLock(lock) {
        this.heightLock = lock;
        refreshHeightLockVisual(this, lock, this.topControlPoints);
        this.dispatchEvent({ type: "height_lock_changed", cubature: this, lock });
    }

    markAutoStale() {
        if (!this.autoMode || this._suppressAutoStale || this._loadingFromDb || this.autoStale) {
            return;
        }
        if (this.phase !== "edit") {
            return;
        }
        this.autoStale = true;
        this.dispatchEvent({ type: "stale_changed", cubature: this, stale: true });
    }

    beginComputing() {
        this.phase = "computing";
        this.computationState = "computing";
        this.computationProgress = null;
        this.update();
        this.dispatchEvent({ type: "phase_changed", cubature: this, phase: this.phase });
        this.dispatchEvent({ type: "computation_started", cubature: this });
    }

    applyComputedResult(result) {
        this._suppressAutoStale = true;
        for (let i = 0; i < this.topControlPoints.length; i++) {
            const top = this.topControlPoints[i];
            const bottom = this.bottomControlPoints[i];
            bottom.x = top.x;
            bottom.y = top.y;
            bottom.z = result.bottomZByIndex[i];
        }
        this.applyDetectedSurface(result.surface);
        this.computedVolume = result.volume;
        this.computedQuality = result.quality;
        this.computedStats = result.stats;
        this.computedInputHash = result.inputHash;
        this.computationState = "done";
        this.computationProgress = null;
        this.autoStale = false;
        this.update();
        this._suppressAutoStale = false;
    }

    insertVertexAt(polygonId, edgeIndex, position) {
        if (this.phase !== "edit") {
            return false;
        }
        const N = this.topControlPoints.length;
        if (N === 0 || edgeIndex < 0 || edgeIndex >= N) {
            return false;
        }
        const nextIndex = (edgeIndex + 1) % N;

        let t = 0.5;
        if (position && isValidPosition(position)) {
            const source = polygonId === "top" ? this.topControlPoints : this.bottomControlPoints;
            const a = source[edgeIndex];
            const b = source[nextIndex];
            const abx = b.x - a.x;
            const aby = b.y - a.y;
            const abz = b.z - a.z;
            const abLen2 = abx * abx + aby * aby + abz * abz;
            if (abLen2 > 1e-12) {
                const apx = position.x - a.x;
                const apy = position.y - a.y;
                const apz = position.z - a.z;
                t = (apx * abx + apy * aby + apz * abz) / abLen2;
                t = Math.max(0, Math.min(1, t));
            }
        }

        const midTop = this.topControlPoints[edgeIndex].clone().lerp(this.topControlPoints[nextIndex], t);
        const midBottom = this.bottomControlPoints[edgeIndex].clone().lerp(this.bottomControlPoints[nextIndex], t);
        if (position && isValidPosition(position)) {
            if (polygonId === "top") {
                midTop.copy(position);
            } else {
                midBottom.copy(position);
            }
        }

        const insertIndex = edgeIndex + 1;
        this.topControlPoints.splice(insertIndex, 0, midTop);
        this.bottomControlPoints.splice(insertIndex, 0, midBottom);

        const tsphere = new THREE.Mesh(this.sphereGeometry, this.createSphereMaterial(this.topColor));
        this.add(tsphere);
        this.topSpheres.splice(insertIndex, 0, tsphere);
        this.attachSphereHandlers(tsphere, "top");

        const bsphere = new THREE.Mesh(this.sphereGeometry, this.createSphereMaterial(this.bottomColor));
        this.add(bsphere);
        this.bottomSpheres.splice(insertIndex, 0, bsphere);
        this.attachSphereHandlers(bsphere, "bottom");

        const newTopEdge = this.createEdge(this.topColor, 2);
        this.add(newTopEdge);
        this.topEdges.splice(insertIndex, 0, newTopEdge);

        const newBottomEdge = this.createEdge(this.bottomColor, 2);
        this.add(newBottomEdge);
        this.bottomEdges.splice(insertIndex, 0, newBottomEdge);

        const newSideEdge = this.createEdge(this.sideColor, 1);
        this.add(newSideEdge);
        this.sideEdges.splice(insertIndex, 0, newSideEdge);

        const newSideMesh = this.createSideMesh();
        this.add(newSideMesh);
        this.sideMeshes.splice(insertIndex, 0, newSideMesh);

        const newTopLabel = createEdgeLabel();
        this.add(newTopLabel);
        this.topEdgeLabels.splice(insertIndex, 0, newTopLabel);
        const newBottomLabel = createEdgeLabel();
        this.add(newBottomLabel);
        this.bottomEdgeLabels.splice(insertIndex, 0, newBottomLabel);
        const newSideLabel = createEdgeLabel();
        this.add(newSideLabel);
        this.sideEdgeLabels.splice(insertIndex, 0, newSideLabel);

        this.markAutoStale();
        this.update();
        this.dispatchEvent({ type: "vertex_inserted", cubature: this, polygonId: polygonId, index: insertIndex });
        return true;
    }

    removeVertex(index) {
        if (this.phase !== "edit") {
            return false;
        }
        if (this.topControlPoints.length <= 3) {
            return false;
        }
        if (index < 0 || index >= this.topControlPoints.length) {
            return false;
        }

        this.topControlPoints.splice(index, 1);
        this.bottomControlPoints.splice(index, 1);

        const disposeMesh = (m, disposeGeometry) => {
            this.remove(m);
            if (disposeGeometry && m.geometry) {
                m.geometry.dispose();
            }
            if (m.material) {
                m.material.dispose();
            }
        };

        disposeMesh(this.topSpheres.splice(index, 1)[0], false);
        disposeMesh(this.bottomSpheres.splice(index, 1)[0], false);
        disposeMesh(this.topEdges.splice(index, 1)[0], true);
        disposeMesh(this.bottomEdges.splice(index, 1)[0], true);
        disposeMesh(this.sideEdges.splice(index, 1)[0], true);
        disposeMesh(this.sideMeshes.splice(index, 1)[0], true);
        this.remove(this.topEdgeLabels.splice(index, 1)[0]);
        this.remove(this.bottomEdgeLabels.splice(index, 1)[0]);
        this.remove(this.sideEdgeLabels.splice(index, 1)[0]);

        this.markAutoStale();
        this.update();
        this.dispatchEvent({ type: "vertex_removed", cubature: this, index: index });
        return true;
    }

    computeVolume() {
        if (this.autoMode && this.computedVolume !== null) {
            return this.computedVolume;
        }
        if (this.topControlPoints.length < 3 || this.bottomControlPoints.length < 3) {
            return 0;
        }
        return prismVolume(this.topControlPoints, this.bottomControlPoints);
    }

    dispose() {
        for (const sphere of [...this.topSpheres, ...this.bottomSpheres]) {
            sphere.material.dispose();
        }
        this.settingsHandle.material.dispose();
        this.sphereGeometry.dispose();
        for (const edge of [...this.topEdges, ...this.bottomEdges, ...this.sideEdges]) {
            edge.geometry.dispose();
            edge.material.dispose();
        }
        for (const mesh of [...this.sideMeshes, this.topMesh, this.bottomMesh]) {
            mesh.geometry.dispose();
            mesh.material.dispose();
        }
        if (this.detectedSurfaceMesh !== null) {
            this.detectedSurfaceMesh.geometry.dispose();
            this.detectedSurfaceMesh.material.dispose();
        }
        const labels = [
            ...this.topEdgeLabels, ...this.bottomEdgeLabels, ...this.sideEdgeLabels, this.volumeLabel
        ];
        for (const label of labels) {
            if (label.material.map) {
                label.material.map.dispose();
            }
            label.material.dispose();
        }
    }

    update() {
        const N = this.topControlPoints.length;
        const M = this.bottomControlPoints.length;

        for (let i = 0; i < this.topSpheres.length; i++) {
            this.topSpheres[i].position.copy(this.topControlPoints[i]);
        }
        for (let i = 0; i < this.bottomSpheres.length; i++) {
            this.bottomSpheres[i].position.copy(this.bottomControlPoints[i]);
        }

        for (let i = 0; i < this.topEdges.length; i++) {
            if (N < 2) {
                this.topEdges[i].visible = false;
                continue;
            }
            const next = (i + 1) % N;
            const isClosing = (i === N - 1);
            if (isClosing && this.phase === "insertion") {
                this.topEdges[i].visible = false;
                continue;
            }
            const a = this.topControlPoints[i];
            const b = this.topControlPoints[next];
            const edge = this.topEdges[i];
            edge.visible = true;
            edge.position.copy(a);
            edge.geometry.setPositions([0, 0, 0, b.x - a.x, b.y - a.y, b.z - a.z]);
            edge.computeLineDistances();
            edge.geometry.computeBoundingSphere();
        }

        for (let i = 0; i < this.bottomEdges.length; i++) {
            if (M < 2) {
                this.bottomEdges[i].visible = false;
                continue;
            }
            const next = (i + 1) % M;
            const a = this.bottomControlPoints[i];
            const b = this.bottomControlPoints[next];
            const edge = this.bottomEdges[i];
            edge.visible = true;
            edge.position.copy(a);
            edge.geometry.setPositions([0, 0, 0, b.x - a.x, b.y - a.y, b.z - a.z]);
            edge.computeLineDistances();
            edge.geometry.computeBoundingSphere();
        }

        for (let i = 0; i < this.sideEdges.length; i++) {
            if (i >= M) {
                this.sideEdges[i].visible = false;
                continue;
            }
            const a = this.topControlPoints[i];
            const b = this.bottomControlPoints[i];
            const edge = this.sideEdges[i];
            edge.visible = true;
            edge.position.copy(a);
            edge.geometry.setPositions([0, 0, 0, b.x - a.x, b.y - a.y, b.z - a.z]);
            edge.computeLineDistances();
            edge.geometry.computeBoundingSphere();
        }

        for (let i = 0; i < this.sideMeshes.length; i++) {
            const mesh = this.sideMeshes[i];
            if (i >= M || N < 2) {
                mesh.visible = false;
                continue;
            }
            const next = (i + 1) % N;
            if (next >= M) {
                mesh.visible = false;
                continue;
            }
            const t0 = this.topControlPoints[i];
            const t1 = this.topControlPoints[next];
            const b0 = this.bottomControlPoints[i];
            const b1 = this.bottomControlPoints[next];
            mesh.visible = true;

            const positions = mesh.geometry.attributes.position.array;
            positions[0] = t0.x; positions[1] = t0.y; positions[2] = t0.z;
            positions[3] = b0.x; positions[4] = b0.y; positions[5] = b0.z;
            positions[6] = b1.x; positions[7] = b1.y; positions[8] = b1.z;
            positions[9] = t0.x; positions[10] = t0.y; positions[11] = t0.z;
            positions[12] = b1.x; positions[13] = b1.y; positions[14] = b1.z;
            positions[15] = t1.x; positions[16] = t1.y; positions[17] = t1.z;
            mesh.geometry.attributes.position.needsUpdate = true;
            mesh.geometry.computeVertexNormals();
            mesh.geometry.computeBoundingSphere();
        }

        if (N >= 3) {
            this.updatePolygonMesh(this.topMesh, this.topControlPoints);
        } else {
            this.topMesh.visible = false;
        }
        if (M >= 3) {
            this.updatePolygonMesh(this.bottomMesh, this.bottomControlPoints);
        } else {
            this.bottomMesh.visible = false;
        }
        if (this.detectedSurfaceMesh !== null) {
            this.bottomMesh.visible = false;
        }

        const unitCode = (this.lengthUnit && this.lengthUnitDisplay)
            ? this.lengthUnitDisplay.code
            : "m";
        const unitFactor = (this.lengthUnit && this.lengthUnitDisplay)
            ? (this.lengthUnitDisplay.unitspermeter / this.lengthUnit.unitspermeter)
            : 1;
        const updateEdgeLabel = (label, a, b, visible) => {
            if (!label) {
                return;
            }
            if (!visible || !a || !b) {
                label.visible = false;
                return;
            }
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const dz = b.z - a.z;
            const length = Math.sqrt(dx * dx + dy * dy + dz * dz) * unitFactor;
            label.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
            label.setText(formatLengthCs(length, unitCode));
            label.visible = this.showEdgeLengths && this.detailLabelsVisible();
        };

        for (let i = 0; i < this.topEdgeLabels.length; i++) {
            if (N < 2 || i >= N) {
                updateEdgeLabel(this.topEdgeLabels[i], null, null, false);
                continue;
            }
            const next = (i + 1) % N;
            const isClosing = (i === N - 1);
            const visible = !(isClosing && this.phase === "insertion");
            updateEdgeLabel(this.topEdgeLabels[i], this.topControlPoints[i], this.topControlPoints[next], visible);
        }
        for (let i = 0; i < this.bottomEdgeLabels.length; i++) {
            if (M < 2 || i >= M) {
                updateEdgeLabel(this.bottomEdgeLabels[i], null, null, false);
                continue;
            }
            const next = (i + 1) % M;
            updateEdgeLabel(this.bottomEdgeLabels[i], this.bottomControlPoints[i], this.bottomControlPoints[next], true);
        }
        for (let i = 0; i < this.sideEdgeLabels.length; i++) {
            if (i >= M || i >= N) {
                updateEdgeLabel(this.sideEdgeLabels[i], null, null, false);
                continue;
            }
            updateEdgeLabel(this.sideEdgeLabels[i], this.topControlPoints[i], this.bottomControlPoints[i], true);
        }

        if (this.phase === "insertion" || N < 3 || M < 3) {
            this.volumeLabel.visible = false;
            this.settingsHandle.visible = false;
        } else {
            const topCentroid = computeCentroid(this.topControlPoints);
            this.settingsHandle.position.set(topCentroid.x, topCentroid.y, topCentroid.z + 0.5);
            this.settingsHandle.visible = this.enabled && this.phase === "edit";
            const bottomCentroid = computeCentroid(this.bottomControlPoints);
            const labelPos = new THREE.Vector3(
                (topCentroid.x + bottomCentroid.x) / 2,
                (topCentroid.y + bottomCentroid.y) / 2,
                (topCentroid.z + bottomCentroid.z) / 2
            );
            this.volumeLabel.position.copy(labelPos);

            this.volumeLabel.setText(this.buildVolumeLabelText());
            this.volumeLabel.visible = this.phase === "pushpull" || this.phase === "computing" ||
                this.permanentLabelsVisible !== false || this.isRevealed();
        }

        // Auto cubature: keep the view clean like the pile — hide everything under the surface (floor + side
        // markers, edges and the volume "curtain" side/floor fill) unless this cubature is selected. Manual
        // cubature is left untouched (the user shapes the floor). The top surface fill and the volume number
        // stay visible either way.
        const showUnderside = !this.autoMode || this.isSelected === true;
        for (const obj of [...this.bottomSpheres, ...this.bottomEdges, ...this.sideEdges]) {
            if (obj) {
                obj.visible = showUnderside;
            }
        }
        if (this.autoMode) {
            for (const mesh of this.sideMeshes) {
                if (mesh) {
                    mesh.visible = showUnderside;
                }
            }
            if (this.bottomMesh) {
                this.bottomMesh.visible = showUnderside;
            }
        }
        if (!showUnderside) {
            for (const label of [...this.bottomEdgeLabels, ...this.sideEdgeLabels]) {
                if (label) {
                    label.visible = false;
                }
            }
        }
    }

    applyDetectedSurface(surface) {
        if (this.detectedSurfaceMesh !== null) {
            this.remove(this.detectedSurfaceMesh);
            this.detectedSurfaceMesh.geometry.dispose();
            this.detectedSurfaceMesh.material.dispose();
            this.detectedSurfaceMesh = null;
        }
        this.detectedSurface = surface || null;
        if (!surface) {
            return;
        }
        const data = buildSurfaceMeshData(surface);
        if (data.indices.length === 0) {
            return;
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.BufferAttribute(data.positions, 3));
        geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
        geometry.computeBoundingSphere();
        const material = new THREE.MeshBasicMaterial({
            color: this.bottomColor,
            transparent: true,
            opacity: 0.28,
            depthTest: true,
            depthWrite: false,
            side: THREE.DoubleSide
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(surface.originX, surface.originY, 0);
        this.add(mesh);
        this.detectedSurfaceMesh = mesh;
    }

    serializeDisplaySurface() {
        return encodeSurfaceGrid(this.detectedSurface);
    }

    restoreDisplaySurface(payload) {
        const surface = decodeSurfaceGrid(payload);
        if (surface === null) {
            return false;
        }
        this.applyDetectedSurface(surface);
        return true;
    }

    formatVolume(volume) {
        let value = volume;
        let suffix = "m";
        if (this.lengthUnit && this.lengthUnitDisplay) {
            value = value / Math.pow(this.lengthUnit.unitspermeter, 3) * Math.pow(this.lengthUnitDisplay.unitspermeter, 3);
            suffix = this.lengthUnitDisplay.code;
        }
        const formatted = value.toLocaleString("cs-CZ", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
        return formatted + " " + suffix + "³";
    }

    buildVolumeLabelText() {
        if (!this.autoMode) {
            return this.formatVolume(this.computeVolume());
        }
        if (this.computationState === "computing") {
            const progress = this.computationProgress;
            if (progress && progress.pointsAccepted > 0) {
                return "Počítám… (" + progress.pointsAccepted.toLocaleString("cs-CZ") + " bodů)";
            }
            return "Počítám…";
        }
        if (this.computationState === "failed") {
            return "Výpočet selhal";
        }
        if (this.computedVolume === null) {
            return this.formatVolume(this.computeVolume());
        }
        let text = this.formatVolume(this.computedVolume);
        if (this.computedQuality && this.computedQuality.approximate) {
            text += " (orientační)";
        }
        if (this.autoStale) {
            text += " (neaktuální)";
        }
        return text;
    }

    findOctreeNodeMinZAt(viewer, x, y) {
        let result = null;
        for (const pc of viewer.scene.pointclouds) {
            if (!pc.root || !pc.root.geometryNode) {
                continue;
            }
            const stack = [pc.root];
            let bestSpacing = Infinity;
            let bestZ = null;
            while (stack.length > 0) {
                const node = stack.pop();
                if (!node.geometryNode) {
                    continue;
                }
                const box = node.getBoundingBox();
                const minX = box.min.x + pc.position.x;
                const maxX = box.max.x + pc.position.x;
                const minY = box.min.y + pc.position.y;
                const maxY = box.max.y + pc.position.y;
                if (x < minX || x > maxX || y < minY || y > maxY) {
                    continue;
                }
                const nodeMinZ = node.geometryNode.boundingBox.min.z + pc.position.z;
                if (node.geometryNode.spacing <= bestSpacing) {
                    bestZ = nodeMinZ;
                    bestSpacing = node.geometryNode.spacing;
                }
                for (const idx of Object.keys(node.children)) {
                    const child = node.children[idx];
                    if (child && child.geometryNode) {
                        stack.push(child);
                    }
                }
            }
            if (bestZ !== null && (result === null || bestZ < result)) {
                result = bestZ;
            }
        }
        return result;
    }

    findClosestPointcloudPointToLine(viewer, lineStart, lineEnd, callerVertex, xyThreshold) {
        const lineDir = new THREE.Vector3().subVectors(lineEnd, lineStart);
        const lineLen = lineDir.length();
        if (lineLen < 1e-6) {
            return null;
        }
        let bestPoint = null;
        let bestDistToCaller = Infinity;

        const tempLocal = new THREE.Vector3();
        const tempWorld = new THREE.Vector3();
        const tempAP = new THREE.Vector3();
        const tempCross = new THREE.Vector3();
        const nodeBox = new THREE.Box3();

        for (const pc of viewer.scene.pointclouds) {
            const nodes = pc.visibleNodes || [];
            for (const node of nodes) {
                const sceneNode = node.sceneNode;
                if (!sceneNode || !sceneNode.geometry) {
                    continue;
                }
                const positions = sceneNode.geometry.attributes.position;
                if (!positions) {
                    continue;
                }

                const localBox = node.getBoundingBox();
                nodeBox.min.copy(localBox.min).add(pc.position);
                nodeBox.max.copy(localBox.max).add(pc.position);
                const cx = Math.max(nodeBox.min.x, Math.min(nodeBox.max.x, lineStart.x));
                const cy = Math.max(nodeBox.min.y, Math.min(nodeBox.max.y, lineStart.y));
                const ndx = cx - lineStart.x;
                const ndy = cy - lineStart.y;
                if (Math.sqrt(ndx * ndx + ndy * ndy) > xyThreshold + 0.5) {
                    continue;
                }

                const matrixWorld = sceneNode.matrixWorld;
                const count = positions.count;
                for (let i = 0; i < count; i++) {
                    tempLocal.set(positions.getX(i), positions.getY(i), positions.getZ(i));
                    tempWorld.copy(tempLocal).applyMatrix4(matrixWorld);

                    tempAP.subVectors(tempWorld, lineStart);
                    tempCross.crossVectors(tempAP, lineDir);
                    const distToLine = tempCross.length() / lineLen;
                    if (distToLine > xyThreshold) {
                        continue;
                    }

                    const distToCaller = tempWorld.distanceTo(callerVertex);
                    if (distToCaller < bestDistToCaller) {
                        bestDistToCaller = distToCaller;
                        bestPoint = tempWorld.clone();
                    }
                }
            }
        }

        return bestPoint;
    }

    snapVertexToTerrain(viewer, polygonId, index) {
        if (this.phase === "insertion") {
            return false;
        }
        if (this.topControlPoints.length < 3 || this.bottomControlPoints.length < 3) {
            return false;
        }
        if (index < 0 || index >= this.topControlPoints.length) {
            return false;
        }
        const top = this.topControlPoints[index];
        const bottom = this.bottomControlPoints[index];
        const xyThreshold = this.computeSnapThreshold(viewer);
        const callerVertex = polygonId === "top" ? top : bottom;
        const target = polygonId === "top" ? top : bottom;
        const picked = this.findClosestPointcloudPointToLine(viewer, top, bottom, callerVertex, xyThreshold);
        if (picked) {
            target.z = picked.z;
            this.markAutoStale();
            this.update();
            this.dispatchEvent({ type: "snapped_to_terrain", cubature: this, polygonId: polygonId, index: index });
            return true;
        }
        if (polygonId === "bottom") {
            const nodeZ = this.findOctreeNodeMinZAt(viewer, top.x, top.y);
            if (nodeZ !== null && nodeZ < top.z) {
                target.z = nodeZ;
                this.markAutoStale();
                this.update();
                this.dispatchEvent({ type: "snapped_to_terrain", cubature: this, polygonId: polygonId, index: index });
                return true;
            }
        }
        return false;
    }

    snapBottomToTerrain(viewer) {
        if (this.phase === "insertion") {
            return false;
        }
        if (this.topControlPoints.length < 3 || this.bottomControlPoints.length < 3) {
            return false;
        }
        let anySnapped = false;
        for (let i = 0; i < this.topControlPoints.length; i++) {
            if (this.snapVertexToTerrain(viewer, "bottom", i)) {
                anySnapped = true;
            }
        }
        return anySnapped;
    }

    computeSnapThreshold(viewer) {
        let maxSpacing = 0;
        for (const pc of viewer.scene.pointclouds) {
            if (pc.pcoGeometry && pc.pcoGeometry.spacing) {
                if (pc.pcoGeometry.spacing > maxSpacing) {
                    maxSpacing = pc.pcoGeometry.spacing;
                }
            }
        }
        const dynamic = maxSpacing > 0 ? maxSpacing * 4 : 0.5;
        return Math.max(0.5, Math.min(5, dynamic));
    }

    raycast(raycaster, intersects) {
        for (const s of this.topSpheres) {
            s.raycast(raycaster, intersects);
        }
        for (const s of this.bottomSpheres) {
            s.raycast(raycaster, intersects);
        }
        for (let i = 0; i < intersects.length; i++) {
            intersects[i].distance = raycaster.ray.origin.distanceTo(intersects[i].point);
        }
        intersects.sort((a, b) => a.distance - b.distance);
    }

    pickMarker(raycaster) {
        const candidates = [];
        const collect = (spheres, polygonId) => {
            for (let i = 0; i < spheres.length; i++) {
                const s = spheres[i];
                const intersects = [];
                s.raycast(raycaster, intersects);
                if (intersects.length > 0) {
                    candidates.push({
                        distance: intersects[0].distance,
                        polygonId: polygonId,
                        index: i,
                        point: intersects[0].point.clone()
                    });
                }
            }
        };
        collect(this.topSpheres, "top");
        collect(this.bottomSpheres, "bottom");
        if (candidates.length === 0) {
            return null;
        }
        candidates.sort((a, b) => a.distance - b.distance);
        return candidates[0];
    }
}
