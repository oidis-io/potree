/*! ******************************************************************************************************** *
 *
 * Copyright 2026 Oidis
 *
 * SPDX-License-Identifier: BSD-2-Clause
 * The BSD-2-Clause license for this file can be found in the LICENSE.txt file included with this distribution
 * or at https://spdx.org/licenses/BSD-2-Clause.html#licenseText
 *
 * ********************************************************************************************************* */

export const PointCloudReadErrorCode = Object.freeze({
    UNSUPPORTED_FILE: "unsupported_file",
    UNSUPPORTED_FORMAT: "unsupported_format",
    EMPTY: "empty",
    TOO_LARGE: "too_large",
    NOT_STORED: "not_stored",
    CANCELED: "canceled",
    FAILED: "failed"
});

export function createReadError(code) {
    const error = new Error(`Cannot read point cloud: ${code}`);
    error.code = code;
    return error;
}
