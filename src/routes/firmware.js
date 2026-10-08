/**
 * Firmware routes: registry upload and listing, rollouts and update
 * tracking. Mounted at /api/firmware by routes/api.js, which also mounts
 * startForDevice at POST /api/devices/:id/firmware. Binaries are written
 * to the directory in the app setting 'firmwareDir' as
 * <deviceType>/<version>.bin; the size and MD5 go into the Firmware
 * collection. Updates go through the app setting 'firmwareService'.
 */

'use strict';

var crypto = require('crypto');
var fs = require('fs');
var path = require('path');
var express = require('express');
var bodyParser = require('body-parser');
var Firmware = require('../models/firmware');
var Device = require('../models/device');
var FirmwareUpdate = require('../models/firmware_update');
var DEVICE_ID_RE = require('../lib/ids').DEVICE_ID_RE;
var STATES = require('../lib/firmware').STATES;

var router = express.Router();

var MAX_SIZE = '10mb';

// Device types double as directory names, so only the model's enum values
// are accepted.
function isDeviceType(value) {
    return Device.schema.path('type').enumValues.indexOf(value) !== -1;
}

function isVersion(value) {
    return typeof value === 'string' && Firmware.VERSION_RE.test(value);
}

function filePath(dir, deviceType, version) {
    return path.join(dir, deviceType, version + '.bin');
}

function writeFile(file, data, cb) {
    fs.mkdir(path.dirname(file), function(err) {
        if (err && err.code !== 'EEXIST') {
            return cb(err);
        }
        // Write to a temporary name and rename, so a download never sees
        // a partly written file.
        var tmp = file + '.' + crypto.randomBytes(4).toString('hex') + '.tmp';
        fs.writeFile(tmp, data, function(writeErr) {
            if (writeErr) {
                return cb(writeErr);
            }
            fs.rename(tmp, file, cb);
        });
    });
}

function ensureDir(dir, cb) {
    fs.mkdir(dir, function(err) {
        cb(err && err.code !== 'EEXIST' ? err : null);
    });
}

function duplicate(res) {
    res.status(409).json({error: 'Firmware version already exists for this device type'});
}

// Sends a service error with its status, or passes it on as a 500.
function serviceError(err, res, next) {
    if (err.status) {
        return res.status(err.status).json({error: err.message});
    }
    next(err);
}

function firmwareService(req, res) {
    var service = req.app.get('firmwareService');
    if (!service) {
        res.status(503).json({error: 'Firmware updates are not available'});
    }
    return service;
}

// POST /api/devices/:id/firmware {version}: update one device to a stored
// image for its device type.
function startForDevice(req, res, next) {
    var deviceId = req.params.id;
    var version = (req.body || {}).version;
    if (!DEVICE_ID_RE.test(deviceId)) {
        return res.status(400).json({error: 'Invalid deviceId'});
    }
    if (!isVersion(version)) {
        return res.status(400).json({error: 'version must look like 1.2.3'});
    }
    var service = firmwareService(req, res);
    if (!service) {
        return;
    }
    Device.findOne({deviceId: deviceId}, 'deviceId type status firmware', function(err, device) {
        if (err) {
            return next(err);
        }
        if (!device) {
            return res.status(404).json({error: 'Device not found'});
        }
        if (device.status === 'decommissioned') {
            return res.status(409).json({error: 'Device is decommissioned'});
        }
        Firmware.findOne({version: version, deviceType: device.type}, function(fwErr, firmware) {
            if (fwErr) {
                return next(fwErr);
            }
            if (!firmware) {
                return res.status(404).json({error: 'Firmware not found for this device type'});
            }
            service.startUpdate(device, firmware, function(startErr, update) {
                if (startErr) {
                    return serviceError(startErr, res, next);
                }
                res.status(202).json(update);
            });
        });
    });
}

// GET /api/firmware/updates?deviceId=&state=
router.get('/updates', function(req, res, next) {
    var query = {};
    if (req.query.deviceId !== undefined) {
        if (typeof req.query.deviceId !== 'string' || !DEVICE_ID_RE.test(req.query.deviceId)) {
            return res.status(400).json({error: 'Invalid deviceId'});
        }
        query.deviceId = req.query.deviceId;
    }
    if (req.query.state !== undefined) {
        if (STATES.indexOf(req.query.state) === -1) {
            return res.status(400).json({error: 'Invalid state'});
        }
        query.state = req.query.state;
    }
    FirmwareUpdate.find(query).sort({createdAt: -1}).limit(500).exec(function(err, updates) {
        if (err) {
            return next(err);
        }
        res.json({updates: updates});
    });
});

// POST /api/firmware/:deviceType/:version/rollout
router.post('/:deviceType/:version/rollout', function(req, res, next) {
    var deviceType = req.params.deviceType;
    var version = req.params.version;
    if (!isDeviceType(deviceType)) {
        return res.status(400).json({error: 'Unknown deviceType'});
    }
    if (!isVersion(version)) {
        return res.status(400).json({error: 'version must look like 1.2.3'});
    }
    var service = firmwareService(req, res);
    if (!service) {
        return;
    }
    service.rollout(deviceType, version, function(err, updates) {
        if (err) {
            return serviceError(err, res, next);
        }
        res.status(202).json({updates: updates});
    });
});

router.get('/', function(req, res, next) {
    Firmware.find({}).sort({deviceType: 1, createdAt: -1}).exec(function(err, found) {
        if (err) {
            return next(err);
        }
        res.json({firmware: found, count: found.length});
    });
});

// POST /api/firmware?version=1.2.0&deviceType=sensor with the binary as an
// application/octet-stream body of at most 10 MB.
router.post('/', bodyParser.raw({type: 'application/octet-stream', limit: MAX_SIZE}), function(req, res, next) {
    var version = req.query.version;
    var deviceType = req.query.deviceType;

    if (!req.is('application/octet-stream')) {
        return res.status(415).json({error: 'Content-Type must be application/octet-stream'});
    }
    if (!isVersion(version)) {
        return res.status(400).json({error: 'version must look like 1.2.3'});
    }
    if (!isDeviceType(deviceType)) {
        return res.status(400).json({error: 'Unknown deviceType'});
    }
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        return res.status(400).json({error: 'Firmware body is empty'});
    }

    var data = req.body;
    var dir = req.app.get('firmwareDir');

    Firmware.findOne({version: version, deviceType: deviceType}, function(err, existing) {
        if (err) {
            return next(err);
        }
        if (existing) {
            return duplicate(res);
        }
        var md5 = crypto.createHash('md5').update(data).digest('hex');
        var file = filePath(dir, deviceType, version);
        ensureDir(dir, function(dirErr) {
            if (dirErr) {
                return next(dirErr);
            }
            Firmware.create({
                version: version,
                deviceType: deviceType,
                filename: deviceType + '/' + version + '.bin',
                size: data.length,
                md5: md5
            }, function(createErr, firmware) {
                if (createErr) {
                    // The unique index catches uploads that raced past the
                    // findOne check; the winner's file is left in place.
                    if (createErr.code === 11000) {
                        return duplicate(res);
                    }
                    return next(createErr);
                }
                writeFile(file, data, function(writeErr) {
                    if (writeErr) {
                        return firmware.remove(function() {
                            next(writeErr);
                        });
                    }
                    res.status(201).json(firmware);
                });
            });
        });
    });
});

router.isDeviceType = isDeviceType;
router.isVersion = isVersion;
router.filePath = filePath;
router.startForDevice = startForDevice;

module.exports = router;
