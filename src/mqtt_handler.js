/**
 * MQTT Handler Module
 *
 * Manages the broker connection, authenticates every inbound device
 * message against the device's token hash, and routes it by message type.
 * Devices can also self-provision with the shared provisioning key.
 *
 * Dependencies (Device model, mqtt module, provisioning key and the
 * telemetry hook) are injectable so the handler can be tested without a
 * broker or database.
 */

'use strict';

var crypto = require('crypto');
var config = require('config');
var lifecycle = require('./lib/lifecycle');
var tokens = require('./lib/tokens');
var topics = require('./lib/topics');

var METRICS = ['temperature', 'humidity', 'pressure', 'battery'];
var DEVICE_TYPES = ['sensor', 'actuator', 'gateway', 'controller'];
var ALERT_SEVERITIES = ['info', 'warning', 'critical'];
var MAX_TEXT_LENGTH = 256;

function configValue(key, fallback) {
    return config.has(key) ? config.get(key) : fallback;
}

function noop() {}

function isFiniteNumber(value) {
    return typeof value === 'number' && isFinite(value);
}

function shortString(value) {
    return typeof value === 'string' && value.length > 0 && value.length <= MAX_TEXT_LENGTH;
}

function isDuplicateKey(err) {
    return !!err && (err.code === 11000 || err.code === 11001);
}

function MQTTHandler(mqttConfig, io, deps) {
    mqttConfig = mqttConfig || {};
    deps = deps || {};

    this.brokerUrl = 'mqtt://' + mqttConfig.host + ':' + (parseInt(mqttConfig.port, 10) || 1883);
    this.options = {
        clientId: 'iot-platform-' + crypto.randomBytes(6).toString('hex'),
        username: mqttConfig.username || '',
        password: mqttConfig.password || '',
        keepalive: 60,
        reconnectPeriod: 5000
    };
    this.io = io;
    this.Device = deps.Device || require('./models/device');
    this.mqtt = deps.mqtt || require('mqtt');
    this.provisioningKey = deps.provisioningKey !== undefined ?
        deps.provisioningKey : configValue('provisioning.key', '');
    this.onTelemetry = deps.onTelemetry || noop;
    this.onFirmware = deps.onFirmware || noop;
    this.maxTelemetryPoints = deps.maxTelemetryPoints || configValue('telemetry.maxPoints', 1000);

    this.client = null;
    this.connected = false;
    this.rejectedCount = 0;
}

// connect(cb): cb runs once the first connection's subscriptions are acked.
MQTTHandler.prototype.connect = function(callback) {
    var self = this;
    var pending = callback || null;
    console.log('Connecting to MQTT broker:', this.brokerUrl);

    this.client = this.mqtt.connect(this.brokerUrl, this.options);

    this.client.on('connect', function() {
        console.log('Connected to MQTT broker');
        self.connected = true;
        self._subscribeTopics(function(err) {
            if (pending) {
                var cb = pending;
                pending = null;
                cb(err);
            }
        });
    });

    this.client.on('message', function(topic, message) {
        self.handleMessage(topic, message);
    });

    this.client.on('error', function(err) {
        console.error('MQTT error:', err.message);
    });

    this.client.on('close', function() {
        self.connected = false;
    });
};

MQTTHandler.prototype._subscribeTopics = function(callback) {
    var client = this.client;
    var list = topics.subscriptions();
    var remaining = list.length;
    var failed = null;

    list.forEach(function(topic) {
        client.subscribe(topic, {qos: 1}, function(err) {
            if (err) {
                console.error('Subscribe error for', topic, ':', err.message);
                failed = failed || err;
            }
            remaining -= 1;
            if (remaining === 0) {
                callback(failed);
            }
        });
    });
};

