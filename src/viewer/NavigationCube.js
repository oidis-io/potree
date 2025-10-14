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

export class NavigationCube extends THREE.Object3D {
    views = {
        FRONT: {yaw: 0, pitch: 0},
        BACK: {yaw: 180, pitch: 0},
        LEFT: {yaw: -90, pitch: 0},
        RIGHT: {yaw: 90, pitch: 0},
        TOP: {yaw: 0, pitch: -90},
        BOTTOM: {yaw: 0, pitch: 90},

        TOP_FRONT: {yaw: 0, pitch: -45},
        TOP_BACK: {yaw: 180, pitch: -45},
        TOP_LEFT: {yaw: -90, pitch: -45},
        TOP_RIGHT: {yaw: 90, pitch: -45},
        BOTTOM_FRONT: {yaw: 0, pitch: 45},
        BOTTOM_BACK: {yaw: 180, pitch: 45},
        BOTTOM_LEFT: {yaw: -90, pitch: 45},
        BOTTOM_RIGHT: {yaw: 90, pitch: 45},
        FRONT_LEFT: {yaw: -45, pitch: 0},
        FRONT_RIGHT: {yaw: 45, pitch: 0},
        BACK_LEFT: {yaw: -135, pitch: 0},
        BACK_RIGHT: {yaw: 135, pitch: 0},

        TOP_FRONT_LEFT: {yaw: -45, pitch: -45},
        TOP_FRONT_RIGHT: {yaw: 45, pitch: -45},
        TOP_BACK_LEFT: {yaw: -135, pitch: -45},
        TOP_BACK_RIGHT: {yaw: 135, pitch: -45},
        BOTTOM_FRONT_LEFT: {yaw: -45, pitch: 45},
        BOTTOM_FRONT_RIGHT: {yaw: 45, pitch: 45},
        BOTTOM_BACK_LEFT: {yaw: -135, pitch: 45},
        BOTTOM_BACK_RIGHT: {yaw: 135, pitch: 45},
    };

