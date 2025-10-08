/*! ******************************************************************************************************** *
 *
 * Copyright 2011-2020 Markus Schütz
 *
 * SPDX-License-Identifier: BSD-2-Clause
 * The BSD-2-Clause license for this file can be found in the LICENSE.txt file included with this distribution
 * or at https://spdx.org/licenses/BSD-2-Clause.html#licenseText
 *
 * ********************************************************************************************************* */

export class Message{

	constructor(content){
		this.content = content;

		let closeIcon = `${exports.resourcePath}/icons/close.svg`;

		this.element = $(`
			<div class="potree_message">
				<span name="content_container" style="flex-grow: 1; padding: 5px"></span>
				<img name="close" src="${closeIcon}" class="button-icon" style="width: 16px; height: 16px;">
			</div>`);

		this.elClose = this.element.find("img[name=close]");

		this.elContainer = this.element.find("span[name=content_container]");

		if(typeof content === "string"){
			this.elContainer.append($(`<span>${content}</span>`));
		}else{
			this.elContainer.append(content);
		}

	}

	setMessage(content){
		this.elContainer.empty();
		if(typeof content === "string"){
			this.elContainer.append($(`<span>${content}</span>`));
		}else{
			this.elContainer.append(content);
		}
	}

}