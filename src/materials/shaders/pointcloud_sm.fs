// * ********************************************************************************************************* *
// *
// * Copyright 2011-2020 Markus Schütz
// * Copyright 2025 Oidis
// *
// * SPDX-License-Identifier: BSD-2-Clause
// * The BSD-2-Clause license for this file can be found in the LICENSE.txt file included with this distribution
// * or at https://spdx.org/licenses/BSD-2-Clause.html#licenseText
// *
// * ********************************************************************************************************* */

precision mediump float;
precision mediump int;

varying vec3 vColor;
varying float vLinearDepth;

void main() {

    //gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0);
    //gl_FragColor = vec4(vColor, 1.0);
    //gl_FragColor = vec4(vLinearDepth, pow(vLinearDepth, 2.0), 0.0, 1.0);
    gl_FragColor = vec4(vLinearDepth, vLinearDepth / 30.0, vLinearDepth / 30.0, 1.0);

}
