'use strict';

var crypto = require('crypto');
var expect = require('chai').expect;
var server = require('../../src/server');
var SimDevice = require('../../src/sim/device');
var Device = require('../../src/models/device');
var FirmwareUpdate = require('../../src/models/firmware_update');
var db = require('../support/db');
var creds = require('../support/mqtt_creds');
var api = require('../support/api').api;
var TEST_API_KEY = require('../support/api').TEST_API_KEY;

var KEY = 'simulator-test-key';

// Calls check(cb) every 100 ms until it yields true or `timeout` ms pass.
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
            setTimeout(attempt, 100);
        });
    }
    attempt();
}

describe('device-fleet simulator against the platform', function() {
    this.timeout(30000);

    var prefix = 'simtest-' + crypto.randomBytes(3).toString('hex');
    var ids = [prefix + '-1', prefix + '-2'];
    var version = '1.1.0';
    var blob = crypto.randomBytes(8192);
    var md5 = crypto.createHash('md5').update(blob).digest('hex');
    var started;
    var sims = [];
    var commands = {};
    var downloads = {};

    before(function(done) {
        db.reset(done);
    });

    before(function(done) {
        server.start({apiKey: TEST_API_KEY, port: 0, provisioningKey: KEY}, function(err, result) {
            if (err) {
                return done(err);
            }
            started = result;
            eventually(function(cb) {
                cb(null, started.mqttHandler.isConnected());
            }, 10000, done);
        });
    });

    before(function(done) {
        var remaining = ids.length;
        var failed = false;
        ids.forEach(function(id) {
            var sim = new SimDevice({
                id: id,
                type: 'sensor',
                mqttUrl: creds.brokerUrl(),
                username: 'device',
                password: creds.deviceOptions(id).password,
                provisioningKey: KEY,
                intervalMs: 300
            });
            commands[id] = [];
            downloads[id] = [];
            sim.on('command', function(body) {
                commands[id].push(body);
            });
            sim.on('download', function(info) {
                downloads[id].push(info);
            });
            sims.push(sim);
            sim.start(function(err) {
                if (failed) {
                    return;
                }
                if (err) {
                    failed = true;
                    return done(err);
                }
                remaining -= 1;
                if (remaining === 0) {
                    done();
                }
            });
        });
    });

    after(function(done) {
        var remaining = sims.length;
        function closeServer() {
            if (started) {
                return started.close(done);
            }
            done();
        }
        if (remaining === 0) {
            return closeServer();
        }
        sims.forEach(function(sim) {
            sim.stop(function() {
                remaining -= 1;
                if (remaining === 0) {
                    closeServer();
                }
            });
        });
    });

    it('starts the server on an ephemeral port with a matching base URL', function() {
        expect(started.port).to.be.above(0);
        expect(started.baseUrl).to.equal('http://localhost:' + started.port);
    });

    it('shows both simulated devices online with telemetry within 10 s', function(done) {
        this.timeout(15000);
        eventually(function(cb) {
            var pending = ids.length;
            var allReady = true;
            var failed = null;
            ids.forEach(function(id) {
                api(started.baseUrl).get('/api/devices/' + id).end(function(err, res) {
                    if (err || res.status !== 200 || res.body.status !== 'online') {
                        allReady = false;
                        return finish(err);
                    }
                    api(started.baseUrl).get('/api/devices/' + id + '/telemetry').end(function(tErr, tRes) {
                        if (tErr || tRes.status !== 200 || tRes.body.telemetry.length < 2) {
                            allReady = false;
                        }
                        finish();
                    });
                });
            });
            function finish(err) {
                failed = failed || err || null;
                pending -= 1;
                if (pending === 0) {
                    cb(failed, allReady);
                }
            }
        }, 10000, function(err) {
            if (err) {
                return done(err);
            }
            Device.find({deviceId: {$in: ids}}, function(findErr, devices) {
                if (findErr) {
                    return done(findErr);
                }
                expect(devices).to.have.length(2);
                devices.forEach(function(d) {
                    expect(d.provisionedBy).to.equal('mqtt');
                    expect(d.firmware).to.equal('1.0.0');
                });
                done();
            });
        });
    });

    it('rolls firmware out to both simulated devices, which install it from the platform', function(done) {
        api(started.baseUrl)
            .post('/api/firmware')
            .query({version: version, deviceType: 'sensor'})
            .set('Content-Type', 'application/octet-stream')
            .send(blob)
            .expect(201)
            .end(function(err, res) {
                if (err) {
                    return done(err);
                }
                expect(res.body.md5).to.equal(md5);
                api(started.baseUrl)
                    .post('/api/firmware/sensor/' + version + '/rollout')
                    .expect(202)
                    .end(function(rErr, rRes) {
                        if (rErr) {
                            return done(rErr);
                        }
                        expect(rRes.body.updates).to.have.length(2);
                        waitForSuccess(rRes.body.updates.map(function(u) {
                            return String(u._id);
                        }));
                    });
            });

        function waitForSuccess(updateIds) {
            eventually(function(cb) {
                FirmwareUpdate.find({_id: {$in: updateIds}}, function(err, found) {
                    cb(err, found.length === 2 && found.every(function(u) {
                        return u.state === 'success';
                    }));
                });
            }, 10000, function(err) {
                if (err) {
                    return done(err);
                }
                var expectedUrl = 'http://localhost:' + started.port + '/firmware/sensor/' + version + '.bin';
                ids.forEach(function(id) {
                    var fwCommands = commands[id].filter(function(c) {
                        return c.command === 'firmware_update';
                    });
                    expect(fwCommands, id).to.have.length(1);
                    expect(fwCommands[0].payload.url.indexOf('http://localhost:' + started.port + '/firmware/')).to.equal(0);
                    expect(fwCommands[0].payload.url).to.equal(expectedUrl);
                    expect(fwCommands[0].payload.md5).to.equal(md5);

                    expect(downloads[id], id).to.have.length(1);
                    expect(downloads[id][0].url).to.equal(expectedUrl);
                    expect(downloads[id][0].statusCode).to.equal(200);
                    expect(downloads[id][0].bytes).to.equal(blob.length);
                    expect(downloads[id][0].md5).to.equal(md5);
                });
                sims.forEach(function(sim) {
                    expect(sim.firmware).to.equal(version);
                });
                FirmwareUpdate.find({_id: {$in: updateIds}}, function(findErr, updates) {
                    if (findErr) {
                        return done(findErr);
                    }
                    updates.forEach(function(u) {
                        expect(u.history.map(function(h) {
                            return h.state;
                        })).to.deep.equal(['pending', 'downloading', 'installing', 'success']);
                    });
                    Device.find({deviceId: {$in: ids}}, function(devErr, devices) {
                        if (devErr) {
                            return done(devErr);
                        }
                        devices.forEach(function(d) {
                            expect(d.firmware).to.equal(version);
                        });
                        done();
                    });
                });
            });
        }
    });
});
