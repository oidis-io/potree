/*! ******************************************************************************************************** *
 *
 * Copyright 2026 Oidis
 *
 * SPDX-License-Identifier: BSD-2-Clause
 * The BSD-2-Clause license for this file can be found in the LICENSE.txt file included with this distribution
 * or at https://spdx.org/licenses/BSD-2-Clause.html#licenseText
 *
 * ********************************************************************************************************* */

const LOCALES = { cs: "cs-CZ", sk: "sk-SK", pl: "pl-PL", de: "de-DE", fr: "fr-FR", es: "es-ES", it: "it-IT", pt: "pt-PT" };

/**
 * Resolves the Intl locale to use for number formatting based on the active i18n language.
 * @returns {string} Locale of the active language, "en-GB" for any language without a mapping.
 */
export function activeLocale() {
    return (typeof i18n !== "undefined" && LOCALES[i18n.lng()]) || "en-GB";
}

/**
 * Formats a number with the decimal and grouping separators of the active i18n language.
 * @param {number} value Number to format.
 * @param {number} digits Count of decimal places, always shown.
 * @returns {string} Formatted number.
 */
export function formatNumber(value, digits) {
    return value.toLocaleString(activeLocale(), { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
