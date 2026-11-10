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
import { PointCloudOctreeGeometry, PointCloudOctreeGeometryNode } from "../../PointCloudOctreeGeometry.js";
import { PointCloudOctree } from "../../PointCloudOctree.js";
import { PointAttribute, PointAttributes, PointAttributeTypes } from "../../loader/PointAttributes.js";
import { Version } from "../../Version.js";
import PotreeConfig from "../../PotreeConfig.js";

const MEMORY_FORMAT_VERSION = "1.4";
const DEFAULT_COLOR_VALUE = 255;
const POINT_CLOUD_PROJECTION = "EPSG:5514";

class MemoryPointLoader {
    constructor(cloud, order) {
        this.version = new Version(MEMORY_FORMAT_VERSION);
        this.cloud = cloud;
        this.order = order;
    }

    load(node) {
        if (node.loaded) {
            return;
        }
        const { positions, colors } = this.cloud;
        const { start, pointCount } = node.memoryRange;
        const minimum = node.boundingBox.min;
        const nodePositions = new Float32Array(pointCount * 3);
        const nodeColors = new Uint8Array(pointCount * 4);
        const indices = new Uint32Array(pointCount);
        const tightMinimum = new THREE.Vector3(Infinity, Infinity, Infinity);
        const tightMaximum = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
        const mean = new THREE.Vector3();
        const position = new THREE.Vector3();
        for (let index = 0; index < pointCount; index++) {
            const point = this.order[start + index];
            position.set(positions[point * 3] - minimum.x, positions[point * 3 + 1] - minimum.y, positions[point * 3 + 2] - minimum.z);
            position.toArray(nodePositions, index * 3);
            tightMinimum.min(position);
            tightMaximum.max(position);
            mean.add(position);
            for (let channel = 0; channel < 3; channel++) {
                nodeColors[index * 4 + channel] = colors ? colors[point * 3 + channel] : DEFAULT_COLOR_VALUE;
            }
            nodeColors[index * 4 + 3] = DEFAULT_COLOR_VALUE;
            indices[index] = index;
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.BufferAttribute(nodePositions, 3));
        geometry.setAttribute("rgba", new THREE.BufferAttribute(nodeColors, 4, true));
        geometry.setAttribute("indices", new THREE.BufferAttribute(new Uint8Array(indices.buffer), 4, true));
        node.geometry = geometry;
        node.numPoints = pointCount;
        node.mean = pointCount > 0 ? mean.divideScalar(pointCount) : mean;
        node.tightBoundingBox = new THREE.Box3(new THREE.Vector3(0, 0, 0), tightMaximum.sub(tightMinimum));
        node.loaded = true;
        node.loading = false;
        PotreeConfig.numNodesLoading--;
    }
}

function createPointAttributes() {
    const attributes = new PointAttributes();
    attributes.add(PointAttribute.POSITION_CARTESIAN);
    attributes.add(new PointAttribute("rgba", PointAttributeTypes.DATA_TYPE_UINT8, 4));
    return attributes;
}

function toBox(minimum, size) {
    return new THREE.Box3(new THREE.Vector3(...minimum), new THREE.Vector3(minimum[0] + size, minimum[1] + size, minimum[2] + size));
}

function createGeometryNode(octreeNode, geometry, spacing) {
    const node = new PointCloudOctreeGeometryNode(octreeNode.name, geometry, toBox(octreeNode.minimum, octreeNode.size));
    node.level = octreeNode.level;
    node.spacing = spacing / 2 ** octreeNode.level;
    node.numPoints = octreeNode.pointCount;
    node.hasChildren = octreeNode.children.length > 0;
    node.memoryRange = { start: octreeNode.start, pointCount: octreeNode.pointCount };
    for (const child of octreeNode.children) {
        node.addChild(createGeometryNode(child, geometry, spacing));
    }
    return node;
}

export function createMemoryPointCloud(cloud, octree) {
    const geometry = new PointCloudOctreeGeometry();
    const localMinimum = cloud.minimum.map((value, axis) => value - cloud.origin[axis]);
    const localMaximum = cloud.maximum.map((value, axis) => value - cloud.origin[axis]);
    geometry.spacing = octree.spacing;
    geometry.offset = new THREE.Vector3(...cloud.origin);
    geometry.boundingBox = toBox(octree.root.minimum, octree.cubeSize);
    geometry.tightBoundingBox = new THREE.Box3(new THREE.Vector3(...localMinimum), new THREE.Vector3(...localMaximum));
    geometry.boundingSphere = geometry.boundingBox.getBoundingSphere(new THREE.Sphere());
    geometry.tightBoundingSphere = geometry.tightBoundingBox.getBoundingSphere(new THREE.Sphere());
    geometry.pointAttributes = createPointAttributes();
    geometry.projection = POINT_CLOUD_PROJECTION;
    geometry.loader = new MemoryPointLoader(cloud, octree.order);
    geometry.root = createGeometryNode(octree.root, geometry, octree.spacing);
    geometry.root.load();
    return new PointCloudOctree(geometry);
}
