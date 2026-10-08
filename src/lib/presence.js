'use strict';

/**
 * Presence sweeper.
 *
 * Every intervalSec, sweep() looks for online devices whose lastSeen is older
 * than offlineAfterSec, sets them offline and emits one Socket.IO 'status'
 * event per device so dashboards update without polling. The IDs are read
 * first so the events name exactly the devices the update targets; the update
 * repeats the online/lastSeen condition so a device that reported in between
 * stays online.
 */

function Presence(opts) {
    opts = opts || {};
    this.Device = opts.Device;
    this.io = opts.io;
    this.offlineAfterSec = opts.offlineAfterSec;
    this.intervalSec = opts.intervalSec;
    this.timer = null;
}

Presence.prototype.start = function() {
    var self = this;
    if (self.timer) {
        return;
    }
    self.timer = setInterval(function() {
        self.sweep(function(err) {
            if (err) {
                console.error('Presence sweep failed:', err.message);
            }
        });
    }, self.intervalSec * 1000);
    if (self.timer.unref) {
        self.timer.unref();
    }
};

Presence.prototype.stop = function() {
    if (this.timer) {
        clearInterval(this.timer);
        this.timer = null;
    }
};

Presence.prototype.isRunning = function() {
    return this.timer !== null;
};

Presence.prototype.sweep = function(cb) {
    var self = this;
    cb = cb || function() {};
    var cutoff = new Date(Date.now() - self.offlineAfterSec * 1000);

    self.Device.find({status: 'online', lastSeen: {$lt: cutoff}}, 'deviceId', function(err, devices) {
        if (err) {
            return cb(err);
        }
        var ids = (devices || []).map(function(d) {
            return d.deviceId;
        });
        if (ids.length === 0) {
            return cb(null, 0);
        }
        self.Device.update(
            {deviceId: {$in: ids}, status: 'online', lastSeen: {$lt: cutoff}},
            {$set: {status: 'offline'}},
            {multi: true},
            function(updateErr, raw) {
                if (updateErr) {
                    return cb(updateErr);
                }
                ids.forEach(function(id) {
                    self.io.emit('status', {deviceId: id, data: {status: 'offline'}});
                });
                var count = raw && typeof raw.n === 'number' ? raw.n : ids.length;
                cb(null, count);
            }
        );
    });
};

module.exports = Presence;
