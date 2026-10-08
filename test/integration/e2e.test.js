'use strict';

/**
 * End-to-end: the full server runs in-process against the real MongoDB and
 * Mosquitto services, and bin/simulate-devices.js runs as a separate
 * process, the same way an operator would start it.
 */

var path = require('path');
var crypto = require('crypto');
var childProcess = require('child_process');
var expect = require('chai').expect;
var config = require('config');
var request = require('supertest');
var ioClient = require('socket.io-client');
var server = require('../../src/server');
var db = require('../support/db');

var KEY = 'e2e-test-key';
var SIMULATOR = path.join(__dirname, '..', '..', 'bin', 'simulate-devices.js');

function brokerUrl() {
    return 'mqtt://' + config.get('mqtt.host') + ':' + (parseInt(config.get('mqtt.port'), 10) || 1883);
}

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

describe('end-to-end: simulator process against the full platform', function() {
    this.timeout(30000);

    var prefix = 'e2e-' + crypto.randomBytes(3).toString('hex');
    var ids = [prefix + '-1', prefix + '-2', prefix + '-3'];
    var started;
    var child;
    var childOutput = '';
    var client;

    before(function(done) {
        db.reset(done);
    });

    before(function(done) {
        server.start({port: 0, provisioningKey: KEY}, function(err, result) {
            if (err) {
                return done(err);
            }
            started = result;
            eventually(function(cb) {
                cb(null, started.mqttHandler.isConnected());
            }, 10000, done);
        });
    });

    // The rule exists before any device reports, so the first reading
    // already sees it (creating it also clears the cached rule set).
    before(function(done) {
        request(started.baseUrl)
            .post('/api/rules')
            .send({name: 'Battery below 101', metric: 'battery', operator: 'lt', threshold: 101,
                severity: 'info', cooldownSec: 60})
            .expect(201, done);
    });

    before(function() {
        child = childProcess.spawn(process.execPath, [SIMULATOR,
            '--count', '3',
            '--duration', '8',
            '--interval', '500',
            '--prefix', prefix,
            '--mqtt', brokerUrl(),
            '--key', KEY
        ], {stdio: ['ignore', 'pipe', 'pipe']});
        child.stdout.on('data', function(chunk) {
            childOutput += chunk;
        });
        child.stderr.on('data', function(chunk) {
            childOutput += chunk;
        });
    });

    after(function(done) {
        if (client) {
            client.disconnect();
        }
        function closeServer() {
            if (started) {
                return started.close(done);
            }
            done();
        }
        if (child && child.exitCode === null && child.signalCode === null) {
            child.once('exit', closeServer);
            return child.kill('SIGTERM');
        }
        closeServer();
    });

    it('registers all three simulated devices', function(done) {
        eventually(function(cb) {
            request(started.baseUrl).get('/api/devices').end(function(err, res) {
                if (err) {
                    return cb(err);
                }
                var found = (res.body.devices || []).map(function(d) {
                    return d.deviceId;
                }).filter(function(id) {
                    return ids.indexOf(id) !== -1;
                });
                cb(null, found.length === 3);
            });
        }, 6000, function(err) {
            if (err) {
                err.message += '\nsimulator output:\n' + childOutput;
            }
            done(err);
        });
    });

    it('reports at least three devices online in /api/stats', function(done) {
        eventually(function(cb) {
            request(started.baseUrl).get('/api/stats').end(function(err, res) {
                if (err) {
                    return cb(err);
                }
                cb(null, res.status === 200 && (res.body.online || 0) >= 3);
            });
        }, 6000, done);
    });

    it('raises an alert from the battery rule', function(done) {
        eventually(function(cb) {
            request(started.baseUrl).get('/api/alerts').end(function(err, res) {
                if (err) {
                    return cb(err);
                }
                var alerts = (res.body.alerts || []).filter(function(a) {
                    return ids.indexOf(a.deviceId) !== -1;
                });
                cb(null, alerts.length >= 1);
            });
        }, 6000, done);
    });

    it('pushes live telemetry to a dashboard socket after subscribe_device', function(done) {
        var finished = false;
        var timer = setTimeout(function() {
            finish(new Error('No telemetry event within 5 s'));
        }, 5000);
        function finish(err) {
            if (finished) {
                return;
            }
            finished = true;
            clearTimeout(timer);
            done(err);
        }
        client = ioClient(started.baseUrl, {transports: ['websocket'], forceNew: true, reconnection: false});
        client.on('connect_error', finish);
        client.on('connect', function() {
            client.emit('subscribe_device', ids[0]);
        });
        client.on('telemetry', function(event) {
            try {
                expect(event.deviceId).to.equal(ids[0]);
                finish();
            } catch (e) {
                finish(e);
            }
        });
    });
});
