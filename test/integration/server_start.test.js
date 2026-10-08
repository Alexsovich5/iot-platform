'use strict';

var expect = require('chai').expect;
var request = require('supertest');
var server = require('../../src/server');

describe('server.start', function() {
    describe('with port 0 and no publicBaseUrl', function() {
        var started;

        before(function(done) {
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

        it('binds a non-zero ephemeral port', function() {
            expect(started.port).to.be.a('number');
            expect(started.port).to.be.above(0);
            expect(started.server.address().port).to.equal(started.port);
        });

        it('derives baseUrl from the bound port', function() {
            expect(started.baseUrl).to.equal('http://localhost:' + started.port);
        });

        it('exposes the MQTT handler', function() {
            expect(started.mqttHandler).to.be.an('object');
            expect(started.mqttHandler.isConnected).to.be.a('function');
        });

        it('answers /health over HTTP', function(done) {
            request(started.baseUrl)
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

        it('returns 400 JSON for a malformed JSON body', function(done) {
            request(started.baseUrl)
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
            server.start({port: 0, publicBaseUrl: 'http://example.test'}, function(err, result) {
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
});
