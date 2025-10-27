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

import * as THREE from "../libs/three.js/build/three.module.js";
import { ClipMethod, ClipTask } from "./defines.js";
import { Box3Helper } from "./utils/Box3Helper.js";
import PotreeConfig from "./PotreeConfig.js";
import PotreeRefs from "./PotreeRefs.js";

export function updatePointClouds(pointclouds, camera, renderer) {
    for (let pointcloud of pointclouds) {
        let start = performance.now();

        for (let profileRequest of pointcloud.profileRequests) {
            profileRequest.update();

            let duration = performance.now() - start;
            if (duration > 5) {
                break;
            }
        }
    }

    let result = updateVisibility(pointclouds, camera, renderer);

    for (let pointcloud of pointclouds) {
        pointcloud.updateMaterial(pointcloud.material, pointcloud.visibleNodes, camera, renderer);
        pointcloud.updateVisibleBounds();
    }

    PotreeRefs.lru.freeMemory();

    return result;
}

export function updateVisibilityStructures(pointclouds, camera, renderer) {
    let frustums = [];
    let camObjPositions = [];
    let priorityQueue = new BinaryHeap(function (x) {
        return 1 / x.weight;
    });

    for (let i = 0; i < pointclouds.length; i++) {
        let pointcloud = pointclouds[i];

        if (!pointcloud.initialized()) {
            continue;
        }

        pointcloud.numVisibleNodes = 0;
        pointcloud.numVisiblePoints = 0;
        pointcloud.deepestVisibleLevel = 0;
        pointcloud.visibleNodes = [];
        pointcloud.visibleGeometry = [];

        camera.updateMatrixWorld();
        let frustum = new THREE.Frustum();
        let viewI = camera.matrixWorldInverse;
        let world = pointcloud.matrixWorld;

        let frustumCam = camera.clone();
        frustumCam.near = Math.min(camera.near, 0.1);
        frustumCam.updateProjectionMatrix();
        let proj = camera.projectionMatrix;

        let fm = new THREE.Matrix4().multiply(proj).multiply(viewI).multiply(world);
        frustum.setFromProjectionMatrix(fm);
        frustums.push(frustum);

        let view = camera.matrixWorld;
        let worldI = world.clone().invert();
        let camMatrixObject = new THREE.Matrix4().multiply(worldI).multiply(view);
        let camObjPos = new THREE.Vector3().setFromMatrixPosition(camMatrixObject);
        camObjPositions.push(camObjPos);

        if (pointcloud.visible && pointcloud.root !== null) {
            priorityQueue.push({ pointcloud: i, node: pointcloud.root, weight: Number.MAX_VALUE });
        }

        if (pointcloud.root.isTreeNode()) {
            pointcloud.hideDescendants(pointcloud.root.sceneNode);
        }

        for (let j = 0; j < pointcloud.boundingBoxNodes.length; j++) {
            pointcloud.boundingBoxNodes[j].visible = false;
        }
    }

    return {
        "frustums": frustums,
        "camObjPositions": camObjPositions,
        "priorityQueue": priorityQueue
    };
}

