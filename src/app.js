/**
 * Express application factory.
 *
 * Builds the HTTP app without connecting to MongoDB or MQTT, so it can be
 * constructed in tests with stubbed dependencies.
 */

'use strict';

var path = require('path');
var express = require('express');
var bodyParser = require('body-parser');
var mongoose = require('mongoose');
var apiRoutes = require('./routes/api');

function defaultStats() {
    return {rejectedMessages: 0};
}

function createApp(options) {
    options = options || {};
    var mqttHandler = options.mqttHandler;
    var stats = options.stats || defaultStats;

    var app = express();
    app.set('mqttHandler', mqttHandler);

    app.use(bodyParser.json({limit: '100kb'}));
    app.use(express.static(path.join(__dirname, '..', 'public')));

    app.use('/api', apiRoutes);

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
