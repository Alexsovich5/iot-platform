'use strict';

var expect = require('chai').expect;
var firmware = require('../../src/lib/firmware');
var FakeIo = require('../support/fake_io');

var FirmwareService = firmware.FirmwareService;

// In-memory stand-in for the FirmwareUpdate model covering the calls the
// service makes: create, findOne and a conditional findOneAndUpdate.
function FakeUpdates() {
    var self = this;
    this.records = [];
    this.nextId = 1;

    function matches(record, query) {
        return Object.keys(query).every(function(key) {
            return String(record[key]) === String(query[key]);
        });
    }

    this.create = function(doc, cb) {
        var record = JSON.parse(JSON.stringify(doc));
        record._id = ('000000000000000000000000' + (self.nextId++).toString(16)).slice(-24);
        self.records.push(record);
        process.nextTick(function() {
            cb(null, record);
        });
    };

    this.findOne = function(query, cb) {
        var found = self.records.filter(function(r) {
            return matches(r, query);
        })[0] || null;
        process.nextTick(function() {
            cb(null, found);
        });
    };

    this.findOneAndUpdate = function(query, update, opts, cb) {
        var found = self.records.filter(function(r) {
            return matches(r, query);
        })[0] || null;
        if (found) {
            Object.keys(update.$set || {}).forEach(function(key) {
                found[key] = update.$set[key];
            });
            Object.keys(update.$push || {}).forEach(function(key) {
                found[key] = (found[key] || []).concat([update.$push[key]]);
            });
        }
        process.nextTick(function() {
            cb(null, found);
        });
    };
}

function FakeMqttHandler() {
    this.sent = [];
    this.connected = true;
}

FakeMqttHandler.prototype.isConnected = function() {
    return this.connected;
};

FakeMqttHandler.prototype.sendCommand = function(deviceId, command, payload, cb) {
    this.sent.push({deviceId: deviceId, command: command, payload: payload});
    if (cb) {
        process.nextTick(cb);
    }
    return 'cmd' + this.sent.length;
};

