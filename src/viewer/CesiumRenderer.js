/*! ******************************************************************************************************** *
 *
 * Copyright 2025-2026 Oidis
 *
 * SPDX-License-Identifier: BSD-2-Clause
 * The BSD-2-Clause license for this file can be found in the LICENSE.txt file included with this distribution
 * or at https://spdx.org/licenses/BSD-2-Clause.html#licenseText
 *
 * ********************************************************************************************************* */

import * as THREE from "../../libs/three.js/build/three.module.js";

export const MapProvider = Object.freeze({
    OPEN_STREET_MAP: "openStreetMap",
    CUZK: "cuzk",
    ORTOFOTO: "orto",
    KATASTR: "katastr"
});

export class CesiumRenderer {
    static CONTEXT_RECOVERY_TIMEOUT_MS = 5000;

    constructor(viewer, args) {
        this.viewer = viewer;
        this._enabled = false;
        this._element = args.element;
        this.cesiumViewer = null;
        this._initFailed = false;
        this._cesiumContextLost = false;
        this._intentionalRelease = false;
        this._currentProviders = [];

        proj4.defs("EPSG:5514", "+proj=krovak +lat_0=49.5 +lon_0=24.83333333333333 +alpha=30.2881397527778 +k=0.9999 +x_0=0 +y_0=0 +ellps=bessel +towgs84=589,76,480,0,0,0,0 +units=m +no_defs");

        this._geoidOffset = 0;
    }

    get enabled() {
        return this._enabled;
    }

    set enabled(value) {
        if (this._initFailed) {
            return;
        }
        this._enabled = value;
    }

    get failed() {
        return this._initFailed;
    }

    _createViewer() {
        if (this.cesiumViewer) {
            return;
        }

        const creditContainer = document.createElement("div");
        creditContainer.style.display = "none";
        this._element.appendChild(creditContainer);

        this.cesiumViewer = new Cesium.Viewer(this._element, {
            useDefaultRenderLoop: false,
            showRenderLoopErrors: false,
            animation: false,
            baseLayerPicker: false,
            fullscreenButton: false,
            geocoder: false,
            homeButton: false,
            infoBox: false,
            sceneModePicker: false,
            selectionIndicator: false,
            timeline: false,
            navigationHelpButton: false,
            terrainShadows: Cesium.ShadowMode.DISABLED,
            creditContainer: creditContainer,
            imageryProvider: Cesium.createOpenStreetMapImageryProvider({
                url: "https://tile.openstreetmap.org/",
                maximumLevel: 19
            }),
        });

        this.cesiumViewer.canvas.addEventListener("webglcontextlost", (e) => {
            e.preventDefault();
            this._cesiumContextLost = true;
            if (this._intentionalRelease) {
                console.info("[CesiumRenderer] Context intentionally released for background tab");
            } else {
                console.warn("[CesiumRenderer] WebGL context lost");
            }
        }, false);

        this.cesiumViewer.canvas.addEventListener("webglcontextrestored", () => {
            console.warn("[CesiumRenderer] WebGL context restored");
            this._cesiumContextLost = false;
        }, false);

        if (this.cesiumViewer.cesiumWidget) {
            this.cesiumViewer.cesiumWidget.showErrorPanel = function() {};
        }

        if (this.cesiumViewer.scene) {
            this.cesiumViewer.scene.rethrowRenderErrors = true;
        }

        if (this.cesiumViewer.scene && this.cesiumViewer.scene.renderError) {
            this.cesiumViewer.scene.renderError.addEventListener((scene, error) => {
                console.error("[CesiumRenderer] scene.renderError:", error);
                this._cesiumContextLost = true;
            });
        }
    }

    _tryRecovery() {
        let savedProviders = this._currentProviders;
        if (this.cesiumViewer) {
            try {
                this.cesiumViewer.destroy();
            } catch (e) {
                // ignore destroy errors on lost context
            }
            this.cesiumViewer = null;
        }
        while (this._element.firstChild) {
            this._element.removeChild(this._element.firstChild);
        }
        this._createViewer();
        this.mapProviders = savedProviders;
    }

    releaseContext() {
        this._intentionalRelease = true;
        if (this.cesiumViewer) {
            try {
                let canvas = this.cesiumViewer.canvas;
                let gl = canvas.getContext("webgl") || canvas.getContext("webgl2");
                if (gl) {
                    let ext = gl.getExtension("WEBGL_lose_context");
                    if (ext) {
                        ext.loseContext();
                    }
                }
            } catch (e) {
                console.warn("[CesiumRenderer] releaseContext failed:", e.message);
            }
        }
    }

