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
    LWPOLYLINE: "LWPLINE",  // nebo "LWPOLYLINE"
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

const flatOffset = 0.2;

export class DrawableEntity extends THREE.Object3D {
    constructor() {
        super();
        this.constructor.counter = (this.constructor.counter === undefined) ? 0 : this.constructor.counter + 1;
        this.name = "entity_" + this.constructor.counter;
        this.type = DxfEntityType.UNKNOWN;

        this.entities = [];
    }

    update() {
        // override me
    }

    fromJson(json) {
        // override me
    }

    toJson() {
        // override me
    }

    addChild(child) {
        this.entities.push(child);
        super.add(child);
    }

    get visible() {
        return super.visible;
    }

    set visible(value) {
        super.visible = value;
    }

    static FromJson(json, isFlat) {
        const entity = new this();
        entity.fromJson(json, isFlat);
        return entity;
    }
}

export class PointEntity extends DrawableEntity {
    constructor() {
        super();

        this.type = DxfEntityType.POINT;

        this.position = new THREE.Vector3();
        this.color = new THREE.Color(0x000000);
        this.handle = null;

        this.radius = 0.5;
        this.circleMesh = null;
        this.circleOutline = null;
    }

    fromJson(json, isFlat) {
        if (json?.type !== DxfEntityType.POINT) {
            return;
        }

        this.position = new THREE.Vector3(
            json.x ?? json.position?.x ?? 0,
            json.y ?? json.position?.y ?? 0,
            json.z ?? json.position?.z ?? 0
        );

        if (isFlat) {
            this.position.z = flatOffset;
        }

        this.color = new THREE.Color(json.color ?? 0x000000);
        this.handle = json.handle ?? null;

        if (this.circleMesh) {
            this.remove(this.circleMesh);
            this.circleMesh.geometry.dispose();
            this.circleMesh.material.dispose();
            this.circleMesh = null;
        }
        if (this.circleOutline) {
            this.remove(this.circleOutline);
            this.circleOutline.geometry.dispose();
            this.circleOutline.material.dispose();
            this.circleOutline = null;
        }

        const segments = 32;
        const geom = new THREE.CircleGeometry(this.radius, segments);
        const fillColor = this.color.clone().lerp(new THREE.Color(0xffffff), 0.3);

        const fillMaterial = new THREE.MeshBasicMaterial({
            color: fillColor,
            opacity: 0.8,
            transparent: true,
            side: THREE.DoubleSide,
            depthWrite: false
        });

        this.circleMesh = new THREE.Mesh(geom, fillMaterial);
        this.circleMesh.position.copy(this.position);
        this.circleMesh.lookAt(this.position.clone().add(new THREE.Vector3(0, 0, 1)));
        this.add(this.circleMesh);

        const circlePoints = [];
        for (let i = 0; i <= segments; i++) {
            const theta = (i / segments) * Math.PI * 2;
            circlePoints.push(new THREE.Vector3(
                Math.cos(theta) * this.radius,
                Math.sin(theta) * this.radius,
                0
            ));
        }

        const outlineGeom = new THREE.BufferGeometry().setFromPoints(circlePoints);
        const outlineMat = new THREE.LineBasicMaterial({ color: this.color });
        this.circleOutline = new THREE.Line(outlineGeom, outlineMat);
        this.circleOutline.position.copy(this.position);
        this.circleOutline.lookAt(this.position.clone().add(new THREE.Vector3(0, 0, 1)));
        this.add(this.circleOutline);
    }
}

export class InsertPoint extends PointEntity {
    constructor() {
        super();

        this.maxMarkers = 3;
    }
}

export class PolylineEntity extends DrawableEntity {
    constructor() {
        super();

        this.type = DxfEntityType.POLYLINE;

        this.color = new THREE.Color(0x000000);
        this.isShape = false;
        this.vertices = [];
    }

