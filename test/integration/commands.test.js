'use strict';

var crypto = require('crypto');
var expect = require('chai').expect;
var mqtt = require('mqtt');
var config = require('config');
var request = require('supertest');
var createApp = require('../../src/app');
var MQTTHandler = require('../../src/mqtt_handler');
var Device = require('../../src/models/device');
var FakeIo = require('../support/fake_io');
var db = require('../support/db');

function brokerUrl() {
    return 'mqtt://' + config.get('mqtt.host') + ':' + (parseInt(config.get('mqtt.port'), 10) || 1883);
}

describe('command dispatch (real broker and MongoDB)', function() {
    this.timeout(15000);

    var handler;
    var device;
    var app;

    before(function(done) {
        db.reset(function(err) {
            if (err) {
                return done(err);
            }
            Device.create([
                {deviceId: 'c1', name: 'Command target', status: 'online'},
                {deviceId: 'c2', name: 'Retired', status: 'decommissioned'}
            ], done);
        });
    });

    before(function(done) {
        handler = new MQTTHandler({host: config.get('mqtt.host'), port: config.get('mqtt.port')}, new FakeIo(), {
            provisioningKey: 'commands-test-key'
        });
        app = createApp({mqttHandler: handler, stats: handler.stats.bind(handler)});
        handler.connect(done);
    });

    before(function(done) {
        device = mqtt.connect(brokerUrl(), {
            clientId: 'commands-test-' + crypto.randomBytes(6).toString('hex'),
            reconnectPeriod: 0
        });
        device.once('connect', function() {
            device.subscribe('devices/c1/commands', {qos: 1}, function(err) {
                done(err);
            });
        });
        device.once('error', done);
    });

    after(function(done) {
        device.end(false, function() {
            handler.close(done);
        });
    });

    it('publishes a POSTed command to the device commands topic', function(done) {
        var commandId;
        var received;

        function check() {
            if (commandId && received) {
                expect(received.commandId).to.equal(commandId);
                expect(received.command).to.equal('reboot');
                expect(received.payload).to.deep.equal({delaySec: 1});
                expect(received.timestamp).to.be.a('string');
                done();
            }
        }

        device.once('message', function(topic, message) {
            expect(topic).to.equal('devices/c1/commands');
            received = JSON.parse(message.toString());
            check();
        });

        request(app)
            .post('/api/devices/c1/commands')
            .send({command: 'reboot', payload: {delaySec: 1}})
            .end(function(err, res) {
                if (err) {
                    return done(err);
                }
                expect(res.status).to.equal(202);
                expect(res.body.commandId).to.match(/^[0-9a-f]{16}$/);
                commandId = res.body.commandId;
                check();
            });
    });

    it('returns 409 for a decommissioned device', function(done) {
        request(app)
            .post('/api/devices/c2/commands')
            .send({command: 'reboot'})
            .expect(409)
            .end(done);
    });

    it('returns 404 for an unknown device', function(done) {
        request(app)
            .post('/api/devices/nope/commands')
            .send({command: 'reboot'})
            .expect(404)
            .end(done);
    });

    it('returns 400 for an invalid command name', function(done) {
        request(app)
            .post('/api/devices/c1/commands')
            .send({command: 'Reboot Now'})
            .expect(400)
            .end(done);
    });

    it('returns 503 when MQTT is disconnected', function(done) {
        var offline = createApp({mqttHandler: {
            isConnected: function() { return false; },
            sendCommand: function() { throw new Error('should not be called'); }
        }});
        request(offline)
            .post('/api/devices/c1/commands')
            .send({command: 'reboot'})
            .expect(503)
            .end(done);
    });
});
