'use strict';

/**
 * Simulated device.
 *
 * A SimDevice stands in for a physical device. It speaks the platform's
 * MQTT topic scheme:
 *   - start() connects, subscribes to devices/<id>/provisioned and
 *     devices/<id>/commands, publishes a registration with the shared
 *     provisioning key and waits for its token. It then publishes an
 *     online status and random-walk telemetry every intervalMs.
 *   - A firmware_update command makes it download the URL over HTTP,
 *     compare the MD5 and report downloading -> installing -> success,
 *     or failed. A successful install changes its firmware version.
 *   - A reboot command makes it republish its status.
 *
 * Options: {id, type, name, firmware, mqttUrl, username, password,
 * provisioningKey, intervalMs, random, mqtt, registerRetryMs,
 * provisionTimeoutMs, maxDownloadBytes, downloadTimeoutMs}.
 * `random` (default Math.random) drives the random walk; `mqtt` is the
 * MQTT module, injectable for tests. The device connects with its id as
 * MQTT client id, which the broker ACL uses to limit it to its own topics.
 * A firmware download is abandoned once it exceeds maxDownloadBytes
 * (default 10 MB, the registry limit) or downloadTimeoutMs in total.
 *
 * Events: 'command' (command body), 'download' ({url, statusCode, bytes,
 * md5}), 'firmware' ({updateId, state, error?}).
 */

var crypto = require('crypto');
var http = require('http');
var url = require('url');
var util = require('util');
var EventEmitter = require('events').EventEmitter;

var BOUNDS = {
    temperature: {min: -10, max: 45, start: 21, step: 0.5},
    humidity: {min: 10, max: 90, start: 45, step: 1},
    pressure: {min: 950, max: 1050, start: 1013, step: 0.8},
    battery: {min: 0, max: 100, start: 100, step: 0.2}
};
var METRICS = Object.keys(BOUNDS);
var DOWNLOAD_TIMEOUT_MS = 15000;
var MAX_DOWNLOAD_BYTES = 10 * 1024 * 1024;

function noop() {}

function round(value, places) {
    var factor = Math.pow(10, places);
    return Math.round(value * factor) / factor;
}

function clamp(value, b) {
    return Math.min(b.max, Math.max(b.min, value));
}

function SimDevice(options) {
    EventEmitter.call(this);
    options = options || {};
    if (!options.id) {
        throw new Error('SimDevice needs an id');
    }
    this.id = options.id;
    this.type = options.type || 'sensor';
    this.name = options.name || 'Simulated ' + this.type + ' ' + this.id;
    this.firmware = options.firmware || '1.0.0';
    this.mqttUrl = options.mqttUrl || 'mqtt://localhost:1883';
    this.username = options.username || '';
    this.password = options.password || '';
    this.provisioningKey = options.provisioningKey || '';
    this.intervalMs = options.intervalMs || 2000;
    this.random = options.random || Math.random;
    this.mqtt = options.mqtt || null;
    this.registerRetryMs = options.registerRetryMs || 2000;
    this.provisionTimeoutMs = options.provisionTimeoutMs || 30000;
    this.maxDownloadBytes = options.maxDownloadBytes || MAX_DOWNLOAD_BYTES;
    this.downloadTimeoutMs = options.downloadTimeoutMs || DOWNLOAD_TIMEOUT_MS;

    this.token = null;
    this.client = null;
    this.connected = false;
    this.startedAt = null;
    this._timer = null;
    this._cancelStart = null;
    this._stopped = false;
    this._values = {};
    var self = this;
    METRICS.forEach(function(metric) {
        self._values[metric] = BOUNDS[metric].start;
    });
}
util.inherits(SimDevice, EventEmitter);

SimDevice.BOUNDS = BOUNDS;

SimDevice.prototype.topic = function(suffix) {
    return 'devices/' + this.id + '/' + suffix;
};

// Advances every metric by a random step and returns the new reading.
// Battery only drains; the other metrics move both ways.
SimDevice.prototype.nextReading = function() {
    var self = this;
    var reading = {};
    METRICS.forEach(function(metric) {
        var b = BOUNDS[metric];
        var r = self.random();
        var delta = metric === 'battery' ? -(1 - r) * b.step : (r - 0.5) * 2 * b.step;
        self._values[metric] = clamp(self._values[metric] + delta, b);
        reading[metric] = round(self._values[metric], 2);
    });
    return reading;
};

