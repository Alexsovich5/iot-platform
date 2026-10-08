'use strict';

var crypto = require('crypto');
var path = require('path');
var expect = require('chai').expect;
var mqtt = require('mqtt');
var config = require('config');
var request = require('supertest');
var createApp = require('../../src/app');
var MQTTHandler = require('../../src/mqtt_handler');
var FirmwareService = require('../../src/lib/firmware').FirmwareService;
var Device = require('../../src/models/device');
var FirmwareUpdate = require('../../src/models/firmware_update');
var FakeIo = require('../support/fake_io');
var db = require('../support/db');

function brokerUrl() {
    return 'mqtt://' + config.get('mqtt.host') + ':' + (parseInt(config.get('mqtt.port'), 10) || 1883);
}

// Calls check(cb) every 50 ms until it yields true or `timeout` ms pass.
function eventually(check, timeout, done) {
    var deadline = Date.now() + timeout;
    function attempt() {
        check(function(err, ok) {
            if (err) {
                return done(err);
            }
            if (ok) {
                return done();
            }
            if (Date.now() > deadline) {
                return done(new Error('Condition not met within ' + timeout + ' ms'));
            }
            setTimeout(attempt, 50);
        });
    }
    attempt();
}

describe('firmware rollout (real broker and MongoDB)', function() {
    this.timeout(20000);

    var dir = path.join('/tmp', 'firmware-rollout-' + crypto.randomBytes(4).toString('hex'));
    var blob = crypto.randomBytes(2048);
    var md5 = crypto.createHash('md5').update(blob).digest('hex');
    var io = new FakeIo();
    var handler;
    var service;
    var app;
    var device;
    var tokens = {};
    var commands = [];
    var updates;

    before(function(done) {
        db.reset(done);
    });

    before(function(done) {
        handler = new MQTTHandler({host: config.get('mqtt.host'), port: config.get('mqtt.port')}, io, {
            provisioningKey: 'rollout-test-key'
        });
        service = new FirmwareService({
            FirmwareUpdate: FirmwareUpdate,
            Device: Device,
            mqttHandler: handler,
            io: io,
            baseUrl: 'http://platform.test:3000'
        });
        handler.firmware = service;
        app = createApp({
            mqttHandler: handler,
            firmwareService: service,
            firmwareDir: dir,
            stats: handler.stats.bind(handler)
        });
        handler.connect(done);
    });

    before(function(done) {
        device = mqtt.connect(brokerUrl(), {
            clientId: 'rollout-test-' + crypto.randomBytes(6).toString('hex'),
            reconnectPeriod: 0
        });
        device.on('message', function(topic, message) {
            commands.push({topic: topic, body: JSON.parse(message.toString())});
        });
        device.once('connect', function() {
            device.subscribe('devices/+/commands', {qos: 1}, function(err) {
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

    it('uploads firmware 1.1.0 for sensors', function(done) {
        request(app)
            .post('/api/firmware')
            .query({version: '1.1.0', deviceType: 'sensor'})
            .set('Content-Type', 'application/octet-stream')
            .send(blob)
            .expect(201)
            .end(function(err, res) {
                if (err) {
                    return done(err);
                }
                expect(res.body.md5).to.equal(md5);
                done();
            });
    });

    it('provisions three sensors and decommissions one', function(done) {
        var ids = ['fw-1', 'fw-2', 'fw-3'];
        var remaining = ids.length;
        ids.forEach(function(id) {
            request(app)
                .post('/api/devices')
                .send({deviceId: id, name: 'Sensor ' + id, type: 'sensor'})
                .expect(201)
                .end(function(err, res) {
                    if (err) {
                        return done(err);
                    }
                    tokens[id] = res.body.token;
                    remaining -= 1;
                    if (remaining === 0) {
                        request(app).delete('/api/devices/fw-3').expect(200).end(done);
                    }
                });
        });
    });

    it('rolls out to the two active sensors and publishes a command to each', function(done) {
        request(app)
            .post('/api/firmware/sensor/1.1.0/rollout')
            .expect(202)
            .end(function(err, res) {
                if (err) {
                    return done(err);
                }
                updates = res.body.updates;
                expect(updates).to.have.length(2);
                expect(updates.map(function(u) {
                    return u.deviceId;
                }).sort()).to.deep.equal(['fw-1', 'fw-2']);
                updates.forEach(function(u) {
                    expect(u.state).to.equal('pending');
                    expect(u.version).to.equal('1.1.0');
                });

                eventually(function(cb) {
                    cb(null, commands.length >= 2);
                }, 5000, function(waitErr) {
                    if (waitErr) {
                        return done(waitErr);
                    }
                    var topics = commands.map(function(c) {
                        return c.topic;
                    }).sort();
                    expect(topics).to.deep.equal(['devices/fw-1/commands', 'devices/fw-2/commands']);
                    commands.forEach(function(c) {
                        expect(c.body.command).to.equal('firmware_update');
                        expect(c.body.payload.version).to.equal('1.1.0');
                        expect(c.body.payload.md5).to.equal(md5);
                        expect(c.body.payload.url).to.equal('http://platform.test:3000/firmware/sensor/1.1.0.bin');
                    });
                    done();
                });
            });
    });

    it('tracks downloading, installing and success reported over MQTT', function(done) {
        var command = commands.filter(function(c) {
            return c.topic === 'devices/fw-1/commands';
        })[0];
        var updateId = command.body.payload.updateId;
        var states = ['downloading', 'installing', 'success'];

        function publishNext() {
            if (states.length === 0) {
                return waitForSuccess();
            }
            var body = {token: tokens['fw-1'], updateId: updateId, state: states.shift()};
            device.publish('devices/fw-1/firmware', JSON.stringify(body), {qos: 1}, function(err) {
                if (err) {
                    return done(err);
                }
                publishNext();
            });
        }

        function waitForSuccess() {
            eventually(function(cb) {
                FirmwareUpdate.findById(updateId, function(err, found) {
                    cb(err, !!found && found.state === 'success');
                });
            }, 5000, function(err) {
                if (err) {
                    return done(err);
                }
                FirmwareUpdate.findById(updateId, function(findErr, update) {
                    if (findErr) {
                        return done(findErr);
                    }
                    expect(update.history.map(function(h) {
                        return h.state;
                    })).to.deep.equal(['pending', 'downloading', 'installing', 'success']);
                    expect(update.history).to.have.length(4);
                    Device.findOne({deviceId: 'fw-1'}, function(devErr, found) {
                        if (devErr) {
                            return done(devErr);
                        }
                        expect(found.firmware).to.equal('1.1.0');
                        expect(io.emittedTo(null, 'firmware').length).to.be.at.least(5);
                        done();
                    });
                });
            });
        }

        publishNext();
    });

    it('ignores progress for an update that belongs to another device', function(done) {
        var other = commands.filter(function(c) {
            return c.topic === 'devices/fw-2/commands';
        })[0];
        var body = {token: tokens['fw-1'], updateId: other.body.payload.updateId, state: 'downloading'};
        device.publish('devices/fw-1/firmware', JSON.stringify(body), {qos: 1}, function(err) {
            if (err) {
                return done(err);
            }
            setTimeout(function() {
                FirmwareUpdate.findById(other.body.payload.updateId, function(findErr, update) {
                    if (findErr) {
                        return done(findErr);
                    }
                    expect(update.state).to.equal('pending');
                    expect(update.history).to.have.length(1);
                    done();
                });
            }, 300);
        });
    });

    it('lists updates filtered by device and state', function(done) {
        request(app)
            .get('/api/firmware/updates')
            .query({deviceId: 'fw-1', state: 'success'})
            .expect(200)
            .end(function(err, res) {
                if (err) {
                    return done(err);
                }
                expect(res.body.updates).to.have.length(1);
                expect(res.body.updates[0].deviceId).to.equal('fw-1');
                request(app).get('/api/firmware/updates').query({state: 'bogus'}).expect(400).end(done);
            });
    });

    it('does not target a device that is already on the version', function(done) {
        request(app)
            .post('/api/firmware/sensor/1.1.0/rollout')
            .expect(202)
            .end(function(err, res) {
                if (err) {
                    return done(err);
                }
                expect(res.body.updates.map(function(u) {
                    return u.deviceId;
                })).to.deep.equal(['fw-2']);
                done();
            });
    });

    it('starts an update for a single device', function(done) {
        request(app)
            .post('/api/devices/fw-2/firmware')
            .send({version: '1.1.0'})
            .expect(202)
            .end(function(err, res) {
                if (err) {
                    return done(err);
                }
                expect(res.body.deviceId).to.equal('fw-2');
                expect(res.body.state).to.equal('pending');
                expect(res.body.history).to.have.length(1);
                done();
            });
    });

    it('rejects single-device updates that cannot be served', function(done) {
        request(app).post('/api/devices/fw-2/firmware').send({version: '1.1'}).expect(400).end(function(err) {
            if (err) {
                return done(err);
            }
            request(app).post('/api/devices/fw-2/firmware').send({version: '9.9.9'}).expect(404).end(function(err2) {
                if (err2) {
                    return done(err2);
                }
                request(app).post('/api/devices/nope/firmware').send({version: '1.1.0'}).expect(404).end(function(err3) {
                    if (err3) {
                        return done(err3);
                    }
                    request(app).post('/api/devices/fw-3/firmware').send({version: '1.1.0'}).expect(409).end(done);
                });
            });
        });
    });

    it('returns 404 for a rollout of an unknown version and 400 for a bad device type', function(done) {
        request(app).post('/api/firmware/sensor/9.9.9/rollout').expect(404).end(function(err) {
            if (err) {
                return done(err);
            }
            request(app).post('/api/firmware/toaster/1.1.0/rollout').expect(400).end(done);
        });
    });

    it('returns 503 when the broker is disconnected', function(done) {
        var offline = {isConnected: function() { return false; }};
        var offlineApp = createApp({
            mqttHandler: offline,
            firmwareService: new FirmwareService({
                FirmwareUpdate: FirmwareUpdate,
                Device: Device,
                mqttHandler: offline,
                io: io,
                baseUrl: 'http://platform.test:3000'
            }),
            firmwareDir: dir
        });
        request(offlineApp).post('/api/firmware/sensor/1.1.0/rollout').expect(503).end(done);
    });
});
