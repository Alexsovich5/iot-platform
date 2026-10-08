/**
 * FirmwareUpdate model: one firmware update sent to one device, with the
 * state the device last reported and every state it has passed through.
 */

'use strict';

var mongoose = require('mongoose');

var STATES = require('../lib/firmware').STATES;

var historySchema = new mongoose.Schema({
    state: { type: String, enum: STATES, required: true },
    at: { type: Date, default: Date.now }
}, { _id: false });

var firmwareUpdateSchema = new mongoose.Schema({
    deviceId: { type: String, required: true },
    version: { type: String, required: true },
    state: { type: String, enum: STATES, default: 'pending' },
    error: String,
    history: [historySchema]
}, {
    timestamps: true,
    toJSON: {
        transform: function(doc, ret) {
            delete ret.__v;
            return ret;
        }
    }
});

firmwareUpdateSchema.index({ deviceId: 1, createdAt: -1 });
firmwareUpdateSchema.index({ state: 1 });

firmwareUpdateSchema.statics.STATES = STATES;

module.exports = mongoose.model('FirmwareUpdate', firmwareUpdateSchema);