// Validates the topic and JSON body and dispatches by message type.
// done() is called once the message has been fully processed or dropped.
MQTTHandler.prototype.handleMessage = function(topic, message, done) {
    done = done || noop;
    var parsed = topics.parse(topic);
    if (!parsed) {
        return process.nextTick(done);
    }

    var payload;
    try {
        payload = JSON.parse(message.toString());
    } catch (e) {
        console.error('Invalid JSON from device', parsed.deviceId);
        return process.nextTick(done);
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return process.nextTick(done);
    }

    if (parsed.type === 'register') {
        return this._handleRegistration(parsed.deviceId, payload, done);
    }

    var self = this;
    this._authenticate(parsed.deviceId, payload.token, function(err, device) {
        if (err || !device) {
            return done();
        }
        switch (parsed.type) {
            case 'telemetry':
                return self._handleTelemetry(device, payload, done);
            case 'status':
                return self._handleStatus(device, payload, done);
            case 'alerts':
                return self._handleAlert(device, payload, done);
            case 'firmware':
                return self.onFirmware(device, payload, done);
        }
        done();
    });
};

// Calls back with the device when token matches its stored hash and the
// device is not decommissioned; otherwise with no device, after counting
// the rejection.
MQTTHandler.prototype._authenticate = function(deviceId, token, cb) {
    var self = this;
    this.Device.findOne({deviceId: deviceId}, '+tokenHash -telemetry', function(err, device) {
        if (err) {
            console.error('Device lookup error:', err.message);
            return cb(err);
        }
        if (!device || device.status === 'decommissioned' || !tokens.verify(token, device.tokenHash)) {
            self.rejectedCount += 1;
            return cb(null, null);
        }
        cb(null, device);
    });
};

MQTTHandler.prototype._handleTelemetry = function(device, data, done) {
    var self = this;
    var reading = {timestamp: new Date()};
    var hasMetric = false;
    METRICS.forEach(function(metric) {
        if (isFiniteNumber(data[metric])) {
            reading[metric] = data[metric];
            hasMetric = true;
        }
    });
    if (!hasMetric) {
        return done();
    }

    var status = lifecycle.nextStatusOnTraffic(device.status);
    this.Device.findOneAndUpdate(
        {deviceId: device.deviceId, status: {$ne: 'decommissioned'}},
        {
            $push: {telemetry: {$each: [reading], $slice: -this.maxTelemetryPoints}},
            $set: {lastSeen: reading.timestamp, status: status}
        },
        {new: true, fields: {telemetry: 0}},
        function(err) {
            if (err) {
                console.error('Telemetry save error:', err.message);
                return done();
            }
            self._emitStatusChange(device, status);
            self.io.to('device_' + device.deviceId).emit('telemetry', {
                deviceId: device.deviceId,
                data: reading
            });
            self.onTelemetry(device, reading);
            done();
        }
    );
};

MQTTHandler.prototype._handleStatus = function(device, data, done) {
    var self = this;
    var status = lifecycle.nextStatusOnTraffic(device.status);
    var set = {status: status, lastSeen: new Date()};
    if (shortString(data.firmware)) {
        set.firmware = data.firmware;
    }
    if (isFiniteNumber(data.uptime) && data.uptime >= 0) {
        set.uptime = data.uptime;
    }

    this.Device.findOneAndUpdate(
        {deviceId: device.deviceId, status: {$ne: 'decommissioned'}},
        {$set: set},
        {new: true, fields: {telemetry: 0}},
        function(err) {
            if (err) {
                console.error('Status update error:', err.message);
                return done();
            }
            var out = {status: set.status};
            if (set.firmware !== undefined) {
                out.firmware = set.firmware;
            }
            if (set.uptime !== undefined) {
                out.uptime = set.uptime;
            }
            self.io.to('device_' + device.deviceId).emit('status', {
                deviceId: device.deviceId,
                data: out
            });
            done();
        }
    );
};

// Telemetry that changes the stored status (for example offline -> online)
// is announced to every dashboard, like a status message.
MQTTHandler.prototype._emitStatusChange = function(device, status) {
    if (status !== device.status) {
        this.io.emit('status', {deviceId: device.deviceId, data: {status: status}});
    }
};

