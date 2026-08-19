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
import { AutoCubatureComputation } from "./AutoCubatureComputation.js";
import { Cubature } from "./Cubature.js";
import { Utils } from "../utils.js";
import { EventDispatcher } from "../EventDispatcher.js";
import { computeCentroid } from "./CubatureMath.js";
import { computeLockPlane, lockPlaneZAt } from "./HeightLockPlane.js";
import { ToolContextMenu } from "./ToolContextMenu.js";

export class CubatureTool extends EventDispatcher {
    constructor(viewer) {
        super();

        this.viewer = viewer;
        this.renderer = viewer.renderer;

        this.scene = new THREE.Scene();
        this.scene.name = "scene_cubature";
        this.light = new THREE.PointLight(0xffffff, 1.0);
        this.scene.add(this.light);

        this.viewer.inputHandler.registerInteractiveScene(this.scene);

        this.activeListeners = [];
        this.activeCubature = null;
        this.hoveredMarker = null;
        this.hoveredEdge = null;

        this.pushPullStartY = 0;
        this.pushPullScale = 1;
        this.pushPullCentroid = null;
        this.activeComputation = null;

        this.contextMenu = new ToolContextMenu(() => this.cancelInputHandlerDrag());

        this.globalContextMenuHandler = (e) => {
            const canvas = this.viewer.renderer.domElement;
            let insideCanvasArea = false;
            if (canvas) {
                const rect = canvas.getBoundingClientRect();
                insideCanvasArea = e.clientX >= rect.left && e.clientX <= rect.right &&
                    e.clientY >= rect.top && e.clientY <= rect.bottom;
            }
            if (this.activeCubature || insideCanvasArea) {
                e.preventDefault();
                e.stopPropagation();
            }
        };
        document.addEventListener("contextmenu", this.globalContextMenuHandler, { capture: true });

        this.onAdd = (e) => {
            this.scene.add(e.cubature);
        };
        this.onRemove = (e) => {
            const cubature = e.cubature;
            if (this.activeComputation !== null && this.activeComputation.owner === cubature) {
                this.cancelActiveComputation();
            }
            if (this.activeCubature === cubature) {
                this.detachAll();
                this.cancelInputHandlerDrag();
                this.renderer.domElement.style.cursor = "";
                this.activeCubature = null;
            }
            if (cubature._autoRecomputeTimer !== null) {
                clearTimeout(cubature._autoRecomputeTimer);
                cubature._autoRecomputeTimer = null;
            }
            cubature.applyHeightLock(null);
            this.scene.remove(cubature);
            cubature.dispose();
        };

        for (const c of viewer.scene.cubatures) {
            this.onAdd({ cubature: c });
        }

        viewer.scene.addEventListener("cubature_added", this.onAdd);
        viewer.scene.addEventListener("cubature_removed", this.onRemove);
        viewer.addEventListener("scene_changed", this.onSceneChange.bind(this));

        viewer.addEventListener("update", this.update.bind(this));
        viewer.addEventListener("render.pass.perspective_overlay", this.render.bind(this));

        viewer.inputHandler.addEventListener("delete", (e) => {
            const cubatures = e.selection.filter(x => x instanceof Cubature);
            cubatures.forEach(c => viewer.scene.removeCubature(c));
        });

        this.addEventListener("start_inserting_cubature", () => {
            this.viewer.dispatchEvent({ type: "cancel_insertions" });
        });

        this.onCancelInsertions = () => {
            if (this.activeCubature) {
                this.cancelCubature(this.activeCubature);
            }
        };
        viewer.addEventListener("cancel_insertions", this.onCancelInsertions);

        this.globalKeyHandler = (e) => {
            if (e.keyCode === 90 && e.shiftKey) {
                this.clearAllHeightLocks();
            }
        };
        viewer.renderer.domElement.addEventListener("keydown", this.globalKeyHandler);

        this.hoveredMarker = null;
        this.hoveredEdge = null;
        this.editCursorApplied = false;
        this.editMouseMove = () => this.handleEditMouseMove();
        this.editMouseDown = (e) => this.handleEditMouseDown(e);
        this.editKeyDown = (e) => this.handleEditKeyDown(e);
        viewer.renderer.domElement.addEventListener("mousemove", this.editMouseMove);
        viewer.renderer.domElement.addEventListener("mousedown", this.editMouseDown);
        viewer.renderer.domElement.addEventListener("keydown", this.editKeyDown);
    }