SimDevice.prototype._mqtt = function() {
    return this.mqtt || require('mqtt');
};

SimDevice.prototype._publish = function(suffix, body, cb) {
    cb = cb || noop;
    if (!this.client || this._stopped) {
        return process.nextTick(function() {
            cb(new Error('SimDevice ' + this.id + ' is not running'));
        }.bind(this));
    }
    this.client.publish(this.topic(suffix), JSON.stringify(body), {qos: 1}, function(err) {
        cb(err);
    });
};

// start(cb): cb(err) once the device is provisioned and publishing, or
// when registration is rejected or times out.
SimDevice.prototype.start = function(callback) {
    var self = this;
    var pending = callback || noop;
    var attempts = 0;
    var lastError = null;
    var retryTimer = null;
    var deadlineTimer = null;

    function finish(err) {
        clearInterval(retryTimer);
        clearTimeout(deadlineTimer);
        if (pending) {
            var cb = pending;
            pending = null;
            cb(err || null);
        }
    }

    function register() {
        attempts += 1;
        self._publish('register', {
            provisioningKey: self.provisioningKey,
            name: self.name,
            type: self.type,
            firmware: self.firmware
        });
    }

    // stop() before provisioning abandons the start without calling back.
    this._cancelStart = function() {
        pending = null;
        finish();
    };

    this._stopped = false;
    var connectOptions = {
        clientId: this.id,
        keepalive: 30,
        reconnectPeriod: 2000
    };
    if (this.username) {
        connectOptions.username = this.username;
        connectOptions.password = this.password;
    }
    this.client = this._mqtt().connect(this.mqttUrl, connectOptions);

    this.client.on('connect', function() {
        self.connected = true;
        // Subscriptions and registration happen once; a reconnect only
        // resumes publishing.
        if (attempts > 0 || self.token) {
            return;
        }
        var topicsToSubscribe = [self.topic('provisioned'), self.topic('commands')];
        var remaining = topicsToSubscribe.length;
        topicsToSubscribe.forEach(function(t) {
            self.client.subscribe(t, {qos: 1}, function(err) {
                if (err) {
                    return finish(err);
                }
                remaining -= 1;
                if (remaining === 0 && pending) {
                    register();
                    retryTimer = setInterval(register, self.registerRetryMs);
                }
            });
        });
    });

    this.client.on('close', function() {
        self.connected = false;
    });

    this.client.on('error', function(err) {
        if (pending) {
            lastError = err;
        }
    });

    this.client.on('message', function(topic, message) {
        var body;
        try {
            body = JSON.parse(message.toString());
        } catch (e) {
            return;
        }
        if (!body || typeof body !== 'object') {
            return;
        }
        if (topic === self.topic('provisioned')) {
            if (self.token || !pending) {
                return;
            }
            if (typeof body.token === 'string' && body.token.length > 0) {
                self.token = body.token;
                self._goOnline();
                return finish();
            }
            lastError = new Error('Registration rejected: ' + (body.error || 'no token'));
            // A token from an earlier attempt may still be on its way, so
            // a rejection of a retry is not final.
            if (attempts <= 1) {
                finish(lastError);
            }
            return;
        }
        if (topic === self.topic('commands') && self.token) {
            self._handleCommand(body);
        }
    });

    deadlineTimer = setTimeout(function() {
        finish(lastError || new Error('No provisioning reply for ' + self.id +
            ' within ' + self.provisionTimeoutMs + ' ms'));
    }, this.provisionTimeoutMs);
};

SimDevice.prototype._goOnline = function() {
    var self = this;
    this.startedAt = Date.now();
    this.publishStatus();
    this.publishTelemetry();
    this._timer = setInterval(function() {
        self.publishTelemetry();
    }, this.intervalMs);
};

SimDevice.prototype.publishStatus = function(cb) {
    this._publish('status', {
        token: this.token,
        status: 'online',
        firmware: this.firmware,
        uptime: this.startedAt ? Math.floor((Date.now() - this.startedAt) / 1000) : 0
    }, cb);
};

