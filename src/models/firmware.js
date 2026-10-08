/**
 * Firmware model: metadata for one stored binary. The file itself lives
 * under the firmware directory at <deviceType>/<version>.bin.
 */

'use strict';

var mongoose = require('mongoose');

var VERSION_RE = /^\d+\.\d+\.\d+$/;

var firmwareSchema = new mongoose.Schema({
    version: { type: String, required: true, match: VERSION_RE },
    deviceType: { type: String, required: true },
    filename: String,
    size: Number,
    md5: String
}, {
    timestamps: true,
    toJSON: {
        transform: function(doc, ret) {
            delete ret.__v;
            return ret;
        }
    }
});

firmwareSchema.index({ version: 1, deviceType: 1 }, { unique: true });

firmwareSchema.statics.VERSION_RE = VERSION_RE;

module.exports = mongoose.model('Firmware', firmwareSchema);
