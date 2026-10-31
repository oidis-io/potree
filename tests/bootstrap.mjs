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

const englishTexts = JSON.parse(readFileSync(join(repositoryRoot, "resources/lang/en/translation.json"), "utf8"));
globalThis.i18n ??= {
    lng: () => "en",
    t: (key, options = {}) => {
        const text = key.split(".").reduce((node, part) => node?.[part], englishTexts);
        if (typeof text !== "string") {
            throw new Error("Missing translation key in tests: " + key);
        }
        return text.replace(/__(\w+)__/g, (match, name) => (name in options ? String(options[name]) : match));
    }
};

if (typeof globalThis.BinaryHeap !== "function") {
    throw new Error("BinaryHeap global was not initialized by tests/bootstrap.mjs");
}
