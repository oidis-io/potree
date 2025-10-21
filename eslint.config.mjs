/*! ******************************************************************************************************** *
 *
 * Copyright 2025 Oidis
 *
 * SPDX-License-Identifier: BSD-2-Clause
 * The BSD-2-Clause license for this file can be found in the LICENSE.txt file included with this distribution
 * or at https://spdx.org/licenses/BSD-2-Clause.html#licenseText
 *
 * ********************************************************************************************************* */

import globals from "globals";
import pluginJs from "@eslint/js";
import unusedImports from "eslint-plugin-unused-imports";

export default [
    {
        ignores: [".github/", ".idea/", "build/", "node_modules/", "resources/", "pointclouds/", "docs/", "examples/", "libs/", "**/*.min.js"],
    },
    {
        languageOptions: {
            globals: globals.browser
        }
    },
    pluginJs.configs.recommended,
    {
        plugins: {
            "unused-imports": unusedImports
        },
        languageOptions: {
            globals: {
                "$": "readonly",
            }
        },
        rules: {
            semi: ["error", "always"],
            "semi-spacing": ["error", {"before": false, "after": true}],
            "semi-style": ["error", "last"],
            "no-extra-semi": "error",
            "no-multiple-empty-lines": ["error", {"max": 1, "maxEOF": 0}],
            "eol-last": ["error", "always"],
            "padded-blocks": ["error", "never"],
            "keyword-spacing": ["error", {"before": true, "after": true}],
            "space-before-blocks": ["error", "always"],
            "indent": ["error", 4, {"SwitchCase": 1}],
            "no-tabs": "error",
            "spaced-comment": ["error", "always", {
                "line": {
                    "markers": ["//"],
                    "exceptions": ["-", "+"]
                },
                "block": {
                    "markers": ["!"],
                    "exceptions": ["*"]
                }
            }],
            "quotes": ["error", "double", {"allowTemplateLiterals": true}],

            "no-unused-vars": [
                "off",
                {
                    "vars": "all",
                    "varsIgnorePattern": "^_",
                    "args": "after-used",
                    "argsIgnorePattern": "^_"
                }
            ],
            "unused-imports/no-unused-imports": "error",
            "no-undef": "off",
            "no-empty": "error",
            "no-prototype-builtins": "off",
            "no-case-declarations": "off",
            "no-debugger": "off",
            "no-dupe-class-members": "off",
            "no-constant-binary-expression": "off",
            "getter-return": "off",
            "no-global-assign": "off",
            "no-redeclare": "off"
            // "sort-imports": ["error", {
            //     "ignoreCase": false,
            //     "ignoreDeclarationSort": false,
            //     "ignoreMemberSort": false,
            //     "memberSyntaxSortOrder": ["none", "all", "multiple", "single"],
            //     "allowSeparatedGroups": false
            // }]
        }
    }
];
