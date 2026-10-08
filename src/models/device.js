/**
 * Device Model
 */

'use strict';

var mongoose = require('mongoose');
var DEVICE_ID_RE = require('../lib/ids').DEVICE_ID_RE;
var STATUSES = require('../lib/lifecycle').STATUSES;

var telemetrySchema = new mongoose.Schema({
    timestamp: { type: Date, default: Date.now },
    temperature: Number,
    humidity: Number,
    pressure: Number,
    battery: Number
}, { _id: false });

var deviceSchema = new mongoose.Schema({
    deviceId: { type: String, required: true, unique: true, index: true, match: DEVICE_ID_RE },
    name: { type: String, required: true },
    type: { type: String, enum: ['sensor', 'actuator', 'gateway', 'controller'], default: 'sensor' },
    status: { type: String, enum: STATUSES, default: 'registered' },
    firmware: String,
    location: {
        building: String,
        floor: String,
        zone: String
    },
    uptime: Number,
    telemetry: [telemetrySchema],
    tags: [String],
    registeredAt: { type: Date, default: Date.now },
    lastSeen: Date,
    metadata: mongoose.Schema.Types.Mixed,
    tokenHash: { type: String, select: false },
    provisionedBy: { type: String, enum: ['api', 'mqtt'] }
}, {
    timestamps: true,
    toJSON: {
        transform: function(doc, ret) {
            delete ret.tokenHash;
            delete ret.__v;
            return ret;
        }
    }
});

deviceSchema.index({ status: 1 });
deviceSchema.index({ lastSeen: -1 });

module.exports = mongoose.model('Device', deviceSchema);
