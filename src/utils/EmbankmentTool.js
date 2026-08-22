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
import { Embankment } from "./Embankment.js";
import { EmbankmentComputation, computeEmbankmentVolumes, computePileVolume } from "./EmbankmentComputation.js";
import { Utils } from "../utils.js";
import { EventDispatcher } from "../EventDispatcher.js";
import { computeCentroid } from "./CubatureMath.js";
import { computeLockPlane, lockPlaneZAt } from "./HeightLockPlane.js";
import { ToolContextMenu } from "./ToolContextMenu.js";

export class EmbankmentTool extends EventDispatcher {
    constructor(viewer) {
        super();

        this.viewer = viewer;
        this.renderer = viewer.renderer;

        this.scene = new THREE.Scene();
        this.scene.name = "scene_embankment";
        this.light = new THREE.PointLight(0xffffff, 1.0);
        this.scene.add(this.light);
        this.viewer.inputHandler.registerInteractiveScene(this.scene);

        this.activeListeners = [];
        this.activeEmbankment = null;
        this.activeComputation = null;
        this.heightDragStartY = 0;
        this.heightDragScale = 1;
        this.contextMenu = new ToolContextMenu(() => this.cancelInputHandlerDrag());
        this.onRequestDelete = null;
        this.onRequestNumber = null;
        this.onRequestEdit = null;
        this.isMenuAllowed = null;

        this.onAdd = (e) => {
            this.scene.add(e.embankment);
        };
        this.onRemove = (e) => {
            const embankment = e.embankment;
            if (this.activeComputation !== null && this.activeComputation.owner === embankment) {
                this.activeComputation.cancel();
            }
            if (this.activeEmbankment === embankment) {
                this.detachAll();
                this.cancelInputHandlerDrag();
                this.renderer.domElement.style.cursor = "";
                this.activeEmbankment = null;
            }
            if (embankment._autoRecomputeTimer !== null) {
                clearTimeout(embankment._autoRecomputeTimer);
                embankment._autoRecomputeTimer = null;
            }
            embankment.applyHeightLock(null);
            this.scene.remove(embankment);
            embankment.dispose();
        };
        for (const embankment of viewer.scene.embankments) {
            this.onAdd({ embankment });
        }
        viewer.scene.addEventListener("embankment_added", this.onAdd);
        viewer.scene.addEventListener("embankment_removed", this.onRemove);
        viewer.addEventListener("scene_changed", (e) => {
            if (e.oldScene) {
                e.oldScene.removeEventListener("embankment_added", this.onAdd);
                e.oldScene.removeEventListener("embankment_removed", this.onRemove);
            }
            e.scene.addEventListener("embankment_added", this.onAdd);
            e.scene.addEventListener("embankment_removed", this.onRemove);
        });

        viewer.addEventListener("update", this.update.bind(this));
        viewer.addEventListener("render.pass.perspective_overlay", this.render.bind(this));

        viewer.inputHandler.addEventListener("delete", (e) => {
            const embankments = e.selection.filter((x) => x instanceof Embankment);
            embankments.forEach((embankment) => this.requestDelete(embankment));
        });

        this.addEventListener("start_inserting_embankment", () => {
            this.viewer.dispatchEvent({ type: "cancel_insertions" });
        });
        viewer.addEventListener("cancel_insertions", () => {
            if (this.activeEmbankment) {
                this.cancelEmbankment(this.activeEmbankment);
            }
        });

        this.globalKeyHandler = (e) => {
            if (e.keyCode === 90 && e.shiftKey) {
                this.clearAllHeightLocks();
            }
        };
        viewer.renderer.domElement.addEventListener("keydown", this.globalKeyHandler);

        this.editCursorApplied = false;
        this.editMouseMove = () => this.handleEditMouseMove();
        this.editMouseDown = (e) => this.handleEditMouseDown(e);
        this.editKeyDown = (e) => this.handleEditKeyDown(e);
        viewer.renderer.domElement.addEventListener("mousemove", this.editMouseMove);
        viewer.renderer.domElement.addEventListener("mousedown", this.editMouseDown);
        viewer.renderer.domElement.addEventListener("keydown", this.editKeyDown);
    }

