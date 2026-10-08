'use strict';

var crypto = require('crypto');
var expect = require('chai').expect;
var mqtt = require('mqtt');
var createApp = require('../../src/app');
var MQTTHandler = require('../../src/mqtt_handler');
var Device = require('../../src/models/device');
var FakeIo = require('../support/fake_io');
var db = require('../support/db');
var creds = require('../support/mqtt_creds');
var api = require('../support/api').api;
var TEST_API_KEY = require('../support/api').TEST_API_KEY;

var KEY = 'integration-provisioning-key';

// Polls check(cb) every 50 ms until it calls back true, or fails after `ms`.
function eventually(ms, check, done) {
    var deadline = Date.now() + ms;
    (function poll() {
        check(function(err, ok) {
            if (err) {
                return done(err);
            }
            if (ok) {
                return done();
            }
            if (Date.now() > deadline) {
                return done(new Error('condition not met within ' + ms + ' ms'));
            }
            setTimeout(poll, 50);
        });
    })();
}

describe('MQTT flow (real broker and MongoDB)', function() {
    this.timeout(15000);

    var handler;
    var device;
    var app;
    var io;
    var deviceId = 'flow-' + crypto.randomBytes(4).toString('hex');

    // Waits for the next message on `topic`, subscribing first.
    function nextMessage(topic, send, cb) {
        function onMessage(t, message) {
            if (t !== topic) {
                return;
            }
            device.removeListener('message', onMessage);
            cb(null, JSON.parse(message.toString()));
        }
        device.on('message', onMessage);
        device.subscribe(topic, {qos: 1}, function(err) {
            if (err) {
                device.removeListener('message', onMessage);
                return cb(err);
            }
            send();
        });
    }

    function register(cb) {
        nextMessage('devices/' + deviceId + '/provisioned', function() {
            device.publish('devices/' + deviceId + '/register', JSON.stringify({
                provisioningKey: KEY,
                name: 'Flow test device',
                type: 'sensor',
                firmware: '1.0.0'
            }), {qos: 1});
        }, cb);
    }

    before(function(done) {
        db.reset(done);
    });

    before(function(done) {
        io = new FakeIo();
        handler = new MQTTHandler(creds.platformConfig(), io, {
            provisioningKey: KEY
        });
        app = createApp({apiKey: TEST_API_KEY, mqttHandler: handler, stats: handler.stats.bind(handler)});
        handler.connect(done);
    });

    before(function(done) {
        device = mqtt.connect(creds.brokerUrl(), creds.deviceOptions(deviceId));
        device.once('connect', function() {
            done();
        });
        device.once('error', done);
    });

    after(function(done) {
        device.end(false, function() {
            handler.close(done);
        });
    });

    var token;

    it('registers over MQTT and receives a token', function(done) {
        register(function(err, reply) {
            if (err) {
                return done(err);
            }
            expect(reply).to.not.have.property('error');
            expect(reply.token).to.match(/^[0-9a-f]{32}$/);
            token = reply.token;
            Device.findOne({deviceId: deviceId}, function(findErr, doc) {
                if (findErr) {
                    return done(findErr);
                }
                expect(doc.provisionedBy).to.equal('mqtt');
                expect(doc.status).to.equal('registered');
                done();
            });
        });
    });

    it('stores authenticated telemetry and marks the device online', function(done) {
        device.publish('devices/' + deviceId + '/telemetry', JSON.stringify({
            token: token,
            temperature: 22.5,
            humidity: 41
        }), {qos: 1});

        eventually(5000, function(cb) {
            api(app)
                .get('/api/devices/' + deviceId + '/telemetry')
                .end(function(err, res) {
                    if (err) {
                        return cb(err);
                    }
                    cb(null, res.status === 200 && res.body.telemetry.length === 1 &&
                        io.emittedTo('device_' + deviceId, 'telemetry').length === 1);
                });
        }, function(err) {
            if (err) {
                return done(err);
            }
            api(app).get('/api/devices/' + deviceId + '/telemetry').end(function(e1, res) {
                if (e1) {
                    return done(e1);
                }
                expect(res.body.telemetry[0].temperature).to.equal(22.5);
                expect(res.body.telemetry[0].humidity).to.equal(41);
                api(app).get('/api/devices/' + deviceId).end(function(e2, detail) {
                    if (e2) {
                        return done(e2);
                    }
                    expect(detail.body.status).to.equal('online');
                    expect(detail.body.lastSeen).to.be.a('string');
                    expect(io.emittedTo('device_' + deviceId, 'telemetry')).to.have.length(1);
                    done();
                });
            });
        });
    });

    it('drops telemetry with a wrong token and leaves the database unchanged', function(done) {
        var rejectedBefore = handler.stats().rejectedMessages;
        device.publish('devices/' + deviceId + '/telemetry', JSON.stringify({
            token: 'ffffffffffffffffffffffffffffffff',
            temperature: 99
        }), {qos: 1});

        eventually(5000, function(cb) {
            cb(null, handler.stats().rejectedMessages === rejectedBefore + 1);
        }, function(err) {
            if (err) {
                return done(err);
            }
            api(app).get('/api/devices/' + deviceId + '/telemetry').end(function(e1, res) {
                if (e1) {
                    return done(e1);
                }
                expect(res.body.telemetry).to.have.length(1);
                expect(res.body.telemetry[0].temperature).to.equal(22.5);
                api(app).get('/health').end(function(e2, health) {
                    if (e2) {
                        return done(e2);
                    }
                    expect(health.body.rejectedMessages).to.equal(rejectedBefore + 1);
                    expect(health.body.mqtt).to.equal('connected');
                    done();
                });
            });
        });
    });

    it('rejects a second registration for the same deviceId', function(done) {
        register(function(err, reply) {
            if (err) {
                return done(err);
            }
            expect(reply).to.not.have.property('token');
            expect(reply.error).to.match(/already/);
            Device.count({deviceId: deviceId}, function(countErr, n) {
                if (countErr) {
                    return done(countErr);
                }
                expect(n).to.equal(1);
                done();
            });
        });
    });
});
