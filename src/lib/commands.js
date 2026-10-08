'use strict';

/**
 * Command dispatch shared by the REST endpoint and the Socket.IO
 * send_command event.
 *
 * dispatch() validates the device ID and command name, refuses unknown
 * and decommissioned devices and a disconnected broker, and otherwise
 * publishes the command through the MQTT handler. Errors carry an HTTP
 * status in err.status.
 */

var DEVICE_ID_RE = require('./ids').DEVICE_ID_RE;

var COMMAND_RE = /^[a-z_]{1,32}$/;

function httpError(status, message) {
    var err = new Error(message);
    err.status = status;
    return err;
}

// cb(err, commandId)
function dispatch(deps, deviceId, command, payload, cb) {
    var Device = deps.Device;
    var mqttHandler = deps.mqttHandler;

    function fail(status, message) {
        process.nextTick(function() {
            cb(httpError(status, message));
        });
    }

    if (typeof deviceId !== 'string' || !DEVICE_ID_RE.test(deviceId)) {
        return fail(400, 'Invalid deviceId');
    }
    if (typeof command !== 'string' || !COMMAND_RE.test(command)) {
        return fail(400, 'Invalid command');
    }

    Device.findOne({deviceId: deviceId}, 'deviceId status', function(err, device) {
        if (err) {
            return cb(err);
        }
        if (!device) {
            return cb(httpError(404, 'Device not found'));
        }
        if (device.status === 'decommissioned') {
            return cb(httpError(409, 'Device is decommissioned'));
        }
        if (!mqttHandler || !mqttHandler.isConnected()) {
            return cb(httpError(503, 'MQTT broker not connected'));
        }
        var commandId = mqttHandler.sendCommand(deviceId, command, payload, function(sendErr) {
            if (sendErr) {
                console.error('Command publish failed for', deviceId, ':', sendErr.message);
            }
        });
        if (!commandId) {
            return cb(httpError(503, 'MQTT broker not connected'));
        }
        cb(null, commandId);
    });
}

module.exports = {
    COMMAND_RE: COMMAND_RE,
    dispatch: dispatch
};
