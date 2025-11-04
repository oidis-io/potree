/*! ******************************************************************************************************** *
 *
 * Copyright 2011-2020 Markus Schütz
 * Copyright 2025 Oidis
 *
 * SPDX-License-Identifier: BSD-2-Clause
 * The BSD-2-Clause license for this file can be found in the LICENSE.txt file included with this distribution
 * or at https://spdx.org/licenses/BSD-2-Clause.html#licenseText
 *
 * ********************************************************************************************************* */

import * as THREE from "../../libs/three.js/build/three.module.js";
import { Fetcher } from "../utils/Fetcher.js";

export const DxfEntityType = {
    UNKNOWN: "UNKNOWN",
    FACE3D: "FACE3D",
    SOLID3D: "SOLID3D",
    ACAD_PROXY_ENTITY: "ACAD_PROXY_ENTITY",
    ARC: "ARC",
    ATTRIB: "ATTRIB",
    BODY: "BODY",
    CIRCLE: "CIRCLE",
    DIMENSION: "DIMENSION",
    ARCDIMENSION: "ARCDIMENSION",
    ELLIPSE: "ELLIPSE",
    HATCH: "HATCH",
    HELIX: "HELIX",
    IMAGE: "IMAGE",
    INSERT: "INSERT",
    LEADER: "LEADER",
    LINE: "LINE",
    LW_POLYLINE: "LWPLINE",  // nebo "LWPOLYLINE"
    MLINE: "MLINE",
    MESH: "MESH",
    MPOLYGON: "MPOLYGON",
    MTEXT: "MTEXT",
    MULTILEADER: "MULTILEADER",
    POINT: "POINT",
    POLYLINE: "POLYLINE",
    VERTEX: "VERTEX",
    POLYMESH: "POLYMESH",
    POLYFACE: "POLYFACE",
    RAY: "RAY",
    REGION: "REGION",
    SHAPE: "SHAPE",
    SOLID: "SOLID",
    SPLINE: "SPLINE",
    SURFACE: "SURFACE",
    TEXT: "TEXT",
    TRACE: "TRACE",
    UNDERLAY: "UNDERLAY",
    VIEWPORT: "VIEWPORT",
    WIPEOUT: "WIPEOUT",
    XLINE: "XLINE",
};

export class DrawableEntity extends THREE.Object3D {
    constructor(parent) {
        super();
        this.parentX = parent;
        this.type = DxfEntityType.UNKNOWN;
    }

    update() {
        // override me
    }

    fromJson(json) {
        // override me
    }

    static FromJson(parent, json) {
        const entity = new this(parent);
        entity.fromJson(json);
        return entity;
    }
}

export class PolylineEntity extends DrawableEntity {
    constructor(parent) {
        super(parent);

        this.type = DxfEntityType.POLYLINE;

        this.color = new THREE.Color(0x000000);
        this.isShape = false;
        this.vertices = [];
    }

