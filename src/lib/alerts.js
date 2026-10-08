/**
 * Alert service: evaluates telemetry against the enabled rules, stores
 * rule and device alerts, pushes each new alert to every dashboard as a
 * Socket.IO 'alert' event and hands it to the optional notifier.
 *
 * Dependencies: {Alert, Rule, io, notifier?, now?}. `now` returns the
 * current time in ms and exists so tests can control the clock.
 */

'use strict';

var rules = require('./rules');

var RULE_CACHE_MS = 10000;
var SEVERITIES = ['info', 'warning', 'critical'];

function AlertService(deps) {
    deps = deps || {};
    this.Alert = deps.Alert;
    this.Rule = deps.Rule;
    this.io = deps.io;
    this.notifier = deps.notifier || null;
    this.now = deps.now || Date.now;

    this.lastFired = {};
    this._rules = null;
    this._rulesLoadedAt = 0;
}

// Drops the cached rule set so the next telemetry message reloads it.
AlertService.prototype.invalidateRules = function() {
    this._rules = null;
    this._rulesLoadedAt = 0;
};

AlertService.prototype._loadRules = function(cb) {
    var self = this;
    var now = this.now();
    if (this._rules && now - this._rulesLoadedAt < RULE_CACHE_MS) {
        var cached = this._rules;
        return process.nextTick(function() {
            cb(null, cached);
        });
    }
    this.Rule.find({enabled: true}, function(err, found) {
        if (err) {
            return cb(err);
        }
        self._rules = found || [];
        self._rulesLoadedAt = now;
        cb(null, self._rules);
    });
};

// Saves one alert document, then emits and notifies.
AlertService.prototype._save = function(doc, cb) {
    var self = this;
    this.Alert.create(doc, function(err, alert) {
        if (err) {
            return cb(err);
        }
        self.io.emit('alert', {alert: alert});
        if (self.notifier) {
            self.notifier.notify(alert);
        }
        cb(null, alert);
    });
};

// cb(err, alerts) with the alerts created for this reading.
AlertService.prototype.onTelemetry = function(device, reading, cb) {
    var self = this;
    cb = cb || function() {};
    this._loadRules(function(err, enabledRules) {
        if (err) {
            return cb(err);
        }
        var matches = rules.evaluate(enabledRules, device, reading, self.lastFired, self.now());
        var created = [];

        (function next(i) {
            if (i >= matches.length) {
                return cb(null, created);
            }
            var rule = matches[i].rule;
            var value = matches[i].value;
            self._save({
                deviceId: device.deviceId,
                ruleId: rule._id,
                source: 'rule',
                severity: rule.severity || 'warning',
                message: rules.formatMessage(rule, device, value),
                metric: rule.metric,
                value: value,
                threshold: rule.threshold
            }, function(saveErr, alert) {
                if (saveErr) {
                    return cb(saveErr, created);
                }
                created.push(alert);
                next(i + 1);
            });
        })(0);
    });
};

// Stores an alert sent by the device itself. An unknown severity becomes
// 'warning'.
AlertService.prototype.fromDevice = function(deviceId, payload, cb) {
    cb = cb || function() {};
    payload = payload || {};
    this._save({
        deviceId: deviceId,
        ruleId: null,
        source: 'device',
        severity: SEVERITIES.indexOf(payload.severity) !== -1 ? payload.severity : 'warning',
        message: payload.message
    }, cb);
};

module.exports = AlertService;