    anyInsertionActive() {
        if (this.activeCubature) {
            return true;
        }
        const embankmentTool = this.viewer.embankmentTool;
        return embankmentTool !== undefined && embankmentTool.activeEmbankment !== null && embankmentTool.activeEmbankment !== undefined;
    }

    editCubatures() {
        return this.viewer.scene.cubatures.filter((c) => c.enabled && c.phase === "edit");
    }

    pickEditTarget() {
        const raycaster = this.getRaycaster();
        const candidates = this.editCubatures();
        for (const cubature of candidates) {
            const markerHit = cubature.pickMarker(raycaster);
            if (markerHit) {
                return { cubature, markerHit, edgeHit: null };
            }
        }
        for (const cubature of candidates) {
            const edgeHit = cubature.pickEdge(raycaster, this.computePickThreshold(cubature));
            if (edgeHit) {
                return { cubature, markerHit: null, edgeHit };
            }
        }
        return null;
    }

    clearAllHeightLocks() {
        for (const cubature of this.viewer.scene.cubatures) {
            if (cubature.heightLock !== null) {
                cubature.applyHeightLock(null);
            }
        }
    }

    onSceneChange(e) {
        if (e.oldScene) {
            e.oldScene.removeEventListener("cubature_added", this.onAdd);
            e.oldScene.removeEventListener("cubature_removed", this.onRemove);
        }
        e.scene.addEventListener("cubature_added", this.onAdd);
        e.scene.addEventListener("cubature_removed", this.onRemove);
    }

    attach(eventType, handler, target) {
        const el = target || this.viewer.renderer.domElement;
        el.addEventListener(eventType, handler);
        this.activeListeners.push({ event: eventType, handler: handler, target: el });
    }

    detachAll() {
        for (const l of this.activeListeners) {
            l.target.removeEventListener(l.event, l.handler);
        }
        this.activeListeners = [];
    }

    getMouseNDC() {
        const rect = this.viewer.renderer.domElement.getBoundingClientRect();
        const mouse = this.viewer.inputHandler.mouse;
        return new THREE.Vector2(
            (mouse.x / rect.width) * 2 - 1,
            -(mouse.y / rect.height) * 2 + 1
        );
    }

    getRaycaster() {
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(this.getMouseNDC(), this.viewer.scene.getActiveCamera());
        return raycaster;
    }

    computePickThreshold(cubature) {
        const camera = this.viewer.scene.getActiveCamera();
        let centroidX = 0, centroidY = 0, centroidZ = 0;
        const all = [...cubature.topControlPoints, ...cubature.bottomControlPoints];
        if (all.length === 0) {
            return 0.5;
        }
        for (const p of all) {
            centroidX += p.x;
            centroidY += p.y;
            centroidZ += p.z;
        }
        centroidX /= all.length;
        centroidY /= all.length;
        centroidZ /= all.length;
        const dist = camera.position.distanceTo(new THREE.Vector3(centroidX, centroidY, centroidZ));
        const viewHeight = this.viewer.renderer.domElement.clientHeight || 1;
        return Math.max(0.1, Math.min(20, (dist / viewHeight) * 30));
    }

    startInsertion(args = {}) {
        if (this.activeCubature) {
            this.cancelCubature(this.activeCubature);
        }
        this.detachAll();

        const cubature = new Cubature({
            topColor: args.topColor,
            bottomColor: args.bottomColor,
            sideColor: args.sideColor,
            sideMeshColor: args.sideMeshColor
        });
        cubature.name = args.name || cubature.name;

        this.dispatchEvent({ type: "start_inserting_cubature", cubature: cubature });

        this.viewer.scene.addCubature(cubature);
        this.activeCubature = cubature;

        this.renderer.domElement.style.cursor = "crosshair";
        this.attachInsertionListeners(cubature);

        cubature.addTopMarker(new THREE.Vector3(0, 0, 0));
        this.viewer.inputHandler.startDragging(cubature.topSpheres[cubature.topSpheres.length - 1]);

        return cubature;
    }

    startAutoInsertion(args = {}) {
        const cubature = this.startInsertion(args);
        cubature.autoMode = true;
        cubature.autoOptions = args.options || {};
        this.enableAutoRecompute(cubature);
        return cubature;
    }

