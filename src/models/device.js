/**
 * Device Model
 * IT Operations Specialist - ACORIA (2015-2016)
 */

'use strict';

var mongoose = require('mongoose');

var telemetrySchema = new mongoose.Schema({
    timestamp: { type: Date, default: Date.now },
    temperature: Number,
    humidity: Number,
    pressure: Number,
    battery: Number
}, { _id: false });

var deviceSchema = new mongoose.Schema({
    deviceId: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
    type: { type: String, enum: ['sensor', 'actuator', 'gateway', 'controller'], default: 'sensor' },
    status: { type: String, enum: ['registered', 'online', 'offline', 'maintenance', 'decommissioned'], default: 'registered' },
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
    metadata: mongoose.Schema.Types.Mixed
}, {
    timestamps: true
});

deviceSchema.index({ status: 1 });
deviceSchema.index({ lastSeen: -1 });

module.exports = mongoose.model('Device', deviceSchema);