describe('firmware', function() {
    describe('canAdvance', function() {
        var table = [
            ['pending', 'downloading', true],
            ['downloading', 'installing', true],
            ['installing', 'success', true],
            ['pending', 'failed', true],
            ['downloading', 'failed', true],
            ['installing', 'failed', true],
            ['pending', 'installing', false],
            ['pending', 'success', false],
            ['downloading', 'success', false],
            ['downloading', 'downloading', false],
            ['installing', 'downloading', false],
            ['success', 'downloading', false],
            ['success', 'failed', false],
            ['failed', 'downloading', false],
            ['failed', 'success', false],
            ['pending', 'pending', false],
            ['pending', 'rebooting', false],
            ['unknown', 'downloading', false]
        ];

        table.forEach(function(row) {
            it((row[2] ? 'allows ' : 'rejects ') + row[0] + ' -> ' + row[1], function() {
                expect(firmware.canAdvance(row[0], row[1])).to.equal(row[2]);
            });
        });
    });

    describe('FirmwareService', function() {
        var FirmwareUpdate;
        var Device;
        var mqttHandler;
        var io;
        var service;
        var deviceUpdates;
        var sensor;
        var image;

        beforeEach(function() {
            FirmwareUpdate = new FakeUpdates();
            deviceUpdates = [];
            Device = {
                update: function(query, update, cb) {
                    deviceUpdates.push({query: query, update: update});
                    process.nextTick(function() {
                        cb(null, {n: 1});
                    });
                }
            };
            mqttHandler = new FakeMqttHandler();
            io = new FakeIo();
            service = new FirmwareService({
                FirmwareUpdate: FirmwareUpdate,
                Device: Device,
                mqttHandler: mqttHandler,
                io: io,
                baseUrl: 'http://app:3000'
            });
            sensor = {deviceId: 's1', type: 'sensor', status: 'online', firmware: '1.0.0'};
            image = {version: '1.1.0', deviceType: 'sensor', md5: '0123456789abcdef0123456789abcdef'};
        });

        it('stores the injected baseUrl as a public property', function() {
            expect(service.baseUrl).to.equal('http://app:3000');
        });

        describe('startUpdate', function() {
            it('creates a pending update and publishes a firmware_update command with url and md5', function(done) {
                service.startUpdate(sensor, image, function(err, update) {
                    if (err) {
                        return done(err);
                    }
                    expect(update.deviceId).to.equal('s1');
                    expect(update.version).to.equal('1.1.0');
                    expect(update.state).to.equal('pending');
                    expect(update.history).to.have.length(1);
                    expect(update.history[0].state).to.equal('pending');

                    expect(mqttHandler.sent).to.have.length(1);
                    var sent = mqttHandler.sent[0];
                    expect(sent.deviceId).to.equal('s1');
                    expect(sent.command).to.equal('firmware_update');
                    expect(sent.payload).to.deep.equal({
                        updateId: String(update._id),
                        version: '1.1.0',
                        url: 'http://app:3000/firmware/sensor/1.1.0.bin',
                        md5: image.md5
                    });
                    done();
                });
            });

            it('reads baseUrl at call time, so a later assignment is used', function(done) {
                service.baseUrl = 'http://localhost:4567';
                service.startUpdate(sensor, image, function(err) {
                    if (err) {
                        return done(err);
                    }
                    expect(mqttHandler.sent[0].payload.url.indexOf('http://localhost:4567/firmware/')).to.equal(0);
                    expect(mqttHandler.sent[0].payload.url).to.equal('http://localhost:4567/firmware/sensor/1.1.0.bin');
                    done();
                });
            });

            it('fails with 503 and records nothing when the broker is disconnected', function(done) {
                mqttHandler.connected = false;
                service.startUpdate(sensor, image, function(err) {
                    expect(err).to.exist;
                    expect(err.status).to.equal(503);
                    expect(FirmwareUpdate.records).to.have.length(0);
                    expect(mqttHandler.sent).to.have.length(0);
                    done();
                });
            });

            it('emits the new update to every dashboard', function(done) {
                service.startUpdate(sensor, image, function(err, update) {
                    if (err) {
                        return done(err);
                    }
                    var emitted = io.emittedTo(null, 'firmware');
                    expect(emitted).to.have.length(1);
                    expect(emitted[0].data.update).to.equal(update);
                    done();
                });
            });
        });

        describe('handleProgress', function() {
            var update;

            beforeEach(function(done) {
                service.startUpdate(sensor, image, function(err, created) {
                    update = created;
                    io.emitted = [];
                    done(err);
                });
            });

            function progress(deviceId, state, cb, extra) {
                var payload = {updateId: String(update._id), state: state};
                Object.keys(extra || {}).forEach(function(key) {
                    payload[key] = extra[key];
                });
                service.handleProgress(deviceId, payload, cb);
            }

            it('advances through downloading, installing and success, appending history', function(done) {
                progress('s1', 'downloading', function(err) {
                    if (err) {
                        return done(err);
                    }
                    progress('s1', 'installing', function(err2) {
                        if (err2) {
                            return done(err2);
                        }
                        progress('s1', 'success', function(err3, final) {
                            if (err3) {
                                return done(err3);
                            }
                            expect(final.state).to.equal('success');
                            expect(final.history.map(function(h) {
                                return h.state;
                            })).to.deep.equal(['pending', 'downloading', 'installing', 'success']);
                            expect(deviceUpdates).to.have.length(1);
                            expect(deviceUpdates[0].query).to.deep.equal({deviceId: 's1'});
                            expect(deviceUpdates[0].update).to.deep.equal({$set: {firmware: '1.1.0'}});
                            expect(io.emittedTo(null, 'firmware')).to.have.length(3);
                            done();
                        });
                    });
                });
            });

            it('rejects success -> downloading and leaves the record unchanged', function(done) {
                FirmwareUpdate.records[0].state = 'success';
                progress('s1', 'downloading', function(err) {
                    expect(err).to.exist;
                    expect(err.status).to.equal(409);
                    expect(FirmwareUpdate.records[0].state).to.equal('success');
                    expect(FirmwareUpdate.records[0].history).to.have.length(1);
                    expect(io.emitted).to.have.length(0);
                    done();
                });
            });

            it('rejects an updateId that belongs to another device', function(done) {
                progress('other', 'downloading', function(err) {
                    expect(err).to.exist;
                    expect(err.status).to.equal(404);
                    expect(FirmwareUpdate.records[0].state).to.equal('pending');
                    expect(io.emitted).to.have.length(0);
                    done();
                });
            });

            it('rejects a malformed updateId and an unknown state', function(done) {
                service.handleProgress('s1', {updateId: 'nope', state: 'downloading'}, function(err) {
                    expect(err).to.exist;
                    expect(err.status).to.equal(400);
                    progress('s1', 'exploded', function(err2) {
                        expect(err2).to.exist;
                        expect(err2.status).to.equal(400);
                        expect(FirmwareUpdate.records[0].state).to.equal('pending');
                        done();
                    });
                });
            });

            it('records the error text of a failed update and does not touch the device', function(done) {
                progress('s1', 'failed', function(err, final) {
                    if (err) {
                        return done(err);
                    }
                    expect(final.state).to.equal('failed');
                    expect(final.error).to.equal('md5 mismatch');
                    expect(deviceUpdates).to.have.length(0);
                    done();
                }, {error: 'md5 mismatch'});
            });

            it('rejects a transition that lost a race to another message', function(done) {
                // The record moves on between the read and the conditional write.
                var originalFindOne = FirmwareUpdate.findOne;
                FirmwareUpdate.findOne = function(query, cb) {
                    originalFindOne(query, function(err, found) {
                        var snapshot = JSON.parse(JSON.stringify(found));
                        found.state = 'downloading';
                        cb(err, snapshot);
                    });
                };
                progress('s1', 'downloading', function(err) {
                    expect(err).to.exist;
                    expect(err.status).to.equal(409);
                    expect(FirmwareUpdate.records[0].history).to.have.length(1);
                    done();
                });
            });
        });

        describe('rollout', function() {
            it('starts an update for each matching device', function(done) {
                var queries = [];
                var Firmware = {
                    findOne: function(query, cb) {
                        process.nextTick(function() {
                            cb(null, query.version === '1.1.0' ? image : null);
                        });
                    }
                };
                Device.find = function(query, cb) {
                    queries.push(query);
                    process.nextTick(function() {
                        cb(null, [sensor, {deviceId: 's2', type: 'sensor', status: 'offline', firmware: '1.0.0'}]);
                    });
                };
                service = new FirmwareService({
                    FirmwareUpdate: FirmwareUpdate,
                    Device: Device,
                    Firmware: Firmware,
                    mqttHandler: mqttHandler,
                    io: io,
                    baseUrl: 'http://app:3000'
                });
                service.rollout('sensor', '1.1.0', function(err, updates) {
                    if (err) {
                        return done(err);
                    }
                    expect(queries[0]).to.deep.equal({
                        type: 'sensor',
                        status: {$ne: 'decommissioned'},
                        firmware: {$ne: '1.1.0'}
                    });
                    expect(updates.map(function(u) {
                        return u.deviceId;
                    })).to.deep.equal(['s1', 's2']);
                    expect(mqttHandler.sent.map(function(s) {
                        return s.deviceId;
                    })).to.deep.equal(['s1', 's2']);
                    service.rollout('sensor', '9.9.9', function(missingErr) {
                        expect(missingErr).to.exist;
                        expect(missingErr.status).to.equal(404);
                        done();
                    });
                });
            });
        });
    });
});