SimDevice.prototype.publishTelemetry = function(cb) {
    var reading = this.nextReading();
    reading.token = this.token;
    this._publish('telemetry', reading, cb);
};

SimDevice.prototype._handleCommand = function(body) {
    this.emit('command', body);
    var payload = body.payload || {};
    if (body.command === 'reboot') {
        this.publishStatus();
    } else if (body.command === 'firmware_update') {
        this._updateFirmware(payload);
    }
};

SimDevice.prototype._report = function(updateId, state, error, cb) {
    var body = {token: this.token, updateId: updateId, state: state};
    if (error) {
        body.error = error;
    }
    this.emit('firmware', {updateId: updateId, state: state, error: error});
    this._publish('firmware', body, cb);
};

// Download, verify and "install" an image, reporting each step. Reports
// are published one after another so they reach the broker in order.
SimDevice.prototype._updateFirmware = function(payload) {
    var self = this;
    var updateId = payload.updateId;

    function fail(message) {
        self._report(updateId, 'failed', message);
    }

    this._report(updateId, 'downloading', null, function() {
        self._download(payload.url, function(err, data) {
            if (err) {
                return fail(err.message);
            }
            var md5 = crypto.createHash('md5').update(data).digest('hex');
            if (md5 !== payload.md5) {
                return fail('MD5 mismatch: expected ' + payload.md5 + ', got ' + md5);
            }
            self._report(updateId, 'installing', null, function() {
                self.firmware = payload.version;
                self._report(updateId, 'success', null, function() {
                    self.publishStatus();
                });
            });
        });
    });
};

// cb(err, buffer)
SimDevice.prototype._download = function(fileUrl, cb) {
    var self = this;
    var done = false;
    var timer = null;
    var req = null;
    function finish(err, data) {
        if (!done) {
            done = true;
            clearTimeout(timer);
            cb(err, data);
        }
    }
    function abort(err) {
        finish(err);
        if (req) {
            req.abort();
        }
    }

    var parsed = typeof fileUrl === 'string' ? url.parse(fileUrl) : {};
    if (parsed.protocol !== 'http:') {
        return process.nextTick(function() {
            finish(new Error('Unsupported firmware URL scheme'));
        });
    }

    timer = setTimeout(function() {
        abort(new Error('Download timed out after ' + self.downloadTimeoutMs + ' ms'));
    }, this.downloadTimeoutMs);

    req = http.get(fileUrl, function(res) {
        var chunks = [];
        var received = 0;
        res.on('data', function(chunk) {
            received += chunk.length;
            if (received > self.maxDownloadBytes) {
                return abort(new Error('Download larger than ' + self.maxDownloadBytes + ' bytes'));
            }
            chunks.push(chunk);
        });
        res.on('end', function() {
            if (done) {
                return;
            }
            var data = Buffer.concat(chunks);
            self.emit('download', {
                url: fileUrl,
                statusCode: res.statusCode,
                bytes: data.length,
                md5: crypto.createHash('md5').update(data).digest('hex')
            });
            if (res.statusCode !== 200) {
                return finish(new Error('Download failed with HTTP ' + res.statusCode));
            }
            finish(null, data);
        });
        res.on('error', finish);
    });
    req.on('error', function(err) {
        finish(new Error('Download failed: ' + err.message));
    });
};

// stop(cb): stops publishing and disconnects.
SimDevice.prototype.stop = function(callback) {
    callback = callback || noop;
    clearInterval(this._timer);
    this._timer = null;
    if (this._cancelStart) {
        this._cancelStart();
        this._cancelStart = null;
    }
    var client = this.client;
    var force = !this.connected;
    this._stopped = true;
    this.client = null;
    this.connected = false;
    if (!client) {
        return process.nextTick(callback);
    }
    // A forced end never calls back once the stream is already closed
    // (see MQTTHandler.close), so it is not waited for.
    if (force) {
        client.end(true);
        return process.nextTick(callback);
    }
    client.end(false, function() {
        callback();
    });
};

module.exports = SimDevice;
