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

// window = { };
// document = { };
// importScripts('/libs/zstd-codec/bundle.js', '/libs/ept/ParseBuffer.js');

onmessage = async function (event) {
    const zstd = await new Promise(resolve => window.ZstdCodec.run(resolve));

    const streaming = new zstd.Streaming();
    const arr = new Uint8Array(event.data.buffer);
    const decompressed = streaming.decompress(arr);

    event.data.buffer = decompressed.buffer;
    parseEpt(event);
};
