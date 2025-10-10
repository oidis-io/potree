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

import {EventDispatcher} from "./EventDispatcher.js";

export class Action extends EventDispatcher {
	constructor (args = {}) {
		super();

		this.icon = args.icon || '';
		this.tooltip = args.tooltip;

		if (args.onclick !== undefined) {
			this.onclick = args.onclick;
		}
	}

	onclick (event) {

	}

	pairWith (object) {

	}

	setIcon (newIcon) {
		let oldIcon = this.icon;

		if (newIcon === oldIcon) {
			return;
		}

		this.icon = newIcon;

		this.dispatchEvent({
			type: 'icon_changed',
			action: this,
			icon: newIcon,
			oldIcon: oldIcon
		});
	}
}

//Potree.Actions = {};
//
//Potree.Actions.ToggleAnnotationVisibility = class ToggleAnnotationVisibility extends Potree.Action {
//	constructor (args = {}) {
//		super(args);
//
//		this.icon = Potree.resourcePath + '/icons/eye.svg';
//		this.showIn = 'sidebar';
//		this.tooltip = 'toggle visibility';
//	}
//
//	pairWith (annotation) {
//		if (annotation.visible) {
//			this.setIcon(Potree.resourcePath + '/icons/eye.svg');
//		} else {
//			this.setIcon(Potree.resourcePath + '/icons/eye_crossed.svg');
//		}
//
//		annotation.addEventListener('visibility_changed', e => {
//			let annotation = e.annotation;
//
//			if (annotation.visible) {
//				this.setIcon(Potree.resourcePath + '/icons/eye.svg');
//			} else {
//				this.setIcon(Potree.resourcePath + '/icons/eye_crossed.svg');
//			}
//		});
//	}
//
//	onclick (event) {
//		let annotation = event.annotation;
//
//		annotation.visible = !annotation.visible;
//
//		if (annotation.visible) {
//			this.setIcon(Potree.resourcePath + '/icons/eye.svg');
//		} else {
//			this.setIcon(Potree.resourcePath + '/icons/eye_crossed.svg');
//		}
//	}
//};
