'use strict';

var expect = require('chai').expect;
var Rule = require('../../src/models/rule');
var Alert = require('../../src/models/alert');

function valid(overrides) {
    var doc = {name: 'Hot', metric: 'temperature', operator: 'gt', threshold: 30};
    Object.keys(overrides || {}).forEach(function(k) {
        doc[k] = overrides[k];
    });
    return new Rule(doc);
}

describe('Rule model', function() {
    it('accepts a global rule and applies defaults', function() {
        var r = valid();
        expect(r.validateSync()).to.equal(undefined);
        expect(r.severity).to.equal('warning');
        expect(r.cooldownSec).to.equal(300);
        expect(r.enabled).to.equal(true);
    });

    it('accepts a deviceId scope or a deviceType scope', function() {
        expect(valid({deviceId: 'sensor-01'}).validateSync()).to.equal(undefined);
        expect(valid({deviceType: 'sensor'}).validateSync()).to.equal(undefined);
    });

    it('rejects a bad operator', function() {
        var err = valid({operator: 'eq'}).validateSync();
        expect(err.errors).to.have.property('operator');
    });

    it('rejects a bad metric', function() {
        var err = valid({metric: 'voltage'}).validateSync();
        expect(err.errors).to.have.property('metric');
    });

    it('rejects a missing threshold', function() {
        var err = valid({threshold: undefined}).validateSync();
        expect(err.errors).to.have.property('threshold');
    });

    it('rejects having both deviceId and deviceType', function() {
        var err = valid({deviceId: 'sensor-01', deviceType: 'sensor'}).validateSync();
        expect(err.errors).to.have.property('deviceType');
        expect(err.errors.deviceType.message).to.equal('deviceId and deviceType are mutually exclusive');
    });
});

describe('Alert model', function() {
    it('accepts a rule alert and defaults acknowledged to false', function() {
        var a = new Alert({deviceId: 'sensor-01', source: 'rule', severity: 'warning',
            message: 'hot', metric: 'temperature', value: 35, threshold: 30});
        expect(a.validateSync()).to.equal(undefined);
        expect(a.acknowledged).to.equal(false);
        expect(a.ruleId).to.equal(null);
    });

    it('rejects an unknown source', function() {
        var err = new Alert({deviceId: 'sensor-01', source: 'cron', message: 'x'}).validateSync();
        expect(err.errors).to.have.property('source');
    });
});