    clearAllHeightLocks() {
        for (const embankment of this.viewer.scene.embankments) {
            if (embankment.heightLock !== null) {
                embankment.applyHeightLock(null);
            }
        }
    }

    anyInsertionActive() {
        if (this.activeEmbankment) {
            return true;
        }
        const cubatureTool = this.viewer.cubatureTool;
        return cubatureTool !== undefined && cubatureTool.activeCubature !== null
            && cubatureTool.activeCubature !== undefined;
    }

    editEmbankments() {
        return this.viewer.scene.embankments.filter((n) => n.enabled && n.phase === "edit");
    }

    pickEditTarget() {
        const raycaster = this.getRaycaster();
        const candidates = this.editEmbankments();
        for (const embankment of candidates) {
            if (embankment.pickSettingsHandle(raycaster)) {
                return { embankment, settingsHit: true, markerHit: null };
            }
        }
        for (const embankment of candidates) {
            const markerHit = embankment.pickMarker(raycaster);
            if (markerHit) {
                return { embankment, settingsHit: false, markerHit };
            }
        }
        for (const embankment of candidates) {
            if (embankment.meshes.length > 0 && raycaster.intersectObjects(embankment.meshes, false).length > 0) {
                return { embankment, settingsHit: false, markerHit: null };
            }
        }
        return null;
    }

    handleEditMouseMove() {
        if (this.anyInsertionActive()) {
            return;
        }
        const target = this.pickEditTarget();
        if (target !== null && target.settingsHit) {
            this.renderer.domElement.style.cursor = "pointer";
            this.editCursorApplied = true;
        } else if (target !== null && target.markerHit !== null) {
            this.renderer.domElement.style.cursor = "move";
            this.editCursorApplied = true;
        } else if (this.editCursorApplied) {
            this.renderer.domElement.style.cursor = "";
            this.editCursorApplied = false;
        }
    }

    handleEditMouseDown(e) {
        if (this.anyInsertionActive()) {
            return;
        }
        const target = this.pickEditTarget();
        if (target === null) {
            return;
        }
        if (!target.settingsHit || e.button === THREE.MOUSE.RIGHT) {
            return;
        }
        if (typeof this.isMenuAllowed === "function" && !this.isMenuAllowed(target.embankment)) {
            return;
        }
        e.preventDefault();
        e.stopImmediatePropagation();
        this.showContextMenu(e.clientX, e.clientY,
            this.buildEditMenuItems(target.embankment, this.selectedVertexIndex(target.embankment)));
    }

    handleEditKeyDown(e) {
        if (this.anyInsertionActive()) {
            return;
        }
        if (e.keyCode === 27) {
            this.hideContextMenu();
        } else if (e.keyCode === 90 && !e.shiftKey) {
            for (const embankment of this.editEmbankments()) {
                if (embankment.heightLock !== null) {
                    embankment.applyHeightLock(null);
                }
            }
        }
    }

    attach(eventType, handler) {
        const el = this.viewer.renderer.domElement;
        el.addEventListener(eventType, handler);
        this.activeListeners.push({ event: eventType, handler, target: el });
    }

    detachAll() {
        for (const listener of this.activeListeners) {
            listener.target.removeEventListener(listener.event, listener.handler);
        }
        this.activeListeners = [];
    }

    getRaycaster() {
        const rect = this.viewer.renderer.domElement.getBoundingClientRect();
        const mouse = this.viewer.inputHandler.mouse;
        const ndc = new THREE.Vector2(
            (mouse.x / rect.width) * 2 - 1,
            -(mouse.y / rect.height) * 2 + 1
        );
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(ndc, this.viewer.scene.getActiveCamera());
        return raycaster;
    }

    cancelInputHandlerDrag() {
        if (this.viewer.inputHandler && this.viewer.inputHandler.drag) {
            this.viewer.inputHandler.drag = null;
        }
    }

