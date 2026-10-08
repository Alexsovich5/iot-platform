'use strict';

var expect = require('chai').expect;
var chartData = require('../../../src/frontend/lib/chart_data');

function at(h, m, s) {
    return new Date(2016, 0, 15, h, m, s).toISOString();
}

describe('chart_data', function() {
    describe('toLineData', function() {
        it('formats labels as HH:MM:SS in local time', function() {
            var data = chartData.toLineData([
                {timestamp: at(3, 4, 5), temperature: 20},
                {timestamp: at(13, 45, 59), temperature: 21}
            ], 'temperature', 100);
            expect(data.labels).to.deep.equal(['03:04:05', '13:45:59']);
        });

        it('returns one dataset named after the metric with its values', function() {
            var data = chartData.toLineData([
                {timestamp: at(1, 0, 0), temperature: 20.5, humidity: 40},
                {timestamp: at(1, 0, 1), temperature: 21, humidity: 41}
            ], 'humidity', 100);
            expect(data.datasets).to.have.length(1);
            expect(data.datasets[0].label).to.equal('humidity');
            expect(data.datasets[0].data).to.deep.equal([40, 41]);
        });

        it('turns missing metric values into null', function() {
            var data = chartData.toLineData([
                {timestamp: at(1, 0, 0), temperature: 20},
                {timestamp: at(1, 0, 1), humidity: 55},
                {timestamp: at(1, 0, 2), temperature: 22}
            ], 'temperature', 100);
            expect(data.datasets[0].data).to.deep.equal([20, null, 22]);
            expect(data.labels).to.have.length(3);
        });

        it('keeps only the newest maxPoints points', function() {
            var points = [];
            for (var i = 0; i < 10; i++) {
                points.push({timestamp: at(2, 0, i), battery: i});
            }
            var data = chartData.toLineData(points, 'battery', 4);
            expect(data.datasets[0].data).to.deep.equal([6, 7, 8, 9]);
            expect(data.labels).to.deep.equal(['02:00:06', '02:00:07', '02:00:08', '02:00:09']);
        });

        it('does not mutate the input array', function() {
            var points = [
                {timestamp: at(1, 0, 0), temperature: 1},
                {timestamp: at(1, 0, 1), temperature: 2},
                {timestamp: at(1, 0, 2), temperature: 3}
            ];
            var copy = JSON.parse(JSON.stringify(points));
            chartData.toLineData(points, 'temperature', 2);
            expect(points).to.deep.equal(copy);
        });
    });

    describe('appendPoint', function() {
        it('returns a new array with the point appended', function() {
            var points = [{temperature: 1}];
            var out = chartData.appendPoint(points, {temperature: 2}, 10);
            expect(out).to.deep.equal([{temperature: 1}, {temperature: 2}]);
            expect(out).to.not.equal(points);
            expect(points).to.deep.equal([{temperature: 1}]);
        });

        it('drops the oldest points beyond max', function() {
            var points = [{v: 1}, {v: 2}, {v: 3}];
            var out = chartData.appendPoint(points, {v: 4}, 3);
            expect(out).to.deep.equal([{v: 2}, {v: 3}, {v: 4}]);
            expect(points).to.have.length(3);
            expect(points[0]).to.deep.equal({v: 1});
        });
    });
});
