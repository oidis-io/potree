/*! ******************************************************************************************************** *
 *
 * Copyright 2025 Oidis
 *
 * SPDX-License-Identifier: BSD-2-Clause
 * The BSD-2-Clause license for this file can be found in the LICENSE.txt file included with this distribution
 * or at https://spdx.org/licenses/BSD-2-Clause.html#licenseText
 *
 * ********************************************************************************************************* */

import terser from "@rollup/plugin-terser";
import commonjs from "@rollup/plugin-commonjs";

const year = new Date().getFullYear();
const banner = `/*! ******************************************************************************************************** *
 *
 * Copyright 2011-2020 Markus Schütz
 * Copyright 2025${(year > 2025) ? "-" + year : ""} Oidis
 *
 * SPDX-License-Identifier: BSD-2-Clause
 * The BSD-2-Clause license for this file can be found in the LICENSE.txt file included with this distribution
 * or at https://spdx.org/licenses/BSD-2-Clause.html#licenseText
 *
 * ********************************************************************************************************* */`;

const terserOptions = {
    format: {
        comments: false,
        preamble: banner
    }
};

export default [
    {
        input: "src/Potree.js",
        treeshake: false,
        output: {
            file: "build/potree/potree.js",
            format: "umd",
            name: "Potree",
            sourcemap: true
        },
        plugins: [
            commonjs(),
            terser(terserOptions)
        ],
        external: [
            "libs/*",
            "pointclouds/*"
        ]
    },
    {
        input: "src/workers/BinaryDecoderWorker.js",
        output: {
            file: "build/potree/workers/BinaryDecoderWorker.js",
            format: "es",
            name: "Potree",
            sourcemap: false
        },
        plugins: [
            terser(terserOptions)
        ],
        external: [
            "libs/*",
            "pointclouds/*"
        ]
    },
    {
        input: "src/modules/loader/2.0/DecoderWorker.js",
        output: {
            file: "build/potree/workers/2.0/DecoderWorker.js",
            format: "es",
            name: "Potree",
            sourcemap: false
        },
        plugins: [
            terser(terserOptions)
        ],
        external: [
            "libs/*",
            "pointclouds/*"
        ]
    },
    {
        input: "src/modules/loader/2.0/DecoderWorker_brotli.js",
        output: {
            file: "build/potree/workers/2.0/DecoderWorker_brotli.js",
            format: "es",
            name: "Potree",
            sourcemap: false
        },
        plugins: [
            terser(terserOptions)
        ],
        external: [
            "libs/*",
            "pointclouds/*"
        ]
    }
];
