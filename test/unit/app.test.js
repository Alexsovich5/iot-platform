'use strict';

var expect = require('chai').expect;
var request = require('supertest');
var createApp = require('../../src/app');
var TEST_API_KEY = require('../support/api').TEST_API_KEY;
var api = require('../support/api').api;

describe('createApp', function() {
    var app;
    var connected;
    var dbConnected;

    beforeEach(function() {
        connected = true;
        dbConnected = true;
        app = createApp({
            apiKey: TEST_API_KEY,
            isDbConnected: function() {
                return dbConnected;
            },
            mqttHandler: {
                isConnected: function() {
                    return connected;
                }
            },
            stats: function() {
                return {rejectedMessages: 3};
            }
        });
    });

    describe('GET /health', function() {
        it('returns 200 with status, uptime, mongodb, mqtt and rejectedMessages', function(done) {
            request(app)
                .get('/health')
                .expect('Content-Type', /json/)
                .expect(200)
                .end(function(err, res) {
                    if (err) {
                        return done(err);
                    }
                    expect(res.body).to.have.all.keys('status', 'uptime', 'mongodb', 'mqtt', 'rejectedMessages');
                    expect(res.body.status).to.equal('healthy');
                    expect(res.body.uptime).to.be.a('number');
                    expect(res.body.mqtt).to.equal('connected');
                    expect(res.body.rejectedMessages).to.equal(3);
                    done();
                });
        });

        it('answers 503 degraded when the MQTT handler is not connected', function(done) {
            connected = false;
            request(app)
                .get('/health')
                .expect(503)
                .end(function(err, res) {
                    if (err) {
                        return done(err);
                    }
                    expect(res.body.status).to.equal('degraded');
                    expect(res.body.mqtt).to.equal('disconnected');
                    expect(res.body.mongodb).to.equal('connected');
                    done();
                });
        });

        it('answers 503 degraded when MongoDB is not connected', function(done) {
            dbConnected = false;
            request(app)
                .get('/health')
                .expect(503)
                .end(function(err, res) {
                    if (err) {
                        return done(err);
                    }
                    expect(res.body.status).to.equal('degraded');
                    expect(res.body.mongodb).to.equal('disconnected');
                    done();
                });
        });

        it('answers 503 degraded when there is no MQTT handler at all', function(done) {
            var bare = createApp({apiKey: TEST_API_KEY, isDbConnected: function() { return true; }});
            request(bare).get('/health').expect(503).end(function(err, res) {
                if (err) {
                    return done(err);
                }
                expect(res.body.status).to.equal('degraded');
                done();
            });
        });

        it('defaults rejectedMessages to 0 when no stats function is given', function(done) {
            var bare = createApp({
                apiKey: TEST_API_KEY,
                isDbConnected: function() { return true; },
                mqttHandler: {isConnected: function() { return true; }}
            });
            request(bare)
                .get('/health')
                .expect(200)
                .end(function(err, res) {
                    if (err) {
                        return done(err);
                    }
                    expect(res.body.rejectedMessages).to.equal(0);
                    done();
                });
        });
    });

    it('returns a 404 JSON body for an unknown /api route', function(done) {
        api(app)
            .get('/api/nope')
            .expect('Content-Type', /json/)
            .expect(404)
            .end(function(err, res) {
                if (err) {
                    return done(err);
                }
                expect(res.body).to.have.property('error');
                done();
            });
    });

    it('returns a 400 JSON body for a malformed JSON request', function(done) {
        api(app)
            .put('/api/devices/abc')
            .set('Content-Type', 'application/json')
            .send('{"name": ')
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

    it('serves public/index.html with the #root mount point', function(done) {
        request(app)
            .get('/')
            .expect(200)
            .expect(/id="root"/)
            .expect(/\/js\/bundle\.js/, done);
    });
});