    restoreContext() {
        this._intentionalRelease = false;
        this._cesiumContextLost = false;
        this._contextLostTime = null;
        if (this.cesiumViewer) {
            try {
                this._tryRecovery();
            } catch (e) {
                console.error("[CesiumRenderer] restore failed:", e);
                this._initFailed = true;
            }
        }
    }

    set mapProviders(value) {
        if (!this.cesiumViewer || this._initFailed) {
            console.warn(`[CesiumRenderer] mapProviders SKIPPED: viewer=${!!this.cesiumViewer}, failed=${this._initFailed}`);
            return;
        }
        if (!Array.isArray(value)) {
            value = [value];
        }
        this._currentProviders = [...value];
        this.cesiumViewer.imageryLayers.removeAll();
        if (value.length === 0) {
            this.viewer.setShowCesium(false);
            return;
        } else {
            this.viewer.setShowCesium(true);
        }
        for (const provider of value) {
            switch (provider) {
                case MapProvider.OPEN_STREET_MAP:
                    this.cesiumViewer.imageryLayers.addImageryProvider(
                        Cesium.createOpenStreetMapImageryProvider({ url: "https://tile.openstreetmap.org/", maximumLevel: 19 })
                    );
                    break;

                case MapProvider.CUZK:
                    this.cesiumViewer.imageryLayers.addImageryProvider(
                        new Cesium.WebMapServiceImageryProvider({
                            url: "https://geoportal.cuzk.cz/WMS_ZM10_PUB/WMService.aspx",
                            layers: "GR_ZM10",
                            parameters: {
                                service: "WMS",
                                format: "image/png",
                                transparent: true,
                                version: "1.3.0",
                            },
                            tilingScheme: new Cesium.WebMercatorTilingScheme(),
                            maximumLevel: 18
                        })
                    );
                    break;

                case MapProvider.ORTOFOTO:
                    this.cesiumViewer.imageryLayers.addImageryProvider(
                        new Cesium.WebMapServiceImageryProvider({
                            url: "https://ags.cuzk.gov.cz/arcgis1/rest/services/ORTOFOTO/MapServer/export",
                            layers: "show",
                            rectangleSouthwestInMeters: new Cesium.Cartesian2(48.5, 12),
                            rectangleNortheastInMeters: new Cesium.Cartesian2(51.5, 19),
                            numberOfLevelZeroTilesX: 1,
                            numberOfLevelZeroTilesY: 1,
                            parameters: {
                                bboxSR: "4326",
                                imageSR: "4326",
                                dpi: 192,
                                format: "image/jpg",
                                transparent: true,
                                f: "image"
                            },
                            maximumLevel: 18
                        })
                    );
                    break;

                case MapProvider.KATASTR:
                    this.cesiumViewer.imageryLayers.addImageryProvider(
                        new Cesium.WebMapServiceImageryProvider({
                            url: "https://services.cuzk.gov.cz/wms/local-km-wms.asp",
                            layers: "RST_KN,RST_KMD,omp,parcelni_cisla,obrazy_parcel,hranice_parcel,DKM,dalsi_p_mapy,prehledka_kraju-linie,polygony_parcel",
                            rectangleSouthwestInMeters: new Cesium.Cartesian2(48.5, 12),
                            rectangleNortheastInMeters: new Cesium.Cartesian2(51.5, 19),
                            numberOfLevelZeroTilesX: 1,
                            numberOfLevelZeroTilesY: 1,
                            parameters: {
                                service: "WMS",
                                format: "image/png",
                                transparent: true,
                                version: "1.1.1",
                                crs: "EPSG:4326"
                            },
                            maximumLevel: 100
                        })
                    );
                    break;

                default:
                    console.warn(`Map provider '${provider}' not supported by Cesium renderer.`);
            }
        }
    }

