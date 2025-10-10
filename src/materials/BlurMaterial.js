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

// see http://john-chapman-graphics.blogspot.co.at/2013/01/ssao-tutorial.html

import * as THREE from "../../libs/three.js/build/three.module.js";

Potree.BlurMaterial = class BlurMaterial extends THREE.ShaderMaterial {
	constructor(parameters = {}) {
		super();

		let uniforms = {
			near: { type: 'f', value: 0 },
			far: { type: 'f', value: 0 },
			screenWidth: { type: 'f', value: 0 },
			screenHeight: { type: 'f', value: 0 },
			map: { type: 't', value: null }
		};

		this.setValues({
			uniforms: uniforms,
			vertexShader: Potree.Shaders['blur.vs'],
			fragmentShader: Potree.Shaders['blur.fs']
		});
	}
};
