'use strict';

var http = require('http');
var expect = require('chai').expect;
var sinon = require('sinon');
var Notifier = require('../../src/lib/notifier');
var WebhookStub = require('../support/webhook_stub');

describe('Notifier', function() {
    var stub;
    var log;

    beforeEach(function(done) {
        log = sinon.spy();
        stub = new WebhookStub();
        stub.start(done);
    });

    afterEach(function(done) {
        stub.close(done);
    });

    var alert = {
        _id: 'a1',
        deviceId: 'd1',
        source: 'rule',
        severity: 'critical',
        message: 'temperature 35 gt 30',
        metric: 'temperature',
        value: 35,
        threshold: 30
    };

    it('POSTs the alert as JSON with the right Content-Type', function(done) {
        var notifier = new Notifier({url: stub.url, log: log});
        notifier.notify(alert, function(err) {
            expect(err).to.not.exist;
            expect(stub.requests).to.have.length(1);
            var req = stub.requests[0];
            expect(req.method).to.equal('POST');
            expect(req.url).to.equal('/hook');
            expect(req.headers['content-type']).to.equal('application/json');
            expect(Number(req.headers['content-length'])).to.equal(Buffer.byteLength(req.body));
            expect(JSON.parse(req.body)).to.deep.equal({alert: alert});
            expect(log.called).to.equal(false);
            done();
        });
    });

    it('serialises a document through its toJSON method', function(done) {
        var doc = {toJSON: function() {
            return {_id: 'a2', message: 'from toJSON'};
        }};
        new Notifier({url: stub.url, log: log}).notify(doc, function(err) {
            expect(err).to.not.exist;
            expect(JSON.parse(stub.requests[0].body)).to.deep.equal({alert: {_id: 'a2', message: 'from toJSON'}});
            done();
        });
    });

    it('makes no request when the URL is empty', function(done) {
        var requestSpy = sinon.spy(http, 'request');
        var notifier = new Notifier({url: '', log: log});
        notifier.notify(alert, function(err, result) {
            requestSpy.restore();
            expect(err).to.not.exist;
            expect(result).to.deep.equal({skipped: true});
            expect(requestSpy.called).to.equal(false);
            expect(stub.requests).to.have.length(0);
            done();
        });
    });

    it('treats a missing options object as no URL', function(done) {
        new Notifier().notify(alert, function(err, result) {
            expect(err).to.not.exist;
            expect(result.skipped).to.equal(true);
            done();
        });
    });

    it('calls back with an error and logs on a 500 response without throwing', function(done) {
        stub.mode = 'error';
        var notifier = new Notifier({url: stub.url, log: log});
        expect(function() {
            notifier.notify(alert, function(err) {
                expect(err).to.be.an.instanceof(Error);
                expect(err.statusCode).to.equal(500);
                expect(stub.requests).to.have.length(1);
                expect(log.calledOnce).to.equal(true);
                expect(log.firstCall.args.join(' ')).to.match(/500/);
                done();
            });
        }).to.not.throw();
    });

    it('times out when the receiver never answers', function(done) {
        this.timeout(2000);
        stub.mode = 'hang';
        var started = Date.now();
        var notifier = new Notifier({url: stub.url, timeoutMs: 200, log: log});
        notifier.notify(alert, function(err) {
            expect(err).to.be.an.instanceof(Error);
            expect(err.message).to.match(/timed out/);
            expect(Date.now() - started).to.be.within(150, 1500);
            expect(log.calledOnce).to.equal(true);
            done();
        });
    });

    it('calls back exactly once after a timeout', function(done) {
        this.timeout(2000);
        stub.mode = 'hang';
        var calls = 0;
        new Notifier({url: stub.url, timeoutMs: 100, log: log}).notify(alert, function() {
            calls += 1;
        });
        setTimeout(function() {
            expect(calls).to.equal(1);
            done();
        }, 400);
    });

    it('defaults the timeout to 5 s', function() {
        expect(new Notifier({url: stub.url}).timeoutMs).to.equal(5000);
    });

    it('reports a connection error without throwing', function(done) {
        var notifier = new Notifier({url: 'http://127.0.0.1:1/hook', log: log});
        notifier.notify(alert, function(err) {
            expect(err).to.be.an.instanceof(Error);
            expect(log.calledOnce).to.equal(true);
            done();
        });
    });

    it('works without a callback', function(done) {
        new Notifier({url: stub.url, log: log}).notify(alert);
        stub.waitForRequests(1, done);
    });

    it('gives up on a receiver that trickles its response past the timeout', function(done) {
        this.timeout(3000);
        stub.mode = 'trickle';
        var started = Date.now();
        new Notifier({url: stub.url, timeoutMs: 300, log: log}).notify(alert, function(err) {
            expect(err).to.be.an.instanceof(Error);
            expect(err.message).to.match(/timed out/);
            expect(Date.now() - started).to.be.below(1500);
            done();
        });
    });

    describe('secrets in the webhook URL', function() {
        var SENTINEL = 'S3NTINEL';

        function logged() {
            return log.args.map(function(args) {
                return args.join(' ');
            }).join('\n');
        }

        function expectNoSentinel(err) {
            expect(err).to.be.an.instanceof(Error);
            expect(String(err.message)).to.not.contain(SENTINEL);
            expect(String(err.stack)).to.not.contain(SENTINEL);
            expect(log.called).to.equal(true);
            expect(logged()).to.not.contain(SENTINEL);
        }

        it('does not log userinfo, path or query of an unsupported URL', function(done) {
            var url = 'ftp://user:' + SENTINEL + '-pw@files.example.com/' + SENTINEL + '-path?token=' + SENTINEL;
            new Notifier({url: url, log: log}).notify(alert, function(err) {
                expectNoSentinel(err);
                expect(logged()).to.contain('ftp://<redacted>@files.example.com/<redacted>');
                done();
            });
        });

        it('does not log them when the connection is refused', function(done) {
            var url = 'http://user:' + SENTINEL + '-pw@127.0.0.1:1/hook/' + SENTINEL + '?key=' + SENTINEL;
            new Notifier({url: url, log: log}).notify(alert, function(err) {
                expectNoSentinel(err);
                expect(logged()).to.contain('http://<redacted>@127.0.0.1:1/<redacted>');
                done();
            });
        });

        it('does not log them on an error response or a timeout', function(done) {
            this.timeout(3000);
            var base = stub.url.replace('http://', 'http://user:' + SENTINEL + '-pw@');
            stub.mode = 'error';
            new Notifier({url: base + '/' + SENTINEL + '?t=' + SENTINEL, log: log}).notify(alert, function(err) {
                expectNoSentinel(err);
                expect(stub.requests[0].headers.authorization).to.match(/^Basic /);
                stub.mode = 'hang';
                log.reset();
                new Notifier({url: base + '?t=' + SENTINEL, timeoutMs: 200, log: log}).notify(alert, function(err2) {
                    expectNoSentinel(err2);
                    done();
                });
            });
        });
    });
});
