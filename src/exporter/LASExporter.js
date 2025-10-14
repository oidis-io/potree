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

export class LASExporter {
    static toLAS(points) {
        // TODO Unused: let string = '';

        let boundingBox = points.boundingBox;
        let offset = boundingBox.min.clone();
        let diagonal = boundingBox.min.distanceTo(boundingBox.max);
        let scale = new THREE.Vector3(0.001, 0.001, 0.001);
        if (diagonal > 1000 * 1000) {
            scale = new THREE.Vector3(0.01, 0.01, 0.01);
        } else {
            scale = new THREE.Vector3(0.001, 0.001, 0.001);
        }

        let setString = function (string, offset, buffer) {
            let view = new Uint8Array(buffer);

            for (let i = 0; i < string.length; i++) {
                let charCode = string.charCodeAt(i);
                view[offset + i] = charCode;
            }
        };

        let buffer = new ArrayBuffer(227 + 28 * points.numPoints);
        let view = new DataView(buffer);
        let u8View = new Uint8Array(buffer);

        setString("LASF", 0, buffer);
        u8View[24] = 1;
        u8View[25] = 2;

        setString("Potree 1.7", 58, buffer);

        view.setUint16(94, 227, true);
        view.setUint32(96, 227, true);

        u8View[104] = 2;

        view.setUint16(105, 28, true);
        view.setUint32(107, points.numPoints, true);
        view.setFloat64(131, scale.x, true);
        view.setFloat64(139, scale.y, true);
        view.setFloat64(147, scale.z, true);
        view.setFloat64(155, offset.x, true);
        view.setFloat64(163, offset.y, true);
        view.setFloat64(171, offset.z, true);
        view.setFloat64(179, boundingBox.max.x, true);
        view.setFloat64(187, boundingBox.min.x, true);
        view.setFloat64(195, boundingBox.max.y, true);
        view.setFloat64(203, boundingBox.min.y, true);
        view.setFloat64(211, boundingBox.max.z, true);
        view.setFloat64(219, boundingBox.min.z, true);

        let boffset = 227;
        for (let i = 0; i < points.numPoints; i++) {
            let px = points.data.position[3 * i + 0];
            let py = points.data.position[3 * i + 1];
            let pz = points.data.position[3 * i + 2];

            let ux = parseInt((px - offset.x) / scale.x);
            let uy = parseInt((py - offset.y) / scale.y);
            let uz = parseInt((pz - offset.z) / scale.z);

            view.setUint32(boffset + 0, ux, true);
            view.setUint32(boffset + 4, uy, true);
            view.setUint32(boffset + 8, uz, true);

            if (points.data.intensity) {
                view.setUint16(boffset + 12, (points.data.intensity[i]), true);
            }

            let rt = 0;
            if (points.data.returnNumber) {
                rt += points.data.returnNumber[i];
            }
            if (points.data.numberOfReturns) {
                rt += (points.data.numberOfReturns[i] << 3);
            }
            view.setUint8(boffset + 14, rt);

            if (points.data.classification) {
                view.setUint8(boffset + 15, points.data.classification[i]);
            }
            if (points.data.pointSourceID) {
                view.setUint16(boffset + 18, points.data.pointSourceID[i]);
            }

            if (points.data.rgba || points.data.color) {
                let rgba = points.data.rgba ?? points.data.color;
                view.setUint16(boffset + 20, (rgba[4 * i + 0] * 255), true);
                view.setUint16(boffset + 22, (rgba[4 * i + 1] * 255), true);
                view.setUint16(boffset + 24, (rgba[4 * i + 2] * 255), true);
            }

            boffset += 28;
        }

        return buffer;
    }
}
