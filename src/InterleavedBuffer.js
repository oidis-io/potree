/*! ******************************************************************************************************** *
 *
 * Copyright 2011-2020 Markus Schütz
 *
 * SPDX-License-Identifier: BSD-2-Clause
 * The BSD-2-Clause license for this file can be found in the LICENSE.txt file included with this distribution
 * or at https://spdx.org/licenses/BSD-2-Clause.html#licenseText
 *
 * ********************************************************************************************************* */

export class InterleavedBufferAttribute{
	
	constructor(name, bytes, numElements, type, normalized){
		this.name = name;
		this.bytes = bytes;
		this.numElements = numElements;
		this.normalized = normalized;
		this.type = type; // gl type without prefix, e.g. "FLOAT", "UNSIGNED_INT"
	}
	
};

export class InterleavedBuffer{

	constructor(data, attributes, numElements){
		this.data = data;
		this.attributes = attributes;
		this.stride = attributes.reduce( (a, att) => a + att.bytes, 0);
		this.stride = Math.ceil(this.stride / 4) * 4;
		this.numElements = numElements;
	}
	
	offset(name){
		let offset = 0;
		
		for(let att of this.attributes){
			if(att.name === name){
				return offset;
			}
			
			offset += att.bytes;
		}
		
		return null;
	}
	
};