MQTTHandler.prototype._handleAlert = function(device, data, done) {
    if (!shortString(data.message)) {
        return process.nextTick(done);
    }
    this.io.emit('alert', {
        deviceId: device.deviceId,
        source: 'device',
        severity: ALERT_SEVERITIES.indexOf(data.severity) !== -1 ? data.severity : 'warning',
        message: data.message,
        timestamp: new Date()
    });
    process.nextTick(done);
};

MQTTHandler.prototype._handleRegistration = function(deviceId, data, done) {
    var self = this;

    function reply(body) {
        self._publish(topics.provisionedTopic(deviceId), body, done);
    }

    // The key is compared through its hash so the comparison runs in
    // constant time.
    if (!this.provisioningKey ||
            !tokens.verify(data.provisioningKey, tokens.hash(this.provisioningKey))) {
        this.rejectedCount += 1;
        return reply({error: 'Invalid provisioning key'});
    }

    var Device = this.Device;
    Device.findOne({deviceId: deviceId}, '_id', function(err, existing) {
        if (err) {
            console.error('Registration lookup error:', err.message);
            return reply({error: 'Registration failed'});
        }
        if (existing) {
            return reply({error: 'Device already registered'});
        }

        var token = tokens.generate();
        var doc = {
            deviceId: deviceId,
            name: shortString(data.name) ? data.name : deviceId,
            type: DEVICE_TYPES.indexOf(data.type) !== -1 ? data.type : 'sensor',
            firmware: shortString(data.firmware) ? data.firmware : 'unknown',
            status: 'registered',
            provisionedBy: 'mqtt',
            tokenHash: tokens.hash(token)
        };

        // A concurrent registration that passed the lookup above is
        // stopped by the unique index on deviceId.
        Device.create(doc, function(createErr) {
            if (isDuplicateKey(createErr)) {
                return reply({error: 'Device already registered'});
            }
            if (createErr) {
                console.error('Registration error:', createErr.message);
                return reply({error: 'Registration failed'});
            }
            console.log('Device registered over MQTT:', deviceId);
            reply({token: token});
        });
    });
};

MQTTHandler.prototype._publish = function(topic, body, cb) {
    cb = cb || noop;
    if (!this.client) {
        return process.nextTick(function() {
            cb(new Error('MQTT client not started'));
        });
    }
    this.client.publish(topic, JSON.stringify(body), {qos: 1}, function(err) {
        if (err) {
            console.error('Publish error on', topic, ':', err.message);
        }
        cb(err);
    });
};

// Publishes {commandId, command, payload, timestamp} to the device's
// commands topic. Returns the commandId, or null when the command could
// not be sent; cb receives the error in that case.
MQTTHandler.prototype.sendCommand = function(deviceId, command, payload, cb) {
    cb = cb || noop;
    var topic;
    try {
        topic = topics.commandTopic(deviceId);
    } catch (e) {
        process.nextTick(function() {
            cb(e);
        });
        return null;
    }
    if (!this.connected || !this.client) {
        process.nextTick(function() {
            cb(new Error('MQTT broker not connected'));
        });
        return null;
    }

    var commandId = crypto.randomBytes(8).toString('hex');
    this._publish(topic, {
        commandId: commandId,
        command: command,
        payload: payload === undefined ? {} : payload,
        timestamp: new Date().toISOString()
    }, cb);
    return commandId;
};

MQTTHandler.prototype.isConnected = function() {
    return this.connected;
};

MQTTHandler.prototype.stats = function() {
    return {rejectedMessages: this.rejectedCount};
};

// Ends the client. A connected client sends DISCONNECT after its in-flight
// messages; one that never connected is closed immediately, because a
// graceful end would wait for a connection that may never come.
MQTTHandler.prototype.close = function(callback) {
    callback = callback || noop;
    var client = this.client;
    var force = !this.connected;
    this.client = null;
    this.connected = false;
    if (!client) {
        return process.nextTick(callback);
    }
    client.end(force, function() {
        callback();
    });
};

module.exports = MQTTHandler;
