'use strict';

var crypto = require('crypto');
var expect = require('chai').expect;
var mqtt = require('mqtt');
var config = require('config');
var request = require('supertest');
var createApp = require('../../src/app');
var MQTTHandler = require('../../src/mqtt_handler');
var AlertService = require('../../src/lib/alerts');
var Alert = require('../../src/models/alert');
var Rule = require('../../src/models/rule');
var FakeIo = require('../support/fake_io');
var db = require('../support/db');

function brokerUrl() {
    return 'mqtt://' + config.get('mqtt.host') + ':' + (parseInt(config.get('mqtt.port'), 10) || 1883);
}

// Calls fetch(cb) every 50 ms until accept(result) is true, then
// done(null, result); fails after `ms`.
function waitUntil(ms, fetch, accept, done) {
    var deadline = Date.now() + ms;
    (function poll() {
        fetch(function(err, result) {
            if (err) {
                return done(err);
            }
            if (accept(result)) {
                return done(null, result);
            }
            if (Date.now() > deadline) {
                return done(new Error('condition not met within ' + ms + ' ms'));
            }
            setTimeout(poll, 50);
        });
    })();
}

describe('alerts flow (real broker and MongoDB)', function() {
    this.timeout(15000);

    var io;
    var alertService;
    var handler;
    var app;
    var client;
    var deviceId = 'alerts-' + crypto.randomBytes(4).toString('hex');
    var token;

    function listAlerts(query, cb) {
        request(app).get('/api/alerts').query(query).end(function(err, res) {
            if (err) {
                return cb(err);
            }
            cb(null, res.body);
        });
    }

    before(function(done) {
        db.reset(done);
    });

    before(function(done) {
        io = new FakeIo();
        alertService = new AlertService({Alert: Alert, Rule: Rule, io: io});
        handler = new MQTTHandler({host: config.get('mqtt.host'), port: config.get('mqtt.port')}, io, {
            provisioningKey: 'alerts-test-key',
            alerts: alertService
        });
        app = createApp({mqttHandler: handler, alertService: alertService});
        handler.connect(done);
    });

    before(function(done) {
        client = mqtt.connect(brokerUrl(), {
            clientId: 'alerts-test-' + crypto.randomBytes(6).toString('hex'),
            reconnectPeriod: 0
        });
        client.once('connect', function() {
            done();
        });
        client.once('error', done);
    });

    after(function(done) {
        client.end(false, function() {
            handler.close(done);
        });
    });

    it('creates the rule temperature gt 30 through the API', function(done) {
        request(app)
            .post('/api/rules')
            .send({name: 'Too hot', metric: 'temperature', operator: 'gt', threshold: 30,
                severity: 'critical', cooldownSec: 60})
            .expect(201)
            .end(function(err, res) {
                if (err) {
                    return done(err);
                }
                expect(res.body._id).to.be.a('string');
                expect(res.body.enabled).to.equal(true);
                request(app).get('/api/rules').expect(200).end(function(err2, res2) {
                    if (err2) {
                        return done(err2);
                    }
                    expect(res2.body.rules).to.have.length(1);
                    expect(res2.body.count).to.equal(1);
                    done();
                });
            });
    });

    it('provisions a device', function(done) {
        request(app)
            .post('/api/devices')
            .send({deviceId: deviceId, name: 'Alert test device', type: 'sensor'})
            .expect(201)
            .end(function(err, res) {
                if (err) {
                    return done(err);
                }
                token = res.body.token;
                expect(token).to.be.a('string');
                done();
            });
    });

    it('turns telemetry above the threshold into one unacknowledged alert', function(done) {
        client.publish('devices/' + deviceId + '/telemetry',
            JSON.stringify({token: token, temperature: 35}), {qos: 1});

        waitUntil(5000, function(cb) {
            listAlerts({}, cb);
        }, function(body) {
            return body.count >= 1;
        }, function(err, body) {
            if (err) {
                return done(err);
            }
            expect(body.count).to.equal(1);
            var alert = body.alerts[0];
            expect(alert.deviceId).to.equal(deviceId);
            expect(alert.source).to.equal('rule');
            expect(alert.severity).to.equal('critical');
            expect(alert.metric).to.equal('temperature');
            expect(alert.value).to.equal(35);
            expect(alert.threshold).to.equal(30);
            expect(alert.acknowledged).to.equal(false);

            var events = io.emittedTo(null, 'alert');
            expect(events).to.have.length(1);
            expect(String(events[0].data.alert._id)).to.equal(alert._id);
            done();
        });
    });

    it('acknowledges the alert', function(done) {
        listAlerts({acknowledged: 'false'}, function(err, body) {
            if (err) {
                return done(err);
            }
            expect(body.count).to.equal(1);
            var id = body.alerts[0]._id;
            request(app)
                .post('/api/alerts/' + id + '/ack')
                .expect(200)
                .end(function(ackErr, res) {
                    if (ackErr) {
                        return done(ackErr);
                    }
                    expect(res.body.acknowledged).to.equal(true);
                    expect(res.body.acknowledgedAt).to.be.a('string');
                    listAlerts({acknowledged: 'true'}, function(listErr, acked) {
                        if (listErr) {
                            return done(listErr);
                        }
                        expect(acked.count).to.equal(1);
                        expect(acked.alerts[0]._id).to.equal(id);
                        expect(acked.alerts[0].acknowledged).to.equal(true);
                        done();
                    });
                });
        });
    });

    it('returns 404 when acknowledging an unknown alert', function(done) {
        request(app)
            .post('/api/alerts/56d0f1a2b3c4d5e6f7a8b9c0/ack')
            .expect(404)
            .end(done);
    });

    it('persists a device-sent alert with source device', function(done) {
        client.publish('devices/' + deviceId + '/alerts',
            JSON.stringify({token: token, severity: 'info', message: 'Door opened'}), {qos: 1});

        waitUntil(5000, function(cb) {
            listAlerts({deviceId: deviceId}, cb);
        }, function(body) {
            return body.count >= 2;
        }, function(err, body) {
            if (err) {
                return done(err);
            }
            var deviceAlerts = body.alerts.filter(function(a) {
                return a.source === 'device';
            });
            expect(deviceAlerts).to.have.length(1);
            expect(deviceAlerts[0].message).to.equal('Door opened');
            expect(deviceAlerts[0].severity).to.equal('info');
            expect(deviceAlerts[0].ruleId).to.equal(null);
            expect(io.emittedTo(null, 'alert')).to.have.length(2);
            done();
        });
    });

    it('rejects a rule with both deviceId and deviceType with 400', function(done) {
        request(app)
            .post('/api/rules')
            .send({name: 'Both', deviceId: deviceId, deviceType: 'sensor',
                metric: 'temperature', operator: 'gt', threshold: 1})
            .expect(400)
            .end(function(err, res) {
                if (err) {
                    return done(err);
                }
                expect(res.body.error).to.match(/mutually exclusive/);
                done();
            });
    });
});