    cubeMap = {
        corners: {
            FRONT: {
                0: {links: [{side: "LEFT", id: 2}, {side: "BOTTOM", id: 0}], name: "BOTTOM_FRONT_LEFT"},
                1: {links: [{side: "LEFT", id: 0}, {side: "TOP", id: 0}], name: "TOP_FRONT_LEFT"},
                2: {links: [{side: "RIGHT", id: 2}, {side: "BOTTOM", id: 2}], name: "BOTTOM_FRONT_RIGHT"},
                3: {links: [{side: "RIGHT", id: 0}, {side: "TOP", id: 2}], name: "TOP_FRONT_RIGHT"}
            },
            BACK: {
                0: {links: [{side: "LEFT", id: 1}, {side: "TOP", id: 1}], name: "TOP_BACK_LEFT"},
                1: {links: [{side: "LEFT", id: 3}, {side: "BOTTOM", id: 1}], name: "BOTTOM_BACK_LEFT"},
                2: {links: [{side: "RIGHT", id: 1}, {side: "TOP", id: 3}], name: "TOP_BACK_RIGHT"},
                3: {links: [{side: "RIGHT", id: 3}, {side: "BOTTOM", id: 3}], name: "BOTTOM_BACK_RIGHT"}
            },
            LEFT: {
                0: {links: [{side: "FRONT", id: 1}, {side: "TOP", id: 0}], name: "TOP_FRONT_LEFT"},
                1: {links: [{side: "BACK", id: 0}, {side: "TOP", id: 1}], name: "TOP_BACK_LEFT"},
                2: {links: [{side: "FRONT", id: 0}, {side: "BOTTOM", id: 0}], name: "BOTTOM_FRONT_LEFT"},
                3: {links: [{side: "BACK", id: 1}, {side: "BOTTOM", id: 1}], name: "BOTTOM_BACK_LEFT"}
            },
            RIGHT: {
                0: {links: [{side: "FRONT", id: 3}, {side: "TOP", id: 2}], name: "TOP_FRONT_RIGHT"},
                1: {links: [{side: "BACK", id: 2}, {side: "TOP", id: 3}], name: "TOP_BACK_RIGHT"},
                2: {links: [{side: "FRONT", id: 2}, {side: "BOTTOM", id: 2}], name: "BOTTOM_FRONT_RIGHT"},
                3: {links: [{side: "BACK", id: 3}, {side: "BOTTOM", id: 3}], name: "BOTTOM_BACK_RIGHT"}
            },
            TOP: {
                0: {links: [{side: "FRONT", id: 1}, {side: "LEFT", id: 0}], name: "TOP_FRONT_LEFT"},
                1: {links: [{side: "BACK", id: 0}, {side: "LEFT", id: 1}], name: "TOP_BACK_LEFT"},
                2: {links: [{side: "FRONT", id: 3}, {side: "RIGHT", id: 0}], name: "TOP_FRONT_RIGHT"},
                3: {links: [{side: "BACK", id: 2}, {side: "RIGHT", id: 1}], name: "TOP_BACK_RIGHT"}
            },
            BOTTOM: {
                0: {links: [{side: "FRONT", id: 0}, {side: "LEFT", id: 2}], name: "BOTTOM_FRONT_LEFT"},
                1: {links: [{side: "BACK", id: 1}, {side: "LEFT", id: 3}], name: "BOTTOM_BACK_LEFT"},
                2: {links: [{side: "FRONT", id: 2}, {side: "RIGHT", id: 2}], name: "BOTTOM_FRONT_RIGHT"},
                3: {links: [{side: "BACK", id: 3}, {side: "RIGHT", id: 3}], name: "BOTTOM_BACK_RIGHT"}
            }
        },
        edges: {
            FRONT: {
                0: {links: [{side: "TOP", id: 1}], name: "TOP_FRONT"},
                1: {links: [{side: "BOTTOM", id: 1}], name: "BOTTOM_FRONT"},
                2: {links: [{side: "LEFT", id: 1}], name: "FRONT_LEFT"},
                3: {links: [{side: "RIGHT", id: 1}], name: "FRONT_RIGHT"}
            },
            BACK: {
                0: {links: [{side: "BOTTOM", id: 0}], name: "BOTTOM_BACK"},
                1: {links: [{side: "TOP", id: 0}], name: "TOP_BACK"},
                2: {links: [{side: "LEFT", id: 0}], name: "BACK_LEFT"},
                3: {links: [{side: "RIGHT", id: 0}], name: "BACK_RIGHT"}
            },
            LEFT: {
                0: {links: [{side: "BACK", id: 2}], name: "BACK_LEFT"},
                1: {links: [{side: "FRONT", id: 2}], name: "FRONT_LEFT"},
                2: {links: [{side: "TOP", id: 2}], name: "TOP_LEFT"},
                3: {links: [{side: "BOTTOM", id: 2}], name: "BOTTOM_LEFT"}
            },
            RIGHT: {
                0: {links: [{side: "BACK", id: 3}], name: "BACK_RIGHT"},
                1: {links: [{side: "FRONT", id: 3}], name: "FRONT_RIGHT"},
                2: {links: [{side: "TOP", id: 3}], name: "TOP_RIGHT"},
                3: {links: [{side: "BOTTOM", id: 3}], name: "BOTTOM_RIGHT"}
            },
            TOP: {
                0: {links: [{side: "BACK", id: 1}], name: "TOP_BACK"},
                1: {links: [{side: "FRONT", id: 0}], name: "TOP_FRONT"},
                2: {links: [{side: "LEFT", id: 2}], name: "TOP_LEFT"},
                3: {links: [{side: "RIGHT", id: 2}], name: "TOP_RIGHT"}
            },
            BOTTOM: {
                0: {links: [{side: "BACK", id: 0}], name: "BOTTOM_BACK"},
                1: {links: [{side: "FRONT", id: 1}], name: "BOTTOM_FRONT"},
                2: {links: [{side: "LEFT", id: 3}], name: "BOTTOM_LEFT"},
                3: {links: [{side: "RIGHT", id: 3}], name: "BOTTOM_RIGHT"}
            }
        }
    };

