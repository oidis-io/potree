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

import { EptBinaryLoader } from "./BinaryLoader.js";
import PotreeConfig from "../../PotreeConfig.js";

export class EptZstandardLoader extends EptBinaryLoader {
    extension() {
        return ".zst";
    }

    workerPath() {
        return PotreeConfig.scriptPath + "/workers/EptZstandardDecoderWorker.js";
    }
}