    fromJson(json, isFlat) {
        if (json?.type === DxfEntityType.POLYLINE) {
            this.vertices = json.vertices.map(vertex => {
                return new THREE.Vector3(vertex.x, vertex.y, isFlat ? flatOffset : vertex.z);
            });
            this.color = new THREE.Color(json.color);
            this.isShape = json.shape ?? false;

            if (!this.vertices.length) {
                return;
            }

            if (this.isShape) {
                this.vertices.push(this.vertices[0].clone());
            }

            if (this.line) {
                this.remove(this.line);
            }

            const geometry = new THREE.BufferGeometry().setFromPoints(this.vertices);
            const material = new THREE.LineBasicMaterial({ color: this.color });

            this.line = new THREE.Line(geometry, material);
            this.add(this.line);

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
                positions[i * 3 + 2] = isFlat ? flatOffset : contour3D[i].z;
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
            this.add(this.fillMesh);
        }
    }
}

export class LWPolylineEntity extends DrawableEntity {
    constructor() {
        super();

        this.type = DxfEntityType.LWPOLYLINE;

        this.color = new THREE.Color(0x000000);
        this.isShape = false;
        this.vertices = [];
        this.elevation = 0;
        this.line = null;
        this.fillMesh = null;
    }

    fromJson(json, isFlat) {
        if (json?.type !== DxfEntityType.LWPOLYLINE) {
            return;
        }

        this.color = new THREE.Color(json.color);
        this.isShape = json.shape ?? false;
        this.elevation = json.elevation ?? 0;
        if (isFlat) {
            this.elevation = flatOffset;
        }
        this.vertices = (json.vertices || []).map(v =>
            new THREE.Vector3(v.x, v.y, this.elevation)
        );

        if (!this.vertices.length) {
            return;
        }

        if (this.isShape && !this.vertices[0].equals(this.vertices[this.vertices.length - 1])) {
            this.vertices.push(this.vertices[0].clone());
        }

        if (this.line) {
            this.remove(this.line);
            this.line.geometry.dispose();
            this.line.material.dispose();
            this.line = null;
        }
        if (this.fillMesh) {
            this.remove(this.fillMesh);
            this.fillMesh.geometry.dispose();
            this.fillMesh.material.dispose();
            this.fillMesh = null;
        }

        const geometry = new THREE.BufferGeometry().setFromPoints(this.vertices);
        const material = new THREE.LineBasicMaterial({ color: this.color });
        this.line = new THREE.Line(geometry, material);
        this.add(this.line);

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

        const contour2D = contour3D.map(v => new THREE.Vector2(v.x, v.y));

        const holes = [];
        const triangles = THREE.ShapeUtils.triangulateShape(contour2D, holes);
        if (!triangles || !triangles.length) {
            console.warn("Triangulation failed or returned empty for LWPOLYLINE shape.");
            return;
        }

        const positions = new Float32Array(contour3D.length * 3);
        for (let i = 0; i < contour3D.length; i++) {
            positions[i * 3] = contour3D[i].x;
            positions[i * 3 + 1] = contour3D[i].y;
            positions[i * 3 + 2] = isFlat ? flatOffset : contour3D[i].z;
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
        this.add(this.fillMesh);
    }
}

export class SplineEntity extends DrawableEntity {
    constructor() {
        super();

        this.type = DxfEntityType.SPLINE;

        this.color = new THREE.Color(0x000000);
        this.degree = 3;
        this.controlPoints = [];
        this.knotValues = [];
        this.planar = true;
        this.curve = null;
        this.line = null;
    }

    fromJson(json, isFlat) {
        if (json?.type !== DxfEntityType.SPLINE) {
            return;
        }

        this.color = new THREE.Color(json.color || 0x000000);
        this.degree = json.degreeOfSplineCurve ?? 3;
        this.planar = json.planar ?? true;
        this.knotValues = json.knotValues ?? [];
        this.controlPoints = (json.controlPoints || []).map(pt => new THREE.Vector3(pt.x, pt.y, isFlat ? 0 : (pt.z ?? 0)));

        if (this.controlPoints.length < 2) {
            console.warn("SplineEntity: not enough control points.");
            return;
        }

        if (this.line) {
            this.remove(this.line);
            this.line.geometry.dispose();
            this.line.material.dispose();
            this.line = null;
        }

        const curve = new THREE.CatmullRomCurve3(this.controlPoints, false, "centripetal", 0.5);
        const points = curve.getPoints(128);

        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        const material = new THREE.LineBasicMaterial({
            color: this.color,
            linewidth: 1
        });

        this.line = new THREE.Line(geometry, material);
        this.add(this.line);

        if (json.shape === true) {
            const contour2D = points.map(v => new THREE.Vector2(v.x, v.y));
            const holes = [];
            const triangles = THREE.ShapeUtils.triangulateShape(contour2D, holes);

            if (triangles?.length) {
                const positions = new Float32Array(points.length * 3);
                for (let i = 0; i < points.length; i++) {
                    positions[i * 3] = points[i].x;
                    positions[i * 3 + 1] = points[i].y;
                    positions[i * 3 + 2] = isFlat ? flatOffset : points[i].z;
                }

                const indices = [];
                for (let t = 0; t < triangles.length; t++) {
                    const tri = triangles[t];
                    indices.push(tri[0], tri[1], isFlat ? flatOffset : tri[2]);
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
                this.add(this.fillMesh);
            }
        }
    }
}

export class CircleEntity extends DrawableEntity {
    constructor() {
        super();

        this.type = DxfEntityType.CIRCLE;

        this.center = new THREE.Vector3();
        this.radius = 1;
        this.color = new THREE.Color(0x00FF00);

        this.line = null;
        this.fillMesh = null;
        this.handle = null;
    }

