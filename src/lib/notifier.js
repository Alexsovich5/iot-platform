/**
 * Webhook notifier: POSTs each new alert as JSON ({alert: ...}) to a
 * configured URL using the http/https core modules.
 *
 * Options: {url, timeoutMs = 5000, log = console.error}. With an empty
 * url, notify() is a no-op. notify() never throws: connection errors,
 * timeouts and non-2xx responses are logged and passed to the optional
 * callback as an Error. timeoutMs bounds the whole exchange, including a
 * response body that keeps trickling in.
 *
 * The URL may carry credentials (userinfo, used as basic auth) or tokens
 * in its path or query, so logs and errors only ever show its redacted
 * form (see lib/redact).
 */

'use strict';

var http = require('http');
var https = require('https');
var urlLib = require('url');
var redactUrl = require('./redact').redactUrl;

var DEFAULT_TIMEOUT_MS = 5000;

function Notifier(opts) {
    opts = opts || {};
    this.url = opts.url || '';
    this.timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS;
    this.log = opts.log || function() {
        console.error.apply(console, arguments);
    };
}

// cb(err, {statusCode}) or cb(null, {skipped: true}) when no url is set.
Notifier.prototype.notify = function(alert, cb) {
    var self = this;
    var finished = false;
    cb = cb || function() {};

    var timer = null;

    function finish(err, result) {
        if (finished) {
            return;
        }
        finished = true;
        clearTimeout(timer);
        if (err) {
            self.log('Alert webhook to ' + redactUrl(self.url) + ' failed:', err.message);
        }
        cb(err || null, result);
    }

    if (!this.url) {
        return process.nextTick(function() {
            finish(null, {skipped: true});
        });
    }

    var body;
    var target;
    try {
        body = JSON.stringify({alert: alert});
        target = urlLib.parse(this.url);
    } catch (e) {
        return process.nextTick(function() {
            finish(new Error('webhook request could not be built'));
        });
    }
    var transport = target.protocol === 'https:' ? https : http;
    if (target.protocol !== 'http:' && target.protocol !== 'https:') {
        return process.nextTick(function() {
            finish(new Error('unsupported webhook URL scheme (http and https only)'));
        });
    }

    var req = transport.request({
        method: 'POST',
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port,
        path: target.path,
        auth: target.auth || undefined,
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body)
        }
    }, function(res) {
        res.resume();
        res.on('end', function() {
            if (res.statusCode < 200 || res.statusCode >= 300) {
                var err = new Error('webhook responded with HTTP ' + res.statusCode);
                err.statusCode = res.statusCode;
                return finish(err);
            }
            finish(null, {statusCode: res.statusCode});
        });
    });

    timer = setTimeout(function() {
        finish(new Error('webhook timed out after ' + self.timeoutMs + ' ms'));
        req.abort();
    }, this.timeoutMs);
    req.on('error', function(err) {
        // Node's connection errors name only the host and port; the
        // message is still rebuilt so no part of the URL can leak.
        finish(new Error('webhook request failed: ' + (err.code || 'error')));
    });
    req.end(body);
};

module.exports = Notifier;