    enableAutoRecompute(cubature) {
        if (cubature._autoRecomputeWired) {
            return;
        }
        cubature._autoRecomputeWired = true;
        const schedule = () => {
            if (!cubature.autoMode || cubature._loadingFromDb || cubature.phase !== "edit") {
                return;
            }
            if (cubature._autoRecomputeTimer) {
                clearTimeout(cubature._autoRecomputeTimer);
            }
            cubature._autoRecomputeTimer = setTimeout(() => {
                cubature._autoRecomputeTimer = null;
                if (!cubature.autoStale || cubature.phase !== "edit") {
                    return;
                }
                if (this.viewer.scene.cubatures.indexOf(cubature) === -1) {
                    return;
                }
                if (this.anyInsertionActive() || this.activeComputation !== null ||
                    (this.viewer.inputHandler && this.viewer.inputHandler.drag)) {
                    schedule();
                    return;
                }
                this.recompute(cubature);
            }, 600);
        };
        cubature.addEventListener("marker_moved", schedule);
        cubature.addEventListener("vertex_inserted", schedule);
        cubature.addEventListener("vertex_removed", schedule);
    }

    attachInsertionListeners(cubature) {
        const onMouseUp = (e) => {
            if (e.button === THREE.MOUSE.LEFT) {
                const last = cubature.topControlPoints[cubature.topControlPoints.length - 1];
                if (last) {
                    cubature.addTopMarker(last.clone());
                    this.viewer.inputHandler.startDragging(cubature.topSpheres[cubature.topSpheres.length - 1]);
                }
            } else if (e.button === THREE.MOUSE.RIGHT) {
                this.pushPullStartY = e.clientY;
                this.finishInsertion(cubature);
            }
        };
        const onKeyDown = (e) => {
            if (e.keyCode === 13) {
                const rect = this.viewer.renderer.domElement.getBoundingClientRect();
                this.pushPullStartY = rect.top + this.viewer.inputHandler.mouse.y;
                this.finishInsertion(cubature);
            } else if (e.keyCode === 27) {
                this.cancelCubature(cubature);
            } else if (e.keyCode === 8) {
                if (cubature.topControlPoints.length > 1) {
                    cubature.removeTopMarker(cubature.topControlPoints.length - 2);
                }
            } else if (e.keyCode === 90 && !e.shiftKey) {
                if (cubature.heightLock === null) {
                    const placed = cubature.topControlPoints.slice(0, Math.max(1, cubature.topControlPoints.length - 1));
                    cubature.applyHeightLock(computeLockPlane(placed));
                    this.snapPendingMarkerToLock(cubature);
                } else {
                    cubature.applyHeightLock(null);
                }
            }
        };

        this.attach("mouseup", onMouseUp);
        this.attach("keydown", onKeyDown);
    }

    snapPendingMarkerToLock(cubature) {
        if (cubature.heightLock === null || cubature.topControlPoints.length === 0) {
            return;
        }
        const index = cubature.topControlPoints.length - 1;
        const target = cubature.topControlPoints[index].clone();
        target.z = lockPlaneZAt(cubature.heightLock, target.x, target.y);
        cubature.setTopPoint(index, target);
    }

    finishInsertion(cubature) {
        const N = cubature.topControlPoints.length;
        if (N >= 2) {
            const last = cubature.topControlPoints[N - 1];
            const prev = cubature.topControlPoints[N - 2];
            const dx = last.x - prev.x;
            const dy = last.y - prev.y;
            const dz = last.z - prev.z;
            const duplicate = Math.sqrt(dx * dx + dy * dy + dz * dz) < 0.01;
            if (duplicate) {
                cubature.removeTopMarker(N - 1);
            }
        }
        if (!cubature.closeTopPolygon()) {
            this.cancelCubature(cubature);
            return;
        }
        cubature.applyHeightLock(null);
        this.detachAll();
        this.cancelInputHandlerDrag();
        if (cubature.autoMode) {
            this.beginAutoComputation(cubature, { removeOnCancel: true });
            return;
        }
        this.renderer.domElement.style.cursor = "ns-resize";
        this.attachPushPullListeners(cubature);
    }

