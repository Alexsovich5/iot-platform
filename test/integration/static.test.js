'use strict';

var expect = require('chai').expect;
var request = require('supertest');
var createApp = require('../../src/app');

describe('static dashboard assets', function() {
    var app;

    before(function() {
        app = createApp({
            mqttHandler: {isConnected: function() { return false; }}
        });
    });

    it('serves index.html at /', function(done) {
        request(app)
            .get('/')
            .expect('Content-Type', /html/)
            .expect(200)
            .end(function(err, res) {
                if (err) {
                    return done(err);
                }
                expect(res.text).to.contain('<div id="root"></div>');
                expect(res.text).to.contain('/js/bundle.js');
                expect(res.text).to.contain('/css/dashboard.css');
                done();
            });
    });

    it('serves the compiled bundle built into the image', function(done) {
        request(app)
            .get('/js/bundle.js')
            .expect('Content-Type', /javascript/)
            .expect(200)
            .end(function(err, res) {
                if (err) {
                    return done(err);
                }
                expect(res.text.length).to.be.above(100000);
                expect(res.text).to.contain('device-card');
                done();
            });
    });

    it('serves the dashboard stylesheet', function(done) {
        request(app)
            .get('/css/dashboard.css')
            .expect('Content-Type', /css/)
            .expect(200, done);
    });
});
