/*! ******************************************************************************************************** *
 *
 * Copyright 2025 Oidis
 *
 * SPDX-License-Identifier: BSD-2-Clause
 * The BSD-2-Clause license for this file can be found in the LICENSE.txt file included with this distribution
 * or at https://spdx.org/licenses/BSD-2-Clause.html#licenseText
 *
 * ********************************************************************************************************* */

import pluginJs from "@eslint/js";
import importPlugin from "eslint-plugin-import";
import unusedImports from "eslint-plugin-unused-imports";
import globals from "globals";

const jsRules = {
    semi: ["error", "always"],
    "semi-spacing": ["error", { "before": false, "after": true }],
    "semi-style": ["error", "last"],
    "camelcase": ["error", {
        "properties": "always",
        "ignoreImports": true,
        "ignoreGlobals": true,
        "ignoreDestructuring": true
    }],
    "no-var": "error",
    "no-extra-semi": "error",
    "no-multiple-empty-lines": ["error", { "max": 1, "maxEOF": 0 }],
    "eol-last": ["error", "always"],
    "padded-blocks": ["error", "never"],
    "keyword-spacing": ["error", { "before": true, "after": true }],
    "space-before-blocks": ["error", "always"],
    "indent": ["error", 4, { "SwitchCase": 1 }],
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
    "quotes": ["error", "double", { "allowTemplateLiterals": true }],
    "object-curly-spacing": ["error", "always"],
    "import/extensions": ["error", "always", {
        "js": "always",
        "mjs": "always"
    }],
    "import/order": ["error", {
        "groups": ["builtin", "external", "internal", ["parent", "sibling", "index"], "object"]
    }],

    "no-unused-vars": [
        "error",
        {
            "vars": "all",
            "varsIgnorePattern": "^_|^[A-Z]",
            "args": "none",
            "ignoreRestSiblings": false,
            "ignoreUsingDeclarations": false,
            "reportUsedIgnorePattern": false,
            "caughtErrors": "none"
        }
    ],
    "unused-imports/no-unused-imports": "error",
    "no-undef": "off",
    "no-empty": "error",
    "no-constant-binary-expression": "off",
    "getter-return": "off",
    "no-global-assign": "off",
    "no-redeclare": "off" // TODO(mkelnar) turned of because of global variables used randomly over sources - refactoring needed
};

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
            "unused-imports": unusedImports,
            "import": importPlugin
        },
        languageOptions: {
            globals: {
                "$": "readonly",
            }
        },
        rules: jsRules
    },
    {
        files: ["gulpfile.js", "rollup.*.js"],
        languageOptions: {
            globals: globals.node
        },
        plugins: {
            "unused-imports": unusedImports,
            "import": importPlugin
        },
        rules: jsRules
    }
];
