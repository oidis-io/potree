/*! ******************************************************************************************************** *
 *
 * Copyright 2011-2020 Markus Schütz
 *
 * SPDX-License-Identifier: BSD-2-Clause
 * The BSD-2-Clause license for this file can be found in the LICENSE.txt file included with this distribution
 * or at https://spdx.org/licenses/BSD-2-Clause.html#licenseText
 *
 * ********************************************************************************************************* */

import * as THREE from "../../libs/three.js/build/three.module.js";

import {Utils} from "../utils.js";

export class Compass{

	constructor(viewer){
		this.viewer = viewer;

		this.visible = false;
		this.dom = this.createElement();

		viewer.addEventListener("update", () => {
			const direction = viewer.scene.view.direction.clone();
			direction.z = 0;
			direction.normalize();

			const camera = viewer.scene.getActiveCamera();

			const p1 = camera.getWorldPosition(new THREE.Vector3());
			const p2 = p1.clone().add(direction);

			const projection = viewer.getProjection();
			const azimuth = Utils.computeAzimuth(p1, p2, projection);
			
			this.dom.css("transform", `rotateZ(${-azimuth}rad)`);
		});

		this.dom.click( () => {
			viewer.setTopView();
		});

		const renderArea = $(viewer.renderArea);
		renderArea.append(this.dom);

		this.setVisible(this.visible);
	}

	setVisible(visible){
		this.visible = visible;

		const value = visible ? "" : "none";
		this.dom.css("display", value);
	}

	isVisible(){
		return this.visible;
	}

	createElement(){
		const style = `style="position: absolute; top: 10px; right: 10px; z-index: 10000; width: 64px;"`;
		const img = $(`<img src="${Potree.resourcePath}/images/compas.svg" ${style} />`);

		return img;
	}

};