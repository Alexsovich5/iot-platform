'use strict';

/**
 * Broker-level authentication and topic ACLs on the real Mosquitto
 * service (docker/mosquitto/mosquitto.conf and acl).
 */

var crypto = require('crypto');
var expect = require('chai').expect;
var mqtt = require('mqtt');
var sinon = require('sinon');
var config = require('config');
var MQTTHandler = require('../../src/mqtt_handler');
var FakeIo = require('../support/fake_io');
var creds = require('../support/mqtt_creds');

var QUIET_MS = 1000;

function suffix() {
    return crypto.randomBytes(4).toString('hex');
}

// cb(null, client) once connected, cb(err) when the broker refuses.
function connect(options, cb) {
    var client = mqtt.connect(creds.brokerUrl(), options);
    var finished = false;
    function finish(err) {
        if (finished) {
            return;
        }
        finished = true;
        if (err) {
            client.end(true);
            return cb(err);
        }
        cb(null, client);
    }
    client.once('connect', function() {
        finish();
    });
    client.once('error', finish);
    client.once('close', function() {
        finish(new Error('connection closed before CONNACK'));
    });
}

function endAll(clients, done) {
    var remaining = clients.length;
    clients.forEach(function(client) {
        client.end(false, function() {
            remaining -= 1;
            if (remaining === 0) {
                done();
            }
        });
    });
}

describe('broker authentication and ACLs (real Mosquitto)', function() {
    this.timeout(10000);

    it('refuses an anonymous client', function(done) {
        connect({clientId: 'anon-' + suffix(), reconnectPeriod: 0}, function(err) {
            expect(err).to.be.an.instanceof(Error);
            expect(err.message).to.match(/Not authorized|refused/i);
            done();
        });
    });

    it('refuses the device account with a wrong password', function(done) {
        var options = creds.deviceOptions('wrong-' + suffix());
        options.password = 'not-the-password';
        connect(options, function(err) {
            expect(err).to.be.an.instanceof(Error);
            done();
        });
    });

    describe('with a platform client and two device clients', function() {
        var platform;
        var victim;
        var intruder;
        var victimId = 'victim-' + suffix();
        var intruderId = 'intruder-' + suffix();
        var received;

        before(function(done) {
            received = {victim: [], intruder: [], platform: []};
            connect(creds.platformOptions('acl-platform-' + suffix()), function(err, p) {
                if (err) {
                    return done(err);
                }
                platform = p;
                connect(creds.deviceOptions(victimId), function(err2, v) {
                    if (err2) {
                        return done(err2);
                    }
                    victim = v;
                    connect(creds.deviceOptions(intruderId), function(err3, i) {
                        if (err3) {
                            return done(err3);
                        }
                        intruder = i;
                        platform.on('message', function(t) {
                            received.platform.push(t);
                        });
                        victim.on('message', function(t) {
                            received.victim.push(t);
                        });
                        intruder.on('message', function(t) {
                            received.intruder.push(t);
                        });
                        done();
                    });
                });
            });
        });

        after(function(done) {
            endAll([platform, victim, intruder], done);
        });

        function subscribe(client, topics, cb) {
            client.subscribe(topics, {qos: 1}, function(err) {
                cb(err);
            });
        }

        it('lets a device read its own provisioned topic but not another device\'s', function(done) {
            var victimTopic = 'devices/' + victimId + '/provisioned';
            subscribe(victim, [victimTopic], function(err) {
                if (err) {
                    return done(err);
                }
                subscribe(intruder, ['devices/+/provisioned', 'devices/#'], function(err2) {
                    if (err2) {
                        return done(err2);
                    }
                    platform.publish(victimTopic, JSON.stringify({token: 'not-for-the-intruder'}), {qos: 1});
                    setTimeout(function() {
                        expect(received.victim).to.include(victimTopic);
                        expect(received.intruder).to.deep.equal([]);
                        done();
                    }, QUIET_MS);
                });
            });
        });

        it('drops commands and telemetry a device publishes for another device', function(done) {
            var commandsTopic = 'devices/' + victimId + '/commands';
            subscribe(victim, [commandsTopic], function(err) {
                if (err) {
                    return done(err);
                }
                subscribe(platform, ['devices/#'], function(err2) {
                    if (err2) {
                        return done(err2);
                    }
                    received.platform = [];
                    received.victim = [];
                    intruder.publish(commandsTopic, JSON.stringify({command: 'reboot'}), {qos: 1});
                    intruder.publish('devices/' + victimId + '/telemetry', '{}', {qos: 1});
                    intruder.publish('devices/' + intruderId + '/telemetry', '{}', {qos: 1});
                    setTimeout(function() {
                        expect(received.victim).to.deep.equal([]);
                        expect(received.platform).to.deep.equal(['devices/' + intruderId + '/telemetry']);
                        done();
                    }, QUIET_MS);
                });
            });
        });

        it('delivers platform commands to the addressed device', function(done) {
            var commandsTopic = 'devices/' + victimId + '/commands';
            received.victim = [];
            platform.publish(commandsTopic, JSON.stringify({command: 'reboot'}), {qos: 1});
            setTimeout(function() {
                expect(received.victim).to.deep.equal([commandsTopic]);
                done();
            }, QUIET_MS);
        });
    });

    describe('broker credentials in platform logs', function() {
        var SENTINEL = 'S3NTINEL-mqtt-pw';
        var handler;

        after(function(done) {
            handler.close(done);
        });

        it('never writes the broker password when the broker refuses it', function(done) {
            var log = sinon.stub(console, 'log');
            var error = sinon.stub(console, 'error');
            handler = new MQTTHandler({
                host: config.get('mqtt.host'),
                port: config.get('mqtt.port'),
                username: 'platform',
                password: SENTINEL
            }, new FakeIo(), {provisioningKey: 'k'});
            handler.connect();
            setTimeout(function() {
                var output = log.args.concat(error.args).map(function(args) {
                    return args.join(' ');
                }).join('\n');
                log.restore();
                error.restore();
                expect(handler.isConnected()).to.equal(false);
                expect(output).to.match(/MQTT error/);
                expect(output).to.not.contain(SENTINEL);
                done();
            }, QUIET_MS);
        });
    });
});
