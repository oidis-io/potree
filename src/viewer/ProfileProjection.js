/*! ******************************************************************************************************** *
 *
 * Copyright 2026 Oidis
 *
 * SPDX-License-Identifier: BSD-2-Clause
 * The BSD-2-Clause license for this file can be found in the LICENSE.txt file included with this distribution
 * or at https://spdx.org/licenses/BSD-2-Clause.html#licenseText
 *
 * ********************************************************************************************************* */

export class ProfileProjection {
    constructor(profilePoints, width) {
        this.halfWidth = width / 2;
        this.segments = [];

        let startMileage = 0;
        for (let index = 0; index < profilePoints.length - 1; index++) {
            const start = profilePoints[index];
            const end = profilePoints[index + 1];
            const deltaX = end.x - start.x;
            const deltaY = end.y - start.y;
            const length = Math.hypot(deltaX, deltaY);
            if (length === 0) {
                continue;
            }
            this.segments.push({
                startX: start.x,
                startY: start.y,
                directionX: deltaX / length,
                directionY: deltaY / length,
                length: length,
                startMileage: startMileage
            });
            startMileage += length;
        }
    }

    project(position) {
        let closest = null;
        for (const segment of this.segments) {
            const offsetX = position.x - segment.startX;
            const offsetY = position.y - segment.startY;
            const along = offsetX * segment.directionX + offsetY * segment.directionY;
            const clampedAlong = Math.min(Math.max(along, 0), segment.length);
            const across = offsetX * segment.directionY - offsetY * segment.directionX;
            const distance = Math.hypot(along - clampedAlong, across);
            if (closest === null || distance < closest.distance) {
                closest = { distance: distance, mileage: segment.startMileage + clampedAlong };
            }
        }

        if (closest === null || closest.distance > this.halfWidth) {
            return null;
        }
        return { mileage: closest.mileage, elevation: position.z };
    }
}
