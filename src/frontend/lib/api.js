'use strict';

/**
 * Operator key handling for the dashboard.
 *
 * The key is kept in sessionStorage only, so it is gone when the tab is
 * closed; it is sent as a Bearer token on every /api request and as the
 * apiKey query parameter of the Socket.IO handshake. apiFetch rejects
 * with err.unauthorized set when the platform answers 401.
 */

var STORAGE_KEY = 'iot-platform.apiKey';

function defaultStorage(win) {
    try {
        return win && win.sessionStorage ? win.sessionStorage : null;
    } catch (e) {
        return null;
    }
}

function keyStore(storage) {
    return {
        get: function() {
            try {
                return (storage && storage.getItem(STORAGE_KEY)) || null;
            } catch (e) {
                return null;
            }
        },
        set: function(key) {
            try {
                if (storage) {
                    storage.setItem(STORAGE_KEY, key);
                }
            } catch (e) {
                // Storage can be disabled; the key then lasts for this page only.
            }
        },
        clear: function() {
            try {
                if (storage) {
                    storage.removeItem(STORAGE_KEY);
                }
            } catch (e) {
                // Nothing stored that could be cleared.
            }
        }
    };
}

function authHeaders(key, extra) {
    var headers = {};
    Object.keys(extra || {}).forEach(function(name) {
        headers[name] = extra[name];
    });
    headers.Authorization = 'Bearer ' + key;
    return headers;
}

function apiFetch(key, url, opts, fetchImpl) {
    opts = opts || {};
    var request = {};
    Object.keys(opts).forEach(function(name) {
        request[name] = opts[name];
    });
    request.headers = authHeaders(key, opts.headers);
    return fetchImpl(url, request).then(function(res) {
        if (res.status === 401) {
            var err = new Error('The API key was rejected');
            err.unauthorized = true;
            throw err;
        }
        return res;
    });
}

function socketQuery(key) {
    return 'apiKey=' + encodeURIComponent(key);
}

module.exports = {
    STORAGE_KEY: STORAGE_KEY,
    defaultStorage: defaultStorage,
    keyStore: keyStore,
    authHeaders: authHeaders,
    apiFetch: apiFetch,
    socketQuery: socketQuery
};
