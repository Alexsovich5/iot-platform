'use strict';

var crypto = require('crypto');
var mqtt = require('mqtt');
var waitForPort = require('../support/wait_for').waitForPort;

describe('backing services', function() {
    it('accepts TCP connections on mongo:27017', function(done) {
        waitForPort('mongo', 27017, 1000, done);
    });

    it('accepts TCP connections on mosquitto:1883', function(done) {
        waitForPort('mosquitto', 1883, 1000, done);
    });

    describe('MQTT round trip', function() {
        var client;

        before(function(done) {
            client = mqtt.connect('mqtt://mosquitto:1883', {
                clientId: 'test-' + crypto.randomBytes(6).toString('hex')
            });
            client.once('connect', function() {
                done();
            });
            client.once('error', done);
        });

        after(function(done) {
            client.end(false, function() {
                done();
            });
        });

        it('receives a message it published on test/ping', function(done) {
            var payload = 'ping-' + crypto.randomBytes(4).toString('hex');
            client.on('message', function(topic, message) {
                if (topic === 'test/ping' && message.toString() === payload) {
                    done();
                }
            });
            client.subscribe('test/ping', {qos: 1}, function(err) {
                if (err) {
                    return done(err);
                }
                client.publish('test/ping', payload, {qos: 1});
            });
        });
    });
});