export function updateVisibility(pointclouds, camera, renderer) {
    let numVisiblePoints = 0;

    let numVisiblePointsInPointclouds = new Map(pointclouds.map(pc => [pc, 0]));

    let visibleNodes = [];
    let visibleGeometry = [];
    let unloadedGeometry = [];

    let lowestSpacing = Infinity;

    // calculate object space frustum and cam pos and setup priority queue
    let s = updateVisibilityStructures(pointclouds, camera, renderer);
    let frustums = s.frustums;
    let camObjPositions = s.camObjPositions;
    let priorityQueue = s.priorityQueue;

    let loadedToGPUThisFrame = 0;

    let domHeight = renderer.domElement.clientHeight;

    // check if pointcloud has been transformed
    // some code will only be executed if changes have been detected
    if (!PotreeConfig._pointcloudTransformVersion) {
        PotreeConfig._pointcloudTransformVersion = new Map();
    }
    let pointcloudTransformVersion = PotreeConfig._pointcloudTransformVersion;
    for (let pointcloud of pointclouds) {
        if (!pointcloud.visible) {
            continue;
        }

        pointcloud.updateMatrixWorld();

        if (!pointcloudTransformVersion.has(pointcloud)) {
            pointcloudTransformVersion.set(pointcloud, { number: 0, transform: pointcloud.matrixWorld.clone() });
        } else {
            let version = pointcloudTransformVersion.get(pointcloud);

            if (!version.transform.equals(pointcloud.matrixWorld)) {
                version.number++;
                version.transform.copy(pointcloud.matrixWorld);

                pointcloud.dispatchEvent({
                    type: "transformation_changed",
                    target: pointcloud
                });
            }
        }
    }

    while (priorityQueue.size() > 0) {
        let element = priorityQueue.pop();
        let node = element.node;
        let parent = element.parent;
        let pointcloud = pointclouds[element.pointcloud];

        let box = node.getBoundingBox();
        let frustum = frustums[element.pointcloud];
        let camObjPos = camObjPositions[element.pointcloud];

        let insideFrustum = frustum.intersectsBox(box);
        let maxLevel = pointcloud.maxLevel || Infinity;
        let level = node.getLevel();
        let visible = insideFrustum;
        visible = visible && !(numVisiblePoints + node.getNumPoints() > PotreeConfig.pointBudget);
        visible = visible && !(numVisiblePointsInPointclouds.get(pointcloud) + node.getNumPoints() > pointcloud.pointBudget);
        visible = visible && level < maxLevel;
        visible = visible || node.getLevel() <= 2;

        let clipBoxes = pointcloud.material.clipBoxes;
        if (true && clipBoxes.length > 0) {
            let numIntersecting = 0;
            let numIntersectionVolumes = 0;

            for (let _clipBox of clipBoxes) {
                let pcWorldInverse = pointcloud.matrixWorld.clone().invert();

                let px = new THREE.Vector3(+0.5, 0, 0).applyMatrix4(pcWorldInverse);
                let nx = new THREE.Vector3(-0.5, 0, 0).applyMatrix4(pcWorldInverse);
                let py = new THREE.Vector3(0, +0.5, 0).applyMatrix4(pcWorldInverse);
                let ny = new THREE.Vector3(0, -0.5, 0).applyMatrix4(pcWorldInverse);
                let pz = new THREE.Vector3(0, 0, +0.5).applyMatrix4(pcWorldInverse);
                let nz = new THREE.Vector3(0, 0, -0.5).applyMatrix4(pcWorldInverse);

                let pxN = new THREE.Vector3().subVectors(nx, px).normalize();
                let nxN = pxN.clone().multiplyScalar(-1);
                let pyN = new THREE.Vector3().subVectors(ny, py).normalize();
                let nyN = pyN.clone().multiplyScalar(-1);
                let pzN = new THREE.Vector3().subVectors(nz, pz).normalize();
                let nzN = pzN.clone().multiplyScalar(-1);

                let pxPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(pxN, px);
                let nxPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(nxN, nx);
                let pyPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(pyN, py);
                let nyPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(nyN, ny);
                let pzPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(pzN, pz);
                let nzPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(nzN, nz);

                let frustum = new THREE.Frustum(pxPlane, nxPlane, pyPlane, nyPlane, pzPlane, nzPlane);
                let intersects = frustum.intersectsBox(box);

                if (intersects) {
                    numIntersecting++;
                }
                numIntersectionVolumes++;
            }

            let insideAny = numIntersecting > 0;
            let insideAll = numIntersecting === numIntersectionVolumes;

            if (pointcloud.material.clipTask === ClipTask.SHOW_INSIDE) {
                if (pointcloud.material.clipMethod === ClipMethod.INSIDE_ANY && insideAny) {
                    // node.debug = true
                } else if (pointcloud.material.clipMethod === ClipMethod.INSIDE_ALL && insideAll) {
                    // node.debug = true;
                } else {
                    visible = false;
                }
            }
        }

        if (node.spacing) {
            lowestSpacing = Math.min(lowestSpacing, node.spacing);
        } else if (node.geometryNode && node.geometryNode.spacing) {
            lowestSpacing = Math.min(lowestSpacing, node.geometryNode.spacing);
        }

        if (numVisiblePoints + node.getNumPoints() > PotreeConfig.pointBudget) {
            break;
        }

        if (!visible) {
            continue;
        }

        numVisiblePoints += node.getNumPoints();
        let numVisiblePointsInPointcloud = numVisiblePointsInPointclouds.get(pointcloud);
        numVisiblePointsInPointclouds.set(pointcloud, numVisiblePointsInPointcloud + node.getNumPoints());

        pointcloud.numVisibleNodes++;
        pointcloud.numVisiblePoints += node.getNumPoints();

        if (node.isGeometryNode() && (!parent || parent.isTreeNode())) {
            if (node.isLoaded() && loadedToGPUThisFrame < 2) {
                node = pointcloud.toTreeNode(node, parent);
                loadedToGPUThisFrame++;
            } else {
                unloadedGeometry.push(node);
                visibleGeometry.push(node);
            }
        }

        if (node.isTreeNode()) {
            PotreeRefs.lru.touch(node.geometryNode);
            node.sceneNode.visible = true;
            node.sceneNode.material = pointcloud.material;

            visibleNodes.push(node);
            pointcloud.visibleNodes.push(node);

            if (node._transformVersion === undefined) {
                node._transformVersion = -1;
            }
            let transformVersion = pointcloudTransformVersion.get(pointcloud);
            if (node._transformVersion !== transformVersion.number) {
                node.sceneNode.updateMatrix();
                node.sceneNode.matrixWorld.multiplyMatrices(pointcloud.matrixWorld, node.sceneNode.matrix);
                node._transformVersion = transformVersion.number;
            }

            if (pointcloud.showBoundingBox && !node.boundingBoxNode && node.getBoundingBox) {
                let boxHelper = new Box3Helper(node.getBoundingBox());
                boxHelper.matrixAutoUpdate = false;
                pointcloud.boundingBoxNodes.push(boxHelper);
                node.boundingBoxNode = boxHelper;
                node.boundingBoxNode.matrix.copy(pointcloud.matrixWorld);
            } else if (pointcloud.showBoundingBox) {
                node.boundingBoxNode.visible = true;
                node.boundingBoxNode.matrix.copy(pointcloud.matrixWorld);
            } else if (!pointcloud.showBoundingBox && node.boundingBoxNode) {
                node.boundingBoxNode.visible = false;
            }
        }

        let children = node.getChildren();
        for (let i = 0; i < children.length; i++) {
            let child = children[i];

            let weight = 0;
            if (camera.isPerspectiveCamera) {
                let sphere = child.getBoundingSphere();
                let center = sphere.center;

                let dx = camObjPos.x - center.x;
                let dy = camObjPos.y - center.y;
                let dz = camObjPos.z - center.z;

                let dd = dx * dx + dy * dy + dz * dz;
                let distance = Math.sqrt(dd);

                let radius = sphere.radius;

                let fov = (camera.fov * Math.PI) / 180;
                let slope = Math.tan(fov / 2);
                let projFactor = (0.5 * domHeight) / (slope * distance);
                let screenPixelRadius = radius * projFactor;

                if (screenPixelRadius < pointcloud.minimumNodePixelSize) {
                    continue;
                }

                weight = screenPixelRadius;

                if (distance - radius < 0) {
                    weight = Number.MAX_VALUE;
                }
            } else {
                // TODO ortho visibility
                let bb = child.getBoundingBox();
                let diagonal = bb.max.clone().sub(bb.min).length();

                weight = diagonal;
            }

            priorityQueue.push({ pointcloud: element.pointcloud, node: child, parent: node, weight: weight });
        }
    }

    {
        let maxDEMLevel = 4;
        // TODO(mkelnar) refactor DEM
        let candidates = pointclouds
            .filter(p => (p.generateDEM && p.dem instanceof DEM));
        for (let pointcloud of candidates) {
            let updatingNodes = pointcloud.visibleNodes.filter(n => n.getLevel() <= maxDEMLevel);
            pointcloud.dem.update(updatingNodes);
        }
    }

    for (let i = 0; i < Math.min(PotreeConfig.maxNodesLoading, unloadedGeometry.length); i++) {
        unloadedGeometry[i].load();
    }

    return {
        visibleNodes: visibleNodes,
        numVisiblePoints: numVisiblePoints,
        lowestSpacing: lowestSpacing
    };
}
