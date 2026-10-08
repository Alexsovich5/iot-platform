'use strict';

var crypto = require('crypto');
var mqtt = require('mqtt');
var waitForPort = require('../support/wait_for').waitForPort;
var creds = require('../support/mqtt_creds');

describe('backing services', function() {
    it('accepts TCP connections on mongo:27017', function(done) {
        waitForPort('mongo', 27017, 1000, done);
    });

    it('accepts TCP connections on mosquitto:1883', function(done) {
        waitForPort('mosquitto', 1883, 1000, done);
    });

    describe('MQTT round trip', function() {
        var platform;
        var device;
        var deviceId = 'svc-' + crypto.randomBytes(4).toString('hex');

        before(function(done) {
            platform = mqtt.connect(creds.brokerUrl(),
                creds.platformOptions('svc-platform-' + crypto.randomBytes(6).toString('hex')));
            platform.once('connect', function() {
                device = mqtt.connect(creds.brokerUrl(), creds.deviceOptions(deviceId));
                device.once('connect', function() {
                    done();
                });
                device.once('error', done);
            });
            platform.once('error', done);
        });

        after(function(done) {
            device.end(false, function() {
                platform.end(false, function() {
                    done();
                });
            });
        });

        it('delivers a device message to the platform account', function(done) {
            var topic = 'devices/' + deviceId + '/telemetry';
            var payload = 'ping-' + crypto.randomBytes(4).toString('hex');
            platform.on('message', function(t, message) {
                if (t === topic && message.toString() === payload) {
                    done();
                }
            });
            platform.subscribe('devices/+/telemetry', {qos: 1}, function(err) {
                if (err) {
                    return done(err);
                }
                device.publish(topic, payload, {qos: 1});
            });
        });
    });
});
