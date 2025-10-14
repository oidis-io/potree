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

precision highp float;
precision highp int;

varying vec3    vColor;

void main() {

    vec3 color = vColor;

    gl_FragColor = vec4(color, 1.0);
}
