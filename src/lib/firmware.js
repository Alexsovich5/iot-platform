'use strict';

/**
 * Firmware update distribution.
 *
 * canAdvance() is the update state machine:
 *   pending -> downloading -> installing -> success
 * and any non-terminal state may move to failed.
 *
 * FirmwareService creates update records, publishes firmware_update
 * commands, rolls an image out to a device type and applies the progress
 * devices report over MQTT. Errors carry an HTTP status in err.status.
 *
 * Dependencies: {FirmwareUpdate, Device, Firmware?, mqttHandler, io,
 * baseUrl}. baseUrl is a public property read whenever a command is built,
 * so the server can set it once the HTTP port is known.
 */

var STATES = ['pending', 'downloading', 'installing', 'success', 'failed'];
var TERMINAL = ['success', 'failed'];
var NEXT = {
    pending: 'downloading',
    downloading: 'installing',
    installing: 'success'
};
var OBJECT_ID_RE = /^[0-9a-fA-F]{24}$/;
var MAX_ERROR_LENGTH = 256;

function canAdvance(from, to) {
    if (STATES.indexOf(from) === -1 || TERMINAL.indexOf(from) !== -1) {
        return false;
    }
    return to === 'failed' || NEXT[from] === to;
}

function httpError(status, message) {
    var err = new Error(message);
    err.status = status;
    return err;
}

function later(cb, err) {
    process.nextTick(function() {
        cb(err);
    });
}

function FirmwareService(deps) {
    deps = deps || {};
    this.FirmwareUpdate = deps.FirmwareUpdate;
    this.Device = deps.Device;
    this.Firmware = deps.Firmware || null;
    this.mqttHandler = deps.mqttHandler;
    this.io = deps.io;
    this.baseUrl = deps.baseUrl;
}

FirmwareService.prototype._firmwareModel = function() {
    return this.Firmware || require('../models/firmware');
};

FirmwareService.prototype._connected = function() {
    return !!(this.mqttHandler && this.mqttHandler.isConnected());
};

FirmwareService.prototype._emit = function(update) {
    if (this.io) {
        this.io.emit('firmware', {update: update});
    }
};

FirmwareService.prototype.downloadUrl = function(deviceType, version) {
    return this.baseUrl + '/firmware/' + deviceType + '/' + version + '.bin';
};

// Creates a pending update for `device` and publishes the command.
// cb(err, update)
FirmwareService.prototype.startUpdate = function(device, firmware, cb) {
    var self = this;
    if (!this._connected()) {
        return later(cb, httpError(503, 'MQTT broker not connected'));
    }
    this.FirmwareUpdate.create({
        deviceId: device.deviceId,
        version: firmware.version,
        state: 'pending',
        history: [{state: 'pending', at: new Date()}]
    }, function(err, update) {
        if (err) {
            return cb(err);
        }
        var commandId = self.mqttHandler.sendCommand(device.deviceId, 'firmware_update', {
            updateId: String(update._id),
            version: firmware.version,
            url: self.downloadUrl(firmware.deviceType, firmware.version),
            md5: firmware.md5
        }, function(sendErr) {
            if (sendErr) {
                console.error('Firmware command publish failed for', device.deviceId, ':', sendErr.message);
            }
        });
        if (!commandId) {
            return self._markFailed(update, 'Command could not be published', function() {
                cb(httpError(503, 'MQTT broker not connected'));
            });
        }
        self._emit(update);
        cb(null, update);
    });
};

FirmwareService.prototype._markFailed = function(update, message, cb) {
    this.FirmwareUpdate.findOneAndUpdate(
        {_id: update._id, state: update.state},
        {$set: {state: 'failed', error: message}, $push: {history: {state: 'failed', at: new Date()}}},
        {new: true},
        function(err) {
            if (err) {
                console.error('Firmware update save error:', err.message);
            }
            cb();
        }
    );
};

// Starts an update on every non-decommissioned device of `deviceType`
// that does not already run `version`. cb(err, updates)
FirmwareService.prototype.rollout = function(deviceType, version, cb) {
    var self = this;
    this._firmwareModel().findOne({version: version, deviceType: deviceType}, function(err, firmware) {
        if (err) {
            return cb(err);
        }
        if (!firmware) {
            return cb(httpError(404, 'Firmware not found'));
        }
        if (!self._connected()) {
            return cb(httpError(503, 'MQTT broker not connected'));
        }
        self.Device.find({
            type: deviceType,
            status: {$ne: 'decommissioned'},
            firmware: {$ne: version}
        }, function(findErr, devices) {
            if (findErr) {
                return cb(findErr);
            }
            var updates = [];
            (function next(i) {
                if (i >= devices.length) {
                    return cb(null, updates);
                }
                self.startUpdate(devices[i], firmware, function(startErr, update) {
                    if (startErr) {
                        return cb(startErr);
                    }
                    updates.push(update);
                    next(i + 1);
                });
            })(0);
        });
    });
};

// Applies a progress report {updateId, state, error?} from `deviceId`.
// The write is conditional on the state that was read, so a report that
// lost a race to another one is rejected rather than applied twice.
// cb(err, update)
FirmwareService.prototype.handleProgress = function(deviceId, payload, cb) {
    var self = this;
    payload = payload || {};
    var updateId = payload.updateId;
    var state = payload.state;

    if (typeof updateId !== 'string' || !OBJECT_ID_RE.test(updateId)) {
        return later(cb, httpError(400, 'Invalid updateId'));
    }
    if (STATES.indexOf(state) === -1) {
        return later(cb, httpError(400, 'Invalid state'));
    }

    var FirmwareUpdate = this.FirmwareUpdate;
    FirmwareUpdate.findOne({_id: updateId, deviceId: deviceId}, function(err, current) {
        if (err) {
            return cb(err);
        }
        if (!current) {
            return cb(httpError(404, 'Firmware update not found for this device'));
        }
        if (!canAdvance(current.state, state)) {
            return cb(httpError(409, 'Invalid transition ' + current.state + ' -> ' + state));
        }

        var set = {state: state};
        if (state === 'failed') {
            set.error = typeof payload.error === 'string' && payload.error.length > 0 ?
                payload.error.slice(0, MAX_ERROR_LENGTH) : 'Update failed';
        }
        FirmwareUpdate.findOneAndUpdate(
            {_id: updateId, deviceId: deviceId, state: current.state},
            {$set: set, $push: {history: {state: state, at: new Date()}}},
            {new: true},
            function(saveErr, update) {
                if (saveErr) {
                    return cb(saveErr);
                }
                if (!update) {
                    return cb(httpError(409, 'Firmware update changed concurrently'));
                }
                if (state !== 'success') {
                    self._emit(update);
                    return cb(null, update);
                }
                self.Device.update({deviceId: deviceId}, {$set: {firmware: update.version}}, function(devErr) {
                    if (devErr) {
                        return cb(devErr);
                    }
                    self._emit(update);
                    cb(null, update);
                });
            }
        );
    });
};

module.exports = {
    STATES: STATES,
    canAdvance: canAdvance,
    FirmwareService: FirmwareService
};
