/**
 * MQTT Handler Module
 *
 * Manages MQTT connections, subscriptions, and message routing
 * for IoT device communication.
 */

'use strict';

var mqtt = require('mqtt');
var Device = require('./models/device');

function MQTTHandler(config, io) {
    this.brokerUrl = 'mqtt://' + config.host + ':' + config.port;
    this.options = {
        clientId: 'iot-platform-' + Date.now(),
        username: config.username || '',
        password: config.password || '',
        keepalive: 60,
        reconnectPeriod: 5000
    };
    this.client = null;
    this.io = io;
    this.connected = false;
}

MQTTHandler.prototype.connect = function() {
    var self = this;
    console.log('Connecting to MQTT broker:', this.brokerUrl);

    this.client = mqtt.connect(this.brokerUrl, this.options);

    this.client.on('connect', function() {
        console.log('Connected to MQTT broker');
        self.connected = true;
        self._subscribeTopics();
    });

    this.client.on('message', function(topic, message) {
        self._handleMessage(topic, message);
    });

    this.client.on('error', function(err) {
        console.error('MQTT error:', err.message);
    });

    this.client.on('close', function() {
        console.log('MQTT connection closed');
        self.connected = false;
    });
};

MQTTHandler.prototype._subscribeTopics = function() {
    var topics = [
        'devices/+/telemetry',
        'devices/+/status',
        'devices/+/alerts',
        'devices/+/register'
    ];

    var self = this;
    topics.forEach(function(topic) {
        self.client.subscribe(topic, { qos: 1 }, function(err) {
            if (err) {
                console.error('Subscribe error for', topic, ':', err);
            } else {
                console.log('Subscribed to:', topic);
            }
        });
    });
};

MQTTHandler.prototype._handleMessage = function(topic, message) {
    var parts = topic.split('/');
    var deviceId = parts[1];
    var messageType = parts[2];

    try {
        var payload = JSON.parse(message.toString());
    } catch (e) {
        console.error('Invalid JSON from device', deviceId);
        return;
    }

    switch (messageType) {
        case 'telemetry':
            this._handleTelemetry(deviceId, payload);
            break;
        case 'status':
            this._handleStatus(deviceId, payload);
            break;
        case 'alerts':
            this._handleAlert(deviceId, payload);
            break;
        case 'register':
            this._handleRegistration(deviceId, payload);
            break;
        default:
            console.log('Unknown message type:', messageType);
    }
};

MQTTHandler.prototype._handleTelemetry = function(deviceId, data) {
    var telemetry = {
        timestamp: new Date(),
        temperature: data.temperature,
        humidity: data.humidity,
        pressure: data.pressure,
        battery: data.battery
    };

    Device.findOneAndUpdate(
        { deviceId: deviceId },
        {
            $push: { telemetry: { $each: [telemetry], $slice: -1000 } },
            $set: { lastSeen: new Date() }
        },
        function(err) {
            if (err) console.error('Telemetry save error:', err);
        }
    );

    // Broadcast to dashboard
    this.io.to('device_' + deviceId).emit('telemetry', {
        deviceId: deviceId,
        data: telemetry
    });
};

MQTTHandler.prototype._handleStatus = function(deviceId, data) {
    Device.findOneAndUpdate(
        { deviceId: deviceId },
        {
            $set: {
                status: data.status,
                firmware: data.firmware,
                uptime: data.uptime,
                lastSeen: new Date()
            }
        },
        function(err) {
            if (err) console.error('Status update error:', err);
        }
    );

    this.io.to('device_' + deviceId).emit('status', {
        deviceId: deviceId,
        data: data
    });
};

MQTTHandler.prototype._handleAlert = function(deviceId, data) {
    console.log('Alert from device', deviceId, ':', data.message);

    this.io.emit('alert', {
        deviceId: deviceId,
        severity: data.severity || 'warning',
        message: data.message,
        timestamp: new Date()
    });
};

MQTTHandler.prototype._handleRegistration = function(deviceId, data) {
    console.log('Registration request from device:', deviceId);

    var device = new Device({
        deviceId: deviceId,
        name: data.name || deviceId,
        type: data.type || 'sensor',
        firmware: data.firmware || 'unknown',
        status: 'registered',
        registeredAt: new Date(),
        lastSeen: new Date()
    });

    device.save(function(err) {
        if (err) {
            if (err.code === 11000) {
                console.log('Device already registered:', deviceId);
            } else {
                console.error('Registration error:', err);
            }
        } else {
            console.log('Device registered:', deviceId);
        }
    });
};

MQTTHandler.prototype.sendCommand = function(deviceId, command, payload) {
    var topic = 'devices/' + deviceId + '/commands';
    var message = JSON.stringify({
        command: command,
        payload: payload,
        timestamp: new Date().toISOString()
    });

    this.client.publish(topic, message, { qos: 1 }, function(err) {
        if (err) {
            console.error('Command publish error:', err);
        } else {
            console.log('Command sent to', deviceId, ':', command);
        }
    });
};

MQTTHandler.prototype.isConnected = function() {
    return this.connected;
};

module.exports = MQTTHandler;
