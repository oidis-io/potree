/*! ******************************************************************************************************** *
 *
 * Copyright 2026 Oidis
 *
 * SPDX-License-Identifier: BSD-2-Clause
 * The BSD-2-Clause license for this file can be found in the LICENSE.txt file included with this distribution
 * or at https://spdx.org/licenses/BSD-2-Clause.html#licenseText
 *
 * ********************************************************************************************************* */

import { LAS_SIGNATURE, readLasFile } from "./LasFileReader.js";
import { PLY_SIGNATURE, readPlyFile } from "./PlyFileReader.js";
import { readTextPointFile, TEXT_POINT_EXTENSIONS } from "./TextPointFileReader.js";
import { createReadError, PointCloudReadErrorCode } from "./PointCloudReadError.js";

const SIGNATURE_BYTES = 4;

export const POINT_CLOUD_FILE_EXTENSIONS = Object.freeze([".las", ".laz", ".ply", ...TEXT_POINT_EXTENSIONS]);

function hasTextPointExtension(fileName) {
    const lowerCaseName = fileName.toLowerCase();
    return TEXT_POINT_EXTENSIONS.some((extension) => lowerCaseName.endsWith(extension));
}

export async function readPointCloudFile(file, maximumPointCount, onProgress) {
    const signature = new TextDecoder("latin1").decode(await file.slice(0, SIGNATURE_BYTES).arrayBuffer());
    if (signature === LAS_SIGNATURE) {
        return readLasFile(file, maximumPointCount, onProgress);
    }
    if (signature.startsWith(PLY_SIGNATURE)) {
        return readPlyFile(file, maximumPointCount, onProgress);
    }
    if (hasTextPointExtension(file.name)) {
        return readTextPointFile(file, maximumPointCount, onProgress);
    }
    throw createReadError(PointCloudReadErrorCode.UNSUPPORTED_FILE);
}
