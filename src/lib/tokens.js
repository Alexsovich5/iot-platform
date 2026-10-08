'use strict';

var crypto = require('crypto');

// Device credentials. A token is shown to the operator once; only its
// SHA-256 digest is stored on the Device document.

function generate() {
    return crypto.randomBytes(16).toString('hex');
}

function hash(token) {
    return crypto.createHash('sha256').update(String(token)).digest('hex');
}

// Compares two strings without returning early on the first differing
// character, so the time taken does not reveal how much of the value matched.
// crypto.timingSafeEqual is not available in this Node version.
function constantTimeEqual(a, b) {
    if (a.length !== b.length) {
        return false;
    }
    var diff = 0;
    for (var i = 0; i < a.length; i++) {
        diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return diff === 0;
}

function verify(token, tokenHash) {
    if (typeof token !== 'string' || token.length === 0) {
        return false;
    }
    if (typeof tokenHash !== 'string' || tokenHash.length === 0) {
        return false;
    }
    return constantTimeEqual(hash(token), tokenHash);
}

exports.generate = generate;
exports.hash = hash;
exports.verify = verify;
