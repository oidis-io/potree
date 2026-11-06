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
import { createDtmMapUrl } from "./DtmService.js";

const REFRESH_DELAY_MILLISECONDS = 400;
const MAXIMUM_EXTENT_METRES = 3000;
const MAXIMUM_IMAGE_SIZE = 4096;
const MINIMUM_METRES_PER_PIXEL = 0.05;
const VIEW_CHANGE_TOLERANCE = 0.001;
const DIRECTION_SCALE = 1000;
const TERRAIN_GRID_STEP_METRES = 4;
const MAXIMUM_TERRAIN_GRID_SEGMENTS = 256;
const TERRAIN_LIFT_METRES = 0.1;
const SURFACE_INTERSECTION_ITERATIONS = 4;

export class DtmOverlay extends EventDispatcher {
    constructor(viewer, mapPlane) {
        super();
        this.viewer = viewer;
        this.mapPlane = mapPlane;
        this.visible = false;
        this.loading = false;
        this.requestIndex = 0;
        this.refreshPending = false;
        this.lastViewChangeTime = 0;
        this.lastViewSnapshot = null;
        this.shownImage = null;
        this.terrainHeightSampler = null;
        this.textureLoader = new THREE.TextureLoader();
        this.material = new THREE.MeshBasicMaterial({ transparent: true, depthTest: false, depthWrite: false });
        this.mesh = new THREE.Mesh(new THREE.PlaneBufferGeometry(1, 1), this.material);
        this.mesh.visible = false;
        this.mesh.frustumCulled = false;
        this.scene = new THREE.Scene();
        this.scene.add(this.mesh);

        viewer.addEventListener("update", () => this.update());
        viewer.addEventListener("render.pass.scene", (event) => this.render(event));
    }

    setTerrainHeightSampler(terrainHeightSampler) {
        this.terrainHeightSampler = terrainHeightSampler;
        terrainHeightSampler.addEventListener("ready", () => {
            if (this.shownImage) {
                this.updateSurfaceGeometry(this.shownImage.extent);
            }
        });
    }

    intersectSurface(screenX, screenY) {
        const sampler = this.terrainHeightSampler?.isReady ? this.terrainHeightSampler : null;
        let point = this.mapPlane.intersectScreenPoint(screenX, screenY);
        for (let iteration = 0; point && sampler && iteration < SURFACE_INTERSECTION_ITERATIONS; iteration++) {
            const surfaceHeight = (sampler.heightAt(point.x, point.y) ?? this.mapPlane.height) + TERRAIN_LIFT_METRES;
            point = this.mapPlane.intersectScreenPointAtHeight(screenX, screenY, surfaceHeight) ?? point;
        }
        return point;
    }

    updateSurfaceGeometry(extent) {
        const sampler = this.terrainHeightSampler?.isReady ? this.terrainHeightSampler : null;
        const extentWidth = extent.maximumX - extent.minimumX;
        const extentHeight = extent.maximumY - extent.minimumY;
        const countSegments = (size) => THREE.MathUtils.clamp(Math.ceil(size / TERRAIN_GRID_STEP_METRES), 1, MAXIMUM_TERRAIN_GRID_SEGMENTS);
        const geometry = sampler
            ? new THREE.PlaneBufferGeometry(1, 1, countSegments(extentWidth), countSegments(extentHeight))
            : new THREE.PlaneBufferGeometry(1, 1);
        if (sampler) {
            const positions = geometry.attributes.position;
            const centerX = (extent.minimumX + extent.maximumX) / 2;
            const centerY = (extent.minimumY + extent.maximumY) / 2;
            for (let index = 0; index < positions.count; index++) {
                const terrainHeight = sampler.heightAt(centerX + positions.getX(index) * extentWidth, centerY + positions.getY(index) * extentHeight);
                positions.setZ(index, terrainHeight === null ? 0 : terrainHeight + TERRAIN_LIFT_METRES - this.mapPlane.height);
            }
        }
        this.mesh.geometry.dispose();
        this.mesh.geometry = geometry;
    }

    setVisible(visible) {
        this.visible = visible;
        this.mesh.visible = visible && this.material.map !== null;
        if (visible) {
            this.refreshPending = true;
            this.lastViewChangeTime = 0;
        } else {
            this.requestIndex++;
            this.setLoading(false);
        }
    }

    getImageMetresPerPixelAt(x, y) {
        if (!this.mesh.visible || !this.shownImage) {
            return null;
        }
        const extent = this.shownImage.extent;
        const isInside = x >= extent.minimumX && x <= extent.maximumX && y >= extent.minimumY && y <= extent.maximumY;
        return isInside ? this.shownImage.metresPerPixel : null;
    }

