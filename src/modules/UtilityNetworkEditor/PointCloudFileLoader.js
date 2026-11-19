/*! ******************************************************************************************************** *
 *
 * Copyright 2026 Oidis
 *
 * SPDX-License-Identifier: BSD-2-Clause
 * The BSD-2-Clause license for this file can be found in the LICENSE.txt file included with this distribution
 * or at https://spdx.org/licenses/BSD-2-Clause.html#licenseText
 *
 * ********************************************************************************************************* */

import PotreeConfig from "../../PotreeConfig.js";
import { createMemoryPointCloud } from "./MemoryPointCloud.js";
import { ConversionMessageType } from "./PointCloudConversionProtocol.js";
import { createReadError, PointCloudReadErrorCode } from "./PointCloudReadError.js";

const WORKER_PATH = "/workers/PointCloudConversionWorker.js";

function createResult(message) {
    const { cloud, octree } = message;
    return {
        pointCloud: createMemoryPointCloud(cloud, octree),
        pointCount: cloud.pointCount,
        sourcePointCount: cloud.sourcePointCount,
        origin: cloud.origin,
        hasColors: cloud.colors !== null,
        hasIntensities: cloud.intensities !== null,
        hasClassifications: cloud.classifications !== null,
        nodeCount: octree.nodeCount,
        fileName: message.fileName,
        fileSize: message.fileSize,
        fileLastModified: message.fileLastModified,
        storageKey: message.storageKey,
        isFromStorage: message.isFromStorage,
        isStored: message.isStored
    };
}

function runConversion(message, options) {
    return new Promise((resolve, reject) => {
        const worker = new Worker(`${PotreeConfig.scriptPath}${WORKER_PATH}`);
        const signal = options.signal ?? null;
        const finish = () => {
            worker.terminate();
            signal?.removeEventListener("abort", cancel);
        };
        const cancel = () => {
            finish();
            reject(createReadError(PointCloudReadErrorCode.CANCELED));
        };
        if (signal?.aborted) {
            cancel();
            return;
        }
        signal?.addEventListener("abort", cancel);
        worker.onmessage = (event) => {
            const response = event.data;
            if (response.type === ConversionMessageType.PROGRESS) {
                options.onProgress?.({ stage: response.stage, share: response.share });
                return;
            }
            finish();
            if (response.type === ConversionMessageType.LOADED) {
                resolve(createResult(response));
            } else {
                reject(createReadError(response.code));
            }
        };
        worker.onerror = (event) => {
            event.preventDefault();
            finish();
            reject(createReadError(PointCloudReadErrorCode.FAILED));
        };
        worker.postMessage(message);
    });
}

export function loadPointCloudFile(file, options) {
    return runConversion({ type: ConversionMessageType.OPEN_FILE, file: file, maximumPointCount: options.maximumPointCount }, options);
}

export function loadStoredPointCloud(storageKey, options = {}) {
    return runConversion({ type: ConversionMessageType.OPEN_STORED, storageKey: storageKey }, options);
}
