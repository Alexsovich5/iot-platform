'use strict';

var expect = require('chai').expect;
var topics = require('../../src/lib/topics');

describe('topics', function() {
    describe('parse', function() {
        it('returns deviceId and type for each inbound type', function() {
            ['register', 'telemetry', 'status', 'alerts', 'firmware'].forEach(function(type) {
                expect(topics.parse('devices/sensor-1/' + type)).to.deep.equal({
                    deviceId: 'sensor-1',
                    type: type
                });
            });
        });

        it('accepts underscores, digits and mixed case in the deviceId', function() {
            expect(topics.parse('devices/Dev_42-a/telemetry').deviceId).to.equal('Dev_42-a');
        });

        it('rejects unknown message types', function() {
            expect(topics.parse('devices/d1/commands')).to.equal(null);
            expect(topics.parse('devices/d1/provisioned')).to.equal(null);
            expect(topics.parse('devices/d1/other')).to.equal(null);
        });

        it('rejects topics outside the devices/ namespace', function() {
            expect(topics.parse('things/d1/telemetry')).to.equal(null);
            expect(topics.parse('d1/telemetry')).to.equal(null);
            expect(topics.parse('')).to.equal(null);
        });

        it('rejects IDs containing / + or #', function() {
            expect(topics.parse('devices/a/b/telemetry')).to.equal(null);
            expect(topics.parse('devices/a+b/telemetry')).to.equal(null);
            expect(topics.parse('devices/+/telemetry')).to.equal(null);
            expect(topics.parse('devices/#/telemetry')).to.equal(null);
            expect(topics.parse('devices/a#/telemetry')).to.equal(null);
        });

        it('rejects empty and over-long IDs', function() {
            var max = new Array(65).join('a');
            expect(max).to.have.length(64);
            expect(topics.parse('devices/' + max + '/telemetry').deviceId).to.equal(max);
            expect(topics.parse('devices/' + max + 'a/telemetry')).to.equal(null);
            expect(topics.parse('devices//telemetry')).to.equal(null);
        });

        it('rejects non-string input', function() {
            expect(topics.parse(null)).to.equal(null);
            expect(topics.parse(undefined)).to.equal(null);
            expect(topics.parse(42)).to.equal(null);
        });
    });

    describe('outbound topics', function() {
        it('builds the commands and provisioned topics', function() {
            expect(topics.commandTopic('d1')).to.equal('devices/d1/commands');
            expect(topics.provisionedTopic('d1')).to.equal('devices/d1/provisioned');
        });

        it('throws for an invalid deviceId', function() {
            expect(function() { topics.commandTopic('a/b'); }).to.throw(/deviceId/);
            expect(function() { topics.provisionedTopic('#'); }).to.throw(/deviceId/);
        });
    });

    describe('subscriptions', function() {
        it('lists one wildcard subscription per inbound type', function() {
            expect(topics.subscriptions()).to.deep.equal([
                'devices/+/register',
                'devices/+/telemetry',
                'devices/+/status',
                'devices/+/alerts',
                'devices/+/firmware'
            ]);
        });
    });
});