    init() {
        try {
            this._createViewer();
        } catch (e) {
            console.error("[CesiumRenderer] init FAILED:", e);
            this._initFailed = true;
            return;
        }

        const startLonLat = [17.050547295, 49.685828670];
        let startPos = Cesium.Cartesian3.fromDegrees(startLonLat[0], startLonLat[1]);
        this.cesiumViewer.camera.setView({
            destination: startPos,
            orientation: {
                heading: 10,
                pitch: -Cesium.Math.PI_OVER_TWO * 0.5,
                roll: 0.0
            }
        });

        // TODO(mkelnar) simple hack for true geoHeight - experimental
        if (this.viewer.scene.pointclouds[0]) {
            this._geoidOffset = -1 * (this.viewer.scene.pointclouds[0].boundingSphere.center.z) + 2;
        }
        let pointcloudProjection = proj4.defs("EPSG:5514"); // TODO(mkelnar) should be loaded from point cloud SRS
        let mapProjection = proj4.defs("WGS84");

        window.toMap = proj4(pointcloudProjection, mapProjection);
        window.toScene = proj4(mapProjection, pointcloudProjection);
    }

    render(params) {
        if (!this.cesiumViewer || this._initFailed) {
            return;
        }

        if (this._cesiumContextLost) {
            return;
        }

        let gl = this.cesiumViewer.canvas.getContext("webgl");
        if (!gl || gl.isContextLost()) {
            this._cesiumContextLost = true;
            return;
        }

        this._element.style.display = this._enabled ? "block" : "none";

        const containerWidth = this._element.clientWidth;
        const containerHeight = this._element.clientHeight;

        if (containerWidth <= 0 || containerHeight <= 0) {
            return;
        }
        const canvas = this.cesiumViewer.canvas;

        if (canvas.width !== containerWidth || canvas.height !== containerHeight) {
            canvas.width = containerWidth;
            canvas.height = containerHeight;
            this.cesiumViewer.resize();
        }

        if (window.toMap !== undefined && this._enabled === true) {
            const activeCamera = this.viewer.scene.getActiveCamera();
            const pivot = this.viewer.scene.view.getPivot();

            const pPos = new THREE.Vector3(0, 0, 0).applyMatrix4(activeCamera.matrixWorld);
            const pTarget = pivot.clone();
            const upDir = new THREE.Vector3(0, 1, 0).applyMatrix4(activeCamera.matrixWorld).sub(pPos).normalize();
            const pUpPoint = pPos.clone().add(upDir.multiplyScalar(10));

            const toCes = (vec) => {
                const xy = [vec.x, vec.y];
                const height = vec.z + this._geoidOffset;
                const deg = toMap.forward(xy);
                return Cesium.Cartesian3.fromDegrees(...deg, height);
            };

            const cPos = toCes(pPos);
            const cTarget = toCes(pTarget);
            const cUpPoint = toCes(pUpPoint);

            const cDir = Cesium.Cartesian3.normalize(
                Cesium.Cartesian3.subtract(cTarget, cPos, new Cesium.Cartesian3()),
                new Cesium.Cartesian3()
            );
            const cUp = Cesium.Cartesian3.normalize(
                Cesium.Cartesian3.subtract(cUpPoint, cPos, new Cesium.Cartesian3()),
                new Cesium.Cartesian3()
            );

            this.cesiumViewer.camera.setView({
                destination: cPos,
                orientation: {
                    direction: cDir,
                    up: cUp
                }
            });

            const widthPx = containerWidth || this.cesiumViewer.canvas.clientWidth || 1;
            const heightPx = containerHeight || this.cesiumViewer.canvas.clientHeight || 1;
            const aspect = widthPx / heightPx;

            const scene = this.viewer.scene;

            if (activeCamera === scene.cameraP) {
                const fovy = THREE.MathUtils.degToRad(activeCamera.fov);
                this.cesiumViewer.camera.frustum.fov = aspect < 1 ? fovy : Math.atan(Math.tan(0.5 * fovy) * aspect) * 2;
                this.cesiumViewer.camera.frustum.aspectRatio = aspect;
            } else if (activeCamera === scene.cameraO) {
                const cameraO = activeCamera;
                const worldHeight = (cameraO.top - cameraO.bottom) / cameraO.zoom;
                const dist = Cesium.Cartesian3.distance(cPos, cTarget) || 1.0;

                let fovY = 2 * Math.atan(worldHeight / (2 * dist));
                this.cesiumViewer.camera.frustum.fov = aspect < 1 ? fovY : Math.atan(Math.tan(0.5 * fovY) * aspect) * 2;
                this.cesiumViewer.camera.frustum.aspectRatio = aspect;
                this.cesiumViewer.camera.frustum.near = 0.1;
                this.cesiumViewer.camera.frustum.far = 10_000_000;
            }

            this.cesiumViewer.render();
        }
    }
}
