/**
 * REST API Routes
 */

'use strict';

var express = require('express');
var router = express.Router();
var Device = require('../models/device');

// List all devices
router.get('/devices', function(req, res) {
    var query = {};
    if (req.query.status) query.status = req.query.status;
    if (req.query.type) query.type = req.query.type;

    Device.find(query)
        .select('-telemetry')
        .sort({ lastSeen: -1 })
        .exec(function(err, devices) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ devices: devices, count: devices.length });
        });
});

// Get device details
router.get('/devices/:id', function(req, res) {
    Device.findOne({ deviceId: req.params.id }, function(err, device) {
        if (err) return res.status(500).json({ error: err.message });
        if (!device) return res.status(404).json({ error: 'Device not found' });
        res.json(device);
    });
});

// Get device telemetry
router.get('/devices/:id/telemetry', function(req, res) {
    var limit = parseInt(req.query.limit) || 100;
    Device.findOne({ deviceId: req.params.id })
        .select({ telemetry: { $slice: -limit } })
        .exec(function(err, device) {
            if (err) return res.status(500).json({ error: err.message });
            if (!device) return res.status(404).json({ error: 'Device not found' });
            res.json({ deviceId: device.deviceId, telemetry: device.telemetry });
        });
});

// Update device
router.put('/devices/:id', function(req, res) {
    Device.findOneAndUpdate(
        { deviceId: req.params.id },
        { $set: req.body },
        { new: true },
        function(err, device) {
            if (err) return res.status(500).json({ error: err.message });
            if (!device) return res.status(404).json({ error: 'Device not found' });
            res.json(device);
        }
    );
});

// Dashboard stats
router.get('/stats', function(req, res) {
    Device.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 } } }
    ], function(err, results) {
        if (err) return res.status(500).json({ error: err.message });
        var stats = {};
        results.forEach(function(r) { stats[r._id] = r.count; });
        res.json(stats);
    });
});

module.exports = router;
