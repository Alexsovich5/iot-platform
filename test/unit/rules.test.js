'use strict';

var expect = require('chai').expect;
var rules = require('../../src/lib/rules');

function rule(overrides) {
    var r = {
        _id: 'r1',
        name: 'Hot',
        metric: 'temperature',
        operator: 'gt',
        threshold: 30,
        severity: 'warning',
        cooldownSec: 300,
        enabled: true
    };
    Object.keys(overrides || {}).forEach(function(k) {
        r[k] = overrides[k];
    });
    return r;
}

var device = {deviceId: 'sensor-01', name: 'Sensor 1', type: 'sensor'};

describe('rules', function() {
    describe('compare', function() {
        var table = [
            ['gt', 31, 30, true], ['gt', 30, 30, false], ['gt', 29, 30, false],
            ['gte', 31, 30, true], ['gte', 30, 30, true], ['gte', 29, 30, false],
            ['lt', 29, 30, true], ['lt', 30, 30, false], ['lt', 31, 30, false],
            ['lte', 29, 30, true], ['lte', 30, 30, true], ['lte', 31, 30, false]
        ];

        table.forEach(function(row) {
            it(row[1] + ' ' + row[0] + ' ' + row[2] + ' is ' + row[3], function() {
                expect(rules.compare(row[0], row[1], row[2])).to.equal(row[3]);
            });
        });

        it('is false for an unknown operator', function() {
            expect(rules.compare('eq', 30, 30)).to.equal(false);
        });

        it('is false for a non-numeric value', function() {
            expect(rules.compare('gte', 'hot', 30)).to.equal(false);
            expect(rules.compare('lt', NaN, 30)).to.equal(false);
        });
    });

    describe('matchesScope', function() {
        it('matches the named device only', function() {
            expect(rules.matchesScope(rule({deviceId: 'sensor-01'}), device)).to.equal(true);
            expect(rules.matchesScope(rule({deviceId: 'sensor-02'}), device)).to.equal(false);
        });

        it('matches devices of the named type only', function() {
            expect(rules.matchesScope(rule({deviceType: 'sensor'}), device)).to.equal(true);
            expect(rules.matchesScope(rule({deviceType: 'gateway'}), device)).to.equal(false);
        });

        it('matches every device when no scope is set', function() {
            expect(rules.matchesScope(rule(), device)).to.equal(true);
            expect(rules.matchesScope(rule(), {deviceId: 'gw-9', type: 'gateway'})).to.equal(true);
        });
    });

    describe('evaluate', function() {
        var now = 1000000;

        it('returns the matching rule and the reading value', function() {
            var r = rule();
            var fired = rules.evaluate([r], device, {temperature: 35}, {}, now);
            expect(fired).to.have.length(1);
            expect(fired[0].rule).to.equal(r);
            expect(fired[0].value).to.equal(35);
        });

        it('returns nothing when the threshold is not crossed', function() {
            expect(rules.evaluate([rule()], device, {temperature: 30}, {}, now)).to.deep.equal([]);
        });

        it('skips a disabled rule', function() {
            var fired = rules.evaluate([rule({enabled: false})], device, {temperature: 35}, {}, now);
            expect(fired).to.deep.equal([]);
        });

        it('skips a rule whose metric is absent from the reading', function() {
            var fired = rules.evaluate([rule({metric: 'humidity'})], device, {temperature: 35}, {}, now);
            expect(fired).to.deep.equal([]);
        });

        it('skips a rule scoped to another device', function() {
            var fired = rules.evaluate([rule({deviceId: 'sensor-02'})], device, {temperature: 35}, {}, now);
            expect(fired).to.deep.equal([]);
        });

        it('suppresses a rule inside its cooldown and fires again after it', function() {
            var r = rule({cooldownSec: 60});
            var lastFired = {};
            expect(rules.evaluate([r], device, {temperature: 35}, lastFired, now)).to.have.length(1);
            expect(rules.evaluate([r], device, {temperature: 36}, lastFired, now + 59999)).to.deep.equal([]);
            expect(rules.evaluate([r], device, {temperature: 37}, lastFired, now + 60000)).to.have.length(1);
        });

        it('keeps the cooldown separate per device', function() {
            var r = rule({cooldownSec: 60});
            var lastFired = {};
            var other = {deviceId: 'sensor-02', type: 'sensor'};
            expect(rules.evaluate([r], device, {temperature: 35}, lastFired, now)).to.have.length(1);
            expect(rules.evaluate([r], other, {temperature: 35}, lastFired, now + 1)).to.have.length(1);
        });

        it('fires multiple rules together', function() {
            var hot = rule({_id: 'a'});
            var low = rule({_id: 'b', metric: 'battery', operator: 'lt', threshold: 20});
            var damp = rule({_id: 'c', metric: 'humidity', operator: 'gte', threshold: 90});
            var fired = rules.evaluate([hot, low, damp], device,
                {temperature: 35, battery: 10, humidity: 50}, {}, now);
            expect(fired.map(function(f) { return f.rule; })).to.deep.equal([hot, low]);
            expect(fired.map(function(f) { return f.value; })).to.deep.equal([35, 10]);
        });
    });

    describe('formatMessage', function() {
        it('names the device, metric, value, operator and threshold', function() {
            var msg = rules.formatMessage(rule(), device, 35);
            expect(msg).to.equal('Hot: sensor-01 temperature 35 > 30');
        });

        it('uses the symbol of each operator', function() {
            expect(rules.formatMessage(rule({operator: 'lte', name: 'Low'}), device, 5))
                .to.equal('Low: sensor-01 temperature 5 <= 30');
        });
    });
});
