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
import { Fetcher } from "../utils/Fetcher.js";
import { Vector3 } from "../../libs/three.js/build/three.js";

export class JGWImage extends THREE.Object3D {
    constructor(viewer, options) {
        super();

        this.viewer = viewer;
        this.options = options || {};
        this._visible = false;

        this.texture = null;
        this.mesh = null;
        this.zOffset = 0.0;
    }

    get visible() {
        return this._visible;
    }

    set visible(value) {
        this._visible = value;
    }

    update() {
        if (this.mesh) {
            this.mesh.visible = this.visible;
            if (this.viewer.scene.pointclouds?.at(0)) {
                this.mesh.position.z = this.viewer.scene.pointclouds[0].boundingSphere.center.z + this.zOffset;
            }
        }
    }

    load(img, jgw, callback) {
        // TODO(mkelnar) add better callback/handling
        if (!callback) {
            callback = () => {
                // dummy handler
            };
        }
        this._addJgwImageToPotree(img, jgw, 0.1)
            .then(callback)
            .catch(err => {
                throw err;
            });
    }

    async _getJgwData(jgwSrc) {
        const jgwCtor = (jgwData) => {
            const { A, a, B, b, C, c, D, d, E, e, F, f } = jgwData;
            return {
                A: A ?? a,
                B: B ?? b,
                C: C ?? c,
                D: D ?? d,
                E: E ?? e,
                F: F ?? f,
            };
        };
        if (typeof jgwSrc === "object" && jgwSrc !== null) {
            return jgwCtor(jgwSrc);
        }
        if (typeof jgwSrc === "string" && (jgwSrc.includes("\n") || jgwSrc.includes(" "))) {
            const parts = jgwSrc.trim().split(/\s+/).map(parseFloat);
            if (parts.length !== 6 || parts.some(isNaN)) {
                throw new Error("Invalid inline JGW text format");
            }
            const [A, D, B, E, C, F] = parts;
            return { A, B, C, D, E, F };
        }
        if (typeof jgwSrc === "string") {
            const resp = await Fetcher.download(jgwSrc);
            const text = await resp.text();
            if (text.trim().startsWith("{")) {
                return jgwCtor(JSON.parse(text));
            }
            const parts = text.trim().split(/\s+/).map(parseFloat);
            if (parts.length !== 6 || parts.some(isNaN)) {
                throw new Error("Invalid JGW file format");
            }
            const [A, D, B, E, C, F] = parts;
            return { A, B, C, D, E, F };
        }
    }

    async _addJgwImageToPotree(imgSrc, jgw, zOffset = 0.0) {
        this.zOffset = zOffset;
        const vals = await this._getJgwData(jgw);
        return new Promise((resolve, reject) => {
            new THREE.TextureLoader().load(
                imgSrc,
                (texture) => {
                    const img = texture.image;
                    const width = img.width;
                    const height = img.height;
                    const xMin = vals.C - vals.A / 2;
                    const xMax = vals.C + vals.A * (width - 0.5);
                    const yMax = vals.F - vals.E / 2;
                    const yMin = vals.F + vals.E * (height - 0.5);
                    const planeWidth = xMax - xMin;
                    const planeHeight = yMax - yMin;
                    const centerX = (xMin + xMax) / 2;
                    const centerY = (yMin + yMax) / 2;

                    if (this.mesh) {
                        this.mesh.material.map.dispose();
                        this.mesh.material.dispose();
                        this.mesh.geometry.dispose();
                        this.mesh.geometry = new THREE.PlaneGeometry(planeWidth, planeHeight);
                        this.mesh.material = new THREE.MeshBasicMaterial({
                            map: texture,
                            side: THREE.DoubleSide
                        });
                        this.mesh.position.set(centerX, centerY, zOffset);
                        // this.mesh.rotation.z = -Math.PI/2;
                        resolve(this.mesh);
                        return;
                    }

                    const geometry = new THREE.PlaneGeometry(planeWidth, planeHeight);
                    const material = new THREE.MeshBasicMaterial({
                        map: texture,
                        side: THREE.DoubleSide
                    });

                    const mesh = new THREE.Mesh(geometry, material);
                    mesh.position.set(centerX, centerY, zOffset);
                    this.mesh = mesh;
                    // this.mesh.rotation.z = -Math.PI/2;
                    this.viewer.scene.scene.add(mesh);

                    resolve(new THREE.Box3(new Vector3(xMin, yMin, zOffset), new Vector3(xMax, yMax, zOffset)));
                },
                undefined,
                (err) => {
                    reject(err);
                }
            );
        });
    }
}
