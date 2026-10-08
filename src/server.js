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
var AlertService = require('./lib/alerts');
var Notifier = require('./lib/notifier');
var FirmwareService = require('./lib/firmware').FirmwareService;
var Device = require('./models/device');
var Rule = require('./models/rule');
var Alert = require('./models/alert');
var Firmware = require('./models/firmware');
var FirmwareUpdate = require('./models/firmware_update');
var secrets = require('./lib/secrets');
var socket = require('./socket');

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

// Reads the operator API key, the broker password and the provisioning
// key. Values come from opts, then config, then the configured files; the
// API key file is created with a random key on first start.
function resolveSecrets(opts, mqttConfig) {
    var out = {};
    if (opts.apiKey) {
        out.apiKey = opts.apiKey;
    } else {
        var keyFile = configValue('api.keyFile', '');
        var loaded = secrets.loadOrCreateKey(keyFile);
        if (loaded.created) {
            console.log('Created a new operator API key in ' + keyFile);
        }
        out.apiKey = loaded.key;
    }
    out.mqttPassword = secrets.readSecret(mqttConfig.password, mqttConfig.passwordFile);
    out.provisioningKey = opts.provisioningKey !== undefined ? opts.provisioningKey :
        secrets.readSecret(configValue('provisioning.key', ''), configValue('provisioning.keyFile', ''));
    return out;
}

// start(opts, cb) boots the platform. Overrides:
//   port, mongoUri, mqtt, apiKey, provisioningKey, publicBaseUrl, webhookUrl
// cb(err, {server, port, baseUrl, mqttHandler, firmwareService, presence, close})
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

    var resolved;
    try {
        resolved = resolveSecrets(opts, mqttConfig);
    } catch (e) {
        return process.nextTick(function() {
            cb(e);
        });
    }
    mqttConfig.password = resolved.mqttPassword;
    delete mqttConfig.passwordFile;

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

    var notifier = new Notifier({
        url: opts.webhookUrl !== undefined ? opts.webhookUrl : configValue('alerts.webhookUrl', '')
    });
    var alertService = new AlertService({Alert: Alert, Rule: Rule, io: io, notifier: notifier});

    var mqttHandler = new MQTTHandler(mqttConfig, io, {
        alerts: alertService,
        provisioningKey: resolved.provisioningKey
    });
    var port = opts.port !== undefined ? opts.port : configValue('server.port', 3000);

    // The base URL depends on the bound port, so it is set again in the
    // listen callback below.
    var firmwareService = new FirmwareService({
        FirmwareUpdate: FirmwareUpdate,
        Device: Device,
        Firmware: Firmware,
        mqttHandler: mqttHandler,
        io: io,
        baseUrl: resolveBaseUrl(opts, port)
    });
    mqttHandler.firmware = firmwareService;

    var app = createApp({
        apiKey: resolved.apiKey,
        mqttHandler: mqttHandler,
        alertService: alertService,
        firmwareService: firmwareService,
        stats: mqttHandler.stats.bind(mqttHandler)
    });
    server.on('request', app);

    mqttHandler.connect();
    io.use(socket.authorize(resolved.apiKey));
    socket.attach(io, mqttHandler, Device);

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
        var baseUrl = resolveBaseUrl(opts, boundPort);
        firmwareService.baseUrl = baseUrl;
        cb(null, {
            server: server,
            port: boundPort,
            baseUrl: baseUrl,
            mqttHandler: mqttHandler,
            firmwareService: firmwareService,
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
