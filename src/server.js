/**
 * IoT Device Management Platform - Main Server
 * IT Operations Specialist - ACORIA (2015-2016)
 *
 * Express server with MQTT integration for device management.
 */

'use strict';

var express = require('express');
var http = require('http');
var mongoose = require('mongoose');
var socketIO = require('socket.io');
var config = require('config');
var MQTTHandler = require('./mqtt_handler');
var apiRoutes = require('./routes/api');

var app = express();
var server = http.createServer(app);
var io = socketIO(server);

// Middleware
app.use(express.json());
app.use(express.static('public'));

// MongoDB connection
var mongoUri = config.get('mongodb.uri');
mongoose.connect(mongoUri, function(err) {
    if (err) {
        console.error('MongoDB connection error:', err);
        process.exit(1);
    }
    console.log('Connected to MongoDB');
});

// API routes
app.use('/api', apiRoutes);

// Health check
app.get('/health', function(req, res) {
    res.json({
        status: 'healthy',
        uptime: process.uptime(),
        mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
        mqtt: mqttHandler.isConnected() ? 'connected' : 'disconnected'
    });
});

// Initialize MQTT handler
var mqttHandler = new MQTTHandler(config.get('mqtt'), io);
mqttHandler.connect();

// WebSocket for real-time dashboard updates
io.on('connection', function(socket) {
    console.log('Dashboard client connected:', socket.id);

    socket.on('subscribe_device', function(deviceId) {
        socket.join('device_' + deviceId);
        console.log('Client subscribed to device:', deviceId);
    });

    socket.on('send_command', function(data) {
        mqttHandler.sendCommand(data.deviceId, data.command, data.payload);
    });

    socket.on('disconnect', function() {
        console.log('Dashboard client disconnected:', socket.id);
    });
});

// Start server
var port = config.get('server.port') || 3000;
server.listen(port, function() {
    console.log('IoT Platform running on port ' + port);
});

module.exports = app;
