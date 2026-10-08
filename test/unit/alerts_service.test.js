'use strict';

var expect = require('chai').expect;
var sinon = require('sinon');
var AlertService = require('../../src/lib/alerts');
var FakeIo = require('../support/fake_io');

describe('AlertService', function() {
    var io;
    var Alert;
    var Rule;
    var clock;
    var service;
    var rule;
    var device;
    var created;

    beforeEach(function() {
        io = new FakeIo();
        created = [];
        rule = {
            _id: 'r1',
            name: 'Hot',
            metric: 'temperature',
            operator: 'gt',
            threshold: 30,
            severity: 'critical',
            cooldownSec: 60,
            enabled: true
        };
        Rule = {find: sinon.stub().yields(null, [rule])};
        Alert = {
            create: sinon.spy(function(doc, cb) {
                var saved = {_id: 'a' + created.length};
                Object.keys(doc).forEach(function(key) {
                    saved[key] = doc[key];
                });
                created.push(saved);
                process.nextTick(function() {
                    cb(null, saved);
                });
            })
        };
        clock = 1000000;
        service = new AlertService({
            Alert: Alert,
            Rule: Rule,
            io: io,
            now: function() {
                return clock;
            }
        });
        device = {deviceId: 'd1', type: 'sensor'};
    });

    describe('onTelemetry', function() {
        it('loads only enabled rules', function(done) {
            service.onTelemetry(device, {temperature: 20}, function(err) {
                expect(err).to.not.exist;
                expect(Rule.find.calledOnce).to.equal(true);
                expect(Rule.find.firstCall.args[0]).to.deep.equal({enabled: true});
                done();
            });
        });

        it('persists a matching rule as a rule alert and emits it to everyone', function(done) {
            service.onTelemetry(device, {temperature: 35}, function(err, alerts) {
                expect(err).to.not.exist;
                expect(alerts).to.have.length(1);
                expect(created).to.have.length(1);
                var doc = created[0];
                expect(doc.deviceId).to.equal('d1');
                expect(doc.ruleId).to.equal('r1');
                expect(doc.source).to.equal('rule');
                expect(doc.severity).to.equal('critical');
                expect(doc.metric).to.equal('temperature');
                expect(doc.value).to.equal(35);
                expect(doc.threshold).to.equal(30);
                expect(doc.message).to.contain('d1');

                var events = io.emittedTo(null, 'alert');
                expect(events).to.have.length(1);
                expect(events[0].data.alert).to.equal(doc);
                done();
            });
        });

        it('creates one alert for two readings inside the cooldown', function(done) {
            service.onTelemetry(device, {temperature: 35}, function(err) {
                expect(err).to.not.exist;
                clock += 10000;
                service.onTelemetry(device, {temperature: 36}, function(err2, alerts) {
                    expect(err2).to.not.exist;
                    expect(alerts).to.have.length(0);
                    expect(Alert.create.calledOnce).to.equal(true);
                    expect(io.emittedTo(null, 'alert')).to.have.length(1);
                    done();
                });
            });
        });

        it('emits an alert for every alert it creates', function(done) {
            service.onTelemetry(device, {temperature: 35}, function() {
                clock += 61000;
                service.onTelemetry(device, {temperature: 37}, function(err, alerts) {
                    expect(err).to.not.exist;
                    expect(alerts).to.have.length(1);
                    expect(Alert.create.calledTwice).to.equal(true);
                    var events = io.emittedTo(null, 'alert');
                    expect(events).to.have.length(2);
                    expect(events[1].data.alert.value).to.equal(37);
                    done();
                });
            });
        });

        it('creates nothing when no rule matches', function(done) {
            service.onTelemetry(device, {temperature: 30}, function(err, alerts) {
                expect(err).to.not.exist;
                expect(alerts).to.have.length(0);
                expect(Alert.create.called).to.equal(false);
                expect(io.emitted).to.have.length(0);
                done();
            });
        });

        it('caches the rule set for 10 s', function(done) {
            service.onTelemetry(device, {temperature: 1}, function() {
                clock += 9999;
                service.onTelemetry(device, {temperature: 1}, function() {
                    expect(Rule.find.calledOnce).to.equal(true);
                    clock += 1;
                    service.onTelemetry(device, {temperature: 1}, function() {
                        expect(Rule.find.calledTwice).to.equal(true);
                        done();
                    });
                });
            });
        });

        it('calls Rule.find again after invalidateRules()', function(done) {
            service.onTelemetry(device, {temperature: 1}, function() {
                expect(Rule.find.calledOnce).to.equal(true);
                service.invalidateRules();
                service.onTelemetry(device, {temperature: 1}, function() {
                    expect(Rule.find.calledTwice).to.equal(true);
                    done();
                });
            });
        });

        it('passes a rule lookup error to the callback and creates nothing', function(done) {
            Rule.find = sinon.stub().yields(new Error('db down'));
            service.onTelemetry(device, {temperature: 99}, function(err) {
                expect(err).to.be.an.instanceof(Error);
                expect(Alert.create.called).to.equal(false);
                done();
            });
        });

        it('hands every saved alert to the notifier', function(done) {
            var notifier = {notify: sinon.spy()};
            service = new AlertService({Alert: Alert, Rule: Rule, io: io, notifier: notifier});
            service.onTelemetry(device, {temperature: 35}, function() {
                expect(notifier.notify.calledOnce).to.equal(true);
                expect(notifier.notify.firstCall.args[0]).to.equal(created[0]);
                done();
            });
        });
    });

    describe('fromDevice', function() {
        it('persists a device alert and emits it', function(done) {
            service.fromDevice('d1', {severity: 'critical', message: 'Overheat'}, function(err, alert) {
                expect(err).to.not.exist;
                expect(created).to.have.length(1);
                expect(alert.deviceId).to.equal('d1');
                expect(alert.source).to.equal('device');
                expect(alert.severity).to.equal('critical');
                expect(alert.message).to.equal('Overheat');
                expect(alert.ruleId).to.equal(null);
                var events = io.emittedTo(null, 'alert');
                expect(events).to.have.length(1);
                expect(events[0].data.alert).to.equal(alert);
                done();
            });
        });

        it('defaults the severity to warning', function(done) {
            service.fromDevice('d1', {message: 'Low battery'}, function(err, alert) {
                expect(err).to.not.exist;
                expect(alert.severity).to.equal('warning');
                done();
            });
        });

        it('emits nothing when the save fails', function(done) {
            Alert.create = function(doc, cb) {
                process.nextTick(function() {
                    cb(new Error('validation'));
                });
            };
            service.fromDevice('d1', {message: 'x'}, function(err) {
                expect(err).to.be.an.instanceof(Error);
                expect(io.emitted).to.have.length(0);
                done();
            });
        });
    });
});