    constructor(viewer, options) {
        super();
        this.corners = [];

        this.viewer = viewer;

        this.options = options || {};
        this.options.width = options?.width || 175;
        this.options.edgeSize = options?.edgeSize || 0.15;
        this.options.bgColor = options?.bgColor || "#b8b8b8";
        this.options.edgeColor = options?.edgeColor || "#b2b2b2";
        this.options.cornerColor = options?.cornerColor || "#b2b2b2";
        this.options.focusColor = options?.focusColor || "#878487";
        this.options.color = options?.color || "#212529";

        this.currentHover = null;
        this.width = this.options.width;

        this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1);
        this.camera.position.set(0, 0, 0);
        this.camera.lookAt(new THREE.Vector3(0, 1, 0));
        this.camera.rotation.order = "ZXY";

        this.navRenderer = new THREE.WebGLRenderer({
            antialias: true,
            alpha: true
        });
        this.navRenderer.setPixelRatio(window.devicePixelRatio * this.width);
        this.navRenderer.setSize(this.width, this.width);
        this.navRenderer.domElement.style.position = "absolute";
        this.navRenderer.domElement.style.right = "0px";
        this.navRenderer.domElement.style.bottom = "0px";
        this.navRenderer.domElement.style.pointerEvents = "none";
        document.body.appendChild(this.navRenderer.domElement);
        viewer.postRenderCallbacks = viewer.postRenderCallbacks || [];
        viewer.postRenderCallbacks.push(() => {
            this.navRenderer.clearDepth();
            this.navRenderer.clear();
            this.navRenderer.render(this, this.camera);
        });

        this.front = this.createSide("FRONT");
        this.front.rotation.x = Math.PI / 2;
        this.front.position.y = -0.5;
        this.front.updateMatrixWorld();
        this.add(this.front);

        this.back = this.createSide("BACK");
        this.back.rotation.x = -Math.PI / 2;
        this.back.position.y = 0.5;
        this.back.updateMatrixWorld();
        this.add(this.back);

        this.left = this.createSide("LEFT");
        this.left.rotation.y = Math.PI / 2;
        this.left.position.x = -0.5;
        this.left.updateMatrixWorld();
        this.add(this.left);

        this.right = this.createSide("RIGHT");
        this.right.rotation.y = Math.PI / 2;
        this.right.position.x = 0.5;
        this.right.updateMatrixWorld();
        this.add(this.right);

        this.bottom = this.createSide("BOTTOM");
        this.bottom.position.z = -0.5;
        this.bottom.updateMatrixWorld();
        this.add(this.bottom);

        this.top = this.createSide("TOP");
        this.top.position.z = 0.5;
        this.top.updateMatrixWorld();
        this.add(this.top);

        this.cornerMeshes = {};
        this.edgeMeshes = {};
        ["FRONT", "BACK", "LEFT", "RIGHT", "TOP", "BOTTOM"].forEach(side => {
            const sideGroup = this[side.toLowerCase()];
            this.cornerMeshes[side] = sideGroup.children.filter(o => o.userData.type === "corner");
            this.edgeMeshes[side] = sideGroup.children.filter(o => o.userData.type === "edge");
        });

        window.addEventListener("resize", () => {
            this.navRenderer.setSize(this.width, this.width);
        });

        this.viewer.renderer.domElement.addEventListener("mousemove", (event) => {
            this.onMouseMove(event);
        });