    beginAutoComputation(cubature, behavior = {}) {
        if (this.activeComputation !== null) {
            this.cancelActiveComputation();
        }
        this.detachAll();
        this.cancelInputHandlerDrag();
        this.hideContextMenu();
        this.renderer.domElement.style.cursor = "progress";
        cubature.beginComputing();

        const computation = new AutoCubatureComputation(this.viewer, {
            topControlPoints: cubature.topControlPoints,
            options: cubature.autoOptions
        }, {
            onProgress: (progress) => {
                cubature.computationProgress = progress;
                cubature.update();
            },
            onCompleted: (result) => {
                this.activeComputation = null;
                cubature.applyComputedResult(result);
                this.finishComputationInteraction(cubature);
                cubature.dispatchEvent({ type: "volume_computed", cubature: cubature, result: result });
            },
            onFailed: (error) => {
                this.activeComputation = null;
                cubature.computationState = "failed";
                console.error("Auto cubature computation failed:", error);
                this.finishComputationInteraction(cubature);
                cubature.dispatchEvent({ type: "computation_failed", cubature: cubature, reason: error.message });
            },
            onCanceled: () => {
                this.activeComputation = null;
                if (behavior.removeOnCancel) {
                    this.cancelCubature(cubature);
                    return;
                }
                cubature.computationState = cubature.computedVolume === null ? "idle" : "done";
                this.finishComputationInteraction(cubature);
            }
        });

        computation.owner = cubature;
        this.activeComputation = computation;
        this.attachComputingListeners(cubature);
        computation.start();
    }

    finishComputationInteraction(cubature) {
        this.detachAll();
        this.renderer.domElement.style.cursor = "";
        if (this.activeCubature === cubature) {
            this.activeCubature = null;
        }
        if (cubature.phase !== "edit") {
            cubature.commitPushPull();
        } else {
            cubature.update();
        }
    }

    attachComputingListeners(cubature) {
        const onKeyDown = (e) => {
            if (e.keyCode === 27) {
                this.cancelActiveComputation();
            }
        };
        const onMouseDown = (e) => {
            if (e.button === THREE.MOUSE.RIGHT) {
                e.preventDefault();
                e.stopPropagation();
                this.showContextMenu(e.clientX, e.clientY, [
                    {
                        label: "Zrušit výpočet",
                        action: () => this.cancelActiveComputation()
                    }
                ]);
            }
        };
        const onContextMenu = (e) => {
            e.preventDefault();
            e.stopPropagation();
        };
        this.attach("keydown", onKeyDown);
        this.attach("mousedown", onMouseDown);
        this.attach("contextmenu", onContextMenu);
    }

    cancelActiveComputation() {
        if (this.activeComputation !== null) {
            this.activeComputation.cancel();
        }
    }

    recompute(cubature, optionsOverride = {}) {
        if (!cubature.autoMode) {
            throw new Error("Only automatic cubatures can be recomputed.");
        }
        if (cubature.phase !== "edit") {
            return;
        }
        cubature.autoOptions = { ...cubature.autoOptions, ...optionsOverride };
        this.beginAutoComputation(cubature, { removeOnCancel: false });
    }

    attachPushPullListeners(cubature) {
        const centroid = computeCentroid(cubature.topControlPoints);
        this.pushPullCentroid = new THREE.Vector3(centroid.x, centroid.y, centroid.z);
        const camera = this.viewer.scene.getActiveCamera();
        const cameraDist = camera.position.distanceTo(this.pushPullCentroid);
        const viewHeight = this.viewer.renderer.domElement.clientHeight || 1;
        this.pushPullScale = Math.max(0.01, cameraDist / viewHeight);

        const minTerrainZ = this.computeTerrainMinZ();
        const minTopZ = cubature.topControlPoints.reduce((m, p) => Math.min(m, p.z), Infinity);
        const maxOffsetDown = Number.isFinite(minTerrainZ)
            ? minTerrainZ - 0.5 - minTopZ
            : -100;

        const onMouseMove = (e) => {
            const deltaY = e.clientY - this.pushPullStartY;
            let deltaZ = -deltaY * this.pushPullScale;
            if (deltaZ < maxOffsetDown) {
                deltaZ = maxOffsetDown;
            }
            cubature.setPushPullOffset(deltaZ);
        };
        const onMouseDown = (e) => {
            if (e.button === THREE.MOUSE.LEFT) {
                e.preventDefault();
                this.commitPushPull(cubature);
            } else if (e.button === THREE.MOUSE.RIGHT) {
                e.preventDefault();
                e.stopPropagation();
                this.showContextMenu(e.clientX, e.clientY, [
                    {
                        label: "Přichytit dno k terénu",
                        action: () => {
                            cubature.snapBottomToTerrain(this.viewer);
                        }
                    },
                    {
                        label: "Potvrdit hloubku",
                        action: () => this.commitPushPull(cubature)
                    },
                    {
                        label: "Zadat hloubku číselně",
                        action: () => this.openNumericInput(cubature)
                    },
                    {
                        label: "Zrušit kubaturu",
                        action: () => this.cancelCubature(cubature)
                    }
                ]);
            }
        };
        const onContextMenu = (e) => {
            e.preventDefault();
            e.stopPropagation();
        };
        const onKeyDown = (e) => {
            if (e.keyCode === 27) {
                this.cancelCubature(cubature);
            } else if (e.keyCode === 84) {
                this.openNumericInput(cubature);
            } else if (e.keyCode === 83) {
                cubature.snapBottomToTerrain(this.viewer);
            }
        };

        this.attach("mousemove", onMouseMove);
        this.attach("mousedown", onMouseDown);
        this.attach("contextmenu", onContextMenu);
        this.attach("keydown", onKeyDown);
    }

