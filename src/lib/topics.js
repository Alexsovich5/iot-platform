'use strict';

/**
 * MQTT topic scheme: devices/<deviceId>/<type>.
 *
 * parse() accepts only the inbound types the platform subscribes to and
 * device IDs that match DEVICE_ID_RE, so wildcard characters, extra path
 * levels and over-long IDs are rejected before any lookup.
 */

var DEVICE_ID_RE = require('./ids').DEVICE_ID_RE;

var PREFIX = 'devices';
var INBOUND_TYPES = ['register', 'telemetry', 'status', 'alerts', 'firmware'];

function parse(topic) {
    if (typeof topic !== 'string') {
        return null;
    }
    var parts = topic.split('/');
    if (parts.length !== 3 || parts[0] !== PREFIX) {
        return null;
    }
    if (!DEVICE_ID_RE.test(parts[1]) || INBOUND_TYPES.indexOf(parts[2]) === -1) {
        return null;
    }
    return {deviceId: parts[1], type: parts[2]};
}

function deviceTopic(deviceId, suffix) {
    if (typeof deviceId !== 'string' || !DEVICE_ID_RE.test(deviceId)) {
        throw new Error('Invalid deviceId: ' + deviceId);
    }
    return PREFIX + '/' + deviceId + '/' + suffix;
}

function commandTopic(deviceId) {
    return deviceTopic(deviceId, 'commands');
}

function provisionedTopic(deviceId) {
    return deviceTopic(deviceId, 'provisioned');
}

function subscriptions() {
    return INBOUND_TYPES.map(function(type) {
        return PREFIX + '/+/' + type;
    });
}

module.exports = {
    INBOUND_TYPES: INBOUND_TYPES,
    parse: parse,
    commandTopic: commandTopic,
    provisionedTopic: provisionedTopic,
    subscriptions: subscriptions
};