    fromJson(json) {
        if (json?.type === "POLYLINE") {
            this.vertices = json.vertices.map(vertex => {
                return new THREE.Vector3(vertex.x, vertex.y, vertex.z);
            });
            this.color = new THREE.Color(json.color);
            this.isShape = json.shape ?? false;

            if (!this.vertices.length) {
                return;
            }

            if (this.isShape) {
                this.vertices.push(this.vertices[0].clone());
            }

            if (this.line && this.parentX) {
                this.parentX.remove(this.line);
            }

            const geometry = new THREE.BufferGeometry().setFromPoints(this.vertices);
            const material = new THREE.LineBasicMaterial({ color: this.color });

            this.line = new THREE.Line(geometry, material);
            if (this.parentX) {
                this.parentX.add(this.line);
            }

            if (!this.isShape) {
                return;
            }

            let contour3D = this.vertices.slice();
            if (contour3D.length >= 2 && contour3D[0].equals(contour3D[contour3D.length - 1])) {
                contour3D = contour3D.slice(0, contour3D.length - 1);
            }
            if (contour3D.length < 3) {
                return;
            }

            const centroid = new THREE.Vector3(0, 0, 0);
            contour3D.forEach(v => centroid.add(v));
            centroid.divideScalar(contour3D.length);

            let normal = new THREE.Vector3(0, 0, 0);
            for (let i = 0; i < contour3D.length; i++) {
                const a = contour3D[i].clone().sub(centroid);
                const b = contour3D[(i + 1) % contour3D.length].clone().sub(centroid);
                normal.add(a.cross(b));
            }
            if (normal.lengthSq() < 1e-8) {
                normal = new THREE.Vector3().subVectors(contour3D[1], contour3D[0])
                    .cross(new THREE.Vector3().subVectors(contour3D[2], contour3D[0]));
            }
            normal.normalize();

            const tangent = new THREE.Vector3().subVectors(contour3D[1], contour3D[0]).normalize();
            if (Math.abs(tangent.dot(normal)) > 0.999) {
                tangent.set(1, 0, 0);
                if (Math.abs(tangent.dot(normal)) > 0.999) {
                    tangent.set(0, 1, 0);
                }
                tangent.cross(normal).normalize();
            }
            const bitangent = new THREE.Vector3().crossVectors(normal, tangent).normalize();

            const basis = new THREE.Matrix4();
            basis.makeBasis(tangent, bitangent, normal);
            const toLocal = new THREE.Matrix4().copy(basis).invert();

            const contour2D = contour3D.map(v => {
                const p = v.clone().applyMatrix4(toLocal);
                return new THREE.Vector2(p.x, p.y);
            });

            const holes = [];
            const triangles = THREE.ShapeUtils.triangulateShape(contour2D, holes);

            if (!triangles || !triangles.length) {
                console.warn("Triangulation failed or returned empty for polygon.");
                return;
            }

            const positions = new Float32Array(contour3D.length * 3);
            for (let i = 0; i < contour3D.length; i++) {
                positions[i * 3] = contour3D[i].x;
                positions[i * 3 + 1] = contour3D[i].y;
                positions[i * 3 + 2] = contour3D[i].z;
            }

            const indices = [];
            for (let t = 0; t < triangles.length; t++) {
                const tri = triangles[t];
                indices.push(tri[0], tri[1], tri[2]);
            }

            const geom = new THREE.BufferGeometry();
            geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
            geom.setIndex(indices);
            geom.computeVertexNormals();

            const fillColor = this.color.clone().lerp(new THREE.Color(0xffffff), 0.3);
            const fillMaterial = new THREE.MeshBasicMaterial({
                color: fillColor,
                opacity: 0.8,
                transparent: true,
                side: THREE.DoubleSide,
                depthWrite: false
            });

            this.fillMesh = new THREE.Mesh(geom, fillMaterial);
            if (this.parentX) {
                this.parentX.add(this.fillMesh);
            }
        }
    }
}

export class DrawableArea extends DrawableEntity {
    constructor(viewer, options) {
        super();

        this.viewer = viewer;
        this.options = options || {};
        this._visible = false;
        this.entities = [];
    }

    get visible() {
        return this._visible;
    }

    set visible(value) {
        this._visible = value;
    }

    load(data) {
        const processData = (d) => {
            try {
                d = JSON.parse(d);
            } catch (e) {
                throw new Error("Invalid drawable data, check DXF to JSON converter.");
            }
            this.fromJson(d);
        };
        if (typeof data === "object") {
            this.fromJson(data);
        } else if (typeof data === "string" && (data.includes("\n") || data.includes(" "))) {
            processData(data);
        } else if (typeof data === "string") {
            Fetcher.download(data)
                .then((resp) => {
                    return resp.text();
                })
                .then((text) => {
                    processData(text);
                })
                .catch((err) => {
                    throw err;
                });
        }
    }

    update() {
        // nothing to do now
    }

    fromJson(json) {
        if (!json.header || !json.entities) {
            throw new Error("Invalid drawable data, check DXF to JSON converter.");
        }

        for (const entity of json.entities) {
            if (entity.type === "POLYLINE") {
                this.entities.push(PolylineEntity.FromJson(this, entity));
            } else {
                console.warn("Unsupported DWG entity type: " + entity.type);
            }
        }

        this.viewer.scene.scene.add(this);
    }
}
