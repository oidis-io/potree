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

uniform mat4 projectionMatrix;

uniform float screenWidth;
uniform float screenHeight;
uniform float near;
uniform float far;

uniform sampler2D map;

varying vec2 vUv;

void main() {

    float dx = 1.0 / screenWidth;
    float dy = 1.0 / screenHeight;

    vec3 color = vec3(0.0, 0.0, 0.0);
    color += texture2D(map, vUv + vec2(-dx, -dy)).rgb;
    color += texture2D(map, vUv + vec2(  0, -dy)).rgb;
    color += texture2D(map, vUv + vec2(+dx, -dy)).rgb;
    color += texture2D(map, vUv + vec2(-dx,   0)).rgb;
    color += texture2D(map, vUv + vec2(  0,   0)).rgb;
    color += texture2D(map, vUv + vec2(+dx,   0)).rgb;
    color += texture2D(map, vUv + vec2(-dx,  dy)).rgb;
    color += texture2D(map, vUv + vec2(  0,  dy)).rgb;
    color += texture2D(map, vUv + vec2(+dx,  dy)).rgb;

    color = color / 9.0;

    gl_FragColor = vec4(color, 1.0);
}