    fromJson(json, isFlat) {
        if (json?.type !== DxfEntityType.CIRCLE) {
            return;
        }

        this.center = new THREE.Vector3(
            json.center?.x ?? 0,
            json.center?.y ?? 0,
            json.center?.z ?? 0
        );
        if (isFlat) {
            this.center.z = flatOffset;
        }
        this.radius = json.radius ?? 1;
        this.color = new THREE.Color(json.color ?? 0x00FF00);
        this.handle = json.handle ?? null;

        if (this.line) {
            this.remove(this.line);
            this.line.geometry.dispose();
            this.line.material.dispose();
            this.line = null;
        }
        if (this.fillMesh) {
            this.remove(this.fillMesh);
            this.fillMesh.geometry.dispose();
            this.fillMesh.material.dispose();
            this.fillMesh = null;
        }

        const circlePoints = [];
        const segments = 64;
        for (let i = 0; i <= segments; i++) {
            const theta = (i / segments) * Math.PI * 2;
            circlePoints.push(new THREE.Vector3(
                this.center.x + Math.cos(theta) * this.radius,
                this.center.y + Math.sin(theta) * this.radius,
                isFlat ? flatOffset : this.center.z
            ));
        }

        const geometry = new THREE.BufferGeometry().setFromPoints(circlePoints);
        const material = new THREE.LineBasicMaterial({ color: this.color });
        this.line = new THREE.Line(geometry, material);
        this.add(this.line);

        const circleGeom = new THREE.CircleGeometry(this.radius, segments);
        const fillColor = this.color.clone().lerp(new THREE.Color(0xffffff), 0.3);

        const fillMaterial = new THREE.MeshBasicMaterial({
            color: fillColor,
            opacity: 0.8,
            transparent: true,
            side: THREE.DoubleSide,
            depthWrite: false
        });

        this.fillMesh = new THREE.Mesh(circleGeom, fillMaterial);
        this.fillMesh.position.copy(this.center);
        this.fillMesh.lookAt(this.center.clone().add(new THREE.Vector3(0, 0, 1)));
        this.add(this.fillMesh);
    }
}

export class DrawableArea extends DrawableEntity {
    constructor(viewer, options) {
        super();

        this.viewer = viewer;
        this.options = options || {};
        this._isFlat = false;
    }

    load(data, isFlat = false) {
        this._isFlat = isFlat;
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
            if (entity.type === DxfEntityType.POLYLINE) {
                this.addChild(PolylineEntity.FromJson(entity, this._isFlat));
            } else if (entity.type === DxfEntityType.CIRCLE) {
                this.addChild(CircleEntity.FromJson(entity, this._isFlat));
            } else if (entity.type === DxfEntityType.LWPOLYLINE) {
                this.addChild(LWPolylineEntity.FromJson(entity, this._isFlat));
            } else if (entity.type === DxfEntityType.SPLINE) {
                this.addChild(SplineEntity.FromJson(entity, this._isFlat));
            } else if (entity.type === DxfEntityType.POINT) {
                this.addChild(PointEntity.FromJson(entity, this._isFlat));
            } else {
                console.warn("Unsupported DWG entity type: " + entity.type);
            }
        }

        this.viewer.scene.scene.add(this);
    }
}
