/**
 * Express application factory.
 *
 * Builds the HTTP app without connecting to MongoDB or MQTT, so it can be
 * constructed in tests with stubbed dependencies.
 */

'use strict';

var fs = require('fs');
var path = require('path');
var express = require('express');
var bodyParser = require('body-parser');
var mongoose = require('mongoose');
var config = require('config');
var apiRoutes = require('./routes/api');
var firmwareRoutes = require('./routes/firmware');

function defaultStats() {
    return {rejectedMessages: 0};
}

function defaultFirmwareDir() {
    return config.has('firmware.dir') ? config.get('firmware.dir') : '/data/firmware';
}

// GET /firmware/:deviceType/:version.bin streams a stored binary.
function downloadFirmware(req, res, next) {
    var deviceType = req.params.deviceType;
    var version = req.params.version;
    if (!firmwareRoutes.isDeviceType(deviceType) || !firmwareRoutes.isVersion(version)) {
        return next();
    }
    var file = firmwareRoutes.filePath(req.app.get('firmwareDir'), deviceType, version);
    fs.stat(file, function(err, stat) {
        if (err || !stat.isFile()) {
            return next();
        }
        res.set('Content-Type', 'application/octet-stream');
        res.set('Content-Length', String(stat.size));
        var stream = fs.createReadStream(file);
        stream.on('error', next);
        stream.pipe(res);
    });
}

function createApp(options) {
    options = options || {};
    var mqttHandler = options.mqttHandler;
    var stats = options.stats || defaultStats;

    var app = express();
    app.set('mqttHandler', mqttHandler);
    app.set('alertService', options.alertService || null);
    app.set('Rule', options.Rule || require('./models/rule'));
    app.set('Alert', options.Alert || require('./models/alert'));
    app.set('firmwareDir', options.firmwareDir || defaultFirmwareDir());

    app.use(bodyParser.json({limit: '100kb'}));
    app.use(express.static(path.join(__dirname, '..', 'public')));

    app.use('/api', apiRoutes);
    app.get('/firmware/:deviceType/:version.bin', downloadFirmware);

    app.get('/health', function(req, res) {
        var mqttConnected = !!(mqttHandler && mqttHandler.isConnected());
        res.json({
            status: 'healthy',
            uptime: process.uptime(),
            mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
            mqtt: mqttConnected ? 'connected' : 'disconnected',
            rejectedMessages: stats().rejectedMessages || 0
        });
    });

    app.use(function(req, res) {
        res.status(404).json({error: 'Not found'});
    });

    // Express recognises error handlers by their four-argument signature.
    app.use(function(err, req, res, next) { // eslint-disable-line no-unused-vars
        var status = err.status || err.statusCode || 500;
        if (status < 400 || status > 599) {
            status = 500;
        }
        if (status >= 500) {
            console.error('Request error:', err.stack || err);
            return res.status(status).json({error: 'Internal server error'});
        }
        res.status(status).json({error: err.message || 'Bad request'});
    });

    return app;
}

module.exports = createApp;
