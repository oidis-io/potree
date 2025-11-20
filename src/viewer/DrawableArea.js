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
import { Measure } from "../utils/Measure.js";

export const DxfEntityType = {
    UNKNOWN: "UNKNOWN",
    FACE3D: "FACE3D",
    SOLID3D: "SOLID3D",
    ACAD_PROXY_ENTITY: "ACAD_PROXY_ENTITY",
    ARC: "ARC",
    ATTDEF: "ATTDEF",
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
    LWPOLYLINE: "LWPOLYLINE",  // nebo "LWPLINE"
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
let isFlat = false;
// TODO(mkelnar) just temporary solution until drawable will be fully refactored and integrated
//  -> current solution is to redirect shapes to measurement items
const suppressDrawing = false;

export class DrawableEntity extends THREE.Object3D {
    constructor() {
        super();
        this.constructor.counter = (this.constructor.counter === undefined) ? 0 : this.constructor.counter + 1;
        this.name = "entity_" + this.constructor.counter;
        this.type = DxfEntityType.UNKNOWN;

        this.color = new THREE.Color(0x000000);

        this.entities = [];
    }

    update() {
        // override me
    }

    fromJson(json, root) {
        this.color = new THREE.Color(json.color ?? 0x000000);
        if (json.colorIndex === 7) {
            // TODO(mkelnar) default render color (ACI palette)
            this.color = new THREE.Color(0x000000);
        }
    }

    toJson() {
        // override me
    }

    addChild(child) {
        this.entities.push(child);
        if (!suppressDrawing) {
            super.add(child);
        }
    }

    get visible() {
        return super.visible;
    }

    set visible(value) {
        super.visible = value;
    }

    static FromJson(json, root) {
        const entity = new this();
        entity.fromJson(json, root);
        return entity;
    }
}

export class Plane extends DrawableEntity {
    constructor() {
        super();

        this.color = new THREE.Color(0x0000ff);
        this.opacity = 0.4;
        this.z = 0.3;
        this.scaleFactor = 50;

        this._createMesh();
    }

    _createMesh() {
        this.geometry = new THREE.PlaneGeometry(1, 1);
        this.material = new THREE.MeshBasicMaterial({
            color: this.color,
            transparent: false,
            opacity: this.opacity,
            side: THREE.DoubleSide,
            depthWrite: false,
            depthTest: false
        });

        this.mesh = new THREE.Mesh(this.geometry, this.material);

        this.add(this.mesh);

        const edges = new THREE.EdgesGeometry(this.geometry);
        this.edges = new THREE.LineSegments(
            edges,
            new THREE.LineBasicMaterial({ color: 0x0000ff })
        );
        this.mesh.add(this.edges);
    }

    update() {
        const camera = this.viewer?.scene?.getActiveCamera();
        if (!camera) {
            return;
        }
        const vFOV = THREE.MathUtils.degToRad(camera.fov);
        const height = 2 * Math.tan(vFOV / 2);
        const width = height * camera.aspect;
        const scale = this.scaleFactor;
        this.mesh.scale.set(width * scale, height * scale, 1);
    }
}

export class PointEntity extends DrawableEntity {
    constructor() {
        super();

        this.type = DxfEntityType.POINT;

        this.handle = null;

        this.radius = 0.2;
        this.circleMesh = null;
        this.circleOutline = null;
    }

    fromJson(json, root) {
        if (json?.type !== DxfEntityType.POINT) {
            return;
        }

        super.fromJson(json, root);

        this.position.copy(new THREE.Vector3(
            json.x ?? json.position?.x ?? 0,
            json.y ?? json.position?.y ?? 0,
            json.z ?? json.position?.z ?? 0
        ));

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

export class LineEntity extends DrawableEntity {
    constructor() {
        super();

        this.type = DxfEntityType.LINE;

        this.start = new THREE.Vector3();
        this.end = new THREE.Vector3();

        this.line = null;
    }

    fromJson(json, root) {
        if (json?.type !== DxfEntityType.LINE) {
            return;
        }

        super.fromJson(json, root);

        const verts = (json.vertices && json.vertices.length) ? json.vertices : [];
        if (verts.length < 2) {
            return;
        }

        const z0 = isFlat ? flatOffset : (verts[0].z ?? 0);
        const z1 = isFlat ? flatOffset : (verts[1].z ?? 0);

        this.vertices = [
            new THREE.Vector3(verts[0].x, verts[0].y, z0),
            new THREE.Vector3(verts[1].x, verts[1].y, z1)
        ];

        this.layer = json.layer ?? this.layer;

        if (this.line) {
            this.remove(this.line);
            if (this.line.geometry) {
                this.line.geometry.dispose();
            }
            if (this.line.material) {
                this.line.material.dispose();
            }
            this.line = null;
        }

        const geometry = new THREE.BufferGeometry().setFromPoints(this.vertices);
        const material = new THREE.LineBasicMaterial({
            color: this.color,
            linewidth: (json.lineweight && json.lineweight > 0) ? json.lineweight : 4
        });

        this.line = new THREE.Line(geometry, material);
        this.add(this.line);
    }
}

export class PolylineEntity extends DrawableEntity {
    constructor() {
        super();

        this.type = DxfEntityType.POLYLINE;

        this.isShape = false;
        this.vertices = [];
    }

    fromJson(json, root) {
        if (json?.type === DxfEntityType.POLYLINE) {
            super.fromJson(json, root);

            this.vertices = json.vertices.map(vertex => {
                return new THREE.Vector3(vertex.x, vertex.y, isFlat ? flatOffset : vertex.z);
            });
            this.isShape = json.shape ?? false;

            if (!this.vertices.length) {
                return;
            }

            if (this.isShape && !suppressDrawing) {
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

        this.isShape = false;
        this.vertices = [];
        this.elevation = 0;
        this.line = null;
        this.fillMesh = null;
    }

    fromJson(json, root) {
        if (json?.type !== DxfEntityType.LWPOLYLINE) {
            return;
        }

        super.fromJson(json, root);

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

        this.degree = 3;
        this.controlPoints = [];
        this.knotValues = [];
        this.planar = true;
        this.curve = null;
        this.line = null;
    }

    fromJson(json, root) {
        if (json?.type !== DxfEntityType.SPLINE) {
            return;
        }

        super.fromJson(json, root);

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

        this.line = null;
        this.fillMesh = null;
        this.handle = null;
    }

    fromJson(json, root, isFlat = false, flatOffset = 0, fillEnabled = false) {
        if (json?.type !== DxfEntityType.CIRCLE) {
            return;
        }

        super.fromJson(json, root);

        this.center = new THREE.Vector3(
            json.center?.x ?? 0,
            json.center?.y ?? 0,
            json.center?.z ?? 0
        );
        if (isFlat) {
            this.center.z = flatOffset;
        }
        this.radius = json.radius ?? 1;
        this.handle = json.handle ?? null;

        if (this.line) {
            this.remove(this.line);
            this.line.geometry?.dispose();
            this.line.material?.dispose();
            this.line = null;
        }
        if (this.fillMesh) {
            this.remove(this.fillMesh);
            this.fillMesh.geometry?.dispose();
            this.fillMesh.material?.dispose();
            this.fillMesh = null;
        }

        let normal = new THREE.Vector3(0, 0, 1);
        if (json.extrusionDirection) {
            normal.set(
                json.extrusionDirection.x ?? 0,
                json.extrusionDirection.y ?? 0,
                json.extrusionDirection.z ?? 0
            ).normalize();
        }

        const quaternion = new THREE.Quaternion();
        quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);

        const circlePoints = [];
        const segments = 64;
        for (let i = 0; i <= segments; i++) {
            const theta = (i / segments) * Math.PI * 2;
            const point = new THREE.Vector3(
                Math.cos(theta) * this.radius,
                Math.sin(theta) * this.radius,
                0
            );
            point.applyQuaternion(quaternion);
            point.add(this.center);
            circlePoints.push(point);
        }

        const geometry = new THREE.BufferGeometry().setFromPoints(circlePoints);
        const material = new THREE.LineBasicMaterial({ color: this.color });
        this.line = new THREE.Line(geometry, material);
        this.add(this.line);

        // TODO(mkelnar) re-enable measure points by proper flag
        if (fillEnabled) {
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
            this.fillMesh.quaternion.copy(quaternion);
            this.add(this.fillMesh);
        }
    }
}

export class ArcEntity extends DrawableEntity {
    constructor() {
        super();

        this.type = DxfEntityType.ARC;

        this.center = new THREE.Vector3();
        this.radius = 1;
        this.startAngle = 0;
        this.endAngle = 0;

        this.line = null;
        this.handle = null;
    }

    fromJson(json, root) {
        if (json?.type !== DxfEntityType.ARC) {
            return;
        }

        super.fromJson(json, root);

        this.center = new THREE.Vector3(
            json.center?.x ?? 0,
            json.center?.y ?? 0,
            json.center?.z ?? 0
        );
        if (isFlat) {
            this.center.z = flatOffset;
        }

        this.radius = json.radius ?? 1;
        this.startAngle = json.startAngle ?? 0;
        this.endAngle = json.endAngle ?? 0;
        this.handle = json.handle ?? null;

        if (this.line) {
            this.remove(this.line);
            this.line.geometry.dispose();
            this.line.material.dispose();
            this.line = null;
        }

        const arcPoints = [];
        const segments = 64;
        const angleStep = (this.endAngle - this.startAngle) / segments;

        for (let i = 0; i <= segments; i++) {
            const theta = this.startAngle + angleStep * i;
            arcPoints.push(new THREE.Vector3(
                this.center.x + Math.cos(theta) * this.radius,
                this.center.y + Math.sin(theta) * this.radius,
                isFlat ? flatOffset : this.center.z
            ));
        }

        const geometry = new THREE.BufferGeometry().setFromPoints(arcPoints);
        const material = new THREE.LineBasicMaterial({ color: this.color });

        this.line = new THREE.Line(geometry, material);
        this.add(this.line);
    }
}

export class SolidEntity extends DrawableEntity {
    constructor() {
        super();
        this.type = DxfEntityType.SOLID;
        this.points = [];
        this.mesh = null;
    }

    fromJson(json, root, isFlat) {
        if (json?.type !== DxfEntityType.SOLID) {
            return;
        }

        super.fromJson(json, root);

        const pts = json.points || [];
        if (pts.length < 3) {
            return;
        }

        this.layer = json.layer ?? this.layer;

        const flatOffset = 0;
        this.points = pts.map(p => new THREE.Vector3(p.x, p.y, isFlat ? flatOffset : (p.z ?? 0)));

        let verts = this.points.slice();

        if (verts.length === 4 && verts[2].equals(verts[3])) {
            verts = verts.slice(0, 3);
        }

        if (json.extrusionDirection) {
            const dir = new THREE.Vector3(
                json.extrusionDirection.x ?? 0,
                json.extrusionDirection.y ?? 0,
                json.extrusionDirection.z ?? 1
            ).normalize();

            const zAxis = new THREE.Vector3(0, 0, 1);
            if (!dir.equals(zAxis)) {
                const quaternion = new THREE.Quaternion();
                quaternion.setFromUnitVectors(zAxis, dir);

                verts.forEach(v => v.applyQuaternion(quaternion));
            }
        }

        if (json.extrusionDirection && json.extrusionDirection.z < 0) {
            verts.reverse();
        }

        if (this.mesh) {
            this.remove(this.mesh);
            this.mesh.geometry?.dispose();
            this.mesh.material?.dispose();
            this.mesh = null;
        }

        let positions, indices;
        if (verts.length === 3) {
            positions = new Float32Array([
                verts[0].x, verts[0].y, verts[0].z,
                verts[1].x, verts[1].y, verts[1].z,
                verts[2].x, verts[2].y, verts[2].z
            ]);
            indices = [0, 1, 2];
        } else if (verts.length === 4) {
            positions = new Float32Array([
                verts[0].x, verts[0].y, verts[0].z,
                verts[1].x, verts[1].y, verts[1].z,
                verts[2].x, verts[2].y, verts[2].z,
                verts[3].x, verts[3].y, verts[3].z
            ]);
            indices = [0, 1, 2, 0, 2, 3];
        } else {
            return;
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
        geometry.setIndex(indices);
        geometry.computeVertexNormals();

        const material = new THREE.MeshBasicMaterial({
            color: this.color,
            side: THREE.DoubleSide
        });

        this.mesh = new THREE.Mesh(geometry, material);
        this.add(this.mesh);
    }
}

export class ObjectEntity extends DrawableEntity {
    constructor() {
        super();
        this.name = "";
        this.handle = "";
        this.ownerHandle = "";
    }

    fromJson(json, root) {
        if (!json.entities) {
            return;
        }

        this.name = json.name;
        this.handle = json.handle;
        this.ownerHandle = json.ownerHandle;

        for (const entity of json.entities) {
            if (entity.type === DxfEntityType.POLYLINE) {
                this.addChild(PolylineEntity.FromJson(entity, root));
            } else if (entity.type === DxfEntityType.CIRCLE) {
                this.addChild(CircleEntity.FromJson(entity, root));
            } else if (entity.type === DxfEntityType.ARC) {
                this.addChild(ArcEntity.FromJson(entity, root));
            } else if (entity.type === DxfEntityType.LINE) {
                this.addChild(LineEntity.FromJson(entity, root));
            } else if (entity.type === DxfEntityType.LWPOLYLINE || entity.type === "LWPLINE") {
                this.addChild(LWPolylineEntity.FromJson(entity, root));
            } else if (entity.type === DxfEntityType.SPLINE) {
                this.addChild(SplineEntity.FromJson(entity, root));
            } else if (entity.type === DxfEntityType.SOLID) {
                this.addChild(SolidEntity.FromJson(entity, root));
            } else if (entity.type === DxfEntityType.POINT) {
                this.addChild(PointEntity.FromJson(entity, root));
            } else if (entity.type === DxfEntityType.INSERT) {
                this.addChild(InsertEntity.FromJson(entity, root));
            } else if (entity.type === DxfEntityType.TEXT) {
                this.addChild(TextEntity.FromJson(entity, root));
            } else if (entity.type === DxfEntityType.ATTDEF) {
                // TODO(mkelnar) support to pre-process ATTDEFs, should be somehow linked with INSERTs or other entities
                //  currently seems not fully supported by dxf-parser
            } else {
                console.warn("Unsupported DWG entity type: " + entity.type);
            }
        }
    }
}

export class InsertEntity extends DrawableEntity {
    constructor() {
        super();

        this.type = DxfEntityType.CIRCLE;

        this.center = new THREE.Vector3();
        this.radius = 1;

        this.line = null;
        this.fillMesh = null;
        this.handle = null;
        this._isFlat = true;
    }

    fromJson(json, root) {
        if (json?.type !== DxfEntityType.INSERT) {
            return;
        }

        const object = ObjectEntity.FromJson(root.blocks[json.name], root, this._isFlat);
        object.position.copy(new THREE.Vector3(json.position.x, json.position.y, json.position.z));
        // TODO(mkelnar) rotation?
        if (json.rotation) {
            object.rotation.z = THREE.Math.degToRad(json.rotation);
        }
        this.addChild(object);
    }
}

export class TextEntity extends DrawableEntity {
    constructor() {
        super();

        this.type = DxfEntityType.TEXT;

        this.font = null;

        this.textMesh = null;
        this.sprite = null;

        this.handle = null;
    }

    fromJson(json, root) {
        if (json?.type !== DxfEntityType.TEXT) {
            return;
        }

        super.fromJson(json, root);

        this.clearPrevious();

        this.handle = json.handle ?? null;

        this.position.copy(new THREE.Vector3(
            json.startPoint?.x ?? 0,
            json.startPoint?.y ?? 0,
            json.startPoint?.z ?? 0
        ));

        if (isFlat) {
            this.position.z = flatOffset;
        }

        this.textValue = json.text ?? "";
        this.height = json.textHeight ?? 1.0;

        if (this.font) {
            this.buildMeshText();
        } else {
            this.buildSpriteText();
        }
    }

    clearPrevious() {
        if (this.textMesh) {
            this.remove(this.textMesh);
            this.textMesh.geometry.dispose();
            this.textMesh.material.dispose();
            this.textMesh = null;
        }
        if (this.sprite) {
            this.remove(this.sprite);
            this.sprite.material.dispose();
            this.sprite = null;
        }
    }

    buildMeshText() {
        const geom = new THREE.TextGeometry(this.textValue, {
            font: this.font,
            size: this.height,
            height: 0.01,
            curveSegments: 4,
        });

        geom.computeBoundingBox();
        geom.center();

        const mat = new THREE.MeshBasicMaterial({
            color: this.color,
            side: THREE.DoubleSide
        });

        this.textMesh = new THREE.Mesh(geom, mat);

        this.textMesh.position.copy(this.position);

        this.textMesh.lookAt(this.position.clone().add(new THREE.Vector3(0, 0, 1)));

        this.add(this.textMesh);
    }

    buildSpriteText() {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");

        const size = 256;
        canvas.width = canvas.height = size;

        ctx.fillStyle = "#" + this.color.getHexString();
        ctx.font = `${size * 0.35}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(this.textValue, size / 2, size / 2);

        const texture = new THREE.CanvasTexture(canvas);

        const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
        this.sprite = new THREE.Sprite(material);

        const scale = this.height * 2.0;
        this.sprite.scale.set(scale, scale, 1);

        this.sprite.position.copy(this.position);

        this.add(this.sprite);
    }
}

export class DrawableArea extends ObjectEntity {
    constructor(viewer, options) {
        super();

        this.viewer = viewer;
        this.options = options || {};
        this.zOffset = 0.2;

        this.zPlane = new Plane();
        // this.addChild(this.zPlane);
    }

    addChild(child) {
        super.addChild(child);
        child.viewer = this.viewer;
    }

    load(data, flat = false) {
        isFlat = flat;
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
        this.zPlane.position.x = this.viewer.scene.view.getPivot().x;
        this.zPlane.position.y = this.viewer.scene.view.getPivot().y;
        for (const entity of this.entities) {
            if (this.viewer.scene.pointclouds?.at(0)) {
                this.position.z = this.viewer.scene.pointclouds[0].boundingSphere.center.z + this.zOffset;
            }
            entity.update();
        }
    }

    fromJson(json) {
        if (!json.header || !json.entities) {
            throw new Error("Invalid drawable data, check DXF to JSON converter.");
        }

        super.fromJson(json, json);

        if (suppressDrawing) {
            for (const entity of this.entities) {
                console.log("Suppress drawing: " + entity.type);
                if (entity.type === DxfEntityType.POLYLINE || entity.type === DxfEntityType.LWPOLYLINE) {
                    const measure = new Measure(entity.color);
                    measure.showDistances = true;
                    measure.showArea = false;
                    measure.closed = entity.isShape;
                    measure.name = "Distance";
                    for (const pt of entity.vertices) {
                        measure.addMarker(pt);
                    }
                    this.viewer.scene.addMeasurement(measure);
                } else if (entity.type === DxfEntityType.CIRCLE) {
                    const measure = new Measure(entity.color);
                    measure.showDistances = false;
                    measure.showAngles = false;
                    measure.showCoordinates = true;
                    measure.showArea = false;
                    measure.closed = true;
                    measure.maxMarkers = 1;
                    measure.name = "Point";
                    this.viewer.scene.addMeasurement(measure);
                }
            }
        } else {
            this.viewer.scene.scene.add(this);
        }
    }
}
