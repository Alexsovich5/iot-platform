/**
 * Alert rule model: compares one telemetry metric against a threshold.
 */

'use strict';

var mongoose = require('mongoose');

var METRICS = ['temperature', 'humidity', 'pressure', 'battery'];
var OPERATORS = ['gt', 'gte', 'lt', 'lte'];
var SEVERITIES = ['info', 'warning', 'critical'];

var ruleSchema = new mongoose.Schema({
    name: { type: String, required: true },
    deviceId: String,
    deviceType: {
        type: String,
        validate: {
            validator: function(v) {
                return !(v && this.deviceId);
            },
            message: 'deviceId and deviceType are mutually exclusive'
        }
    },
    metric: { type: String, enum: METRICS, required: true },
    operator: { type: String, enum: OPERATORS, required: true },
    threshold: { type: Number, required: true },
    severity: { type: String, enum: SEVERITIES, default: 'warning' },
    cooldownSec: { type: Number, default: 300, min: 0 },
    enabled: { type: Boolean, default: true }
}, {
    timestamps: true
});

ruleSchema.statics.METRICS = METRICS;
ruleSchema.statics.OPERATORS = OPERATORS;
ruleSchema.statics.SEVERITIES = SEVERITIES;

module.exports = mongoose.model('Rule', ruleSchema);
