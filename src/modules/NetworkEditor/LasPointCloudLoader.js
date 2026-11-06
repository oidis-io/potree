/*! ******************************************************************************************************** *
 *
 * Copyright 2026 Oidis
 *
 * SPDX-License-Identifier: BSD-2-Clause
 * The BSD-2-Clause license for this file can be found in the LICENSE.txt file included with this distribution
 * or at https://spdx.org/licenses/BSD-2-Clause.html#licenseText
 *
 * ********************************************************************************************************* */

import { readLasHeader, readLasPoints } from "./LasFileReader.js";
import { buildMemoryOctree } from "./MemoryOctreeBuilder.js";
import { createMemoryPointCloud } from "./MemoryPointCloud.js";

export const LasLoadStage = Object.freeze({
    READING: "reading",
    BUILDING: "building"
});

export async function loadLasPointCloud(file, maximumPointCount, onProgress) {
    const header = await readLasHeader(file);
    const cloud = await readLasPoints(file, header, maximumPointCount, (share) => onProgress?.({ stage: LasLoadStage.READING, share: share }));
    const octree = await buildMemoryOctree(cloud, (share) => onProgress?.({ stage: LasLoadStage.BUILDING, share: share }));
    return {
        pointCloud: createMemoryPointCloud(cloud, octree),
        pointCount: cloud.pointCount,
        sourcePointCount: cloud.sourcePointCount,
        origin: cloud.origin,
        hasColors: header.hasColors,
        nodeCount: octree.nodeCount
    };
}
