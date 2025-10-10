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

class EnumItem {
	constructor(object) {
		for (let key of Object.keys(object)) {
			this[key] = object[key];
		}
	}

	inspect() {
		return `Enum(${this.name}: ${this.value})`;
	}
}

class Enum {
	constructor(object) {
		this.object = object;

		for (let key of Object.keys(object)) {
			let value = object[key];

			if (typeof value === "object") {
				value.name = key;
			} else {
				value = {name: key, value: value};
			}

			this[key] = new EnumItem(value);
		}
	}

	fromValue(value) {
		for (let key of Object.keys(this.object)) {
			if (this[key].value === value) {
				return this[key];
			}
		}

		throw new Error(`No enum for value: ${value}`);
	}
}

export {Enum, EnumItem};
