/*! ******************************************************************************************************** *
 *
 * Copyright 2026 Oidis
 *
 * SPDX-License-Identifier: BSD-2-Clause
 * The BSD-2-Clause license for this file can be found in the LICENSE.txt file included with this distribution
 * or at https://spdx.org/licenses/BSD-2-Clause.html#licenseText
 *
 * ********************************************************************************************************* */

export const SELECTED_VERTEX_SCALE = 1.5;
const SELECTED_VERTEX_EMISSIVE = 0xff8800;
const HOVER_EMISSIVE = 0x888888;
// isElementSelected is set by the host application on every marker of the active object (layer highlight),
// the single selected vertex below is a separate state owned by the cubature/embankment tools.
const HOST_HIGHLIGHT_EMISSIVE = 0x888888;
const CLICK_TOLERANCE_PX = 3;

let selectedSphere = null;
let handledClick = null;

export function sphereHoverEmissive(sphere) {
    return sphere.isVertexSelected === true ? SELECTED_VERTEX_EMISSIVE : HOVER_EMISSIVE;
}

export function sphereRestEmissive(sphere) {
    if (sphere.isVertexSelected === true) {
        return SELECTED_VERTEX_EMISSIVE;
    }
    return sphere.isElementSelected === true ? HOST_HIGHLIGHT_EMISSIVE : 0x000000;
}

export function selectVertex(sphere) {
    if (selectedSphere === sphere) {
        return;
    }
    clearVertexSelection();
    selectedSphere = sphere;
    sphere.isVertexSelected = true;
    sphere.material.emissive.setHex(SELECTED_VERTEX_EMISSIVE);
}

export function clearVertexSelection() {
    if (selectedSphere === null) {
        return;
    }
    selectedSphere.isVertexSelected = false;
    selectedSphere.material.emissive.setHex(sphereRestEmissive(selectedSphere));
    selectedSphere = null;
}

export function selectedSphereIndex(spheres) {
    return spheres.findIndex((sphere) => sphere.isVertexSelected === true);
}

export function applySelectedVertexLook(sphere, baseScale) {
    const selected = sphere.isVertexSelected === true;
    const scale = selected ? baseScale * SELECTED_VERTEX_SCALE : baseScale;
    sphere.scale.set(scale, scale, scale);
    if (selected) {
        sphere.material.emissive.setHex(SELECTED_VERTEX_EMISSIVE);
    }
}

// A click is a mousedown/mouseup pair without movement, so camera drags keep the selection.
// Every tool owns a tracker; a click handled by one tool must not be cleared by the others,
// therefore clearing is deferred and skipped when another tracker has handled the same mouseup.
export function createVertexClickTracker() {
    let pressed = null;
    return {
        press(event, hit) {
            pressed = { x: event.clientX, y: event.clientY, hit };
        },
        release(event) {
            if (pressed === null) {
                return;
            }
            const { x, y, hit } = pressed;
            pressed = null;
            if (Math.hypot(event.clientX - x, event.clientY - y) > CLICK_TOLERANCE_PX) {
                return;
            }
            if (hit === null) {
                setTimeout(() => {
                    if (handledClick !== event) {
                        clearVertexSelection();
                    }
                }, 0);
                return;
            }
            handledClick = event;
            if (hit.sphere) {
                selectVertex(hit.sphere);
            }
        }
    };
}
