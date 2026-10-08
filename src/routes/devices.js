/**
 * Device routes: list, provisioning, detail, update, decommission and
 * telemetry history and command dispatch. Mounted at /api/devices by routes/api.js.
 */

'use strict';

var express = require('express');
var Device = require('../models/device');
var DEVICE_ID_RE = require('../lib/ids').DEVICE_ID_RE;
var lifecycle = require('../lib/lifecycle');
var tokens = require('../lib/tokens');
var commands = require('../lib/commands');

var router = express.Router();

var CREATE_FIELDS = ['deviceId', 'name', 'type', 'location', 'tags'];
var UPDATE_FIELDS = ['name', 'location', 'tags', 'metadata', 'status'];

var DEFAULT_TELEMETRY_LIMIT = 100;
var MAX_TELEMETRY_LIMIT = 1000;

function pick(source, fields) {
    var out = {};
    source = source || {};
    fields.forEach(function(field) {
        if (Object.prototype.hasOwnProperty.call(source, field)) {
            out[field] = source[field];
        }
    });
    return out;
}

function isDuplicateKey(err) {
    return !!err && (err.code === 11000 || err.code === 11001);
}

// Map mongoose validation and duplicate-key errors to 4xx responses and
// pass anything else to the app's error handler.
function handleError(err, res, next) {
    if (err.name === 'ValidationError' || err.name === 'CastError') {
        return res.status(400).json({error: err.message});
    }
    if (isDuplicateKey(err)) {
        return res.status(409).json({error: 'Device already exists'});
    }
    next(err);
}

function clampLimit(raw) {
    var limit = parseInt(raw, 10);
    if (isNaN(limit)) {
        return DEFAULT_TELEMETRY_LIMIT;
    }
    return Math.max(1, Math.min(MAX_TELEMETRY_LIMIT, limit));
}

router.param('id', function(req, res, next, id) {
    if (!DEVICE_ID_RE.test(id)) {
        return res.status(400).json({error: 'Invalid deviceId'});
    }
    next();
});

// List devices, optionally filtered by status and type.
router.get('/', function(req, res, next) {
    var query = {};
    if (typeof req.query.status === 'string') {
        query.status = req.query.status;
    }
    if (typeof req.query.type === 'string') {
        query.type = req.query.type;
    }

    Device.find(query)
        .select('-telemetry')
        .sort({lastSeen: -1})
        .exec(function(err, devices) {
            if (err) {
                return next(err);
            }
            res.json({devices: devices, count: devices.length});
        });
});

// Operator provisioning: create the device and return its token once.
router.post('/', function(req, res, next) {
    var fields = pick(req.body, CREATE_FIELDS);
    if (typeof fields.deviceId !== 'string' || !DEVICE_ID_RE.test(fields.deviceId)) {
        return res.status(400).json({error: 'Invalid deviceId'});
    }

    Device.findOne({deviceId: fields.deviceId}, {_id: 1}, function(err, existing) {
        if (err) {
            return next(err);
        }
        if (existing) {
            return res.status(409).json({error: 'Device already exists'});
        }

        var token = tokens.generate();
        fields.tokenHash = tokens.hash(token);
        fields.provisionedBy = 'api';
        fields.status = 'registered';

        // The unique index still rejects a concurrent create that passed
        // the findOne check above; handleError maps that E11000 to 409.
        Device.create(fields, function(createErr, device) {
            if (createErr) {
                return handleError(createErr, res, next);
            }
            res.status(201).json({device: device, token: token});
        });
    });
});

// Device details without the embedded telemetry history.
router.get('/:id', function(req, res, next) {
    Device.findOne({deviceId: req.params.id})
        .select('-telemetry')
        .exec(function(err, device) {
            if (err) {
                return next(err);
            }
            if (!device) {
                return res.status(404).json({error: 'Device not found'});
            }
            res.json(device);
        });
});

// Telemetry history, newest point last.
router.get('/:id/telemetry', function(req, res, next) {
    var limit = clampLimit(req.query.limit);
    Device.findOne({deviceId: req.params.id})
        .select({deviceId: 1, telemetry: {$slice: -limit}})
        .exec(function(err, device) {
            if (err) {
                return next(err);
            }
            if (!device) {
                return res.status(404).json({error: 'Device not found'});
            }
            res.json({deviceId: device.deviceId, telemetry: device.telemetry});
        });
});

// Update whitelisted fields. A status change must be a valid operator
// transition.
router.put('/:id', function(req, res, next) {
    var updates = pick(req.body, UPDATE_FIELDS);

    if (updates.status !== undefined && lifecycle.STATUSES.indexOf(updates.status) === -1) {
        return res.status(400).json({error: 'Invalid status'});
    }

    Device.findOne({deviceId: req.params.id})
        .select('-telemetry')
        .exec(function(err, device) {
            if (err) {
                return next(err);
            }
            if (!device) {
                return res.status(404).json({error: 'Device not found'});
            }
            if (updates.status !== undefined && updates.status !== device.status &&
                    !lifecycle.canTransition(device.status, updates.status)) {
                return res.status(409).json({
                    error: 'Cannot change status from ' + device.status + ' to ' + updates.status
                });
            }

            Object.keys(updates).forEach(function(field) {
                device.set(field, updates[field]);
            });
            device.save(function(saveErr, saved) {
                if (saveErr) {
                    return handleError(saveErr, res, next);
                }
                res.json(saved);
            });
        });
});

// Send a command to the device over MQTT. The MQTT handler is taken from
// the app setting 'mqttHandler' (see app.js).
router.post('/:id/commands', function(req, res, next) {
    var body = req.body || {};
    commands.dispatch({Device: Device, mqttHandler: req.app.get('mqttHandler')},
        req.params.id, body.command, body.payload, function(err, commandId) {
            if (err) {
                return err.status ? res.status(err.status).json({error: err.message}) : next(err);
            }
            res.status(202).json({commandId: commandId});
        });
});

// Decommission: final status, token revoked. The record is kept.
router.delete('/:id', function(req, res, next) {
    Device.findOneAndUpdate(
        {deviceId: req.params.id},
        {$set: {status: 'decommissioned'}, $unset: {tokenHash: 1}},
        {new: true}
    )
        .select('-telemetry')
        .exec(function(err, device) {
            if (err) {
                return next(err);
            }
            if (!device) {
                return res.status(404).json({error: 'Device not found'});
            }
            res.json(device);
        });
});

module.exports = router;
