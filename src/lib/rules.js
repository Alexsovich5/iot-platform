/**
 * Threshold rule evaluation. Pure functions, no I/O.
 */

'use strict';

var SYMBOLS = { gt: '>', gte: '>=', lt: '<', lte: '<=' };

function matchesScope(rule, device) {
    if (rule.deviceId) {
        return rule.deviceId === device.deviceId;
    }
    if (rule.deviceType) {
        return rule.deviceType === device.type;
    }
    return true;
}

function compare(op, value, threshold) {
    if (typeof value !== 'number' || isNaN(value)) {
        return false;
    }
    switch (op) {
        case 'gt': return value > threshold;
        case 'gte': return value >= threshold;
        case 'lt': return value < threshold;
        case 'lte': return value <= threshold;
        default: return false;
    }
}

function cooldownKey(rule, device) {
    return String(rule._id) + ':' + device.deviceId;
}

/**
 * Returns [{rule, value}] for every rule the reading triggers.
 * lastFiredMap (key "<ruleId>:<deviceId>" -> ms timestamp) is read to
 * apply each rule's cooldown and updated for every rule that fires.
 */
function evaluate(rules, device, reading, lastFiredMap, now) {
    var fired = [];
    (rules || []).forEach(function(rule) {
        if (rule.enabled === false || !matchesScope(rule, device)) {
            return;
        }
        if (!reading || reading[rule.metric] === undefined || reading[rule.metric] === null) {
            return;
        }
        var value = reading[rule.metric];
        if (!compare(rule.operator, value, rule.threshold)) {
            return;
        }
        var key = cooldownKey(rule, device);
        var last = lastFiredMap[key];
        var cooldownMs = (rule.cooldownSec || 0) * 1000;
        if (last !== undefined && now - last < cooldownMs) {
            return;
        }
        lastFiredMap[key] = now;
        fired.push({ rule: rule, value: value });
    });
    return fired;
}

function formatMessage(rule, device, value) {
    return rule.name + ': ' + device.deviceId + ' ' + rule.metric + ' ' + value +
        ' ' + (SYMBOLS[rule.operator] || rule.operator) + ' ' + rule.threshold;
}

module.exports = {
    matchesScope: matchesScope,
    compare: compare,
    evaluate: evaluate,
    formatMessage: formatMessage
};
