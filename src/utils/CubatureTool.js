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
import { Cubature } from "./Cubature.js";
import { Utils } from "../utils.js";
import { EventDispatcher } from "../EventDispatcher.js";
import { computeCentroid } from "./CubatureMath.js";

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
        this.snapHintGroup = new THREE.Group();
        this.snapHintGroup.name = "cubature_snap_hints";
        this.scene.add(this.snapHintGroup);

        this.contextMenuEl = this.createContextMenuEl();

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
            this.scene.remove(e.cubature);
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
        this.clearSnapHints();

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
            if (e.keyCode === 27 || e.keyCode === 13) {
                const rect = this.viewer.renderer.domElement.getBoundingClientRect();
                this.pushPullStartY = rect.top + this.viewer.inputHandler.mouse.y;
                this.finishInsertion(cubature);
            } else if (e.keyCode === 8) {
                if (cubature.topControlPoints.length > 1) {
                    cubature.removeTopMarker(cubature.topControlPoints.length - 1);
                }
            }
        };

        this.attach("mouseup", onMouseUp);
        this.attach("keydown", onKeyDown);
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
        this.detachAll();
        this.cancelInputHandlerDrag();
        this.renderer.domElement.style.cursor = "ns-resize";
        this.attachPushPullListeners(cubature);
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
                            this.clearSnapHints();
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
                this.clearSnapHints();
            }
        };

        this.attach("mousemove", onMouseMove);
        this.attach("mousedown", onMouseDown);
        this.attach("contextmenu", onContextMenu);
        this.attach("keydown", onKeyDown);
    }

    showSnapHints(cubature) {
        this.clearSnapHints();
        const previewPositions = cubature.computeSnapPreviewPositions(this.viewer);
        if (previewPositions.length === 0) {
            return;
        }
        const sphereGeo = new THREE.SphereGeometry(0.5, 12, 12);
        const material = new THREE.MeshBasicMaterial({
            color: 0x33ff77,
            transparent: true,
            opacity: 0.55,
            depthTest: false,
            depthWrite: false,
            wireframe: true
        });
        for (let i = 0; i < previewPositions.length; i++) {
            const pos = previewPositions[i];
            if (!pos) {
                continue;
            }
            const ghost = new THREE.Mesh(sphereGeo, material);
            ghost.position.copy(pos);
            ghost.renderOrder = 1001;
            this.snapHintGroup.add(ghost);
        }
    }

    clearSnapHints() {
        while (this.snapHintGroup.children.length > 0) {
            const ghost = this.snapHintGroup.children[0];
            this.snapHintGroup.remove(ghost);
            if (ghost.geometry) {
                ghost.geometry.dispose();
            }
            if (ghost.material) {
                ghost.material.dispose();
            }
        }
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
        this.clearSnapHints();
        this.cancelInputHandlerDrag();
        this.renderer.domElement.style.cursor = "";
        this.activeCubature = null;
        this.attachEditListeners(cubature);
    }

    cancelCubature(cubature) {
        this.detachAll();
        this.clearSnapHints();
        this.hideContextMenu();
        if (this.viewer.scene.cubatures.indexOf(cubature) !== -1) {
            this.viewer.scene.removeCubature(cubature);
        }
        this.renderer.domElement.style.cursor = "";
        if (this.activeCubature === cubature) {
            this.activeCubature = null;
        }
    }

    attachEditListeners(cubature) {
        const onMouseMove = () => {
            const raycaster = this.getRaycaster();
            const threshold = this.computePickThreshold(cubature);
            this.hoveredMarker = cubature.pickMarker(raycaster);
            if (!this.hoveredMarker) {
                this.hoveredEdge = cubature.pickEdge(raycaster, threshold);
            } else {
                this.hoveredEdge = null;
            }
            if (this.hoveredMarker) {
                this.renderer.domElement.style.cursor = "move";
            } else if (this.hoveredEdge) {
                this.renderer.domElement.style.cursor = "crosshair";
            } else {
                this.renderer.domElement.style.cursor = "";
            }
        };
        const onMouseDown = (e) => {
            if (e.button !== THREE.MOUSE.RIGHT) {
                return;
            }
            const raycaster = this.getRaycaster();
            const markerHit = cubature.pickMarker(raycaster);
            if (markerHit) {
                e.preventDefault();
                e.stopPropagation();
                const isBottom = markerHit.polygonId === "bottom";
                const snapLabel = isBottom
                    ? "Přichytit tento bod ke dnu"
                    : "Přichytit tento bod k povrchu";
                this.showContextMenu(e.clientX, e.clientY, [
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
                ]);
                return;
            }
            const edgeHit = cubature.pickEdge(raycaster, this.computePickThreshold(cubature));
            if (edgeHit) {
                e.preventDefault();
                e.stopPropagation();
                this.showContextMenu(e.clientX, e.clientY, [
                    {
                        label: "Vložit vrchol zde",
                        action: () => cubature.insertVertexAt(edgeHit.polygonId, edgeHit.edgeIndex, edgeHit.point)
                    },
                    {
                        label: "Přichytit dno k terénu (S)",
                        action: () => cubature.snapBottomToTerrain(this.viewer)
                    }
                ]);
            }
        };
        const onContextMenu = (e) => {
            e.preventDefault();
            e.stopPropagation();
        };
        const onKeyDown = (e) => {
            if (e.keyCode === 46) {
                if (this.hoveredMarker && cubature.topControlPoints.length > 3) {
                    cubature.removeVertex(this.hoveredMarker.index);
                    this.hoveredMarker = null;
                }
            } else if (e.keyCode === 27) {
                this.hideContextMenu();
            } else if (e.keyCode === 83) {
                cubature.snapBottomToTerrain(this.viewer);
            }
        };

        this.attach("mousemove", onMouseMove);
        this.attach("mousedown", onMouseDown);
        this.attach("contextmenu", onContextMenu);
        this.attach("keydown", onKeyDown);
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

    createContextMenuEl() {
        const el = document.createElement("div");
        el.className = "potree-cubature-menu";
        el.style.cssText = [
            "position: absolute",
            "display: none",
            "z-index: 10000",
            "background: rgba(0,0,0,0.85)",
            "color: white",
            "padding: 4px 0",
            "border-radius: 4px",
            "font-size: 14px",
            "font-family: Arial, sans-serif",
            "user-select: none",
            "min-width: 160px"
        ].join("; ");
        document.body.appendChild(el);
        return el;
    }

    cancelInputHandlerDrag() {
        if (this.viewer.inputHandler && this.viewer.inputHandler.drag) {
            this.viewer.inputHandler.drag = null;
        }
    }

    showContextMenu(x, y, items) {
        this.cancelInputHandlerDrag();
        const el = this.contextMenuEl;
        while (el.firstChild) {
            el.removeChild(el.firstChild);
        }
        for (const item of items) {
            const row = document.createElement("div");
            row.textContent = item.label;
            row.style.cssText = "padding: 6px 16px; cursor: pointer;";
            row.addEventListener("mouseenter", () => {
                row.style.background = "rgba(255,255,255,0.15)";
            });
            row.addEventListener("mouseleave", () => {
                row.style.background = "";
            });
            row.addEventListener("click", () => {
                item.action();
                this.hideContextMenu();
            });
            el.appendChild(row);
        }
        el.style.left = "0px";
        el.style.top = "0px";
        el.style.visibility = "hidden";
        el.style.display = "block";

        const rect = el.getBoundingClientRect();
        const padding = 4;
        const maxLeft = Math.max(0, window.innerWidth - rect.width - padding);
        const maxTop = Math.max(0, window.innerHeight - rect.height - padding);
        const clampedX = Math.min(Math.max(0, x), maxLeft);
        const clampedY = Math.min(Math.max(0, y), maxTop);

        el.style.left = clampedX + "px";
        el.style.top = clampedY + "px";
        el.style.visibility = "";

        const onOutside = (e) => {
            if (!el.contains(e.target)) {
                this.hideContextMenu();
                document.removeEventListener("mousedown", onOutside, true);
            }
        };
        setTimeout(() => {
            document.addEventListener("mousedown", onOutside, true);
        }, 0);
    }

    hideContextMenu() {
        if (this.contextMenuEl) {
            this.contextMenuEl.style.display = "none";
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
