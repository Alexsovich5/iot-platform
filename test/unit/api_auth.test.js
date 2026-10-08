'use strict';

var expect = require('chai').expect;
var sinon = require('sinon');
var request = require('supertest');
var createApp = require('../../src/app');
var apiAuth = require('../../src/lib/api_auth');

var KEY = 'unit-operator-key-0123456789abcdef';
var RULE_ID = '0123456789abcdef01234567';

// Every /api route: state-changing and data-returning alike.
var ROUTES = [
    ['get', '/api/stats'],
    ['get', '/api/devices'],
    ['post', '/api/devices'],
    ['get', '/api/devices/d1'],
    ['put', '/api/devices/d1'],
    ['delete', '/api/devices/d1'],
    ['get', '/api/devices/d1/telemetry'],
    ['post', '/api/devices/d1/commands'],
    ['post', '/api/devices/d1/firmware'],
    ['get', '/api/rules'],
    ['post', '/api/rules'],
    ['put', '/api/rules/' + RULE_ID],
    ['delete', '/api/rules/' + RULE_ID],
    ['get', '/api/alerts'],
    ['post', '/api/alerts/' + RULE_ID + '/ack'],
    ['get', '/api/firmware'],
    ['post', '/api/firmware?version=1.0.0&deviceType=sensor'],
    ['get', '/api/firmware/updates'],
    ['post', '/api/firmware/sensor/1.0.0/rollout'],
    ['get', '/api/nope']
];

function failIfCalled() {
    throw new Error('a rejected request reached the data layer');
}

// Models whose every method fails the test: a request rejected by the
// API key check must never reach them.
var Untouchable = {
    find: failIfCalled,
    findOne: failIfCalled,
    findById: failIfCalled,
    create: failIfCalled,
    findByIdAndUpdate: failIfCalled,
    findByIdAndRemove: failIfCalled
};

describe('operator API key', function() {
    var app;

    beforeEach(function() {
        app = createApp({
            apiKey: KEY,
            mqttHandler: {isConnected: function() { return true; }},
            isDbConnected: function() { return true; },
            Rule: Untouchable,
            Alert: Untouchable
        });
    });

    it('createApp refuses to build an app without a key', function() {
        expect(function() {
            createApp({mqttHandler: {isConnected: function() { return true; }}});
        }).to.throw(/apiKey/);
    });

    ROUTES.forEach(function(route) {
        var method = route[0];
        var url = route[1];

        it('rejects ' + method.toUpperCase() + ' ' + url + ' without a key', function(done) {
            request(app)[method](url)
                .expect('WWW-Authenticate', /Bearer/)
                .expect(401)
                .end(function(err, res) {
                    if (err) {
                        return done(err);
                    }
                    expect(res.body.error).to.match(/API key/);
                    done();
                });
        });

        it('rejects ' + method.toUpperCase() + ' ' + url + ' with a wrong key', function(done) {
            request(app)[method](url)
                .set('Authorization', 'Bearer S3NTINEL-wrong-key')
                .expect(401)
                .end(function(err, res) {
                    if (err) {
                        return done(err);
                    }
                    expect(res.text).to.not.contain('S3NTINEL');
                    done();
                });
        });
    });

    it('rejects the right key sent with another scheme or as a prefix', function(done) {
        request(app).get('/api/rules').set('Authorization', 'Basic ' + KEY).expect(401).end(function(err) {
            if (err) {
                return done(err);
            }
            request(app).get('/api/rules').set('Authorization', 'Bearer ' + KEY.slice(0, -1))
                .expect(401).end(function(err2) {
                    if (err2) {
                        return done(err2);
                    }
                    request(app).get('/api/rules').set('Authorization', 'Bearer ' + KEY + 'x')
                        .expect(401, done);
                });
        });
    });

    it('lets the right key through to the route', function(done) {
        var Rule = {find: sinon.stub().returns({
            sort: function() {
                return {exec: function(cb) { cb(null, []); }};
            }
        })};
        var authed = createApp({apiKey: KEY, Rule: Rule, mqttHandler: {isConnected: function() { return true; }}});
        request(authed).get('/api/rules').set('Authorization', 'Bearer ' + KEY).expect(200).end(function(err, res) {
            if (err) {
                return done(err);
            }
            expect(res.body).to.deep.equal({rules: [], count: 0});
            done();
        });
    });

    it('accepts the scheme name in any case', function(done) {
        var Rule = {find: function() {
            return {sort: function() {
                return {exec: function(cb) { cb(null, []); }};
            }};
        }};
        var authed = createApp({apiKey: KEY, Rule: Rule, mqttHandler: {isConnected: function() { return true; }}});
        request(authed).get('/api/rules').set('Authorization', 'bearer ' + KEY).expect(200, done);
    });

    it('keeps GET /health public', function(done) {
        request(app).get('/health').expect(200, done);
    });

    it('checks the key before parsing a request body', function(done) {
        request(app)
            .post('/api/rules')
            .set('Content-Type', 'application/json')
            .send('{"broken": ')
            .expect(401, done);
    });

    describe('bearerToken', function() {
        it('extracts the token of a Bearer header', function() {
            expect(apiAuth.bearerToken('Bearer abc')).to.equal('abc');
            expect(apiAuth.bearerToken('BEARER   abc  ')).to.equal('abc');
        });

        it('returns null for anything else', function() {
            expect(apiAuth.bearerToken(undefined)).to.equal(null);
            expect(apiAuth.bearerToken('')).to.equal(null);
            expect(apiAuth.bearerToken('Basic abc')).to.equal(null);
            expect(apiAuth.bearerToken('Bearer')).to.equal(null);
            expect(apiAuth.bearerToken(['Bearer abc'])).to.equal(null);
        });
    });

    describe('keyMatches', function() {
        it('is true only for the exact key', function() {
            expect(apiAuth.keyMatches(KEY, KEY)).to.equal(true);
            expect(apiAuth.keyMatches(KEY + ' ', KEY)).to.equal(false);
            expect(apiAuth.keyMatches('', KEY)).to.equal(false);
            expect(apiAuth.keyMatches(null, KEY)).to.equal(false);
            expect(apiAuth.keyMatches({}, KEY)).to.equal(false);
        });

        it('is false when no key is configured', function() {
            expect(apiAuth.keyMatches('', '')).to.equal(false);
            expect(apiAuth.keyMatches('x', undefined)).to.equal(false);
        });
    });
});
