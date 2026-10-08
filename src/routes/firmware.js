/**
 * Firmware registry routes: upload and list. Mounted at /api/firmware by
 * routes/api.js. Binaries are written to the directory in the app setting
 * 'firmwareDir' as <deviceType>/<version>.bin; the size and MD5 go into
 * the Firmware collection.
 */

'use strict';

var crypto = require('crypto');
var fs = require('fs');
var path = require('path');
var express = require('express');
var bodyParser = require('body-parser');
var Firmware = require('../models/firmware');
var Device = require('../models/device');

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

module.exports = router;
