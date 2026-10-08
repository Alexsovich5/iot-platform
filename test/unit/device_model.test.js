'use strict';

var expect = require('chai').expect;
var Device = require('../../src/models/device');
var ids = require('../../src/lib/ids');

function valid(overrides) {
    var doc = {deviceId: 'sensor-01', name: 'Sensor 1', type: 'sensor'};
    Object.keys(overrides || {}).forEach(function(k) {
        doc[k] = overrides[k];
    });
    return new Device(doc);
}

describe('Device model', function() {
    it('accepts a minimal valid device', function() {
        expect(valid().validateSync()).to.equal(undefined);
    });

    it('fails without a name', function() {
        var err = valid({name: undefined}).validateSync();
        expect(err.errors).to.have.property('name');
    });

    it('fails with a bad type', function() {
        var err = valid({type: 'toaster'}).validateSync();
        expect(err.errors).to.have.property('type');
    });

    it('fails with a bad status', function() {
        var err = valid({status: 'asleep'}).validateSync();
        expect(err.errors).to.have.property('status');
    });

    it('fails with a bad provisionedBy', function() {
        var err = valid({provisionedBy: 'fax'}).validateSync();
        expect(err.errors).to.have.property('provisionedBy');
    });

    it('accepts provisionedBy api and mqtt', function() {
        expect(valid({provisionedBy: 'api'}).validateSync()).to.equal(undefined);
        expect(valid({provisionedBy: 'mqtt'}).validateSync()).to.equal(undefined);
    });

    it('fails when deviceId does not match DEVICE_ID_RE', function() {
        ['has space', 'a/b', '', new Array(66).join('x')].forEach(function(id) {
            expect(ids.DEVICE_ID_RE.test(id)).to.equal(false);
            var err = valid({deviceId: id}).validateSync();
            expect(err, id).to.not.equal(undefined);
            expect(err.errors).to.have.property('deviceId');
        });
    });

    it('accepts a 64 character deviceId of letters, digits, _ and -', function() {
        var id = new Array(61).join('a') + 'B_9-';
        expect(id.length).to.equal(64);
        expect(valid({deviceId: id}).validateSync()).to.equal(undefined);
    });

    it('declares tokenHash with select: false', function() {
        expect(Device.schema.path('tokenHash').options.select).to.equal(false);
    });

    it('omits tokenHash and __v from toJSON', function() {
        var json = valid({tokenHash: 'abc123'}).toJSON();
        expect(json).to.not.have.property('tokenHash');
        expect(json).to.not.have.property('__v');
        expect(json.deviceId).to.equal('sensor-01');
        expect(json.name).to.equal('Sensor 1');
    });

    it('omits tokenHash from JSON.stringify output', function() {
        var parsed = JSON.parse(JSON.stringify(valid({tokenHash: 'abc123'})));
        expect(parsed).to.not.have.property('tokenHash');
    });
});
