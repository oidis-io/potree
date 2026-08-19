/*! ******************************************************************************************************** *
 *
 * Copyright 2026 Oidis
 *
 * SPDX-License-Identifier: BSD-2-Clause
 * The BSD-2-Clause license for this file can be found in the LICENSE.txt file included with this distribution
 * or at https://spdx.org/licenses/BSD-2-Clause.html#licenseText
 *
 * ********************************************************************************************************* */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

globalThis.document ??= { currentScript: null };

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const binaryHeapSource = readFileSync(join(repositoryRoot, "libs/other/BinaryHeap.js"), "utf8");
(0, eval)(binaryHeapSource);

if (typeof globalThis.BinaryHeap !== "function") {
    throw new Error("BinaryHeap global was not initialized by tests/bootstrap.mjs");
}
