/*! ******************************************************************************************************** *
 *
 * Copyright 2025 Oidis
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
    constructor(viewer, args) {
        this.viewer = viewer;
        this._enabled = false;
        this._element = args.element;
        this.cesiumViewer = new Cesium.Viewer(this._element, {
            useDefaultRenderLoop: false,
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
        });

        proj4.defs("EPSG:5514", "+proj=krovak +lat_0=49.5 +lon_0=24.83333333333333 +alpha=30.2881397527778 +k=0.9999 +x_0=0 +y_0=0 +ellps=bessel +towgs84=589,76,480,0,0,0,0 +units=m +no_defs");

        this._geoidOffset = 0;
    }

    get enabled() {
        return this._enabled;
    }

    set enabled(value) {
        this._enabled = value;
    }

    set mapProviders(value) {
        if (!Array.isArray(value)) {
            value = [value]
        }
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
                        Cesium.createOpenStreetMapImageryProvider({ url: "https://tile.openstreetmap.org/" })
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
        this.mapProviders = [];
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
        this._element.style.display = this._enabled ? "block" : "none";
        if (window.toMap !== undefined && this._enabled === true) {
            let camera = this.viewer.scene.getActiveCamera();
            let pivot = this.viewer.scene.view.getPivot();
            let pPos = new THREE.Vector3(0, 0, 0).applyMatrix4(camera.matrixWorld);
            let pTarget = pivot.clone();
            let upDir = new THREE.Vector3(0, 1, 0).applyMatrix4(camera.matrixWorld)
                .sub(pPos)
                .normalize();
            let pUpPoint = pPos.clone().add(upDir.multiplyScalar(10));

            let toCes = (vec) => {
                let xy = [vec.x, vec.y];
                let height = vec.z + this._geoidOffset;
                let deg = toMap.forward(xy);
                return Cesium.Cartesian3.fromDegrees(...deg, height);
            };

            let cPos = toCes(pPos);
            let cTarget = toCes(pTarget);
            let cUpPoint = toCes(pUpPoint);

            let cDir = Cesium.Cartesian3.normalize(
                Cesium.Cartesian3.subtract(cTarget, cPos, new Cesium.Cartesian3()),
                new Cesium.Cartesian3()
            );
            let cUp = Cesium.Cartesian3.normalize(
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

            let cameraP = this.viewer.scene.cameraP;
            if (cameraP) {
                let aspect = cameraP.aspect;
                let fovy = Math.PI * (cameraP.fov / 180);
                this.cesiumViewer.camera.frustum.fov =
                    aspect < 1
                        ? fovy
                        : Math.atan(Math.tan(0.5 * fovy) * aspect) * 2;
            }

            this.cesiumViewer.render();
        }
    }
}
