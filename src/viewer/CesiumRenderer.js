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
            imageryProvider: Cesium.createOpenStreetMapImageryProvider({ url: "https://tile.openstreetmap.org/" }),
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

    init() {
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
