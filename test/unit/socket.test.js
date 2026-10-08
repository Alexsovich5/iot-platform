'use strict';

var EventEmitter = require('events').EventEmitter;
var expect = require('chai').expect;
var sinon = require('sinon');
var socket = require('../../src/socket');

// Minimal stand-in for a Socket.IO client socket: records joins and
// leaves and lets the test fire client events with an optional ack.
function FakeSocket() {
    EventEmitter.call(this);
    this.joined = [];
    this.left = [];
}
FakeSocket.prototype = Object.create(EventEmitter.prototype);
FakeSocket.prototype.join = function(room) {
    this.joined.push(room);
};
FakeSocket.prototype.leave = function(room) {
    this.left.push(room);
};

describe('socket.attach', function() {
    var io;
    var client;
    var mqttHandler;
    var Device;

    beforeEach(function() {
        io = new EventEmitter();
        mqttHandler = {
            isConnected: sinon.stub().returns(true),
            sendCommand: sinon.stub().returns('cmd-1')
        };
        Device = {findOne: sinon.stub().yields(null, {deviceId: 'd1', status: 'online'})};
        socket.attach(io, mqttHandler, Device);
        client = new FakeSocket();
        io.emit('connection', client);
    });

    it('joins the device room on subscribe_device', function() {
        client.emit('subscribe_device', 'd1');
        expect(client.joined).to.deep.equal(['device_d1']);
    });

    it('ignores subscribe_device with an invalid deviceId', function() {
        client.emit('subscribe_device', 'a/b');
        client.emit('subscribe_device', {deviceId: 'd1'});
        expect(client.joined).to.deep.equal([]);
    });

    it('leaves the device room on unsubscribe_device', function() {
        client.emit('unsubscribe_device', 'd1');
        expect(client.left).to.deep.equal(['device_d1']);
    });

    it('does not send an invalid command and acks an error', function(done) {
        client.emit('send_command', {deviceId: 'd1', command: 'Reboot!'}, function(res) {
            expect(res.error).to.match(/command/i);
            expect(mqttHandler.sendCommand.called).to.equal(false);
            done();
        });
    });

    it('does not send a command with an invalid deviceId', function(done) {
        client.emit('send_command', {deviceId: 'd+1', command: 'reboot'}, function(res) {
            expect(res.error).to.match(/deviceId/);
            expect(mqttHandler.sendCommand.called).to.equal(false);
            done();
        });
    });

    it('does not throw on a missing payload object or ack', function() {
        client.emit('send_command');
        client.emit('send_command', {deviceId: 'd1', command: 'bad cmd'});
        expect(mqttHandler.sendCommand.called).to.equal(false);
    });

    it('refuses a decommissioned device', function(done) {
        Device.findOne.yields(null, {deviceId: 'd1', status: 'decommissioned'});
        client.emit('send_command', {deviceId: 'd1', command: 'reboot'}, function(res) {
            expect(res.error).to.match(/decommissioned/);
            expect(mqttHandler.sendCommand.called).to.equal(false);
            done();
        });
    });

    it('sends a valid command and acks its commandId', function(done) {
        client.emit('send_command', {deviceId: 'd1', command: 'set_interval', payload: {sec: 5}}, function(res) {
            expect(res).to.deep.equal({commandId: 'cmd-1'});
            expect(mqttHandler.sendCommand.calledOnce).to.equal(true);
            var args = mqttHandler.sendCommand.firstCall.args;
            expect(args.slice(0, 3)).to.deep.equal(['d1', 'set_interval', {sec: 5}]);
            done();
        });
    });

    it('acks an error when MQTT is disconnected', function(done) {
        mqttHandler.isConnected.returns(false);
        client.emit('send_command', {deviceId: 'd1', command: 'reboot'}, function(res) {
            expect(res.error).to.match(/MQTT/);
            expect(mqttHandler.sendCommand.called).to.equal(false);
            done();
        });
    });
});

describe('socket.authorize', function() {
    var KEY = 'socket-operator-key-0123456789';

    function handshake(query, headers) {
        return {handshake: {query: query || {}, headers: headers || {}}, request: {headers: headers || {}}};
    }

    function run(middleware, sock) {
        var result = {called: false, err: null};
        middleware(sock, function(err) {
            result.called = true;
            result.err = err || null;
        });
        return result;
    }

    it('accepts the key from the apiKey query parameter', function() {
        var result = run(socket.authorize(KEY), handshake({apiKey: KEY}));
        expect(result.called).to.equal(true);
        expect(result.err).to.equal(null);
    });

    it('accepts the key as a Bearer Authorization header', function() {
        var result = run(socket.authorize(KEY), handshake({}, {authorization: 'Bearer ' + KEY}));
        expect(result.err).to.equal(null);
    });

    it('rejects a missing or wrong key without echoing it', function() {
        var missing = run(socket.authorize(KEY), handshake());
        expect(missing.err).to.be.an.instanceof(Error);
        expect(missing.err.message).to.equal('Unauthorized');

        var wrong = run(socket.authorize(KEY), handshake({apiKey: 'S3NTINEL-wrong'}));
        expect(wrong.err.message).to.equal('Unauthorized');

        var array = run(socket.authorize(KEY), handshake({apiKey: [KEY]}));
        expect(array.err.message).to.equal('Unauthorized');
    });

    it('refuses to build a middleware without a key', function() {
        expect(function() {
            socket.authorize('');
        }).to.throw(/key/);
    });
});
