'use strict';

var expect = require('chai').expect;
var sinon = require('sinon');
var MQTTHandler = require('../../src/mqtt_handler');
var tokens = require('../../src/lib/tokens');
var createFakeMqtt = require('../support/fake_mqtt').createFakeMqtt;
var FakeIo = require('../support/fake_io');

var KEY = 'unit-provisioning-key';
var TOKEN = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

function json(obj) {
    return new Buffer(JSON.stringify(obj));
}

function duplicateKeyError() {
    var err = new Error('E11000 duplicate key error');
    err.code = 11000;
    return err;
}

describe('MQTTHandler', function() {
    var fake;
    var io;
    var Device;
    var handler;
    var alerts;
    var storedDevice;

    beforeEach(function() {
        fake = createFakeMqtt();
        io = new FakeIo();
        storedDevice = {
            deviceId: 'd1',
            status: 'registered',
            tokenHash: tokens.hash(TOKEN)
        };
        Device = {
            findOne: sinon.stub(),
            findOneAndUpdate: sinon.stub(),
            create: sinon.stub()
        };
        Device.findOne.yields(null, storedDevice);
        Device.findOneAndUpdate.yields(null, {deviceId: 'd1', status: 'online'});
        alerts = {
            onTelemetry: sinon.stub().yields(null, []),
            fromDevice: sinon.stub().yields(null, {})
        };
        handler = new MQTTHandler({host: 'broker', port: 1883}, io, {
            Device: Device,
            mqtt: fake.mqtt,
            provisioningKey: KEY,
            alerts: alerts,
            maxTelemetryPoints: 50
        });
    });

    afterEach(function(done) {
        handler.close(done);
    });

    describe('connect', function() {
        it('uses a random iot-platform clientId and subscribes to every inbound type', function(done) {
            handler.connect(function(err) {
                if (err) {
                    return done(err);
                }
                expect(fake.connectArgs.url).to.equal('mqtt://broker:1883');
                expect(fake.connectArgs.options.clientId).to.match(/^iot-platform-[0-9a-f]{12}$/);
                var subscribed = fake.client.subscriptions.map(function(s) {
                    return s.topic;
                });
                expect(subscribed).to.deep.equal([
                    'devices/+/register',
                    'devices/+/telemetry',
                    'devices/+/status',
                    'devices/+/alerts',
                    'devices/+/firmware'
                ]);
                fake.client.subscriptions.forEach(function(s) {
                    expect(s.opts.qos).to.equal(1);
                });
                expect(handler.isConnected()).to.equal(true);
                done();
            });
            fake.client.simulateConnect();
        });

        it('ends a connected client gracefully on close', function(done) {
            handler.connect();
            fake.client.simulateConnect();
            handler.close(function() {
                expect(fake.client.ended).to.equal(true);
                expect(fake.client.endForce).to.equal(false);
                expect(handler.isConnected()).to.equal(false);
                done();
            });
        });

        it('force-closes a client that never connected', function(done) {
            handler.connect();
            handler.close(function() {
                expect(fake.client.ended).to.equal(true);
                expect(fake.client.endForce).to.equal(true);
                done();
            });
        });
    });

    describe('inbound validation', function() {
        it('drops a non-JSON payload without touching the database', function(done) {
            handler.handleMessage('devices/d1/telemetry', new Buffer('not json{'), function() {
                expect(Device.findOne.called).to.equal(false);
                expect(Device.findOneAndUpdate.called).to.equal(false);
                expect(io.emitted).to.have.length(0);
                done();
            });
        });

        it('drops a JSON payload that is not an object', function(done) {
            handler.handleMessage('devices/d1/telemetry', new Buffer('[1,2]'), function() {
                expect(Device.findOne.called).to.equal(false);
                done();
            });
        });

        it('ignores topics with an invalid deviceId', function(done) {
            handler.handleMessage('devices/a+b/telemetry', json({token: TOKEN, temperature: 1}), function() {
                expect(Device.findOne.called).to.equal(false);
                expect(io.emitted).to.have.length(0);
                done();
            });
        });

        it('routes messages that arrive on the client', function(done) {
            handler.connect();
            fake.client.emit('message', 'devices/d1/telemetry', json({token: TOKEN, temperature: 20}));
            setTimeout(function() {
                expect(Device.findOneAndUpdate.calledOnce).to.equal(true);
                done();
            }, 20);
        });
    });

    describe('authentication', function() {
        it('drops a message with a bad token, counts it and emits nothing', function(done) {
            handler.handleMessage('devices/d1/telemetry', json({token: 'wrong', temperature: 20}), function() {
                expect(Device.findOne.calledOnce).to.equal(true);
                expect(Device.findOne.firstCall.args[0]).to.deep.equal({deviceId: 'd1'});
                expect(Device.findOne.firstCall.args[1]).to.match(/\+tokenHash/);
                expect(Device.findOneAndUpdate.called).to.equal(false);
                expect(handler.rejectedCount).to.equal(1);
                expect(handler.stats()).to.deep.equal({rejectedMessages: 1});
                expect(io.emitted).to.have.length(0);
                expect(alerts.onTelemetry.called).to.equal(false);
                done();
            });
        });

        it('drops a message with no token', function(done) {
            handler.handleMessage('devices/d1/status', json({uptime: 5}), function() {
                expect(handler.rejectedCount).to.equal(1);
                expect(Device.findOneAndUpdate.called).to.equal(false);
                done();
            });
        });

        it('drops a message for an unknown device', function(done) {
            Device.findOne.yields(null, null);
            handler.handleMessage('devices/d1/telemetry', json({token: TOKEN, temperature: 20}), function() {
                expect(handler.rejectedCount).to.equal(1);
                expect(Device.findOneAndUpdate.called).to.equal(false);
                done();
            });
        });

        it('drops a message from a decommissioned device even with a matching hash', function(done) {
            storedDevice.status = 'decommissioned';
            handler.handleMessage('devices/d1/telemetry', json({token: TOKEN, temperature: 20}), function() {
                expect(handler.rejectedCount).to.equal(1);
                expect(Device.findOneAndUpdate.called).to.equal(false);
                done();
            });
        });
    });

    describe('telemetry', function() {
        it('pushes the reading with $slice, marks the device online and emits to its room', function(done) {
            var payload = {token: TOKEN, temperature: 21.5, humidity: 40, battery: 88, extra: 'x'};
            handler.handleMessage('devices/d1/telemetry', json(payload), function() {
                expect(Device.findOneAndUpdate.calledOnce).to.equal(true);
                var args = Device.findOneAndUpdate.firstCall.args;
                expect(args[0].deviceId).to.equal('d1');
                var update = args[1];
                expect(update.$push.telemetry.$slice).to.equal(-50);
                expect(update.$push.telemetry.$each).to.have.length(1);
                var reading = update.$push.telemetry.$each[0];
                expect(reading.temperature).to.equal(21.5);
                expect(reading.humidity).to.equal(40);
                expect(reading.battery).to.equal(88);
                expect(reading).to.not.have.property('pressure');
                expect(reading).to.not.have.property('extra');
                expect(reading).to.not.have.property('token');
                expect(reading.timestamp).to.be.an.instanceof(Date);
                expect(update.$set.status).to.equal('online');
                expect(update.$set.lastSeen).to.be.an.instanceof(Date);

                var events = io.emittedTo('device_d1', 'telemetry');
                expect(events).to.have.length(1);
                expect(events[0].data.deviceId).to.equal('d1');
                expect(events[0].data.data.temperature).to.equal(21.5);
                expect(events[0].data.data).to.not.have.property('token');

                expect(alerts.onTelemetry.calledOnce).to.equal(true);
                expect(alerts.onTelemetry.firstCall.args[0].deviceId).to.equal('d1');
                expect(alerts.onTelemetry.firstCall.args[1].temperature).to.equal(21.5);
                expect(handler.rejectedCount).to.equal(0);
                done();
            });
        });

        it('keeps a device in maintenance when it sends telemetry', function(done) {
            storedDevice.status = 'maintenance';
            handler.handleMessage('devices/d1/telemetry', json({token: TOKEN, temperature: 1}), function() {
                expect(Device.findOneAndUpdate.firstCall.args[1].$set.status).to.equal('maintenance');
                done();
            });
        });

        it('drops telemetry with no numeric metric', function(done) {
            handler.handleMessage('devices/d1/telemetry', json({token: TOKEN, temperature: 'hot'}), function() {
                expect(Device.findOneAndUpdate.called).to.equal(false);
                expect(io.emitted).to.have.length(0);
                done();
            });
        });
    });

    describe('status', function() {
        it('applies the lifecycle, stores firmware and uptime and emits to the room', function(done) {
            storedDevice.status = 'offline';
            var payload = {token: TOKEN, status: 'online', firmware: '1.2.0', uptime: 300};
            handler.handleMessage('devices/d1/status', json(payload), function() {
                var update = Device.findOneAndUpdate.firstCall.args[1];
                expect(update.$set.status).to.equal('online');
                expect(update.$set.firmware).to.equal('1.2.0');
                expect(update.$set.uptime).to.equal(300);
                var events = io.emittedTo('device_d1', 'status');
                expect(events).to.have.length(1);
                expect(events[0].data.data.status).to.equal('online');
                expect(events[0].data.data).to.not.have.property('token');
                done();
            });
        });

        it('does not let a device report itself out of maintenance', function(done) {
            storedDevice.status = 'maintenance';
            handler.handleMessage('devices/d1/status', json({token: TOKEN, status: 'online'}), function() {
                expect(Device.findOneAndUpdate.firstCall.args[1].$set.status).to.equal('maintenance');
                done();
            });
        });
    });

    describe('alerts', function() {
        it('passes an authenticated device alert to the alert service', function(done) {
            handler.handleMessage('devices/d1/alerts', json({token: TOKEN, severity: 'critical', message: 'Overheat'}), function() {
                expect(alerts.fromDevice.calledOnce).to.equal(true);
                var args = alerts.fromDevice.firstCall.args;
                expect(args[0]).to.equal('d1');
                expect(args[1]).to.deep.equal({severity: 'critical', message: 'Overheat'});
                expect(io.emitted).to.have.length(0);
                done();
            });
        });

        it('defaults an unknown severity to warning and drops alerts without a message', function(done) {
            handler.handleMessage('devices/d1/alerts', json({token: TOKEN, severity: 'boom', message: 'x'}), function() {
                handler.handleMessage('devices/d1/alerts', json({token: TOKEN}), function() {
                    expect(alerts.fromDevice.calledOnce).to.equal(true);
                    expect(alerts.fromDevice.firstCall.args[1].severity).to.equal('warning');
                    done();
                });
            });
        });

        it('drops an alert from a device with a bad token', function(done) {
            handler.handleMessage('devices/d1/alerts', json({token: 'wrong', message: 'x'}), function() {
                expect(alerts.fromDevice.called).to.equal(false);
                done();
            });
        });
    });

    describe('registration', function() {
        it('publishes {error} for a wrong provisioning key and creates nothing', function(done) {
            handler.connect();
            handler.handleMessage('devices/new-1/register', json({provisioningKey: 'nope', name: 'N'}), function() {
                expect(Device.create.called).to.equal(false);
                var replies = fake.client.publishedTo('devices/new-1/provisioned');
                expect(replies).to.have.length(1);
                expect(replies[0]).to.have.property('error');
                expect(replies[0]).to.not.have.property('token');
                done();
            });
        });

        it('creates the device with provisionedBy mqtt and publishes its token', function(done) {
            Device.findOne.yields(null, null);
            Device.create.yields(null, {deviceId: 'new-1'});
            handler.connect();
            var payload = {provisioningKey: KEY, name: 'Roof', type: 'sensor', firmware: '1.0.0'};
            handler.handleMessage('devices/new-1/register', json(payload), function() {
                expect(Device.create.calledOnce).to.equal(true);
                var doc = Device.create.firstCall.args[0];
                expect(doc.deviceId).to.equal('new-1');
                expect(doc.name).to.equal('Roof');
                expect(doc.type).to.equal('sensor');
                expect(doc.firmware).to.equal('1.0.0');
                expect(doc.provisionedBy).to.equal('mqtt');
                expect(doc.status).to.equal('registered');

                var replies = fake.client.publishedTo('devices/new-1/provisioned');
                expect(replies).to.have.length(1);
                expect(replies[0].token).to.match(/^[0-9a-f]{32}$/);
                expect(doc.tokenHash).to.equal(tokens.hash(replies[0].token));
                expect(fake.client.published[0].opts.qos).to.equal(1);
                done();
            });
        });

        it('rejects a deviceId that already exists', function(done) {
            handler.connect();
            handler.handleMessage('devices/d1/register', json({provisioningKey: KEY}), function() {
                expect(Device.create.called).to.equal(false);
                var replies = fake.client.publishedTo('devices/d1/provisioned');
                expect(replies).to.have.length(1);
                expect(replies[0].error).to.match(/already/);
                done();
            });
        });

        it('maps a duplicate-key race on create to {error}', function(done) {
            Device.findOne.yields(null, null);
            Device.create.yields(duplicateKeyError());
            handler.connect();
            handler.handleMessage('devices/d2/register', json({provisioningKey: KEY}), function() {
                var replies = fake.client.publishedTo('devices/d2/provisioned');
                expect(replies).to.have.length(1);
                expect(replies[0].error).to.match(/already/);
                done();
            });
        });
    });

    describe('sendCommand', function() {
        it('publishes the command with a commandId at QoS 1', function(done) {
            handler.connect();
            fake.client.simulateConnect();
            var commandId = handler.sendCommand('d1', 'reboot', {delay: 1}, function(err) {
                if (err) {
                    return done(err);
                }
                var sent = fake.client.publishedTo('devices/d1/commands');
                expect(sent).to.have.length(1);
                expect(sent[0].commandId).to.equal(commandId);
                expect(sent[0].command).to.equal('reboot');
                expect(sent[0].payload).to.deep.equal({delay: 1});
                expect(sent[0].timestamp).to.be.a('string');
                expect(fake.client.published[0].opts.qos).to.equal(1);
                done();
            });
            expect(commandId).to.match(/^[0-9a-f]{16}$/);
        });

        it('errors and publishes nothing when disconnected', function(done) {
            handler.connect();
            handler.sendCommand('d1', 'reboot', {}, function(err) {
                expect(err).to.be.an.instanceof(Error);
                expect(err.message).to.match(/not connected/i);
                expect(fake.client.published).to.have.length(0);
                done();
            });
        });
    });
});
