/*! ******************************************************************************************************** *
 *
 * Copyright 2025 Oidis
 *
 * SPDX-License-Identifier: BSD-2-Clause
 * The BSD-2-Clause license for this file can be found in the LICENSE.txt file included with this distribution
 * or at https://spdx.org/licenses/BSD-2-Clause.html#licenseText
 *
 * ********************************************************************************************************* */

export class Fetcher {
    static _headers;

    static getHeaders() {
        if (Fetcher._headers === undefined) {
            Fetcher._headers = new Headers();
        }
        return Fetcher._headers;
    }

    static setHeaders(headers) {
        Fetcher._headers = headers;
    }

    static async download(request) {
        const baseHeaders = Fetcher.getHeaders();
        if (typeof request === "string") {
            return fetch(request, {
                headers: baseHeaders
            });
        } else if (request instanceof Request) {
            const requestHeaders = request.headers;
            const mergedHeaders = new Headers(baseHeaders);

            for (const [key, value] of new Headers(requestHeaders)) {
                mergedHeaders.set(key, value);
            }

            const newRequest = new Request(request, {
                method: request.method,
                body: request.body,
                headers: mergedHeaders,
                mode: request.mode,
                credentials: request.credentials,
                cache: request.cache,
                redirect: request.redirect,
                referrer: request.referrer,
                integrity: request.integrity
            });

            return fetch(newRequest);
        }

        throw new Error("Request must be either a URL string or a Request object");
    }
}
