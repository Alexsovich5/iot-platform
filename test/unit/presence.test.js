'use strict';

var expect = require('chai').expect;
var sinon = require('sinon');
var Presence = require('../../src/lib/presence');
var FakeIo = require('../support/fake_io');

describe('Presence', function() {
    var clock;
    var Device;
    var io;
    var presence;

    beforeEach(function() {
        clock = sinon.useFakeTimers(new Date('2016-01-15T12:00:00Z').getTime());
        io = new FakeIo();
        Device = {
            find: sinon.stub(),
            update: sinon.stub()
        };
        Device.find.yields(null, [{deviceId: 'a1'}, {deviceId: 'b2'}]);
        Device.update.yields(null, {ok: 1, n: 2, nModified: 2});
        presence = new Presence({
            Device: Device,
            io: io,
            offlineAfterSec: 120,
            intervalSec: 30
        });
    });

    afterEach(function() {
        presence.stop();
        clock.restore();
    });

    describe('sweep', function() {
        it('selects online devices whose lastSeen is older than now - offlineAfterSec', function(done) {
            presence.sweep(function(err) {
                expect(err).to.not.exist;
                var cutoff = new Date(Date.now() - 120 * 1000);
                var query = Device.find.firstCall.args[0];
                expect(query.status).to.equal('online');
                expect(query.lastSeen.$lt.getTime()).to.equal(cutoff.getTime());
                done();
            });
        });

        it('sets the matched devices offline in one multi update', function(done) {
            presence.sweep(function(err) {
                expect(err).to.not.exist;
                var args = Device.update.firstCall.args;
                expect(args[0].status).to.equal('online');
                expect(args[0].deviceId).to.deep.equal({$in: ['a1', 'b2']});
                expect(args[0].lastSeen.$lt.getTime()).to.equal(Date.now() - 120 * 1000);
                expect(args[1]).to.deep.equal({$set: {status: 'offline'}});
                expect(args[2]).to.deep.equal({multi: true});
                done();
            });
        });

        it('emits one status event per affected device and calls back with the count', function(done) {
            presence.sweep(function(err, count) {
                expect(err).to.not.exist;
                expect(count).to.equal(2);
                var events = io.emittedTo(null, 'status');
                expect(events).to.deep.equal([
                    {room: null, event: 'status', data: {deviceId: 'a1', data: {status: 'offline'}}},
                    {room: null, event: 'status', data: {deviceId: 'b2', data: {status: 'offline'}}}
                ]);
                done();
            });
        });

        it('skips the update and emits nothing when no device is stale', function(done) {
            Device.find.yields(null, []);
            presence.sweep(function(err, count) {
                expect(err).to.not.exist;
                expect(count).to.equal(0);
                expect(Device.update.called).to.equal(false);
                expect(io.emitted).to.have.length(0);
                done();
            });
        });

        it('passes a find error to the callback', function(done) {
            Device.find.yields(new Error('db down'));
            presence.sweep(function(err) {
                expect(err.message).to.equal('db down');
                expect(io.emitted).to.have.length(0);
                done();
            });
        });
    });

    describe('start and stop', function() {
        it('sweeps once every intervalSec', function() {
            presence.start();
            expect(Device.find.callCount).to.equal(0);
            clock.tick(30 * 1000);
            expect(Device.find.callCount).to.equal(1);
            clock.tick(30 * 1000);
            expect(Device.find.callCount).to.equal(2);
        });

        it('computes the cutoff from the clock at each sweep', function() {
            presence.start();
            clock.tick(60 * 1000);
            var second = Device.find.secondCall.args[0].lastSeen.$lt.getTime();
            expect(second).to.equal(Date.now() - 120 * 1000);
        });

        it('stop clears the timer', function() {
            presence.start();
            clock.tick(30 * 1000);
            presence.stop();
            clock.tick(5 * 30 * 1000);
            expect(Device.find.callCount).to.equal(1);
        });

        it('start twice does not create a second timer', function() {
            presence.start();
            presence.start();
            clock.tick(30 * 1000);
            expect(Device.find.callCount).to.equal(1);
        });
    });
});
