'use strict';

var crypto = require('crypto');
var http = require('http');
var expect = require('chai').expect;
var SimDevice = require('../../src/sim/device');
var createFakeMqtt = require('../support/fake_mqtt').createFakeMqtt;

// Deterministic linear congruential generator in [0, 1).
function seeded(seed) {
    var state = seed >>> 0;
    return function() {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 4294967296;
    };
}

// Calls check() every 5 ms until it returns true or 2 s pass.
function waitFor(check, done) {
    var deadline = Date.now() + 2000;
    (function attempt() {
        if (check()) {
            return done();
        }
        if (Date.now() > deadline) {
            return done(new Error('Condition not met in time'));
        }
        setTimeout(attempt, 5);
    })();
}

function inBounds(reading) {
    Object.keys(SimDevice.BOUNDS).forEach(function(metric) {
        var b = SimDevice.BOUNDS[metric];
        expect(reading[metric], metric).to.be.a('number');
        expect(reading[metric], metric).to.be.within(b.min, b.max);
    });
}

// Starts a SimDevice against a fake client and answers its registration.
function startProvisioned(opts, done) {
    var fake = createFakeMqtt();
    opts.mqtt = fake.mqtt;
    var sim = new SimDevice(opts);
    sim.start(function(err) {
        done(err, sim, fake.client);
    });
    fake.client.simulateConnect();
    waitFor(function() {
        return fake.client.publishedTo('devices/' + opts.id + '/register').length > 0;
    }, function(err) {
        if (err) {
            return done(err);
        }
        fake.client.emit('message', 'devices/' + opts.id + '/provisioned',
            new Buffer(JSON.stringify({token: 'tok-' + opts.id})));
    });
}

function commandMessage(command, payload) {
    return new Buffer(JSON.stringify({
        commandId: crypto.randomBytes(8).toString('hex'),
        command: command,
        payload: payload,
        timestamp: new Date().toISOString()
    }));
}

