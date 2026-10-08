'use strict';

var expect = require('chai').expect;
var request = require('supertest');
var createApp = require('../../src/app');

describe('createApp', function() {
    var app;
    var connected;

    beforeEach(function() {
        connected = true;
        app = createApp({
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

        it('reports mqtt as disconnected when the handler is not connected', function(done) {
            connected = false;
            request(app)
                .get('/health')
                .expect(200)
                .end(function(err, res) {
                    if (err) {
                        return done(err);
                    }
                    expect(res.body.mqtt).to.equal('disconnected');
                    done();
                });
        });

        it('defaults rejectedMessages to 0 when no stats function is given', function(done) {
            var bare = createApp({mqttHandler: {isConnected: function() { return false; }}});
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
        request(app)
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
        request(app)
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
