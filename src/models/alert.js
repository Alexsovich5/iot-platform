/**
 * Alert model: raised by a rule match or sent by a device.
 */

'use strict';

var mongoose = require('mongoose');

var alertSchema = new mongoose.Schema({
    deviceId: { type: String, required: true },
    ruleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Rule', default: null },
    source: { type: String, enum: ['rule', 'device'], required: true },
    severity: { type: String, enum: ['info', 'warning', 'critical'], default: 'warning' },
    message: { type: String, required: true },
    metric: String,
    value: Number,
    threshold: Number,
    acknowledged: { type: Boolean, default: false },
    acknowledgedAt: Date,
    createdAt: { type: Date, default: Date.now }
});

alertSchema.index({ createdAt: -1 });
alertSchema.index({ acknowledged: 1 });

module.exports = mongoose.model('Alert', alertSchema);
