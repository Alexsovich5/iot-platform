'use strict';

var net = require('net');

// Try a TCP connection to host:port every `interval` ms until it succeeds
// or `timeout` ms have passed.
function waitForPort(host, port, timeout, callback, interval) {
    interval = interval || 250;
    var deadline = Date.now() + timeout;

    function attempt() {
        var socket = net.connect({host: host, port: port});
        var finished = false;

        function finish(err) {
            if (finished) {
                return;
            }
            finished = true;
            socket.destroy();
            if (!err) {
                return callback();
            }
            if (Date.now() >= deadline) {
                return callback(new Error('Timed out waiting for ' + host + ':' + port + ' (' + err.message + ')'));
            }
            setTimeout(attempt, interval);
        }

        socket.setTimeout(1000, function() {
            finish(new Error('connect timeout'));
        });
        socket.once('connect', function() {
            finish();
        });
        socket.once('error', finish);
    }

    attempt();
}

module.exports = {
    waitForPort: waitForPort
};