    startInsertion(args = {}) {
        if (this.activeEmbankment) {
            this.cancelEmbankment(this.activeEmbankment);
        }
        this.detachAll();

        const embankment = new Embankment({ color: args.color, mode: args.mode });
        embankment.name = args.name || embankment.name;
        embankment.autoOptions = args.options || {};
        if (args.slopeDeg !== undefined) {
            embankment.slopeDeg = args.slopeDeg;
        }

        this.dispatchEvent({ type: "start_inserting_embankment", embankment });
        this.viewer.scene.addEmbankment(embankment);
        this.activeEmbankment = embankment;
        this.enableAutoRecompute(embankment);

        this.renderer.domElement.style.cursor = "crosshair";
        this.attachInsertionListeners(embankment);
        embankment.addMarker(new THREE.Vector3(0, 0, 0));
        this.viewer.inputHandler.startDragging(embankment.spheres[embankment.spheres.length - 1]);
        return embankment;
    }

    attachInsertionListeners(embankment) {
        const onMouseUp = (e) => {
            if (e.button === THREE.MOUSE.LEFT) {
                const last = embankment.controlPoints[embankment.controlPoints.length - 1];
                if (last) {
                    embankment.addMarker(last.clone());
                    this.viewer.inputHandler.startDragging(embankment.spheres[embankment.spheres.length - 1]);
                }
            }
        };
        const onKeyDown = (e) => {
            if (e.keyCode === 13) {
                const rect = this.viewer.renderer.domElement.getBoundingClientRect();
                this.heightDragStartY = rect.top + this.viewer.inputHandler.mouse.y;
                this.finishInsertion(embankment);
            } else if (e.keyCode === 27) {
                this.cancelEmbankment(embankment);
            } else if (e.keyCode === 8) {
                if (embankment.controlPoints.length > 1) {
                    embankment.removeMarkerAt(embankment.controlPoints.length - 2);
                }
            } else if (e.keyCode === 90 && !e.shiftKey) {
                if (embankment.heightLock === null) {
                    const placed = embankment.controlPoints.slice(0, Math.max(1, embankment.controlPoints.length - 1));
                    embankment.applyHeightLock(computeLockPlane(placed));
                    this.snapPendingMarkerToLock(embankment);
                } else {
                    embankment.applyHeightLock(null);
                }
            }
        };
        this.attach("mouseup", onMouseUp);
        this.attach("keydown", onKeyDown);
    }

    snapPendingMarkerToLock(embankment) {
        if (embankment.heightLock === null || embankment.controlPoints.length === 0) {
            return;
        }
        const index = embankment.controlPoints.length - 1;
        const target = embankment.controlPoints[index].clone();
        target.z = lockPlaneZAt(embankment.heightLock, target.x, target.y);
        embankment.setControlPoint(index, target);
    }

    finishInsertion(embankment) {
        const n = embankment.controlPoints.length;
        if (n >= 2) {
            const last = embankment.controlPoints[n - 1];
            const previous = embankment.controlPoints[n - 2];
            if (last.distanceTo(previous) < 0.01) {
                embankment.removeLastMarker();
            }
        }
        if (!embankment.closeOutline()) {
            return;
        }
        embankment.applyHeightLock(null);
        this.detachAll();
        this.cancelInputHandlerDrag();
        this.beginProbe(embankment, { removeOnCancel: true, enterHeight: embankment.mode !== "pile" });
    }

    beginProbe(embankment, behavior) {
        if (this.activeComputation !== null) {
            this.activeComputation.cancel();
        }
        this.detachAll();
        this.cancelInputHandlerDrag();
        this.hideContextMenu();
        this.renderer.domElement.style.cursor = "progress";
        embankment.beginComputing();

        const reportFailure = (error) => {
            this.activeComputation = null;
            embankment.computationState = "failed";
            console.error("Embankment computation failed:", error);
            embankment.dispatchEvent({ type: "computation_failed", embankment, reason: error.message });
            if (behavior.removeOnCancel && embankment.computedTotal === null) {
                this.cancelEmbankment(embankment);
                return;
            }
            this.finishInteraction(embankment);
        };

        let computation;
        try {
            computation = new EmbankmentComputation(this.viewer, {
                outlinePoints: embankment.controlPoints,
                mode: embankment.mode,
                options: { slopeDeg: embankment.slopeDeg, ...embankment.autoOptions }
            }, {
                onProgress: (progress) => {
                    embankment.computationProgress = progress;
                    embankment.update();
                },
                onReady: (probe) => {
                    this.activeComputation = null;
                    embankment.probe = probe;
                    if (behavior.enterHeight) {
                        this.enterHeightPhase(embankment);
                    } else {
                        this.applyVolumes(embankment);
                        this.finishInteraction(embankment);
                    }
                },
                onFailed: reportFailure,
                onCanceled: () => {
                    this.activeComputation = null;
                    if (behavior.removeOnCancel) {
                        this.cancelEmbankment(embankment);
                        return;
                    }
                    embankment.computationState = embankment.computedTotal === null ? "idle" : "done";
                    this.finishInteraction(embankment);
                }
            });
        } catch (error) {
            reportFailure(error);
            return;
        }

        computation.owner = embankment;
        this.activeComputation = computation;
        this.attachComputingListeners(embankment);
        computation.start();
    }