describe('SimDevice', function() {
    describe('random walk', function() {
        it('stays inside its bounds when the random source always pushes up', function() {
            var sim = new SimDevice({id: 'walk-up', random: function() { return 0.999999; }});
            for (var i = 0; i < 2000; i++) {
                inBounds(sim.nextReading());
            }
            expect(sim.nextReading().temperature).to.equal(SimDevice.BOUNDS.temperature.max);
        });

        it('stays inside its bounds when the random source always pushes down', function() {
            var sim = new SimDevice({id: 'walk-down', random: function() { return 0; }});
            for (var i = 0; i < 2000; i++) {
                inBounds(sim.nextReading());
            }
            expect(sim.nextReading().humidity).to.equal(SimDevice.BOUNDS.humidity.min);
            expect(sim.nextReading().battery).to.equal(SimDevice.BOUNDS.battery.min);
        });

        it('stays inside its bounds and moves with a seeded random source', function() {
            var sim = new SimDevice({id: 'walk-seeded', random: seeded(42)});
            var first = sim.nextReading();
            var changed = false;
            for (var i = 0; i < 1000; i++) {
                var reading = sim.nextReading();
                inBounds(reading);
                if (reading.temperature !== first.temperature) {
                    changed = true;
                }
            }
            expect(changed).to.equal(true);
        });

        it('is reproducible for the same seed', function() {
            var a = new SimDevice({id: 'a', random: seeded(7)});
            var b = new SimDevice({id: 'b', random: seeded(7)});
            for (var i = 0; i < 20; i++) {
                expect(a.nextReading()).to.deep.equal(b.nextReading());
            }
        });
    });

    describe('provisioning and telemetry', function() {
        var sim;
        var client;

        before(function(done) {
            startProvisioned({
                id: 'unit-sim-1',
                type: 'gateway',
                provisioningKey: 'secret-key',
                intervalMs: 10,
                random: seeded(1)
            }, function(err, s, c) {
                sim = s;
                client = c;
                done(err);
            });
        });

        after(function(done) {
            sim.stop(done);
        });

        it('subscribes to its provisioned and commands topics with QoS 1', function() {
            var subscribed = client.subscriptions.map(function(s) {
                return s.topic;
            }).sort();
            expect(subscribed).to.deep.equal(['devices/unit-sim-1/commands', 'devices/unit-sim-1/provisioned']);
            client.subscriptions.forEach(function(s) {
                expect(s.opts.qos).to.equal(1);
            });
        });

        it('registers with the provisioning key, its type and firmware', function() {
            var reg = client.publishedTo('devices/unit-sim-1/register')[0];
            expect(reg.provisioningKey).to.equal('secret-key');
            expect(reg.type).to.equal('gateway');
            expect(reg.firmware).to.equal('1.0.0');
            expect(reg.name).to.be.a('string');
        });

        it('publishes online status with its firmware and token', function() {
            var status = client.publishedTo('devices/unit-sim-1/status')[0];
            expect(status.token).to.equal('tok-unit-sim-1');
            expect(status.status).to.equal('online');
            expect(status.firmware).to.equal('1.0.0');
        });

        it('publishes telemetry carrying the token every interval', function(done) {
            waitFor(function() {
                return client.publishedTo('devices/unit-sim-1/telemetry').length >= 3;
            }, function(err) {
                if (err) {
                    return done(err);
                }
                client.publishedTo('devices/unit-sim-1/telemetry').forEach(function(t) {
                    expect(t.token).to.equal('tok-unit-sim-1');
                    inBounds(t);
                });
                done();
            });
        });

        it('republishes its status on reboot', function(done) {
            var before = client.publishedTo('devices/unit-sim-1/status').length;
            client.emit('message', 'devices/unit-sim-1/commands', commandMessage('reboot', {}));
            waitFor(function() {
                return client.publishedTo('devices/unit-sim-1/status').length === before + 1;
            }, done);
        });

        it('stops publishing telemetry after stop', function(done) {
            sim.stop(function() {
                var count = client.publishedTo('devices/unit-sim-1/telemetry').length;
                expect(client.ended).to.equal(true);
                setTimeout(function() {
                    expect(client.publishedTo('devices/unit-sim-1/telemetry').length).to.equal(count);
                    done();
                }, 50);
            });
        });
    });

    it('fails start when the platform rejects the registration', function(done) {
        var fake = createFakeMqtt();
        var sim = new SimDevice({id: 'unit-rejected', provisioningKey: 'wrong', mqtt: fake.mqtt});
        sim.start(function(err) {
            expect(err).to.be.an('error');
            expect(err.message).to.match(/Invalid provisioning key/);
            sim.stop(done);
        });
        fake.client.simulateConnect();
        waitFor(function() {
            return fake.client.publishedTo('devices/unit-rejected/register').length > 0;
        }, function() {
            fake.client.emit('message', 'devices/unit-rejected/provisioned',
                new Buffer(JSON.stringify({error: 'Invalid provisioning key'})));
        });
    });

    describe('firmware updates', function() {
        var blob = crypto.randomBytes(4096);
        var md5 = crypto.createHash('md5').update(blob).digest('hex');
        var stub;
        var baseUrl;
        var requests = [];

        before(function(done) {
            stub = http.createServer(function(req, res) {
                requests.push(req.url);
                if (req.url === '/firmware/sensor/1.1.0.bin') {
                    res.writeHead(200, {'Content-Type': 'application/octet-stream'});
                    return res.end(blob);
                }
                res.writeHead(404);
                res.end();
            });
            stub.listen(0, '127.0.0.1', function() {
                baseUrl = 'http://127.0.0.1:' + stub.address().port;
                done();
            });
        });

        after(function(done) {
            stub.close(done);
        });

        function reports(client, id) {
            return client.publishedTo('devices/' + id + '/firmware');
        }

        function runUpdate(id, payload, expectedStates, done) {
            startProvisioned({id: id, provisioningKey: 'k', intervalMs: 60000, random: seeded(3)},
                function(err, sim, client) {
                    if (err) {
                        return done(err);
                    }
                    client.emit('message', 'devices/' + id + '/commands', commandMessage('firmware_update', payload));
                    waitFor(function() {
                        var states = reports(client, id).map(function(r) {
                            return r.state;
                        });
                        return states.length === expectedStates.length;
                    }, function(waitErr) {
                        sim.stop(function() {
                            done(waitErr, sim, client);
                        });
                    });
                });
        }

        it('downloads, verifies and reports downloading, installing and success', function(done) {
            var payload = {updateId: 'u1', version: '1.1.0', url: baseUrl + '/firmware/sensor/1.1.0.bin', md5: md5};
            runUpdate('unit-fw-ok', payload, ['downloading', 'installing', 'success'], function(err, sim, client) {
                if (err) {
                    return done(err);
                }
                var sent = reports(client, 'unit-fw-ok');
                expect(sent.map(function(r) {
                    return r.state;
                })).to.deep.equal(['downloading', 'installing', 'success']);
                sent.forEach(function(r) {
                    expect(r.token).to.equal('tok-unit-fw-ok');
                    expect(r.updateId).to.equal('u1');
                });
                expect(sim.firmware).to.equal('1.1.0');
                expect(requests).to.include('/firmware/sensor/1.1.0.bin');
                var statuses = client.publishedTo('devices/unit-fw-ok/status');
                expect(statuses[statuses.length - 1].firmware).to.equal('1.1.0');
                done();
            });
        });

        it('reports failed and keeps its firmware when the MD5 does not match', function(done) {
            var payload = {
                updateId: 'u2',
                version: '1.1.0',
                url: baseUrl + '/firmware/sensor/1.1.0.bin',
                md5: crypto.createHash('md5').update('something else').digest('hex')
            };
            runUpdate('unit-fw-md5', payload, ['downloading', 'failed'], function(err, sim, client) {
                if (err) {
                    return done(err);
                }
                var sent = reports(client, 'unit-fw-md5');
                expect(sent.map(function(r) {
                    return r.state;
                })).to.deep.equal(['downloading', 'failed']);
                expect(sent[1].error).to.match(/md5/i);
                expect(sim.firmware).to.equal('1.0.0');
                done();
            });
        });

        it('reports failed when the download returns an HTTP error', function(done) {
            var payload = {updateId: 'u3', version: '9.9.9', url: baseUrl + '/firmware/sensor/9.9.9.bin', md5: md5};
            runUpdate('unit-fw-404', payload, ['downloading', 'failed'], function(err, sim, client) {
                if (err) {
                    return done(err);
                }
                var sent = reports(client, 'unit-fw-404');
                expect(sent[1].state).to.equal('failed');
                expect(sent[1].error).to.match(/404/);
                expect(sim.firmware).to.equal('1.0.0');
                done();
            });
        });
    });
});
