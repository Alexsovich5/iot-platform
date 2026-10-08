'use strict';

var expect = require('chai').expect;
var request = require('supertest');
var createApp = require('../../src/app');
var Device = require('../../src/models/device');
var tokens = require('../../src/lib/tokens');
var db = require('../support/db');

describe('device REST API', function() {
    var app;

    before(function() {
        app = createApp({mqttHandler: {isConnected: function() { return false; }}});
    });

    beforeEach(function(done) {
        db.reset(done);
    });

    function create(body, cb) {
        request(app).post('/api/devices').send(body).end(cb);
    }

    describe('POST /api/devices', function() {
        it('returns 201 with a 32-hex token and stores only its hash', function(done) {
            create({deviceId: 'sensor-1', name: 'Hall sensor', type: 'sensor'}, function(err, res) {
                if (err) {
                    return done(err);
                }
                expect(res.status).to.equal(201);
                expect(res.body.token).to.match(/^[0-9a-f]{32}$/);
                expect(res.body.device.deviceId).to.equal('sensor-1');
                expect(res.body.device.status).to.equal('registered');
                expect(res.body.device.provisionedBy).to.equal('api');
                expect(res.body.device).to.not.have.property('tokenHash');

                Device.findOne({deviceId: 'sensor-1'}).select('+tokenHash').exec(function(findErr, device) {
                    if (findErr) {
                        return done(findErr);
                    }
                    expect(device.tokenHash).to.match(/^[0-9a-f]{64}$/);
                    expect(tokens.verify(res.body.token, device.tokenHash)).to.equal(true);
                    done();
                });
            });
        });

        it('returns 409 for a deviceId that already exists', function(done) {
            create({deviceId: 'dup-1', name: 'First'}, function(err, first) {
                if (err) {
                    return done(err);
                }
                expect(first.status).to.equal(201);
                create({deviceId: 'dup-1', name: 'Second'}, function(err2, second) {
                    if (err2) {
                        return done(err2);
                    }
                    expect(second.status).to.equal(409);
                    expect(second.body).to.have.property('error');
                    Device.count({deviceId: 'dup-1'}, function(countErr, n) {
                        expect(n).to.equal(1);
                        done(countErr);
                    });
                });
            });
        });

        it('returns 400 for a deviceId outside the allowed characters', function(done) {
            create({deviceId: 'bad id/with#chars', name: 'Bad'}, function(err, res) {
                if (err) {
                    return done(err);
                }
                expect(res.status).to.equal(400);
                expect(res.body).to.have.property('error');
                done();
            });
        });

        it('returns 400 when the name is missing', function(done) {
            create({deviceId: 'no-name'}, function(err, res) {
                if (err) {
                    return done(err);
                }
                expect(res.status).to.equal(400);
                done();
            });
        });

        it('returns 400 for an unknown device type', function(done) {
            create({deviceId: 'typed', name: 'X', type: 'toaster'}, function(err, res) {
                if (err) {
                    return done(err);
                }
                expect(res.status).to.equal(400);
                done();
            });
        });
    });

    describe('db.reset', function() {
        it('keeps the unique index on deviceId so duplicates raise E11000', function(done) {
            Device.collection.indexInformation(function(err, info) {
                if (err) {
                    return done(err);
                }
                var hasDeviceIdIndex = Object.keys(info).some(function(name) {
                    return info[name].length === 1 && info[name][0][0] === 'deviceId';
                });
                expect(hasDeviceIdIndex).to.equal(true);

                Device.create({deviceId: 'idx-1', name: 'A'}, function(createErr) {
                    if (createErr) {
                        return done(createErr);
                    }
                    Device.create({deviceId: 'idx-1', name: 'B'}, function(dupErr) {
                        expect(dupErr).to.exist;
                        expect(dupErr.code).to.equal(11000);
                        done();
                    });
                });
            });
        });
    });

    describe('GET /api/devices/:id', function() {
        beforeEach(function(done) {
            Device.create({
                deviceId: 'detail-1',
                name: 'Detail',
                tokenHash: tokens.hash('secret'),
                telemetry: [{temperature: 21}, {temperature: 22}]
            }, done);
        });

        it('omits telemetry and tokenHash', function(done) {
            request(app).get('/api/devices/detail-1').expect(200).end(function(err, res) {
                if (err) {
                    return done(err);
                }
                expect(res.body.deviceId).to.equal('detail-1');
                expect(res.body).to.not.have.property('telemetry');
                expect(res.body).to.not.have.property('tokenHash');
                done();
            });
        });

        it('returns 404 for an unknown device', function(done) {
            request(app).get('/api/devices/missing-1').expect(404, done);
        });

        it('returns 400 for an invalid deviceId', function(done) {
            request(app).get('/api/devices/' + encodeURIComponent('a b')).expect(400, done);
        });
    });

    describe('PUT /api/devices/:id', function() {
        beforeEach(function(done) {
            Device.create({
                deviceId: 'put-1',
                name: 'Before',
                tokenHash: tokens.hash('keep-me'),
                telemetry: [{temperature: 20}]
            }, done);
        });

        it('updates whitelisted fields and ignores the rest', function(done) {
            request(app)
                .put('/api/devices/put-1')
                .send({
                    name: 'After',
                    tags: ['roof'],
                    location: {building: 'B1', floor: '2', zone: 'north'},
                    metadata: {serial: 'X1'},
                    telemetry: [],
                    tokenHash: 'x',
                    deviceId: 'renamed',
                    provisionedBy: 'mqtt'
                })
                .expect(200)
                .end(function(err, res) {
                    if (err) {
                        return done(err);
                    }
                    expect(res.body.name).to.equal('After');
                    expect(res.body.tags).to.deep.equal(['roof']);
                    expect(res.body.location.building).to.equal('B1');
                    expect(res.body.metadata).to.deep.equal({serial: 'X1'});
                    expect(res.body.deviceId).to.equal('put-1');
                    expect(res.body).to.not.have.property('tokenHash');

                    Device.findOne({deviceId: 'put-1'}).select('+tokenHash').exec(function(findErr, device) {
                        if (findErr) {
                            return done(findErr);
                        }
                        expect(device.tokenHash).to.equal(tokens.hash('keep-me'));
                        expect(device.telemetry).to.have.length(1);
                        expect(device.provisionedBy).to.equal(undefined);
                        done();
                    });
                });
        });

        it('applies a valid status transition', function(done) {
            request(app)
                .put('/api/devices/put-1')
                .send({status: 'maintenance'})
                .expect(200)
                .end(function(err, res) {
                    if (err) {
                        return done(err);
                    }
                    expect(res.body.status).to.equal('maintenance');
                    done();
                });
        });

        it('returns 409 for decommissioned -> online', function(done) {
            Device.update({deviceId: 'put-1'}, {$set: {status: 'decommissioned'}}, function(err) {
                if (err) {
                    return done(err);
                }
                request(app)
                    .put('/api/devices/put-1')
                    .send({status: 'online'})
                    .expect(409)
                    .end(function(putErr) {
                        if (putErr) {
                            return done(putErr);
                        }
                        Device.findOne({deviceId: 'put-1'}, function(findErr, device) {
                            expect(device.status).to.equal('decommissioned');
                            done(findErr);
                        });
                    });
            });
        });

        it('returns 400 for an unknown status value', function(done) {
            request(app).put('/api/devices/put-1').send({status: 'sleeping'}).expect(400, done);
        });

        it('returns 404 for an unknown device', function(done) {
            request(app).put('/api/devices/nobody').send({name: 'x'}).expect(404, done);
        });
    });

    describe('DELETE /api/devices/:id', function() {
        it('decommissions the device and revokes its token', function(done) {
            create({deviceId: 'del-1', name: 'Doomed'}, function(err, created) {
                if (err) {
                    return done(err);
                }
                expect(created.status).to.equal(201);
                request(app).delete('/api/devices/del-1').expect(200).end(function(delErr, res) {
                    if (delErr) {
                        return done(delErr);
                    }
                    expect(res.body.status).to.equal('decommissioned');
                    request(app).get('/api/devices/del-1').expect(200).end(function(getErr, got) {
                        if (getErr) {
                            return done(getErr);
                        }
                        expect(got.body.status).to.equal('decommissioned');
                        Device.findOne({deviceId: 'del-1'}).select('+tokenHash').exec(function(findErr, device) {
                            if (findErr) {
                                return done(findErr);
                            }
                            expect(device.tokenHash).to.equal(undefined);
                            done();
                        });
                    });
                });
            });
        });

        it('returns 404 for an unknown device', function(done) {
            request(app).delete('/api/devices/ghost').expect(404, done);
        });
    });

    describe('GET /api/devices filters and /api/stats', function() {
        beforeEach(function(done) {
            Device.create([
                {deviceId: 'f-1', name: 'a', type: 'sensor', status: 'online'},
                {deviceId: 'f-2', name: 'b', type: 'sensor', status: 'offline'},
                {deviceId: 'f-3', name: 'c', type: 'gateway', status: 'online'},
                {deviceId: 'f-4', name: 'd', type: 'actuator', status: 'maintenance'}
            ], done);
        });

        it('filters by status', function(done) {
            request(app).get('/api/devices?status=online').expect(200).end(function(err, res) {
                if (err) {
                    return done(err);
                }
                expect(res.body.count).to.equal(2);
                var ids = res.body.devices.map(function(d) { return d.deviceId; }).sort();
                expect(ids).to.deep.equal(['f-1', 'f-3']);
                done();
            });
        });

        it('filters by type', function(done) {
            request(app).get('/api/devices?type=sensor').expect(200).end(function(err, res) {
                if (err) {
                    return done(err);
                }
                expect(res.body.count).to.equal(2);
                res.body.devices.forEach(function(d) {
                    expect(d.type).to.equal('sensor');
                    expect(d).to.not.have.property('telemetry');
                });
                done();
            });
        });

        it('counts devices by status', function(done) {
            request(app).get('/api/stats').expect(200).end(function(err, res) {
                if (err) {
                    return done(err);
                }
                expect(res.body).to.deep.equal({online: 2, offline: 1, maintenance: 1});
                done();
            });
        });
    });

    describe('GET /api/devices/:id/telemetry', function() {
        beforeEach(function(done) {
            var points = [];
            for (var i = 0; i < 1200; i++) {
                points.push({timestamp: new Date(1000 * i), temperature: i});
            }
            Device.collection.insert({deviceId: 'tele-1', name: 'T', telemetry: points}, done);
        });

        it('clamps limit=5000 to 1000 points, newest last', function(done) {
            request(app).get('/api/devices/tele-1/telemetry?limit=5000').expect(200).end(function(err, res) {
                if (err) {
                    return done(err);
                }
                expect(res.body.deviceId).to.equal('tele-1');
                expect(res.body.telemetry).to.have.length(1000);
                expect(res.body.telemetry[999].temperature).to.equal(1199);
                done();
            });
        });

        it('clamps a limit below 1 to a single point', function(done) {
            request(app).get('/api/devices/tele-1/telemetry?limit=-3').expect(200).end(function(err, res) {
                if (err) {
                    return done(err);
                }
                expect(res.body.telemetry).to.have.length(1);
                expect(res.body.telemetry[0].temperature).to.equal(1199);
                done();
            });
        });

        it('defaults to 100 points', function(done) {
            request(app).get('/api/devices/tele-1/telemetry').expect(200).end(function(err, res) {
                if (err) {
                    return done(err);
                }
                expect(res.body.telemetry).to.have.length(100);
                done();
            });
        });
    });
});
