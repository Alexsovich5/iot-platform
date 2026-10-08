/**
 * REST API router. Mounts the resource routers and serves dashboard stats.
 */

'use strict';

var express = require('express');
var Device = require('../models/device');
var devices = require('./devices');
var rules = require('./rules');
var alerts = require('./alerts');
var firmware = require('./firmware');

var router = express.Router();

router.post('/devices/:id/firmware', firmware.startForDevice);
router.use('/devices', devices);
router.use('/rules', rules);
router.use('/alerts', alerts);
router.use('/firmware', firmware);

// Device counts by status.
router.get('/stats', function(req, res, next) {
    Device.aggregate([
        {$group: {_id: '$status', count: {$sum: 1}}}
    ], function(err, results) {
        if (err) {
            return next(err);
        }
        var stats = {};
        results.forEach(function(r) {
            stats[r._id] = r.count;
        });
        res.json(stats);
    });
});

module.exports = router;
