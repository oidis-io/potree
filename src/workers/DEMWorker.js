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

/* global onmessage:true postMessage:false */
/* exported onmessage */
onmessage = function (event) {
    let boundingBox = event.data.boundingBox;
    let position = new Float32Array(event.data.position);
    let width = 64;
    let height = 64;
    let numPoints = position.length / 3;

    let boxSize = {
        x: boundingBox.max[0] - boundingBox.min[0],
        y: boundingBox.max[1] - boundingBox.min[1],
        z: boundingBox.max[2] - boundingBox.min[2]
    };

    let dem = new Float32Array(width * height);
    dem.fill(-Infinity);
    for (let i = 0; i < numPoints; i++) {
        let x = position[3 * i + 0];
        let y = position[3 * i + 1];
        let z = position[3 * i + 2];

        let dx = x / boxSize.x;
        let dy = y / boxSize.y;

        let ix = parseInt(Math.min(width * dx, width - 1));
        let iy = parseInt(Math.min(height * dy, height - 1));

        let index = ix + width * iy;
        dem[index] = z;
    }

    let message = {
        dem: {
            width: width,
            height: height,
            data: dem.buffer
        }
    };

    postMessage(message, [message.dem.data]);
};