        this.viewer.renderer.domElement.addEventListener("mousedown", (event) => {
            this.onMouseDown(event);
        }, false);
    }

    createTextLabel(text, size = 256, color = "#000000", background = null) {
        const dpi = window.devicePixelRatio || 1;
        const canvas = document.createElement("canvas");
        canvas.width = size * dpi;
        canvas.height = size * dpi;
        const ctx = canvas.getContext("2d");
        ctx.scale(dpi, dpi);

        if (background) {
            ctx.fillStyle = background;
            ctx.fillRect(0, 0, size, size);
        }

        ctx.fillStyle = color;
        ctx.font = `${size / 5}px Arial`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(text, size / 2, size / 2);

        const texture = new THREE.CanvasTexture(canvas);
        const material = new THREE.MeshBasicMaterial({
            map: texture,
            transparent: true,
            side: THREE.DoubleSide
        });
        const geometry = new THREE.PlaneGeometry(1, 1);
        return new THREE.Mesh(geometry, material);
    }

    createSide(name) {
        const group = new THREE.Group();
        const cornerSize = this.options.edgeSize;
        const edgeSize = 0.7;

        const colorCorner = new THREE.Color(this.options.edgeColor);
        const colorEdge = new THREE.Color(this.options.cornerColor);
        const colorFace = new THREE.Color(this.options.bgColor);

        this.corners = [
            [-0.5 + cornerSize / 2, -0.5 + cornerSize / 2],
            [-0.5 + cornerSize / 2, 0.5 - cornerSize / 2],
            [0.5 - cornerSize / 2, -0.5 + cornerSize / 2],
            [0.5 - cornerSize / 2, 0.5 - cornerSize / 2]
        ];
        this.corners.forEach((pos, i) => {
            const mesh = new THREE.Mesh(
                new THREE.PlaneGeometry(cornerSize, cornerSize),
                new THREE.MeshBasicMaterial({color: colorCorner, side: THREE.DoubleSide})
            );
            mesh.position.set(pos[0], pos[1], 0);
            mesh.userData = {type: "corner", id: i, side: name};
            group.add(mesh);
        });
        const edges = [
            {pos: [0, 0.5 - cornerSize / 2], size: [edgeSize, cornerSize]},
            {pos: [0, -0.5 + cornerSize / 2], size: [edgeSize, cornerSize]},
            {pos: [-0.5 + cornerSize / 2, 0], size: [cornerSize, edgeSize]},
            {pos: [0.5 - cornerSize / 2, 0], size: [cornerSize, edgeSize]}
        ];
        edges.forEach((e, i) => {
            const mesh = new THREE.Mesh(
                new THREE.PlaneGeometry(e.size[0], e.size[1]),
                new THREE.MeshBasicMaterial({color: colorEdge, side: THREE.DoubleSide})
            );
            mesh.position.set(e.pos[0], e.pos[1], 0);
            mesh.userData = {type: "edge", id: i, side: name};
            group.add(mesh);
        });

        const faceMesh = new THREE.Mesh(
            new THREE.PlaneGeometry(edgeSize, edgeSize),
            new THREE.MeshBasicMaterial({color: colorFace, side: THREE.DoubleSide})
        );
        faceMesh.userData = {type: "face", side: name};
        group.add(faceMesh);

        const textMesh = this.createTextLabel(name, 4 * this.width, this.options.color);
        textMesh.userData = {type: "label", parent: faceMesh};
        textMesh.scale.set(edgeSize, edgeSize, 1);
        textMesh.position.z = 0.001;
        textMesh.raycast = () => {
            // disable raycaster for label
        };

        switch (name.toLowerCase()) {
            case "top":
            case "front":
                textMesh.position.z = 0.001;
                break;
            case "back":
                textMesh.rotation.y = -Math.PI;
                textMesh.rotation.x = -Math.PI;
                textMesh.position.z = 0.001;
                break;
            case "left":
                textMesh.rotation.z = Math.PI / 2;
                textMesh.rotation.x = Math.PI;
                textMesh.position.z = -0.001;
                break;
            case "right":
                textMesh.rotation.z = Math.PI / 2;
                break;
            case "bottom":
                textMesh.rotation.z = -Math.PI;
                textMesh.rotation.y = -Math.PI;
                textMesh.position.z = -0.001;
                break;
        }

        faceMesh.add(textMesh);
        return group;
    }

    fitToContainer(event) {
        if (!this.visible) {
            return;
        }
        let mouse = new THREE.Vector2();
        const rect = event.currentTarget.getBoundingClientRect();
        const x = event.clientX - (rect.width + rect.left - this.width);
        const y = event.clientY - rect.top;
        if (x < 0 || y < 0 || x > this.width || y > this.width) {
            return;
        }
        mouse.x = (x / this.width) * 2 - 1;
        mouse.y = -(y / this.width) * 2 + 1;
        return mouse;
    }

    onMouseMove(event) {
        let mouse = this.fitToContainer(event);
        if (!mouse) {
            return;
        }

        let raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(mouse, this.camera);
        raycaster.ray.origin.sub(this.camera.getWorldDirection(new THREE.Vector3()));

        let intersects = raycaster.intersectObjects(this.children, true);
        if (intersects.length > 0) {
            let hit = intersects[0].object;
            if (this.currentHover !== hit) {
                if (this.currentHoverGroup) {
                    this.currentHoverGroup.forEach(item => {
                        item.material.color.copy(item.userData.originalColor);
                    });
                }

                this.currentHover = hit;
                this.currentHoverGroup = [];

                if (hit.userData.type === "corner" || hit.userData.type === "edge") {
                    let map = this.cubeMap.corners;
                    let meshes = this.cornerMeshes;
                    if (hit.userData.type === "edge") {
                        map = this.cubeMap.edges;
                        meshes = this.edgeMeshes;
                    }

                    const {side, id} = hit.userData;
                    const linked = map[side][id].links || [];
                    const group = [hit];

                    linked.forEach(link => {
                        const match = meshes[link.side][link.id];
                        if (match) {
                            group.push(match);
                        }
                    });

                    group.forEach(item => {
                        if (!item.userData.originalColor) {
                            item.userData.originalColor = item.material.color.clone();
                        }
                        item.material.color.copy(new THREE.Color(this.options.focusColor));
                    });

                    this.currentHoverGroup = group;
                } else {
                    if (!hit.userData.originalColor) {
                        hit.userData.originalColor = hit.material.color.clone();
                    }
                    hit.material.color.copy(new THREE.Color(this.options.focusColor));
                    this.currentHoverGroup = [hit];
                }
            }
        } else {
            if (this.currentHoverGroup) {
                this.currentHoverGroup.forEach(item => {
                    item.material.color.copy(item.userData.originalColor);
                });
                this.currentHoverGroup = null;
            }

            if (this.currentHover) {
                this.currentHover.material.color.copy(this.currentHover.userData.originalColor);
                this.currentHover = null;
            }
        }
    }

    onMouseDown(event) {
        let mouse = this.fitToContainer(event);
        if (!mouse) {
            return;
        }

        let raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(mouse, this.camera);
        raycaster.ray.origin.sub(this.camera.getWorldDirection(new THREE.Vector3()));

        const intersects = raycaster.intersectObjects(this.children, true);
        if (intersects.length === 0) {
            return;
        }

        const closest = intersects.reduce((prev, curr) => prev.distance < curr.distance ? prev : curr);
        const mesh = closest.object;
        const {type, side, id} = mesh.userData;

        const cubeMap = this.cubeMap;

        let viewTo;
        if (type === "corner") {
            const corner = cubeMap.corners[side]?.[id];
            if (corner) {
                viewTo = corner.name;
            }
        } else if (type === "edge") {
            const edge = cubeMap.edges[side]?.[id];
            if (edge) {
                viewTo = edge.name;
            }
        } else if (type === "face") {
            viewTo = side;
        } else {
            return;
        }

        this.setView(viewTo);
    }

    setView(viewName) {
        const target = this.views[viewName];
        if (!target) {
            return;
        }

        this.viewer.scene.view.yaw = THREE.MathUtils.degToRad(target.yaw);
        this.viewer.scene.view.pitch = THREE.MathUtils.degToRad(target.pitch);
        this.viewer.fitToScreen();
    }

    update(rotation) {
        this.camera.rotation.copy(rotation);
        this.camera.updateMatrixWorld();
    }
}
