'use strict';

/**
 * Operator API key check.
 *
 * Every /api request must carry `Authorization: Bearer <key>`. The key is
 * compared through its SHA-256 hash in constant time (tokens.verify), so
 * neither its length nor a matching prefix shows in the response time.
 * Rejections get 401 with a fixed message; the presented value is never
 * echoed or logged.
 */

var tokens = require('./tokens');

function bearerToken(header) {
    if (typeof header !== 'string') {
        return null;
    }
    var match = /^Bearer\s+(\S+)\s*$/i.exec(header);
    return match ? match[1] : null;
}

function keyMatches(candidate, key) {
    if (typeof key !== 'string' || key.length === 0) {
        return false;
    }
    return tokens.verify(candidate, tokens.hash(key));
}

// Express middleware that answers 401 unless the request carries `key`.
function requireApiKey(key) {
    if (typeof key !== 'string' || key.length === 0) {
        throw new Error('requireApiKey needs a non-empty key');
    }
    return function(req, res, next) {
        if (keyMatches(bearerToken(req.headers.authorization), key)) {
            return next();
        }
        res.set('WWW-Authenticate', 'Bearer realm="iot-platform"');
        res.status(401).json({error: 'Missing or invalid API key'});
    };
}

module.exports = {
    bearerToken: bearerToken,
    keyMatches: keyMatches,
    requireApiKey: requireApiKey
};
