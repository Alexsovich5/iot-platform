/**
 * Turns telemetry readings into the {labels, datasets} shape that the
 * Chart.js 1.x Line chart expects. Neither function mutates its input.
 */

'use strict';

function pad(n) {
    return n < 10 ? '0' + n : String(n);
}

// HH:MM:SS in the browser's local time.
function timeLabel(timestamp) {
    var d = new Date(timestamp);
    if (isNaN(d.getTime())) {
        return '';
    }
    return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
}

function toLineData(points, metric, maxPoints) {
    var recent = points.slice(-maxPoints);
    return {
        labels: recent.map(function(point) {
            return timeLabel(point.timestamp);
        }),
        datasets: [{
            label: metric,
            fillColor: 'rgba(46, 125, 50, 0.15)',
            strokeColor: '#2e7d32',
            pointColor: '#2e7d32',
            pointStrokeColor: '#fff',
            data: recent.map(function(point) {
                var value = point[metric];
                return typeof value === 'number' ? value : null;
            })
        }]
    };
}

function appendPoint(points, point, max) {
    return points.concat([point]).slice(-max);
}

module.exports = {
    toLineData: toLineData,
    appendPoint: appendPoint,
    timeLabel: timeLabel
};
