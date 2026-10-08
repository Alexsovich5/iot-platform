'use strict';

var crypto = require('crypto');
var fs = require('fs');
var path = require('path');
var expect = require('chai').expect;
var request = require('supertest');
var createApp = require('../../src/app');
var Firmware = require('../../src/models/firmware');
var db = require('../support/db');

// supertest buffers only text and JSON responses; binary bodies are
// collected here so they can be compared byte for byte.
function binaryParser(res, cb) {
    var chunks = [];
    res.on('data', function(chunk) {
        chunks.push(chunk);
    });
    res.on('end', function() {
        cb(null, Buffer.concat(chunks));
    });
}

describe('firmware registry', function() {
    var app;
    var dir = path.join('/tmp', 'firmware-registry-' + crypto.randomBytes(4).toString('hex'));
    var blob = crypto.randomBytes(1024);
    var md5 = crypto.createHash('md5').update(blob).digest('hex');

    function upload(query, body, contentType) {
        return request(app)
            .post('/api/firmware')
            .query(query)
            .set('Content-Type', contentType || 'application/octet-stream')
            .send(body);
    }

    before(function(done) {
        db.reset(done);
    });

    before(function() {
        app = createApp({
            mqttHandler: {isConnected: function() { return false; }},
            firmwareDir: dir
        });
    });

    it('stores an upload with its size and md5 and lists it', function(done) {
        upload({version: '1.2.0', deviceType: 'sensor'}, blob)
            .expect(201)
            .end(function(err, res) {
                if (err) {
                    return done(err);
                }
                expect(res.body.version).to.equal('1.2.0');
                expect(res.body.deviceType).to.equal('sensor');
                expect(res.body.size).to.equal(1024);
                expect(res.body.md5).to.equal(md5);
                expect(res.body.filename).to.equal('sensor/1.2.0.bin');

                var onDisk = fs.readFileSync(path.join(dir, 'sensor', '1.2.0.bin'));
                expect(onDisk.equals(blob)).to.equal(true);

                request(app).get('/api/firmware').expect(200).end(function(listErr, list) {
                    if (listErr) {
                        return done(listErr);
                    }
                    expect(list.body.firmware).to.have.length(1);
                    expect(list.body.firmware[0].md5).to.equal(md5);
                    done();
                });
            });
    });

    it('serves a byte-identical download', function(done) {
        request(app)
            .get('/firmware/sensor/1.2.0.bin')
            .buffer(true)
            .parse(binaryParser)
            .expect(200)
            .expect('Content-Type', /application\/octet-stream/)
            .end(function(err, res) {
                if (err) {
                    return done(err);
                }
                expect(Buffer.isBuffer(res.body)).to.equal(true);
                expect(res.body.length).to.equal(1024);
                expect(res.body.equals(blob)).to.equal(true);
                expect(crypto.createHash('md5').update(res.body).digest('hex')).to.equal(md5);
                done();
            });
    });

    it('returns 409 for a duplicate version and device type', function(done) {
        upload({version: '1.2.0', deviceType: 'sensor'}, crypto.randomBytes(16))
            .expect(409)
            .end(function(err) {
                if (err) {
                    return done(err);
                }
                Firmware.count({}, function(countErr, n) {
                    if (countErr) {
                        return done(countErr);
                    }
                    expect(n).to.equal(1);
                    var onDisk = fs.readFileSync(path.join(dir, 'sensor', '1.2.0.bin'));
                    expect(onDisk.equals(blob)).to.equal(true);
                    done();
                });
            });
    });

    it('turns a duplicate-key error from the unique index into 409', function(done) {
        // Simulates two uploads racing past the findOne pre-check.
        var original = Firmware.findOne;
        Firmware.findOne = function(query, cb) {
            Firmware.findOne = original;
            cb(null, null);
        };
        upload({version: '1.2.0', deviceType: 'sensor'}, blob)
            .expect(409)
            .end(function(err) {
                Firmware.findOne = original;
                done(err);
            });
    });

    it('accepts the same version for another device type', function(done) {
        upload({version: '1.2.0', deviceType: 'gateway'}, blob).expect(201).end(done);
    });

    it('returns 400 for a bad version', function(done) {
        upload({version: '1.2', deviceType: 'sensor'}, blob)
            .expect(400)
            .end(function(err, res) {
                if (err) {
                    return done(err);
                }
                expect(res.body.error).to.match(/version/);
                done();
            });
    });

    it('returns 400 for an unknown device type', function(done) {
        upload({version: '1.0.0', deviceType: '..'}, blob).expect(400).end(done);
    });

    it('returns 400 for an empty body', function(done) {
        upload({version: '1.0.0', deviceType: 'sensor'}, new Buffer(0)).expect(400).end(done);
    });

    it('rejects a body that is not application/octet-stream', function(done) {
        upload({version: '1.0.1', deviceType: 'sensor'}, '{"a":1}', 'application/json')
            .end(function(err, res) {
                if (err) {
                    return done(err);
                }
                expect([400, 415]).to.include(res.status);
                done();
            });
    });

    it('returns 413 for an 11 MB body', function(done) {
        upload({version: '9.9.9', deviceType: 'sensor'}, new Buffer(11 * 1024 * 1024))
            .expect(413)
            .end(function(err) {
                if (err) {
                    return done(err);
                }
                expect(fs.existsSync(path.join(dir, 'sensor', '9.9.9.bin'))).to.equal(false);
                done();
            });
    });

    it('returns 404 for a firmware file that does not exist', function(done) {
        request(app).get('/firmware/sensor/7.7.7.bin').expect(404).end(done);
    });

    it('returns 404 for a malformed download path', function(done) {
        request(app).get('/firmware/sensor/..%2F..%2Fetc.bin').expect(404).end(done);
    });
});
