/*! ******************************************************************************************************** *
 *
 * Copyright 2026 Oidis
 *
 * SPDX-License-Identifier: BSD-2-Clause
 * The BSD-2-Clause license for this file can be found in the LICENSE.txt file included with this distribution
 * or at https://spdx.org/licenses/BSD-2-Clause.html#licenseText
 *
 * ********************************************************************************************************* */

export class ToolContextMenu {
    constructor(onBeforeShow) {
        this.onBeforeShow = onBeforeShow;
        this.el = document.createElement("div");
        this.el.className = "potree-cubature-menu";
        this.el.style.cssText = [
            "position: absolute",
            "display: none",
            "z-index: 10000",
            "background: rgba(0,0,0,0.85)",
            "color: white",
            "padding: 4px 0",
            "border-radius: 4px",
            "font-size: 14px",
            "font-family: Arial, sans-serif",
            "user-select: none",
            "min-width: 160px"
        ].join("; ");
        this.onOutside = (e) => {
            if (!this.el.contains(e.target)) {
                this.hide();
            }
        };
        document.body.appendChild(this.el);
    }

    show(x, y, items) {
        this.onBeforeShow();
        const el = this.el;
        while (el.firstChild) {
            el.removeChild(el.firstChild);
        }
        for (const item of items) {
            const row = document.createElement("div");
            row.textContent = item.label;
            row.style.cssText = "padding: 6px 16px; cursor: pointer;";
            row.addEventListener("mouseenter", () => {
                row.style.background = "rgba(255,255,255,0.15)";
            });
            row.addEventListener("mouseleave", () => {
                row.style.background = "";
            });
            row.addEventListener("click", () => {
                item.action();
                this.hide();
            });
            el.appendChild(row);
        }
        el.style.left = "0px";
        el.style.top = "0px";
        el.style.visibility = "hidden";
        el.style.display = "block";
        const rect = el.getBoundingClientRect();
        const clampedX = Math.min(Math.max(0, x), Math.max(0, window.innerWidth - rect.width - 4));
        const clampedY = Math.min(Math.max(0, y), Math.max(0, window.innerHeight - rect.height - 4));
        el.style.left = clampedX + "px";
        el.style.top = clampedY + "px";
        el.style.visibility = "";
        setTimeout(() => {
            document.addEventListener("mousedown", this.onOutside, true);
        }, 0);
    }

    hide() {
        this.el.style.display = "none";
        document.removeEventListener("mousedown", this.onOutside, true);
    }

    dispose() {
        this.hide();
        if (this.el.parentNode) {
            this.el.parentNode.removeChild(this.el);
        }
    }
}
