'use strict';

var expect = require('chai').expect;
var Device = require('../../src/models/device');
var Presence = require('../../src/lib/presence');
var FakeIo = require('../support/fake_io');
var db = require('../support/db');

describe('Presence sweep against MongoDB', function() {
    var io;
    var presence;

    beforeEach(function(done) {
        io = new FakeIo();
        presence = new Presence({Device: Device, io: io, offlineAfterSec: 120, intervalSec: 30});
        db.reset(function(err) {
            if (err) {
                return done(err);
            }
            Device.create([
                {deviceId: 'stale-1', name: 'Stale', status: 'online',
                    lastSeen: new Date(Date.now() - 10 * 60 * 1000)},
                {deviceId: 'fresh-1', name: 'Fresh', status: 'online', lastSeen: new Date()},
                {deviceId: 'maint-1', name: 'Maintenance', status: 'maintenance',
                    lastSeen: new Date(Date.now() - 10 * 60 * 1000)}
            ], done);
        });
    });

    afterEach(function() {
        presence.stop();
    });

    it('marks only the silent online device offline', function(done) {
        presence.sweep(function(err, count) {
            if (err) {
                return done(err);
            }
            expect(count).to.equal(1);
            Device.find({}).sort({deviceId: 1}).exec(function(findErr, devices) {
                if (findErr) {
                    return done(findErr);
                }
                var byId = {};
                devices.forEach(function(d) {
                    byId[d.deviceId] = d.status;
                });
                expect(byId).to.deep.equal({
                    'fresh-1': 'online',
                    'maint-1': 'maintenance',
                    'stale-1': 'offline'
                });
                expect(io.emittedTo(null, 'status')).to.deep.equal([
                    {room: null, event: 'status', data: {deviceId: 'stale-1', data: {status: 'offline'}}}
                ]);
                done();
            });
        });
    });

    it('does nothing on a second sweep', function(done) {
        presence.sweep(function(err) {
            if (err) {
                return done(err);
            }
            presence.sweep(function(err2, count) {
                expect(err2).to.not.exist;
                expect(count).to.equal(0);
                expect(io.emitted).to.have.length(1);
                done();
            });
        });
    });
});
