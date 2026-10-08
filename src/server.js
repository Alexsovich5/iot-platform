/**
 * IoT Device Management Platform - server bootstrap.
 *
 * Connects to MongoDB and the MQTT broker, attaches Socket.IO and starts
 * the HTTP server around the app built by src/app.js.
 */

'use strict';

var http = require('http');
var mongoose = require('mongoose');
var socketIO = require('socket.io');
var config = require('config');
var MQTTHandler = require('./mqtt_handler');
var createApp = require('./app');
var Presence = require('./lib/presence');
var Device = require('./models/device');

function configValue(key, fallback) {
    return config.has(key) ? config.get(key) : fallback;
}

function resolveBaseUrl(opts, port) {
    if (opts.publicBaseUrl) {
        return opts.publicBaseUrl;
    }
    if (opts.port === 0) {
        return 'http://localhost:' + port;
    }
    return configValue('firmware.publicBaseUrl', 'http://localhost:' + port);
}

function setupSocketIO(io, mqttHandler) {
    io.on('connection', function(socket) {
        socket.on('subscribe_device', function(deviceId) {
            socket.join('device_' + deviceId);
        });

        socket.on('send_command', function(data) {
            if (!data) {
                return;
            }
            mqttHandler.sendCommand(data.deviceId, data.command, data.payload);
        });
    });
}

// start(opts, cb) boots the platform. Overrides:
//   port, mongoUri, mqtt, provisioningKey, publicBaseUrl, webhookUrl
// cb(err, {server, port, baseUrl, mqttHandler, presence, close})
function start(opts, cb) {
    if (typeof opts === 'function') {
        cb = opts;
        opts = {};
    }
    opts = opts || {};
    cb = cb || function() {};

    var mqttConfig = {};
    var baseMqtt = configValue('mqtt', {});
    Object.keys(baseMqtt).forEach(function(key) {
        mqttConfig[key] = baseMqtt[key];
    });
    Object.keys(opts.mqtt || {}).forEach(function(key) {
        mqttConfig[key] = opts.mqtt[key];
    });
    mqttConfig.port = parseInt(mqttConfig.port, 10) || 1883;

    var server = http.createServer();
    var io = socketIO(server);

    var presence = new Presence({
        Device: Device,
        io: io,
        offlineAfterSec: configValue('presence.offlineAfterSec', 120),
        intervalSec: configValue('presence.sweepIntervalSec', 30)
    });
    var closed = false;
    function startPresence() {
        if (!closed) {
            presence.start();
        }
    }

    if (mongoose.connection.readyState === 0) {
        var mongoUri = opts.mongoUri || config.get('mongodb.uri');
        mongoose.connect(mongoUri, function(err) {
            if (err) {
                console.error('MongoDB connection error:', err.message);
                if (require.main === module) {
                    process.exit(1);
                }
                return;
            }
            startPresence();
        });
    } else if (mongoose.connection.readyState === 1) {
        startPresence();
    } else {
        mongoose.connection.once('open', startPresence);
    }

    var mqttHandler = new MQTTHandler(mqttConfig, io, {
        provisioningKey: opts.provisioningKey !== undefined ?
            opts.provisioningKey : configValue('provisioning.key', '')
    });
    var app = createApp({
        mqttHandler: mqttHandler,
        stats: mqttHandler.stats.bind(mqttHandler)
    });
    server.on('request', app);

    mqttHandler.connect();
    setupSocketIO(io, mqttHandler);

    var port = opts.port !== undefined ? opts.port : configValue('server.port', 3000);

    function close(done) {
        done = done || function() {};
        closed = true;
        presence.stop();
        mongoose.connection.removeListener('open', startPresence);
        mqttHandler.close(function() {
            io.engine.close();
            server.close(function() {
                done();
            });
        });
    }

    server.once('error', cb);
    server.listen(port, function() {
        server.removeListener('error', cb);
        var boundPort = server.address().port;
        cb(null, {
            server: server,
            port: boundPort,
            baseUrl: resolveBaseUrl(opts, boundPort),
            mqttHandler: mqttHandler,
            presence: presence,
            close: close
        });
    });
}

module.exports = {
    start: start
};

if (require.main === module) {
    start({}, function(err, result) {
        if (err) {
            console.error('Failed to start:', err.message);
            process.exit(1);
        }
        console.log('IoT Platform running on port ' + result.port);
    });
}
