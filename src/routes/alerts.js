/**
 * Alert routes: list with filters and acknowledge. Mounted at /api/alerts
 * by routes/api.js. The Alert model is taken from the app setting 'Alert'.
 */

'use strict';

var express = require('express');
var http = require('./http');

var router = express.Router();

var DEFAULT_LIMIT = 100;
var MAX_LIMIT = 1000;

function clampLimit(raw) {
    var limit = parseInt(raw, 10);
    if (isNaN(limit)) {
        return DEFAULT_LIMIT;
    }
    return Math.max(1, Math.min(MAX_LIMIT, limit));
}

router.param('id', http.objectIdParam('alert id'));

// Newest first. ?acknowledged=true|false, ?deviceId=, ?limit=1..1000.
router.get('/', function(req, res, next) {
    var query = {};
    if (req.query.acknowledged === 'true') {
        query.acknowledged = true;
    } else if (req.query.acknowledged === 'false') {
        query.acknowledged = false;
    }
    if (typeof req.query.deviceId === 'string') {
        query.deviceId = req.query.deviceId;
    }

    req.app.get('Alert').find(query)
        .sort({createdAt: -1})
        .limit(clampLimit(req.query.limit))
        .exec(function(err, found) {
            if (err) {
                return next(err);
            }
            res.json({alerts: found, count: found.length});
        });
});

router.post('/:id/ack', function(req, res, next) {
    req.app.get('Alert').findByIdAndUpdate(
        req.params.id,
        {$set: {acknowledged: true, acknowledgedAt: new Date()}},
        {new: true},
        function(err, alert) {
            if (err) {
                return http.handleError(err, res, next);
            }
            if (!alert) {
                return res.status(404).json({error: 'Alert not found'});
            }
            res.json(alert);
        }
    );
});

module.exports = router;
