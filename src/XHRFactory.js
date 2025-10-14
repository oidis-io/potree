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

import { Fetcher } from "./utils/Fetcher";

const XHRFactory = {
    config: {
        withCredentials: false,
        customHeaders: [
            {header: null, value: null}
        ]
    },

    createXMLHttpRequest: function () {
        let xhr = new XMLHttpRequest();

        const globHeaders = Fetcher.getHeaders();
        if (globHeaders) {
            this.config.customHeaders = [];
            for (const key of Object.keys(globHeaders)) {
                this.config.customHeaders.push({header: key, value: globHeaders[key]});
            }
        }

        if (this.config.customHeaders && Array.isArray(this.config.customHeaders) && this.config.customHeaders.length > 0) {
            let baseOpen = xhr.open;
            let customHeaders = this.config.customHeaders;
            xhr.open = function () {
                baseOpen.apply(this, [].slice.call(arguments));
                customHeaders.forEach(function (customHeader) {
                    if (!!customHeader.header && !!customHeader.value) {
                        xhr.setRequestHeader(customHeader.header, customHeader.value);
                    }
                });
            };
        }

        return xhr;
    }
};

export { XHRFactory };
