/*! ******************************************************************************************************** *
 *
 * Copyright 2026 Oidis
 *
 * SPDX-License-Identifier: BSD-2-Clause
 * The BSD-2-Clause license for this file can be found in the LICENSE.txt file included with this distribution
 * or at https://spdx.org/licenses/BSD-2-Clause.html#licenseText
 *
 * ********************************************************************************************************* */

export const PointCloudLoadStage = Object.freeze({
    READING: "reading",
    BUILDING: "building",
    STORING: "storing",
    RESTORING: "restoring"
});

export const ConversionMessageType = Object.freeze({
    OPEN_FILE: "open_file",
    OPEN_STORED: "open_stored",
    PROGRESS: "progress",
    LOADED: "loaded",
    FAILED: "failed"
});
