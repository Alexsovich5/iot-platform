'use strict';

/**
 * Socket.IO connection handlers for the dashboard.
 *
 * Clients join and leave per-device rooms to receive telemetry, and send
 * commands with send_command. Commands go through the same validation as
 * the REST endpoint; the result ({commandId} or {error}) is returned
 * through the event's acknowledgement callback when the client gives one.
 */

var DEVICE_ID_RE = require('./lib/ids').DEVICE_ID_RE;
var commands = require('./lib/commands');

function validId(deviceId) {
    return typeof deviceId === 'string' && DEVICE_ID_RE.test(deviceId);
}

function attach(io, mqttHandler, Device) {
    io.on('connection', function(socket) {
        socket.on('subscribe_device', function(deviceId) {
            if (validId(deviceId)) {
                socket.join('device_' + deviceId);
            }
        });

        socket.on('unsubscribe_device', function(deviceId) {
            if (validId(deviceId)) {
                socket.leave('device_' + deviceId);
            }
        });

        socket.on('send_command', function(data, ack) {
            var reply = typeof ack === 'function' ? ack : function() {};
            data = data && typeof data === 'object' ? data : {};
            commands.dispatch({Device: Device, mqttHandler: mqttHandler},
                data.deviceId, data.command, data.payload, function(err, commandId) {
                    if (err) {
                        return reply({error: err.status ? err.message : 'Command failed'});
                    }
                    reply({commandId: commandId});
                });
        });
    });
}

module.exports = {
    attach: attach
};
