/**
 * Express application factory.
 *
 * Builds the HTTP app without connecting to MongoDB or MQTT, so it can be
 * constructed in tests with stubbed dependencies.
 *
 * Every /api route requires the operator key (options.apiKey) as a Bearer
 * token; /health, the dashboard files and firmware downloads are public.
 */

'use strict';

var fs = require('fs');
var path = require('path');
var express = require('express');
var bodyParser = require('body-parser');
var mongoose = require('mongoose');
var config = require('config');
var apiAuth = require('./lib/api_auth');
var apiRoutes = require('./routes/api');
var firmwareRoutes = require('./routes/firmware');

function defaultStats() {
    return {rejectedMessages: 0};
}

function mongoConnected() {
    return mongoose.connection.readyState === 1;
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
    if (typeof options.apiKey !== 'string' || options.apiKey.length === 0) {
        throw new Error('createApp needs an apiKey');
    }
    var mqttHandler = options.mqttHandler;
    var stats = options.stats || defaultStats;
    var isDbConnected = options.isDbConnected || mongoConnected;

    var app = express();
    app.set('mqttHandler', mqttHandler);
    app.set('alertService', options.alertService || null);
    app.set('Rule', options.Rule || require('./models/rule'));
    app.set('Alert', options.Alert || require('./models/alert'));
    app.set('firmwareDir', options.firmwareDir || defaultFirmwareDir());
    app.set('firmwareService', options.firmwareService || null);

    // The key is checked before any body is parsed.
    app.use('/api', apiAuth.requireApiKey(options.apiKey));
    app.use(bodyParser.json({limit: '100kb'}));
    app.use(express.static(path.join(__dirname, '..', 'public')));

    app.use('/api', apiRoutes);
    app.get('/firmware/:deviceType/:version.bin', downloadFirmware);

    // healthy only when both MongoDB and the broker are connected;
    // anything else, including an unknown state, is 503 degraded.
    app.get('/health', function(req, res) {
        var mqttConnected = !!(mqttHandler && mqttHandler.isConnected());
        var dbConnected = !!isDbConnected();
        var healthy = mqttConnected && dbConnected;
        res.status(healthy ? 200 : 503).json({
            status: healthy ? 'healthy' : 'degraded',
            uptime: process.uptime(),
            mongodb: dbConnected ? 'connected' : 'disconnected',
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
