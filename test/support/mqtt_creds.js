'use strict';

/**
 * Broker credentials for integration tests. The secrets service writes
 * the passwords into the shared secrets volume, mounted read-only into
 * the test container at /secrets.
 *
 * platformConfig() is the MQTTHandler config for the platform account;
 * deviceOptions(deviceId) are mqtt.connect options for the device
 * account, whose client id must equal the device id (see the broker ACL).
 */

var fs = require('fs');
var config = require('config');

function readFile(file) {
    return fs.readFileSync(file, 'utf8').trim();
}

function brokerUrl() {
    return 'mqtt://' + config.get('mqtt.host') + ':' + (parseInt(config.get('mqtt.port'), 10) || 1883);
}

function platformPassword() {
    return readFile(config.get('mqtt.passwordFile'));
}

function devicePasswordFile() {
    return process.env.MQTT_DEVICE_PASSWORD_FILE || '/secrets/mqtt_device_password';
}

function platformConfig() {
    return {
        host: config.get('mqtt.host'),
        port: config.get('mqtt.port'),
        username: config.get('mqtt.username'),
        password: platformPassword()
    };
}

function platformOptions(clientId) {
    return {
        clientId: clientId,
        username: config.get('mqtt.username'),
        password: platformPassword(),
        reconnectPeriod: 0
    };
}

function deviceOptions(deviceId) {
    return {
        clientId: deviceId,
        username: 'device',
        password: readFile(devicePasswordFile()),
        reconnectPeriod: 0
    };
}

module.exports = {
    brokerUrl: brokerUrl,
    platformConfig: platformConfig,
    platformOptions: platformOptions,
    deviceOptions: deviceOptions,
    devicePasswordFile: devicePasswordFile
};
