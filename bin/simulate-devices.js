#!/usr/bin/env node
'use strict';

/**
 * Starts a fleet of simulated devices against an MQTT broker.
 *
 *   node bin/simulate-devices.js --count 5 --prefix sim --interval 2000 \
 *        --mqtt mqtt://mosquitto:1883 --key $PROVISIONING_KEY \
 *        [--duration 30] [--type sensor]
 *
 * Devices are named <prefix>-1 .. <prefix>-<count>. --duration 0 (the
 * default) runs until SIGINT or SIGTERM; either signal stops every device
 * and exits.
 */

var SimDevice = require('../src/sim/device');
var DEVICE_ID_RE = require('../src/lib/ids').DEVICE_ID_RE;

var DEVICE_TYPES = ['sensor', 'actuator', 'gateway', 'controller'];
var FLAGS = ['count', 'prefix', 'interval', 'mqtt', 'key', 'duration', 'type'];

function integer(name, raw, min) {
    var value = Number(raw);
    if (!/^-?\d+$/.test(String(raw)) || value < min) {
        throw new Error('--' + name + ' must be an integer >= ' + min);
    }
    return value;
}

// parseArgs(argv, env) -> {count, prefix, interval, mqtt, key, duration, type}
function parseArgs(argv, env) {
    env = env || {};
    var raw = {};
    for (var i = 0; i < argv.length; i++) {
        var arg = argv[i];
        var match = /^--([a-z]+)(?:=(.*))?$/.exec(arg);
        if (!match || FLAGS.indexOf(match[1]) === -1) {
            throw new Error('Unknown option: ' + arg);
        }
        var value = match[2];
        if (value === undefined) {
            if (i + 1 >= argv.length) {
                throw new Error('--' + match[1] + ' needs a value');
            }
            value = argv[++i];
        }
        raw[match[1]] = value;
    }

    var opts = {
        count: raw.count !== undefined ? integer('count', raw.count, 1) : 5,
        prefix: raw.prefix !== undefined ? raw.prefix : 'sim',
        interval: raw.interval !== undefined ? integer('interval', raw.interval, 100) : 2000,
        mqtt: raw.mqtt !== undefined ? raw.mqtt : 'mqtt://localhost:1883',
        key: raw.key !== undefined ? raw.key : (env.PROVISIONING_KEY || ''),
        duration: raw.duration !== undefined ? integer('duration', raw.duration, 0) : 0,
        type: raw.type !== undefined ? raw.type : 'sensor'
    };
    if (DEVICE_TYPES.indexOf(opts.type) === -1) {
        throw new Error('--type must be one of ' + DEVICE_TYPES.join(', '));
    }
    if (!DEVICE_ID_RE.test(opts.prefix + '-' + opts.count)) {
        throw new Error('--prefix must be letters, digits, "_" or "-"');
    }
    return opts;
}

function deviceIds(prefix, count) {
    var ids = [];
    for (var i = 1; i <= count; i++) {
        ids.push(prefix + '-' + i);
    }
    return ids;
}

function run(opts) {
    var devices = deviceIds(opts.prefix, opts.count).map(function(id) {
        return new SimDevice({
            id: id,
            type: opts.type,
            mqttUrl: opts.mqtt,
            provisioningKey: opts.key,
            intervalMs: opts.interval
        });
    });
    var stopping = false;

    function stopAll(code) {
        if (stopping) {
            return;
        }
        stopping = true;
        var remaining = devices.length;
        devices.forEach(function(device) {
            device.stop(function() {
                remaining -= 1;
                if (remaining === 0) {
                    console.log('Simulator stopped');
                    process.exit(code);
                }
            });
        });
    }

    process.on('SIGINT', function() {
        stopAll(0);
    });
    process.on('SIGTERM', function() {
        stopAll(0);
    });

    var started = 0;
    var failed = 0;
    devices.forEach(function(device) {
        device.on('firmware', function(report) {
            console.log(device.id + ': firmware update ' + report.updateId + ' ' + report.state +
                (report.error ? ' (' + report.error + ')' : ''));
        });
        device.start(function(err) {
            if (err) {
                failed += 1;
                console.error(device.id + ': ' + err.message);
            } else {
                started += 1;
                console.log(device.id + ': provisioned and online');
            }
            if (started + failed === devices.length) {
                console.log(started + ' of ' + devices.length + ' simulated devices running');
                if (started === 0) {
                    stopAll(1);
                }
            }
        });
    });

    if (opts.duration > 0) {
        setTimeout(function() {
            stopAll(0);
        }, opts.duration * 1000);
    }
}

module.exports = {
    parseArgs: parseArgs,
    deviceIds: deviceIds,
    run: run
};

if (require.main === module) {
    var options;
    try {
        options = parseArgs(process.argv.slice(2), process.env);
    } catch (e) {
        console.error(e.message);
        process.exit(2);
    }
    run(options);
}
