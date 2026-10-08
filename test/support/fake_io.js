'use strict';

/**
 * In-memory stand-in for a Socket.IO server. Every emit is recorded as
 * {room, event, data}; room is null for a broadcast to all clients.
 */

function FakeIo() {
    this.emitted = [];
}

FakeIo.prototype.to = function(room) {
    var self = this;
    return {
        emit: function(event, data) {
            self.emitted.push({room: room, event: event, data: data});
        }
    };
};

FakeIo.prototype.emit = function(event, data) {
    this.emitted.push({room: null, event: event, data: data});
};

FakeIo.prototype.emittedTo = function(room, event) {
    return this.emitted.filter(function(e) {
        return e.room === room && (event === undefined || e.event === event);
    });
};

module.exports = FakeIo;
