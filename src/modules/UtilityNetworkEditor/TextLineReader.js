/*! ******************************************************************************************************** *
 *
 * Copyright 2026 Oidis
 *
 * SPDX-License-Identifier: BSD-2-Clause
 * The BSD-2-Clause license for this file can be found in the LICENSE.txt file included with this distribution
 * or at https://spdx.org/licenses/BSD-2-Clause.html#licenseText
 *
 * ********************************************************************************************************* */

const CHUNK_BYTES = 4 * 1024 * 1024;

export async function forEachLine(file, startOffset, onLine, onProgress) {
    const decoder = new TextDecoder("utf-8");
    const byteCount = Math.max(1, file.size - startOffset);
    let remainder = "";
    for (let offset = startOffset; offset < file.size; offset += CHUNK_BYTES) {
        const chunkEnd = Math.min(file.size, offset + CHUNK_BYTES);
        const text = remainder + decoder.decode(await file.slice(offset, chunkEnd).arrayBuffer(), { stream: true });
        const lines = text.split("\n");
        remainder = lines.pop();
        for (const line of lines) {
            if (onLine(line) === false) {
                return;
            }
        }
        onProgress?.((chunkEnd - startOffset) / byteCount);
    }
    const lastLine = remainder + decoder.decode();
    if (lastLine !== "") {
        onLine(lastLine);
    }
}
