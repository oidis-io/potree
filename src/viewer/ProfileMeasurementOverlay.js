/*! ******************************************************************************************************** *
 *
 * Copyright 2026 Oidis
 *
 * SPDX-License-Identifier: BSD-2-Clause
 * The BSD-2-Clause license for this file can be found in the LICENSE.txt file included with this distribution
 * or at https://spdx.org/licenses/BSD-2-Clause.html#licenseText
 *
 * ********************************************************************************************************* */

import * as THREE from "../../libs/three.js/build/three.module.js";
import { Utils } from "../utils.js";
import { ProfileProjection } from "./ProfileProjection.js";

const MARKER_RADIUS = 4;
const LABEL_OFFSET = 12;
const ANGLE_LABEL_DISTANCE = 20;
const MEASUREMENT_EVENTS = ["marker_added", "marker_removed", "marker_moved"];

export class ProfileMeasurementOverlay {
    constructor(profileControl, svg) {
        this.profileControl = profileControl;
        this.svg = svg;
        this.profile = null;
        this.scene = null;
        this.updateRequested = false;
        this.labelsVisibleWhenDrawn = new Map();

        this.onMeasurementChanged = () => {
            this.requestUpdate();
        };
        this.onMeasurementAdded = event => {
            this.observeMeasurement(event.measurement);
            this.requestUpdate();
        };
        this.onMeasurementRemoved = event => {
            this.unobserveMeasurement(event.measurement);
            this.requestUpdate();
        };
        this.onViewerUpdate = () => {
            if (this.hasLabelsVisibilityChanged()) {
                this.requestUpdate();
            }
        };

        this.observeScene(profileControl.viewer.scene);
        profileControl.viewer.addEventListener("scene_changed", event => {
            this.observeScene(event.scene);
        });
        profileControl.viewer.addEventListener("update", this.onViewerUpdate);
    }

    setProfile(profile) {
        this.profile = profile;
        this.update();
    }

    clear() {
        this.svg.selectAll("*").remove();
        this.labelsVisibleWhenDrawn.clear();
    }

    requestUpdate() {
        if (this.updateRequested) {
            return;
        }
        this.updateRequested = true;
        requestAnimationFrame(() => {
            this.updateRequested = false;
            this.update();
        });
    }

    update() {
        this.clear();

        const control = this.profileControl;
        if (!control.enabled || this.profile === null || !control.scaleX || this.svg.empty()) {
            return;
        }

        const projection = new ProfileProjection(this.profile.points, this.profile.width);
        for (const measurement of this.scene.measurements) {
            if (!this.isSupported(measurement)) {
                continue;
            }
            const projectedPoints = measurement.points.map(point => projection.project(point.position));
            if (projectedPoints.every(point => point !== null)) {
                const labelsVisible = this.areLabelsVisible(measurement);
                this.labelsVisibleWhenDrawn.set(measurement, labelsVisible);
                this.drawMeasurement(measurement, projectedPoints.map(point => this.toScreen(point)), labelsVisible);
            }
        }
    }

    observeScene(scene) {
        if (this.scene !== null) {
            this.scene.removeEventListener("measurement_added", this.onMeasurementAdded);
            this.scene.removeEventListener("measurement_removed", this.onMeasurementRemoved);
            this.scene.measurements.forEach(measurement => this.unobserveMeasurement(measurement));
        }

        this.scene = scene;
        scene.addEventListener("measurement_added", this.onMeasurementAdded);
        scene.addEventListener("measurement_removed", this.onMeasurementRemoved);
        scene.measurements.forEach(measurement => this.observeMeasurement(measurement));

        this.update();
    }

    observeMeasurement(measurement) {
        MEASUREMENT_EVENTS.forEach(type => measurement.addEventListener(type, this.onMeasurementChanged));
    }

    unobserveMeasurement(measurement) {
        MEASUREMENT_EVENTS.forEach(type => measurement.removeEventListener(type, this.onMeasurementChanged));
    }

    isSupported(measurement) {
        if (measurement.visible === false || measurement.points.length === 0) {
            return false;
        }
        if (measurement.showArea || measurement.showCircle || measurement.showAzimuth || measurement.showRectangle) {
            return false;
        }
        return measurement.showEdges || measurement.showDistances || measurement.showHeight ||
            measurement.showAngles || measurement.showCoordinates;
    }

    areLabelsVisible(measurement) {
        const measuringTool = this.profileControl.viewer.measuringTool;
        if (measuringTool && measuringTool.showLabels === false) {
            return false;
        }
        return measurement.permanentLabelsVisible !== false || measurement.isRevealed();
    }

    hasLabelsVisibilityChanged() {
        for (const [measurement, labelsVisible] of this.labelsVisibleWhenDrawn) {
            if (this.areLabelsVisible(measurement) !== labelsVisible) {
                return true;
            }
        }
        return false;
    }

    toScreen(point) {
        return {
            x: this.profileControl.scaleX(point.mileage),
            y: this.profileControl.scaleY(point.elevation)
        };
    }