    computeTerrainMinZ() {
        let minZ = Infinity;
        for (const pc of this.viewer.scene.pointclouds) {
            if (!pc.boundingBox) {
                continue;
            }
            const z = pc.boundingBox.min.z + pc.position.z;
            if (z < minZ) {
                minZ = z;
            }
        }
        return minZ;
    }

    commitPushPull(cubature) {
        cubature.commitPushPull();
        this.detachAll();
        this.cancelInputHandlerDrag();
        this.renderer.domElement.style.cursor = "";
        this.activeCubature = null;
    }

    cancelCubature(cubature) {
        this.detachAll();
        this.hideContextMenu();
        if (this.viewer.scene.cubatures.indexOf(cubature) !== -1) {
            this.viewer.scene.removeCubature(cubature);
        }
        this.renderer.domElement.style.cursor = "";
        if (this.activeCubature === cubature) {
            this.activeCubature = null;
        }
    }

    handleEditMouseMove() {
        if (this.anyInsertionActive()) {
            return;
        }
        const target = this.pickEditTarget();
        this.hoveredMarker = target !== null && target.markerHit !== null
            ? { cubature: target.cubature, ...target.markerHit }
            : null;
        this.hoveredEdge = target !== null ? target.edgeHit : null;
        if (this.hoveredMarker) {
            this.renderer.domElement.style.cursor = "move";
            this.editCursorApplied = true;
        } else if (this.hoveredEdge) {
            this.renderer.domElement.style.cursor = "crosshair";
            this.editCursorApplied = true;
        } else if (this.editCursorApplied) {
            this.renderer.domElement.style.cursor = "";
            this.editCursorApplied = false;
        }
    }

    handleEditMouseDown(e) {
        if (this.anyInsertionActive() || e.button !== THREE.MOUSE.RIGHT) {
            return;
        }
        const target = this.pickEditTarget();
        if (target === null) {
            return;
        }
        const cubature = target.cubature;
        const markerHit = target.markerHit;
        const edgeHit = target.edgeHit;
        if (markerHit) {
            e.preventDefault();
            e.stopImmediatePropagation();
            const isBottom = markerHit.polygonId === "bottom";
            const snapLabel = isBottom
                ? "Přichytit tento bod ke dnu"
                : "Přichytit tento bod k povrchu";
            const markerItems = [
                {
                    label: cubature.heightLock === null
                        ? "Držet výšku tohoto vrcholu (řez)"
                        : "Vypnout držení výšky",
                    action: () => {
                        if (cubature.heightLock === null) {
                            const vertex = cubature.topControlPoints[markerHit.index];
                            cubature.applyHeightLock({ x0: vertex.x, y0: vertex.y, z0: vertex.z, gx: 0, gy: 0 });
                        } else {
                            cubature.applyHeightLock(null);
                        }
                    }
                },
                {
                    label: snapLabel,
                    action: () => cubature.snapVertexToTerrain(this.viewer, markerHit.polygonId, markerHit.index)
                },
                {
                    label: "Smazat vrchol",
                    action: () => cubature.removeVertex(markerHit.index)
                },
                {
                    label: "Vložit vrchol před",
                    action: () => {
                        const N = cubature.topControlPoints.length;
                        const prev = (markerHit.index - 1 + N) % N;
                        cubature.insertVertexAt(markerHit.polygonId, prev);
                    }
                },
                {
                    label: "Vložit vrchol za",
                    action: () => cubature.insertVertexAt(markerHit.polygonId, markerHit.index)
                }
            ];
            if (cubature.autoMode) {
                markerItems.push({
                    label: "Přepočítat objem",
                    action: () => this.recompute(cubature)
                });
            }
            this.showContextMenu(e.clientX, e.clientY, markerItems);
            return;
        }
        if (edgeHit) {
            e.preventDefault();
            e.stopImmediatePropagation();
            const edgeItems = [
                {
                    label: "Vložit vrchol zde",
                    action: () => cubature.insertVertexAt(edgeHit.polygonId, edgeHit.edgeIndex, edgeHit.point)
                },
                {
                    label: "Přichytit dno k terénu (S)",
                    action: () => cubature.snapBottomToTerrain(this.viewer)
                }
            ];
            if (cubature.autoMode) {
                edgeItems.push({
                    label: "Přepočítat objem",
                    action: () => this.recompute(cubature)
                });
            }
            this.showContextMenu(e.clientX, e.clientY, edgeItems);
        }
    }

