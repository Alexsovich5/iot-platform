'use strict';

/**
 * redactUrl(url) returns a form of `url` that is safe to log:
 * scheme://host[:port], with '<redacted>@' in place of any userinfo and
 * '/<redacted>' in place of any path or query, which may carry tokens.
 */

var urlLib = require('url');

function redactUrl(raw) {
    if (typeof raw !== 'string' || raw.length === 0) {
        return '<redacted url>';
    }
    var parsed;
    try {
        parsed = urlLib.parse(raw);
    } catch (e) {
        return '<redacted url>';
    }
    if (!parsed.protocol || !parsed.host) {
        return '<redacted url>';
    }
    var out = parsed.protocol + '//' + (parsed.auth ? '<redacted>@' : '') + parsed.host;
    var rest = (parsed.path || '') + (parsed.hash || '');
    if (rest && rest !== '/') {
        out += '/<redacted>';
    }
    return out;
}

module.exports = {
    redactUrl: redactUrl
};
