'use strict';

/**
 * Local HTTP server standing in for a webhook receiver. Every request is
 * recorded as {method, url, headers, body}. `mode` controls the reply:
 * 'ok' answers 200, 'error' answers 500, 'hang' never answers and
 * 'trickle' sends the headers and then one byte every 50 ms without end.
 *
 *   var stub = new WebhookStub();
 *   stub.start(function() { ... stub.url ... });
 *   stub.close(done);
 */

var http = require('http');

function WebhookStub() {
    var self = this;
    this.requests = [];
    this.mode = 'ok';
    this.url = null;
    this._sockets = [];
    this._waiters = [];

    this.server = http.createServer(function(req, res) {
        var chunks = [];
        req.on('data', function(chunk) {
            chunks.push(chunk);
        });
        req.on('end', function() {
            self.requests.push({
                method: req.method,
                url: req.url,
                headers: req.headers,
                body: Buffer.concat(chunks).toString('utf8')
            });
            self._notifyWaiters();
            if (self.mode === 'hang') {
                return;
            }
            if (self.mode === 'trickle') {
                res.writeHead(200, {'Content-Type': 'text/plain'});
                var timer = setInterval(function() {
                    res.write('.');
                }, 50);
                res.on('close', function() {
                    clearInterval(timer);
                });
                req.socket.on('close', function() {
                    clearInterval(timer);
                });
                return;
            }
            var status = self.mode === 'error' ? 500 : 200;
            res.writeHead(status, {'Content-Type': 'text/plain'});
            res.end(status === 200 ? 'ok' : 'error');
        });
    });
    this.server.on('connection', function(socket) {
        self._sockets.push(socket);
        socket.on('close', function() {
            var i = self._sockets.indexOf(socket);
            if (i !== -1) {
                self._sockets.splice(i, 1);
            }
        });
    });
}

WebhookStub.prototype.start = function(cb) {
    var self = this;
    this.server.listen(0, '127.0.0.1', function() {
        self.url = 'http://127.0.0.1:' + self.server.address().port + '/hook';
        cb();
    });
};

// cb() once at least `count` requests have been recorded.
WebhookStub.prototype.waitForRequests = function(count, cb) {
    this._waiters.push({count: count, cb: cb});
    this._notifyWaiters();
};

WebhookStub.prototype._notifyWaiters = function() {
    var self = this;
    this._waiters = this._waiters.filter(function(w) {
        if (self.requests.length >= w.count) {
            process.nextTick(w.cb);
            return false;
        }
        return true;
    });
};

// Destroys open (possibly hanging) connections, then stops listening.
WebhookStub.prototype.close = function(cb) {
    this._sockets.forEach(function(socket) {
        socket.destroy();
    });
    this.server.close(function() {
        cb();
    });
};

module.exports = WebhookStub;
