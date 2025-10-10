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

import * as THREE from "../../libs/three.js/build/three.module.js";
import { Shaders } from "../../build/shaders/shaders.js";

export class NormalizationMaterial extends THREE.RawShaderMaterial {
    constructor(parameters = {}) {
        super();

        let uniforms = {
            uDepthMap: {type: 't', value: null},
            uWeightMap: {type: 't', value: null},
        };

        this.setValues({
            uniforms: uniforms,
            vertexShader: this.getDefines() + Shaders['normalize.vs'],
            fragmentShader: this.getDefines() + Shaders['normalize.fs'],
        });
    }

    getDefines() {
        let defines = '';

        return defines;
    }

    updateShaderSource() {
        let vs = this.getDefines() + Shaders['normalize.vs'];
        let fs = this.getDefines() + Shaders['normalize.fs'];

        this.setValues({
            vertexShader: vs,
            fragmentShader: fs
        });

        this.needsUpdate = true;
    }
}
