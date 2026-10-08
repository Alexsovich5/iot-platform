'use strict';

var fs = require('fs');
var expect = require('chai').expect;
var config = require('config');
var mongoose = require('mongoose');
var request = require('supertest');
var server = require('../../src/server');
var api = require('../support/api').api;
var TEST_API_KEY = require('../support/api').TEST_API_KEY;

// Calls back once the broker (platform account from config) and MongoDB
// are both connected, or with an error after 10 s.
function whenConnected(started, done) {
    var deadline = Date.now() + 10000;
    (function poll() {
        if (started.mqttHandler.isConnected() && mongoose.connection.readyState === 1) {
            return done();
        }
        if (Date.now() > deadline) {
            return done(new Error('broker or MongoDB not connected within 10 s'));
        }
        setTimeout(poll, 50);
    })();
}

describe('server.start', function() {
    this.timeout(15000);

    describe('with port 0 and no publicBaseUrl', function() {
        var started;

        before(function(done) {
            server.start({apiKey: TEST_API_KEY, port: 0}, function(err, result) {
                if (err) {
                    return done(err);
                }
                started = result;
                whenConnected(started, done);
            });
        });

        after(function(done) {
            started.close(done);
        });

        it('binds a non-zero ephemeral port', function() {
            expect(started.port).to.be.a('number');
            expect(started.port).to.be.above(0);
            expect(started.server.address().port).to.equal(started.port);
        });

        it('derives baseUrl from the bound port', function() {
            expect(started.baseUrl).to.equal('http://localhost:' + started.port);
        });

        it('points the firmware service at the bound base URL before calling back', function() {
            expect(started.firmwareService).to.be.an('object');
            expect(started.firmwareService.baseUrl).to.equal('http://localhost:' + started.port);
            expect(started.mqttHandler.firmware).to.equal(started.firmwareService);
        });

        it('exposes the MQTT handler', function() {
            expect(started.mqttHandler).to.be.an('object');
            expect(started.mqttHandler.isConnected).to.be.a('function');
        });

        it('starts the presence sweeper once Mongo is connected', function(done) {
            var mongoose = require('mongoose');
            function check() {
                expect(started.presence).to.be.an('object');
                expect(started.presence.offlineAfterSec).to.equal(120);
                expect(started.presence.intervalSec).to.equal(30);
                expect(started.presence.isRunning()).to.equal(true);
                done();
            }
            if (mongoose.connection.readyState === 1) {
                return setImmediate(check);
            }
            mongoose.connection.once('open', function() {
                setImmediate(check);
            });
        });

        it('answers /health over HTTP', function(done) {
            api(started.baseUrl)
                .get('/health')
                .expect(200)
                .end(function(err, res) {
                    if (err) {
                        return done(err);
                    }
                    expect(res.body.status).to.equal('healthy');
                    done();
                });
        });

        it('reports the MQTT handler rejection count in /health', function(done) {
            started.mqttHandler.rejectedCount = 2;
            api(started.baseUrl)
                .get('/health')
                .expect(200)
                .end(function(err, res) {
                    started.mqttHandler.rejectedCount = 0;
                    if (err) {
                        return done(err);
                    }
                    expect(res.body.rejectedMessages).to.equal(2);
                    done();
                });
        });

        it('returns 400 JSON for a malformed JSON body', function(done) {
            api(started.baseUrl)
                .put('/api/devices/abc')
                .set('Content-Type', 'application/json')
                .send('{"broken": ')
                .expect('Content-Type', /json/)
                .expect(400)
                .end(function(err, res) {
                    if (err) {
                        return done(err);
                    }
                    expect(res.body).to.have.property('error');
                    done();
                });
        });
    });

    describe('with an explicit publicBaseUrl', function() {
        var started;

        before(function(done) {
            server.start({apiKey: TEST_API_KEY, port: 0, publicBaseUrl: 'http://example.test'}, function(err, result) {
                if (err) {
                    return done(err);
                }
                started = result;
                done();
            });
        });

        after(function(done) {
            started.close(done);
        });

        it('keeps the override as baseUrl', function() {
            expect(started.port).to.be.above(0);
            expect(started.baseUrl).to.equal('http://example.test');
        });
    });

    describe('without an apiKey override', function() {
        var started;
        var keyFile = config.get('api.keyFile');

        before(function(done) {
            try {
                fs.unlinkSync(keyFile);
            } catch (e) {
                if (e.code !== 'ENOENT') {
                    return done(e);
                }
            }
            server.start({port: 0}, function(err, result) {
                if (err) {
                    return done(err);
                }
                started = result;
                done();
            });
        });

        after(function(done) {
            started.close(done);
        });

        it('creates the operator key file and requires that key on /api', function(done) {
            var key = fs.readFileSync(keyFile, 'utf8').trim();
            expect(key).to.match(/^[0-9a-f]{64}$/);
            request(started.baseUrl).get('/api/rules').expect(401).end(function(err) {
                if (err) {
                    return done(err);
                }
                api(started.baseUrl, key).get('/api/rules').expect(200, done);
            });
        });
    });

    it('fails to start when the configured broker password file is missing', function(done) {
        server.start({apiKey: TEST_API_KEY, port: 0, mqtt: {password: '', passwordFile: '/nonexistent/pw'}},
            function(err) {
                expect(err).to.be.an.instanceof(Error);
                expect(err.message).to.contain('/nonexistent/pw');
                done();
            });
    });
});