    applyVolumes(embankment) {
        if (embankment.probe === null) {
            this.beginProbe(embankment, { removeOnCancel: false, enterHeight: false });
            return;
        }
        if (embankment.mode === "pile") {
            const pileResult = computePileVolume(embankment.probe);
            embankment.applyComputedPile(pileResult);
            embankment.dispatchEvent({ type: "volume_computed", embankment, result: pileResult });
            return;
        }
        const result = computeEmbankmentVolumes(embankment.probe, {
            heightM: embankment.heightM,
            bevelEnabled: embankment.bevelEnabled,
            slopeDeg: embankment.slopeDeg
        });
        embankment.applyComputedVolumes(result);
        embankment.dispatchEvent({ type: "volume_computed", embankment, result });
    }

    attachComputingListeners(embankment) {
        const onKeyDown = (e) => {
            if (e.keyCode === 27 && this.activeComputation !== null) {
                this.activeComputation.cancel();
            }
        };
        this.attach("keydown", onKeyDown);
    }

    enterHeightPhase(embankment) {
        this.detachAll();
        this.cancelInputHandlerDrag();
        const rect = this.viewer.renderer.domElement.getBoundingClientRect();
        this.heightDragStartY = rect.top + this.viewer.inputHandler.mouse.y;
        this.renderer.domElement.style.cursor = "ns-resize";
        embankment.beginHeightPhase();

        const centroid = computeCentroid(embankment.controlPoints);
        const camera = this.viewer.scene.getActiveCamera();
        const cameraDistance = camera.position.distanceTo(new THREE.Vector3(centroid.x, centroid.y, centroid.z));
        const viewHeight = this.viewer.renderer.domElement.clientHeight || 1;
        this.heightDragScale = Math.max(0.01, cameraDistance / viewHeight);
        const baseHeight = embankment.heightM;

        const onMouseMove = (e) => {
            const deltaY = this.heightDragStartY - e.clientY;
            embankment.setHeightPreview(baseHeight + deltaY * this.heightDragScale);
        };
        const onMouseDown = (e) => {
            if (e.button === THREE.MOUSE.LEFT) {
                e.preventDefault();
                this.commitHeight(embankment);
            }
        };
        const onKeyDown = (e) => {
            if (e.keyCode === 27) {
                this.cancelEmbankment(embankment);
            } else if (e.keyCode === 84) {
                this.openHeightInput(embankment);
            }
        };
        this.attach("mousemove", onMouseMove);
        this.attach("mousedown", onMouseDown);
        this.attach("keydown", onKeyDown);
    }

    commitHeight(embankment) {
        this.applyVolumes(embankment);
        embankment.commitEdit();
        this.finishInteraction(embankment);
    }

    finishInteraction(embankment) {
        this.detachAll();
        this.cancelInputHandlerDrag();
        this.renderer.domElement.style.cursor = "";
        if (this.activeEmbankment === embankment) {
            this.activeEmbankment = null;
        }
        if (embankment.phase !== "edit") {
            embankment.commitEdit();
        } else {
            embankment.update();
        }
    }

    requestNumber(request, apply) {
        if (typeof this.onRequestNumber === "function") {
            this.onRequestNumber(request, apply);
            return;
        }
        let hint = "";
        for (;;) {
            const value = window.prompt(hint + request.label, String(request.value));
            if (value === null) {
                return;
            }
            const parsed = parseFloat(value.replace(",", "."));
            if (Number.isFinite(parsed) && (request.min === null || parsed >= request.min) && (request.max === null || parsed <= request.max)) {
                apply(parsed);
                return;
            }
            hint = "Neplatná hodnota. ";
        }
    }