    drawMeasurement(measurement, points, labelsVisible) {
        const color = `#${new THREE.Color(measurement.color).getHexString()}`;
        const group = this.svg.append("g").attr("class", "profile-measurement");

        if (measurement.showEdges && points.length > 1) {
            const edgePoints = measurement.closed ? [...points, points[0]] : points;
            this.drawPolyline(group, edgePoints, "profile-measurement-edge", color);
        }
        if (measurement.showHeight && points.length > 1) {
            const heightPath = this.getHeightPath(points);
            this.drawPolyline(group, [heightPath.low, heightPath.corner, heightPath.high], "profile-measurement-height", color);
        }
        if (measurement.showMarkers) {
            this.drawMarkers(group, points, color);
        }

        if (!labelsVisible) {
            return;
        }
        if (measurement.showDistances) {
            this.drawDistanceLabels(group, measurement, points);
        }
        if (measurement.showHeight && points.length > 1) {
            this.drawHeightLabel(group, measurement, points);
        }
        if (measurement.showAngles) {
            this.drawAngleLabels(group, measurement, points);
        }
        if (measurement.showCoordinates) {
            this.drawElevationLabels(group, measurement, points);
        }
    }

    drawPolyline(group, points, className, color) {
        group.append("polyline")
            .attr("class", className)
            .attr("points", points.map(point => `${point.x},${point.y}`).join(" "))
            .attr("stroke", color);
    }

    drawMarkers(group, points, color) {
        points.forEach(point => {
            group.append("circle")
                .attr("class", "profile-measurement-marker")
                .attr("cx", point.x)
                .attr("cy", point.y)
                .attr("r", MARKER_RADIUS)
                .attr("fill", color);
        });
    }

    drawLabel(group, text, x, y, anchor) {
        group.append("text")
            .attr("class", "profile-measurement-label")
            .attr("x", x)
            .attr("y", y)
            .attr("text-anchor", anchor)
            .text(text);
    }

    drawDistanceLabels(group, measurement, points) {
        const edgeCount = measurement.closed ? points.length : points.length - 1;
        for (let index = 0; index < edgeCount; index++) {
            const nextIndex = (index + 1) % points.length;
            const length = measurement.points[index].position.distanceTo(measurement.points[nextIndex].position);
            if (length === 0) {
                continue;
            }
            const start = points[index];
            const end = points[nextIndex];
            this.drawLabel(group, measurement.edgeLabels[index].text,
                (start.x + end.x) / 2, (start.y + end.y) / 2 - LABEL_OFFSET, "middle");
        }

        if (edgeCount > 1) {
            const lastPoint = points[points.length - 1];
            this.drawLabel(group, `Σ ${measurement.totalLabel.text}`, lastPoint.x + LABEL_OFFSET, lastPoint.y, "start");
        }
    }

    getHeightPath(points) {
        const low = points.reduce((lowest, point) => (point.y > lowest.y ? point : lowest));
        const high = points.reduce((highest, point) => (point.y < highest.y ? point : highest));
        return { low: low, corner: { x: high.x, y: low.y }, high: high };
    }

    drawHeightLabel(group, measurement, points) {
        const heightPath = this.getHeightPath(points);
        this.drawLabel(group, measurement.heightLabel.text,
            heightPath.corner.x + LABEL_OFFSET, (heightPath.corner.y + heightPath.high.y) / 2, "start");
    }

    drawAngleLabels(group, measurement, points) {
        if (points.length < 3) {
            return;
        }
        const firstIndex = measurement.closed ? 0 : 1;
        const lastIndex = measurement.closed ? points.length - 1 : points.length - 2;
        for (let index = firstIndex; index <= lastIndex; index++) {
            if (measurement.getAngle(index) === 0) {
                continue;
            }
            const vertex = points[index];
            const previous = points[(index - 1 + points.length) % points.length];
            const next = points[(index + 1) % points.length];
            const direction = this.getBisectorDirection(vertex, previous, next);
            this.drawLabel(group, measurement.angleLabels[index].text,
                vertex.x + direction.x * ANGLE_LABEL_DISTANCE, vertex.y + direction.y * ANGLE_LABEL_DISTANCE, "middle");
        }
    }

    getBisectorDirection(vertex, previous, next) {
        const directionX = (previous.x + next.x) / 2 - vertex.x;
        const directionY = (previous.y + next.y) / 2 - vertex.y;
        const length = Math.hypot(directionX, directionY);
        if (length === 0) {
            return { x: 0, y: -1 };
        }
        return { x: directionX / length, y: directionY / length };
    }

    drawElevationLabels(group, measurement, points) {
        points.forEach((point, index) => {
            const elevation = measurement.points[index].position.z;
            this.drawLabel(group, Utils.addCommas(elevation.toFixed(2)),
                point.x, point.y - MARKER_RADIUS - LABEL_OFFSET, "middle");
        });
    }
}
