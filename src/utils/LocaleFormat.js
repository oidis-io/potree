/*! ******************************************************************************************************** *
 *
 * Copyright 2026 Oidis
 *
 * SPDX-License-Identifier: BSD-2-Clause
 * The BSD-2-Clause license for this file can be found in the LICENSE.txt file included with this distribution
 * or at https://spdx.org/licenses/BSD-2-Clause.html#licenseText
 *
 * ********************************************************************************************************* */

/**
 * Resolves the Intl locale to use for number formatting based on the active i18n language.
 * @returns {string} "cs-CZ" when the active language is Czech, "en-GB" otherwise.
 */
export function activeLocale() {
    return (typeof i18n !== "undefined" && i18n.lng() === "cs") ? "cs-CZ" : "en-GB";
}