    update() {
        if (!this.visible) {
            return;
        }
        const now = performance.now();
        if (this.hasViewChanged()) {
            this.lastViewChangeTime = now;
            this.refreshPending = true;
            return;
        }
        if (this.refreshPending && now - this.lastViewChangeTime >= REFRESH_DELAY_MILLISECONDS) {
            this.refreshPending = false;
            this.refresh();
        }
    }

    hasViewChanged() {
        const snapshot = this.createViewSnapshot();
        const previousSnapshot = this.lastViewSnapshot;
        const changed = previousSnapshot === null
            || previousSnapshot.length !== snapshot.length
            || snapshot.some((value, index) => Math.abs(value - previousSnapshot[index]) > VIEW_CHANGE_TOLERANCE);
        if (changed) {
            this.lastViewSnapshot = snapshot;
        }
        return changed;
    }

    createViewSnapshot() {
        const camera = this.viewer.scene.getActiveCamera();
        const direction = camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(DIRECTION_SCALE);
        const projection = camera.isOrthographicCamera
            ? [camera.left, camera.right, camera.top, camera.bottom, camera.zoom]
            : [camera.fov, camera.aspect];
        const { width, height } = this.mapPlane.getRenderSize();
        return [...camera.position.toArray(), ...direction.toArray(), ...projection, width, height, this.mapPlane.height];
    }

    refresh() {
        const requestIndex = ++this.requestIndex;
        const extent = this.computeViewExtent();
        if (!extent) {
            this.mesh.visible = false;
            this.setLoading(false);
            return;
        }
        const image = this.computeImageSize(extent);
        this.setLoading(true);
        this.textureLoader.load(createDtmMapUrl(extent, image.width, image.height), (texture) => {
            if (requestIndex !== this.requestIndex) {
                texture.dispose();
                return;
            }
            this.applyTexture(texture, extent, image.metresPerPixel);
            this.setLoading(false);
        }, undefined, () => {
            if (requestIndex === this.requestIndex) {
                this.setLoading(false);
                this.dispatchEvent({ type: "load_failed" });
            }
        });
    }

    computeViewExtent() {
        return this.mapPlane.computeViewExtent(MAXIMUM_EXTENT_METRES);
    }

    computeImageSize(extent) {
        const { width, height } = this.mapPlane.getRenderSize();
        const extentWidth = extent.maximumX - extent.minimumX;
        const extentHeight = extent.maximumY - extent.minimumY;
        const screenMetresPerPixel = [
            this.mapPlane.metresPerPixelAt(width / 2, height / 2),
            this.mapPlane.metresPerPixelAt(width / 2, height - 1)
        ].filter((value) => value !== null);
        const finestScreenMetresPerPixel = screenMetresPerPixel.length > 0 ? Math.min(...screenMetresPerPixel) : 0;
        const metresPerPixel = Math.max(
            finestScreenMetresPerPixel,
            MINIMUM_METRES_PER_PIXEL,
            Math.max(extentWidth, extentHeight) / MAXIMUM_IMAGE_SIZE
        );
        const imageWidth = Math.max(1, Math.round(extentWidth / metresPerPixel));
        const imageHeight = Math.max(1, Math.round(extentHeight / metresPerPixel));
        return {
            width: imageWidth,
            height: imageHeight,
            metresPerPixel: extentWidth / imageWidth
        };
    }

    applyTexture(texture, extent, metresPerPixel) {
        texture.minFilter = THREE.LinearFilter;
        texture.generateMipmaps = false;
        const previousTexture = this.material.map;
        this.material.map = texture;
        this.material.needsUpdate = true;
        if (previousTexture) {
            previousTexture.dispose();
        }
        this.mesh.position.set((extent.minimumX + extent.maximumX) / 2, (extent.minimumY + extent.maximumY) / 2, this.mapPlane.height);
        this.mesh.scale.set(extent.maximumX - extent.minimumX, extent.maximumY - extent.minimumY, 1);
        this.updateSurfaceGeometry(extent);
        this.mesh.visible = this.visible;
        this.shownImage = { extent: extent, metresPerPixel: metresPerPixel };
    }

    setLoading(loading) {
        if (this.loading !== loading) {
            this.loading = loading;
            this.dispatchEvent({ type: "loading_changed", loading: loading });
        }
    }

    render(event) {
        if (event.renderTarget || !this.mesh.visible) {
            return;
        }
        this.viewer.renderer.render(this.scene, this.viewer.scene.getActiveCamera());
    }
}