    openHeightInput(embankment) {
        this.requestNumber({
            kind: "embankmentHeight",
            label: "Výška náspu (m):",
            value: embankment.heightM.toFixed(2),
            min: 0,
            max: null
        }, (parsed) => this.applyHeight(embankment, parsed));
    }

    applyHeight(embankment, heightM) {
        embankment.setHeightPreview(heightM);
        if (embankment.phase === "height") {
            this.commitHeight(embankment);
        } else {
            this.applyVolumes(embankment);
        }
    }

    applyBevel(embankment, enabled, slopeDeg) {
        if (!(slopeDeg >= 10 && slopeDeg <= 60)) {
            throw new Error("Úhel zkosení musí být mezi 10° a 60°.");
        }
        embankment.slopeDeg = slopeDeg;
        embankment.bevelEnabled = enabled;
        if (embankment.phase === "edit") {
            this.applyVolumes(embankment);
        }
    }

    selectedVertexIndex(embankment) {
        return (embankment.spheres || []).findIndex(($sphere) => $sphere.isElementSelected === true);
    }

    requestDelete(embankment) {
        if (typeof this.onRequestDelete === "function") {
            this.onRequestDelete(embankment);
            return;
        }
        this.viewer.scene.removeEmbankment(embankment);
    }

    buildEditMenuItems(embankment, markerIndex, options = {}) {
        const items = [];
        if (embankment.mode !== "pile") {
            items.push({ label: "Upravit výšku tažením", action: () => this.enterHeightPhase(embankment) });
        }
        if (markerIndex !== null && markerIndex >= 0) {
            items.push(
                {
                    label: embankment.heightLock === null
                        ? "Držet výšku vybraného vrcholu (řez)"
                        : "Vypnout držení výšky",
                    action: () => this.toggleHeightLock(embankment, markerIndex)
                },
                {
                    label: "Srovnat vybraný vrchol podle sousedů",
                    action: () => this.levelVertexWithNeighbors(embankment, markerIndex)
                },
                {
                    label: "Srovnat všechny vrcholy na tuto výšku (řez)",
                    action: () => this.levelAllVerticesTo(embankment, markerIndex)
                },
                { label: "Zadat výšku vybraného vrcholu…", action: () => this.openVertexHeightInput(embankment, markerIndex) }
            );
        } else if (embankment.heightLock !== null) {
            items.push({ label: "Vypnout držení výšky", action: () => embankment.applyHeightLock(null) });
        }
        items.push({ label: "Přepočítat objem", action: () => this.recompute(embankment) });
        if (typeof this.onRequestEdit === "function" && options.includeEdit !== false) {
            items.push({ label: "Upravit…", action: () => this.onRequestEdit(embankment) });
        }
        if (options.includeDelete !== false) {
            items.push({
                label: embankment.mode === "pile" ? "Smazat haldu" : "Smazat násep",
                action: () => this.requestDelete(embankment)
            });
        }
        return items;
    }

    toggleHeightLock(embankment, index) {
        if (embankment.heightLock === null) {
            const vertex = embankment.controlPoints[index];
            embankment.applyHeightLock({ x0: vertex.x, y0: vertex.y, z0: vertex.z, gx: 0, gy: 0 });
        } else {
            embankment.applyHeightLock(null);
        }
    }

    levelAllVerticesTo(embankment, index) {
        const levelZ = embankment.controlPoints[index].z;
        for (let i = 0; i < embankment.controlPoints.length; i++) {
            if (i === index) {
                continue;
            }
            const target = embankment.controlPoints[i].clone();
            target.z = levelZ;
            embankment.setControlPoint(i, target);
        }
    }

    levelVertexWithNeighbors(embankment, index) {
        const count = embankment.controlPoints.length;
        const previous = embankment.controlPoints[(index - 1 + count) % count];
        const next = embankment.controlPoints[(index + 1) % count];
        const target = embankment.controlPoints[index].clone();
        target.z = (previous.z + next.z) / 2;
        embankment.setControlPoint(index, target);
    }

