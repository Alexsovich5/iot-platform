'use strict';

/**
 * In-memory stand-in for an MQTT.js client and the mqtt module.
 *
 * The client records every publish and subscribe call and acknowledges
 * them asynchronously. Tests drive inbound messages with
 * client.emit('message', topic, buffer).
 */

var EventEmitter = require('events').EventEmitter;
var util = require('util');

function FakeMqttClient() {
    EventEmitter.call(this);
    this.published = [];
    this.subscriptions = [];
    this.ended = false;
    this.endForce = null;
}
util.inherits(FakeMqttClient, EventEmitter);

FakeMqttClient.prototype.publish = function(topic, message, opts, cb) {
    if (typeof opts === 'function') {
        cb = opts;
        opts = {};
    }
    this.published.push({topic: topic, message: String(message), opts: opts || {}});
    if (cb) {
        process.nextTick(cb);
    }
};

FakeMqttClient.prototype.subscribe = function(topic, opts, cb) {
    if (typeof opts === 'function') {
        cb = opts;
        opts = {};
    }
    this.subscriptions.push({topic: topic, opts: opts || {}});
    if (cb) {
        process.nextTick(function() {
            cb(null, [{topic: topic, qos: (opts && opts.qos) || 0}]);
        });
    }
};

FakeMqttClient.prototype.end = function(force, cb) {
    var self = this;
    if (typeof force === 'function') {
        cb = force;
        force = false;
    }
    this.ended = true;
    this.endForce = !!force;
    process.nextTick(function() {
        self.emit('close');
        if (cb) {
            cb();
        }
    });
};

// Simulates a successful broker connection.
FakeMqttClient.prototype.simulateConnect = function() {
    this.emit('connect', {returnCode: 0});
};

// Parsed JSON payloads published to `topic`.
FakeMqttClient.prototype.publishedTo = function(topic) {
    return this.published.filter(function(p) {
        return p.topic === topic;
    }).map(function(p) {
        return JSON.parse(p.message);
    });
};

// Returns {mqtt, client, connectArgs}: a module-shaped object whose
// connect() hands out the single fake client.
function createFakeMqtt() {
    var client = new FakeMqttClient();
    var fake = {client: client, connectArgs: null};
    fake.mqtt = {
        connect: function(url, options) {
            fake.connectArgs = {url: url, options: options};
            return client;
        }
    };
    return fake;
}

module.exports = {
    FakeMqttClient: FakeMqttClient,
    createFakeMqtt: createFakeMqtt
};
