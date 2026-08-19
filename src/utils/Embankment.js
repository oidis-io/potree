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
import { Line2 } from "../../libs/three.js/lines/Line2.js";
import { LineGeometry } from "../../libs/three.js/lines/LineGeometry.js";
import { LineMaterial } from "../../libs/three.js/lines/LineMaterial.js";
import { computeCentroid, shadeColor } from "./CubatureMath.js";
import { resolveEmbankmentMode } from "./EmbankmentComputation.js";
import { intersectDragWithLockPlane, lockPlaneZAt, refreshHeightLockVisual } from "./HeightLockPlane.js";
import { buildSurfaceMeshData } from "./TerrainGridMath.js";

function isValidPosition(p) {
    return p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);
}

function createLabel(fontsize, color) {
    const label = new TextSprite("");
    label.setTextColor(color);
    label.setBorderColor({ r: 0, g: 0, b: 0, a: 1.0 });
    label.setBackgroundColor({ r: 0, g: 0, b: 0, a: 1.0 });
    label.fontsize = fontsize;
    label.material.depthTest = false;
    label.material.opacity = 1;
    label.visible = false;
    return label;
}

function formatCubicMeters(value) {
    return value.toLocaleString("cs-CZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " m³";
}

export class Embankment extends THREE.Object3D {
    constructor(args = {}) {
        super();

        this.constructor.counter = (this.constructor.counter === undefined) ? 0 : this.constructor.counter + 1;
        this.name = "Embankment_" + this.constructor.counter;

        this.phase = "insertion";
        this.enabled = true;
        this.mode = resolveEmbankmentMode(args.mode);
        this.heightLock = null;
        this.heightLockVisual = null;

        this.controlPoints = [];
        this.heightM = 0;
        this.bevelEnabled = false;
        this.slopeDeg = 45;
        this.autoOptions = {};
        this.probe = null;

        this.autoStale = false;
        this.computationState = "idle";
        this.computationProgress = null;
        this.computedTotal = null;
        this.computedBelowOutlineVolume = null;
        this.computedAboveOutlineVolume = null;
        this.computedUncertaintyPct = null;
        this.computedQuality = null;
        this.computedStats = null;
        this.computedInputHash = null;
        this.computedBevelCapM = null;
        this._suppressAutoStale = false;
        this._loadingFromDb = false;
        this._autoRecomputeWired = false;
        this._autoRecomputeTimer = null;

        this.baseColor = args.color !== undefined ? args.color : 0xd97a1f;
        this.darkColor = shadeColor(this.baseColor, -0.35);
        this.lightColor = shadeColor(this.baseColor, 0.55);

        this.spheres = [];
        this.baseEdges = [];
        this.crownEdges = [];
        this.cornerEdges = [];
        this.meshes = [];

        this.permanentLabelsVisible = true;
        this.isHovered = false;
        this.isListHovered = false;
        this.isPinned = false;

        this.sphereGeometry = new THREE.SphereGeometry(0.4, 10, 10);
        this.volumeLabel = createLabel(16, { r: 255, g: 220, b: 100, a: 1.0 });
        this.add(this.volumeLabel);
        this.breakdownLabel = createLabel(13, { r: 230, g: 230, b: 230, a: 1.0 });
        this.add(this.breakdownLabel);
        this.settingsHandle = this.createSettingsHandle();
        this.add(this.settingsHandle);
    }

    setShowLabels(visible) {
        this.permanentLabelsVisible = visible;
    }

    isRevealed() {
        return this.isHovered === true || this.isListHovered === true || this.isPinned === true;
    }

    createSphereMaterial() {
        return new THREE.MeshLambertMaterial({ color: 0xff0000, depthTest: false, depthWrite: false });
    }

    createSettingsHandle() {
        const handle = new THREE.Mesh(this.sphereGeometry, new THREE.MeshLambertMaterial({
            color: 0xffffff, depthTest: false, depthWrite: false
        }));
        handle.name = "embankment_settings_handle";
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

    createEdge(color, linewidth) {
        const geometry = new LineGeometry();
        geometry.setPositions([0, 0, 0, 0, 0, 0]);
        const material = new LineMaterial({
            color: color,
            linewidth: linewidth,
            resolution: new THREE.Vector2(1000, 1000)
        });
        material.depthTest = false;
        return new Line2(geometry, material);
    }

    attachSphereHandlers(sphere) {
        const mouseover = (e) => {
            if (this.enabled && this.phase === "edit") {
                e.object.material.emissive.setHex(0x888888);
            }
        };
        const mouseleave = (e) => {
            e.object.material.emissive.setHex(e.object.isElementSelected === true ? 0x888888 : 0x000000);
        };
        const drag = (e) => {
            if (!this.enabled || this.phase !== "edit" && this.phase !== "insertion") {
                return;
            }
            const index = this.spheres.indexOf(e.drag.object);
            if (index === -1) {
                return;
            }
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
                if (this.heightLock !== null) {
                    target.z = lockPlaneZAt(this.heightLock, target.x, target.y);
                }
            } else if (this.heightLock !== null) {
                target = intersectDragWithLockPlane(e.drag.end, e.viewer, this.heightLock);
            }
            if (target !== null) {
                this.setControlPoint(index, target);
            }
        };
        sphere.addEventListener("mouseover", mouseover);
        sphere.addEventListener("mouseleave", mouseleave);
        sphere.addEventListener("drag", drag);
    }

    addMarker(position) {
        if (!isValidPosition(position)) {
            return;
        }
        this.controlPoints.push(position.clone());
        const sphere = new THREE.Mesh(this.sphereGeometry, this.createSphereMaterial());
        this.add(sphere);
        this.spheres.push(sphere);
        this.attachSphereHandlers(sphere);

        if (this.controlPoints.length >= 2) {
            this.baseEdges.push(this.createEdge(this.baseColor, 2));
            this.add(this.baseEdges[this.baseEdges.length - 1]);
        }
        this.update();
        this.dispatchEvent({ type: "marker_added", embankment: this });
    }

    removeMarkerAt(index) {
        if (index < 0 || index >= this.controlPoints.length) {
            return;
        }
        const sphere = this.spheres[index];
        this.remove(sphere);
        sphere.material.dispose();
        this.spheres.splice(index, 1);
        this.controlPoints.splice(index, 1);
        if (this.baseEdges.length > 0) {
            const edge = this.baseEdges.pop();
            this.remove(edge);
            edge.geometry.dispose();
            edge.material.dispose();
        }
        this.update();
        this.dispatchEvent({ type: "marker_removed", embankment: this });
    }

    removeLastMarker() {
        this.removeMarkerAt(this.controlPoints.length - 1);
    }

    setControlPoint(index, newPosition) {
        if (!isValidPosition(newPosition) || index < 0 || index >= this.controlPoints.length) {
            return;
        }
        this.controlPoints[index].copy(newPosition);
        this.markAutoStale();
        this.update();
        this.dispatchEvent({ type: "marker_moved", embankment: this, index: index });
    }

    applyHeightLock(lock) {
        this.heightLock = lock;
        refreshHeightLockVisual(this, lock, this.controlPoints);
        this.dispatchEvent({ type: "height_lock_changed", embankment: this, lock });
    }

    dispose() {
        this.disposeMeshes();
        for (const sphere of this.spheres) {
            sphere.material.dispose();
        }
        this.settingsHandle.material.dispose();
        this.sphereGeometry.dispose();
        for (const edge of [...this.baseEdges, ...this.crownEdges, ...this.cornerEdges]) {
            edge.geometry.dispose();
            edge.material.dispose();
        }
        for (const label of [this.volumeLabel, this.breakdownLabel]) {
            if (label.material.map) {
                label.material.map.dispose();
            }
            label.material.dispose();
        }
    }

    markAutoStale() {
        if (this._suppressAutoStale || this._loadingFromDb || this.autoStale || this.phase !== "edit") {
            return;
        }
        this.autoStale = true;
        this.dispatchEvent({ type: "stale_changed", embankment: this, stale: true });
    }

    closeOutline() {
        if (this.controlPoints.length < 3) {
            return false;
        }
        this.baseEdges.push(this.createEdge(this.baseColor, 2));
        this.add(this.baseEdges[this.baseEdges.length - 1]);
        if (this.mode !== "pile") {
            for (let i = 0; i < this.controlPoints.length; i++) {
                const crownEdge = this.createEdge(this.darkColor, 2);
                this.add(crownEdge);
                this.crownEdges.push(crownEdge);
                const cornerEdge = this.createEdge(this.lightColor, 1);
                this.add(cornerEdge);
                this.cornerEdges.push(cornerEdge);
            }
        }
        this.update();
        return true;
    }

    beginComputing() {
        this.phase = "computing";
        this.computationState = "computing";
        this.computationProgress = null;
        this.update();
        this.dispatchEvent({ type: "phase_changed", embankment: this, phase: this.phase });
        this.dispatchEvent({ type: "computation_started", embankment: this });
    }

    beginHeightPhase() {
        this.phase = "height";
        this.update();
        this.dispatchEvent({ type: "phase_changed", embankment: this, phase: this.phase });
    }

    commitEdit() {
        this.phase = "edit";
        this.update();
        this.dispatchEvent({ type: "phase_changed", embankment: this, phase: this.phase });
    }

    setHeightPreview(heightM) {
        this.heightM = Math.max(0, heightM);
        this.update();
        this.dispatchEvent({ type: "height_changed", embankment: this, heightM: this.heightM });
    }

    applyComputedPile(result) {
        this._suppressAutoStale = true;
        this.computedTotal = result.total;
        this.computedBelowOutlineVolume = null;
        this.computedAboveOutlineVolume = null;
        this.computedUncertaintyPct = result.uncertaintyPct;
        this.computedQuality = result.quality;
        this.computedStats = result.stats;
        this.computedInputHash = result.inputHash;
        this.computationState = "done";
        this.autoStale = false;
        this.disposeMeshes();
        if (result.surface) {
            this.createSurfaceMesh(result.surface, this.baseColor, 0.25);
        }
        this.createRingMesh(this.controlPoints, this.lightColor, 0.15);
        this.update();
        this._suppressAutoStale = false;
    }

    applyComputedVolumes(result) {
        this._suppressAutoStale = true;
        this.computedTotal = result.total;
        this.computedBelowOutlineVolume = result.belowOutlineVolume;
        this.computedAboveOutlineVolume = result.aboveOutlineVolume;
        this.computedQuality = result.quality;
        this.computedStats = result.stats;
        this.computedInputHash = result.inputHash;
        this.computedBevelCapM = result.bevelCapM;
        this.heightM = result.heightM;
        this.bevelEnabled = result.bevelEnabled;
        this.slopeDeg = result.slopeDeg;
        this.computationState = "done";
        this.autoStale = false;
        this.rebuildMeshes(result);
        this.update();
        this._suppressAutoStale = false;
    }

    disposeMeshes() {
        for (const mesh of this.meshes) {
            this.remove(mesh);
            mesh.geometry.dispose();
            mesh.material.dispose();
        }
        this.meshes = [];
    }

    createSurfaceMesh(surfaceData, color, opacity) {
        const data = buildSurfaceMeshData(surfaceData);
        if (data.indices.length === 0) {
            return null;
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.BufferAttribute(data.positions, 3));
        geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
        geometry.computeBoundingSphere();
        const material = new THREE.MeshBasicMaterial({
            color: color,
            transparent: true,
            opacity: opacity,
            depthTest: true,
            depthWrite: false,
            side: THREE.DoubleSide
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(surfaceData.originX, surfaceData.originY, 0);
        this.add(mesh);
        this.meshes.push(mesh);
        return mesh;
    }

    createRingMesh(ringPoints, color, opacity) {
        const shape = ringPoints.map((p) => new THREE.Vector2(p.x, p.y));
        const triangles = THREE.ShapeUtils.triangulateShape(shape, []);
        if (triangles.length === 0) {
            return null;
        }
        const positions = new Float32Array(ringPoints.length * 3);
        const anchor = ringPoints[0];
        for (let i = 0; i < ringPoints.length; i++) {
            positions[i * 3] = ringPoints[i].x - anchor.x;
            positions[i * 3 + 1] = ringPoints[i].y - anchor.y;
            positions[i * 3 + 2] = ringPoints[i].z;
        }
        const indices = new Uint32Array(triangles.length * 3);
        for (let i = 0; i < triangles.length; i++) {
            indices[i * 3] = triangles[i][0];
            indices[i * 3 + 1] = triangles[i][1];
            indices[i * 3 + 2] = triangles[i][2];
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
        geometry.setIndex(new THREE.BufferAttribute(indices, 1));
        geometry.computeBoundingSphere();
        const material = new THREE.MeshBasicMaterial({
            color: color,
            transparent: true,
            opacity: opacity,
            depthTest: true,
            depthWrite: false,
            side: THREE.DoubleSide
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(anchor.x, anchor.y, 0);
        this.add(mesh);
        this.meshes.push(mesh);
        return mesh;
    }

    createWallMesh() {
        const n = this.controlPoints.length;
        const positions = new Float32Array(n * 4 * 3);
        const indices = new Uint32Array(n * 6);
        const anchor = this.controlPoints[0];
        for (let i = 0; i < n; i++) {
            const a = this.controlPoints[i];
            const b = this.controlPoints[(i + 1) % n];
            const base = i * 12;
            positions[base] = a.x - anchor.x;
            positions[base + 1] = a.y - anchor.y;
            positions[base + 2] = a.z;
            positions[base + 3] = b.x - anchor.x;
            positions[base + 4] = b.y - anchor.y;
            positions[base + 5] = b.z;
            positions[base + 6] = b.x - anchor.x;
            positions[base + 7] = b.y - anchor.y;
            positions[base + 8] = b.z + this.heightM;
            positions[base + 9] = a.x - anchor.x;
            positions[base + 10] = a.y - anchor.y;
            positions[base + 11] = a.z + this.heightM;
            const vertexBase = i * 4;
            const indexBase = i * 6;
            indices[indexBase] = vertexBase;
            indices[indexBase + 1] = vertexBase + 1;
            indices[indexBase + 2] = vertexBase + 2;
            indices[indexBase + 3] = vertexBase;
            indices[indexBase + 4] = vertexBase + 2;
            indices[indexBase + 5] = vertexBase + 3;
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
        geometry.setIndex(new THREE.BufferAttribute(indices, 1));
        geometry.computeBoundingSphere();
        const material = new THREE.MeshBasicMaterial({
            color: this.baseColor,
            transparent: true,
            opacity: 0.15,
            depthTest: true,
            depthWrite: false,
            side: THREE.DoubleSide
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(anchor.x, anchor.y, 0);
        this.add(mesh);
        this.meshes.push(mesh);
        return mesh;
    }

    rebuildMeshes(result) {
        this.disposeMeshes();
        if (result.surface) {
            this.createSurfaceMesh(result.surface, this.lightColor, 0.28);
        }
        if (result.crownSurface) {
            this.createSurfaceMesh(result.crownSurface, this.darkColor, 0.3);
        } else {
            const crownRing = this.controlPoints.map((p) => ({ x: p.x, y: p.y, z: p.z + this.heightM }));
            this.createRingMesh(crownRing, this.darkColor, 0.3);
            this.createWallMesh();
        }
        this.createRingMesh(this.controlPoints, this.lightColor, 0.15);
    }

    buildVolumeLabelText() {
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
        if (this.phase === "height") {
            return "výška " + this.heightM.toLocaleString("cs-CZ", {
                minimumFractionDigits: 2, maximumFractionDigits: 2
            }) + " m";
        }
        if (this.computedTotal === null) {
            return "";
        }
        let text = formatCubicMeters(this.computedTotal);
        if (this.mode === "pile" && this.computedUncertaintyPct !== null) {
            text += ` (±${this.computedUncertaintyPct} %)`;
        }
        if (this.computedBevelCapM !== null && this.computedBevelCapM !== undefined) {
            text += " — svahy stropují výšku na " + this.computedBevelCapM.toLocaleString("cs-CZ", {
                minimumFractionDigits: 2, maximumFractionDigits: 2
            }) + " m";
        }
        if (this.computedQuality && this.computedQuality.approximate) {
            text += " (orientační)";
        }
        if (this.autoStale) {
            text += " (neaktuální)";
        }
        return text;
    }

    update() {
        const n = this.controlPoints.length;
        for (let i = 0; i < this.spheres.length; i++) {
            this.spheres[i].position.copy(this.controlPoints[i]);
        }

        const setEdge = (edge, a, b) => {
            edge.visible = true;
            edge.position.copy(a);
            edge.geometry.setPositions([0, 0, 0, b.x - a.x, b.y - a.y, b.z - a.z]);
            edge.computeLineDistances();
            edge.geometry.computeBoundingSphere();
        };
        const temporaryA = new THREE.Vector3();
        const temporaryB = new THREE.Vector3();

        for (let i = 0; i < this.baseEdges.length; i++) {
            if (n < 2) {
                this.baseEdges[i].visible = false;
                continue;
            }
            const next = (i + 1) % n;
            const isClosing = (i === n - 1);
            if (isClosing && this.phase === "insertion") {
                this.baseEdges[i].visible = false;
                continue;
            }
            setEdge(this.baseEdges[i], this.controlPoints[i], this.controlPoints[next]);
        }
        const hideFrame = this.bevelEnabled && this.phase === "edit";
        for (let i = 0; i < this.crownEdges.length; i++) {
            if (i >= n || hideFrame) {
                this.crownEdges[i].visible = false;
                continue;
            }
            const next = (i + 1) % n;
            temporaryA.copy(this.controlPoints[i]).setZ(this.controlPoints[i].z + this.heightM);
            temporaryB.copy(this.controlPoints[next]).setZ(this.controlPoints[next].z + this.heightM);
            setEdge(this.crownEdges[i], temporaryA, temporaryB);
        }
        for (let i = 0; i < this.cornerEdges.length; i++) {
            if (i >= n || hideFrame) {
                this.cornerEdges[i].visible = false;
                continue;
            }
            temporaryA.copy(this.controlPoints[i]);
            temporaryB.copy(this.controlPoints[i]).setZ(this.controlPoints[i].z + this.heightM);
            setEdge(this.cornerEdges[i], temporaryA, temporaryB);
        }

        if (n >= 3 && this.phase !== "insertion") {
            const centroid = computeCentroid(this.controlPoints);
            this.settingsHandle.position.set(centroid.x, centroid.y, centroid.z + this.heightM + 0.5);
            this.settingsHandle.visible = this.enabled && this.phase === "edit";
            this.volumeLabel.position.set(centroid.x, centroid.y, centroid.z + this.heightM + 1);
            const labelText = this.buildVolumeLabelText();
            this.volumeLabel.setText(labelText);
            const mainVisible = this.phase === "height" || this.phase === "computing" ||
                this.permanentLabelsVisible !== false || this.isRevealed();
            this.volumeLabel.visible = mainVisible && labelText !== "";

            if (this.computedTotal !== null && this.phase === "edit") {
                this.breakdownLabel.position.set(centroid.x, centroid.y, centroid.z + this.heightM + 0.2);
                this.breakdownLabel.setText(this.mode === "pile"
                    ? "objem hromady · nejistota podkladu ±" + this.computedUncertaintyPct + " %"
                    : "dosypání " + formatCubicMeters(this.computedBelowOutlineVolume) +
                      " · navážka " + formatCubicMeters(this.computedAboveOutlineVolume));
                this.breakdownLabel.visible = mainVisible;
            } else {
                this.breakdownLabel.visible = false;
            }
        } else {
            this.settingsHandle.visible = false;
            this.volumeLabel.visible = false;
            this.breakdownLabel.visible = false;
        }
    }

    raycast(raycaster, intersects) {
        for (const sphere of this.spheres) {
            sphere.raycast(raycaster, intersects);
        }
        for (let i = 0; i < intersects.length; i++) {
            intersects[i].distance = raycaster.ray.origin.distanceTo(intersects[i].point);
        }
        intersects.sort((a, b) => a.distance - b.distance);
    }

    pickMarker(raycaster) {
        const candidates = [];
        for (let i = 0; i < this.spheres.length; i++) {
            const intersects = [];
            this.spheres[i].raycast(raycaster, intersects);
            if (intersects.length > 0) {
                candidates.push({ distance: intersects[0].distance, index: i });
            }
        }
        if (candidates.length === 0) {
            return null;
        }
        candidates.sort((a, b) => a.distance - b.distance);
        return candidates[0];
    }
}