    openVertexHeightInput(embankment, index) {
        const current = embankment.controlPoints[index];
        this.requestNumber({
            kind: "vertexHeight",
            label: "Výška vrcholu (m n. m.):",
            value: current.z.toFixed(2),
            min: null,
            max: null
        }, (parsed) => {
            const target = current.clone();
            target.z = parsed;
            embankment.setControlPoint(index, target);
        });
    }

    recompute(embankment) {
        if (embankment.phase !== "edit") {
            return;
        }
        this.beginProbe(embankment, { removeOnCancel: false, enterHeight: false });
    }

    enableAutoRecompute(embankment) {
        if (embankment._autoRecomputeWired) {
            return;
        }
        embankment._autoRecomputeWired = true;
        const schedule = () => {
            if (embankment._loadingFromDb || embankment.phase !== "edit") {
                return;
            }
            if (embankment._autoRecomputeTimer) {
                clearTimeout(embankment._autoRecomputeTimer);
            }
            embankment._autoRecomputeTimer = setTimeout(() => {
                embankment._autoRecomputeTimer = null;
                if (!embankment.autoStale || embankment.phase !== "edit") {
                    return;
                }
                if (this.viewer.scene.embankments.indexOf(embankment) === -1) {
                    return;
                }
                if (this.anyInsertionActive() || this.activeComputation !== null ||
                    (this.viewer.inputHandler && this.viewer.inputHandler.drag)) {
                    schedule();
                    return;
                }
                this.recompute(embankment);
            }, 600);
        };
        embankment.addEventListener("marker_moved", schedule);
    }

    cancelEmbankment(embankment) {
        this.detachAll();
        this.hideContextMenu();
        if (this.viewer.scene.embankments.indexOf(embankment) !== -1) {
            this.viewer.scene.removeEmbankment(embankment);
        }
        this.renderer.domElement.style.cursor = "";
        if (this.activeEmbankment === embankment) {
            this.activeEmbankment = null;
        }
    }

    showContextMenu(x, y, items) {
        this.contextMenu.show(x, y, items);
    }

    hideContextMenu() {
        this.contextMenu.hide();
    }

    update() {
        const scene = this.viewer.scene;
        if (!scene) {
            return;
        }
        const camera = scene.getActiveCamera();
        const renderAreaSize = this.viewer.renderer.getSize(new THREE.Vector2());
        this.light.position.copy(camera.position);

        for (const embankment of scene.embankments) {
            for (const sphere of embankment.spheres) {
                const distance = camera.position.distanceTo(sphere.getWorldPosition(new THREE.Vector3()));
                const pr = Utils.projectedRadius(1, camera, distance, renderAreaSize.width, renderAreaSize.height);
                const scale = (15 / pr);
                sphere.scale.set(scale, scale, scale);
            }
            if (embankment.settingsHandle.visible) {
                const handleDistance = camera.position.distanceTo(
                    embankment.settingsHandle.getWorldPosition(new THREE.Vector3()));
                const pr = Utils.projectedRadius(1, camera, handleDistance, renderAreaSize.width, renderAreaSize.height);
                const scale = (20 / pr);
                embankment.settingsHandle.scale.set(scale, scale, scale);
            }
            for (const label of [embankment.volumeLabel, embankment.breakdownLabel]) {
                if (!label.visible) {
                    continue;
                }
                const distance = label.position.distanceTo(camera.position);
                const pr = Utils.projectedRadius(1, camera, distance, renderAreaSize.width, renderAreaSize.height);
                const scale = ((label === embankment.volumeLabel ? 70 : 50) / pr);
                label.scale.set(scale, scale, scale);
            }
            for (const label of [...embankment.baseEdgeLabels, ...embankment.heightLabels]) {
                if (!label || !label.visible) {
                    continue;
                }
                const distance = label.position.distanceTo(camera.position);
                const pr = Utils.projectedRadius(1, camera, distance, renderAreaSize.width, renderAreaSize.height);
                const scale = (55 / pr);
                label.scale.set(scale, scale, scale);
            }
            for (const edge of [...embankment.baseEdges, ...embankment.crownEdges, ...embankment.cornerEdges]) {
                if (edge.material && edge.material.resolution) {
                    edge.material.resolution.set(renderAreaSize.width, renderAreaSize.height);
                }
            }
        }
    }

    render() {
        this.viewer.renderer.render(this.scene, this.viewer.scene.getActiveCamera());
    }
}
