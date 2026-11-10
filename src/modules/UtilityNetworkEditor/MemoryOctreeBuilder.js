/*! ******************************************************************************************************** *
 *
 * Copyright 2026 Oidis
 *
 * SPDX-License-Identifier: BSD-2-Clause
 * The BSD-2-Clause license for this file can be found in the LICENSE.txt file included with this distribution
 * or at https://spdx.org/licenses/BSD-2-Clause.html#licenseText
 *
 * ********************************************************************************************************* */

const SAMPLING_GRID_SIZE = 128;
const LEAF_POINT_LIMIT = 50000;
const MAXIMUM_DEPTH = 14;
const YIELD_INTERVAL_MILLISECONDS = 30;
const CUBE_PADDING_RATIO = 1e-6;

function waitForNextTask() {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

function toCellCoordinate(value, minimum, scale) {
    const cell = ((value - minimum) * scale) | 0;
    return cell < 0 ? 0 : (cell >= SAMPLING_GRID_SIZE ? SAMPLING_GRID_SIZE - 1 : cell);
}

class OctreePartitioner {
    constructor(cloud) {
        this.positions = cloud.positions;
        this.order = new Uint32Array(cloud.pointCount);
        this.scratch = new Uint32Array(cloud.pointCount);
        this.childIndices = new Uint8Array(cloud.pointCount);
        this.grid = new Uint8Array(SAMPLING_GRID_SIZE ** 3);
        this.touchedCells = new Uint32Array(SAMPLING_GRID_SIZE ** 3);
        for (let index = 0; index < cloud.pointCount; index++) {
            this.order[index] = index;
        }
    }

    selectNodePoints(node) {
        const { positions, order, grid, touchedCells } = this;
        const scale = SAMPLING_GRID_SIZE / node.size;
        const [minimumX, minimumY, minimumZ] = node.minimum;
        let touchedCount = 0;
        let selectedEnd = node.start;
        for (let index = node.start; index < node.end; index++) {
            const point = order[index];
            const base = point * 3;
            const cellX = toCellCoordinate(positions[base], minimumX, scale);
            const cellY = toCellCoordinate(positions[base + 1], minimumY, scale);
            const cellZ = toCellCoordinate(positions[base + 2], minimumZ, scale);
            const cell = (cellX * SAMPLING_GRID_SIZE + cellY) * SAMPLING_GRID_SIZE + cellZ;
            if (grid[cell] === 0) {
                grid[cell] = 1;
                touchedCells[touchedCount++] = cell;
                order[index] = order[selectedEnd];
                order[selectedEnd] = point;
                selectedEnd++;
            }
        }
        for (let index = 0; index < touchedCount; index++) {
            grid[touchedCells[index]] = 0;
        }
        return selectedEnd;
    }

    splitIntoChildren(node, start) {
        const { positions, order, scratch, childIndices } = this;
        const halfSize = node.size / 2;
        const [centerX, centerY, centerZ] = node.minimum.map((value) => value + halfSize);
        const counts = new Uint32Array(8);
        for (let index = start; index < node.end; index++) {
            const base = order[index] * 3;
            const childIndex = (positions[base] >= centerX ? 4 : 0) | (positions[base + 1] >= centerY ? 2 : 0) | (positions[base + 2] >= centerZ ? 1 : 0);
            childIndices[index] = childIndex;
            counts[childIndex]++;
        }
        const offsets = [];
        let offset = start;
        for (let childIndex = 0; childIndex < 8; childIndex++) {
            offsets.push(offset);
            offset += counts[childIndex];
        }
        const writePositions = [...offsets];
        for (let index = start; index < node.end; index++) {
            scratch[writePositions[childIndices[index]]++] = order[index];
        }
        order.set(scratch.subarray(start, node.end), start);
        const children = [];
        for (let childIndex = 0; childIndex < 8; childIndex++) {
            if (counts[childIndex] === 0) {
                continue;
            }
            children.push({
                name: `${node.name}${childIndex}`,
                index: childIndex,
                level: node.level + 1,
                minimum: [
                    node.minimum[0] + ((childIndex & 4) ? halfSize : 0),
                    node.minimum[1] + ((childIndex & 2) ? halfSize : 0),
                    node.minimum[2] + ((childIndex & 1) ? halfSize : 0)
                ],
                size: halfSize,
                start: offsets[childIndex],
                end: offsets[childIndex] + counts[childIndex],
                children: []
            });
        }
        return children;
    }

    partition(node) {
        const pointCount = node.end - node.start;
        if (pointCount <= LEAF_POINT_LIMIT || node.level >= MAXIMUM_DEPTH) {
            node.pointCount = pointCount;
            return [];
        }
        const selectedEnd = this.selectNodePoints(node);
        node.pointCount = selectedEnd - node.start;
        node.children = selectedEnd < node.end ? this.splitIntoChildren(node, selectedEnd) : [];
        return node.children;
    }
}

export async function buildMemoryOctree(cloud, onProgress) {
    const extent = cloud.maximum.map((value, axis) => value - cloud.minimum[axis]);
    const cubeSize = Math.max(...extent) * (1 + CUBE_PADDING_RATIO) || 1;
    const partitioner = new OctreePartitioner(cloud);
    const cubeMinimum = extent.map((size, axis) => cloud.minimum[axis] - cloud.origin[axis] + size / 2 - cubeSize / 2);
    const root = { name: "r", index: 0, level: 0, minimum: cubeMinimum, size: cubeSize, start: 0, end: cloud.pointCount, children: [] };
    const pendingNodes = [root];
    let nodeCount = 0;
    let placedPointCount = 0;
    let lastYieldTime = performance.now();
    while (pendingNodes.length > 0) {
        const node = pendingNodes.pop();
        pendingNodes.push(...partitioner.partition(node));
        nodeCount++;
        placedPointCount += node.pointCount;
        if (performance.now() - lastYieldTime > YIELD_INTERVAL_MILLISECONDS) {
            onProgress?.(placedPointCount / cloud.pointCount);
            await waitForNextTask();
            lastYieldTime = performance.now();
        }
    }
    partitioner.scratch = null;
    partitioner.childIndices = null;
    return {
        root: root,
        order: partitioner.order,
        cubeSize: cubeSize,
        spacing: cubeSize / SAMPLING_GRID_SIZE,
        nodeCount: nodeCount
    };
}