    handleEditKeyDown(e) {
        if (this.anyInsertionActive()) {
            return;
        }
        if (e.keyCode === 46) {
            const hovered = this.hoveredMarker;
            if (hovered && hovered.cubature.topControlPoints.length > 3) {
                hovered.cubature.removeVertex(hovered.index);
                this.hoveredMarker = null;
            }
        } else if (e.keyCode === 27) {
            this.hideContextMenu();
        } else if (e.keyCode === 83) {
            const target = this.pickEditTarget();
            const candidates = this.editCubatures();
            const cubature = target !== null ? target.cubature : (candidates.length === 1 ? candidates[0] : null);
            if (cubature !== null) {
                cubature.snapBottomToTerrain(this.viewer);
            }
        } else if (e.keyCode === 90 && !e.shiftKey) {
            for (const cubature of this.editCubatures()) {
                if (cubature.heightLock !== null) {
                    cubature.applyHeightLock(null);
                }
            }
        }
    }

    openNumericInput(cubature) {
        const value = window.prompt("Hloubka výkopu (m, záporná hodnota = dolů):", "-1.0");
        if (value === null) {
            return;
        }
        const parsed = parseFloat(value);
        if (!Number.isFinite(parsed)) {
            return;
        }
        cubature.setPushPullOffset(parsed);
        this.commitPushPull(cubature);
    }

    showContextMenu(x, y, items) {
        this.contextMenu.show(x, y, items);
    }

    hideContextMenu() {
        this.contextMenu.hide();
    }

    cancelInputHandlerDrag() {
        if (this.viewer.inputHandler && this.viewer.inputHandler.drag) {
            this.viewer.inputHandler.drag = null;
        }
    }

    update() {
        const scene = this.viewer.scene;
        if (!scene) {
            return;
        }
        const camera = scene.getActiveCamera();
        const renderAreaSize = this.viewer.renderer.getSize(new THREE.Vector2());
        const clientWidth = renderAreaSize.width;
        const clientHeight = renderAreaSize.height;

        this.light.position.copy(camera.position);

        for (const cubature of scene.cubatures) {
            cubature.lengthUnit = this.viewer.lengthUnit;
            cubature.lengthUnitDisplay = this.viewer.lengthUnitDisplay;

            const allSpheres = [...cubature.topSpheres, ...cubature.bottomSpheres];
            for (const sphere of allSpheres) {
                const distance = camera.position.distanceTo(sphere.getWorldPosition(new THREE.Vector3()));
                const pr = Utils.projectedRadius(1, camera, distance, clientWidth, clientHeight);
                const scale = (15 / pr);
                sphere.scale.set(scale, scale, scale);
            }

            const label = cubature.volumeLabel;
            if (label && label.visible) {
                const distance = label.position.distanceTo(camera.position);
                const pr = Utils.projectedRadius(1, camera, distance, clientWidth, clientHeight);
                const scale = (70 / pr);
                label.scale.set(scale, scale, scale);
            }

            const edgeLabels = [
                ...cubature.topEdgeLabels,
                ...cubature.bottomEdgeLabels,
                ...cubature.sideEdgeLabels
            ];
            for (const el of edgeLabels) {
                if (!el || !el.visible) {
                    continue;
                }
                const distance = el.position.distanceTo(camera.position);
                const pr = Utils.projectedRadius(1, camera, distance, clientWidth, clientHeight);
                const scale = (55 / pr);
                el.scale.set(scale, scale, scale);
            }

            const lineMaterials = [
                ...cubature.topEdges.map(e => e.material),
                ...cubature.bottomEdges.map(e => e.material),
                ...cubature.sideEdges.map(e => e.material)
            ];
            for (const material of lineMaterials) {
                if (material && material.resolution) {
                    material.resolution.set(clientWidth, clientHeight);
                }
            }
        }
    }

    render() {
        this.viewer.renderer.render(this.scene, this.viewer.scene.getActiveCamera());
    }
}
