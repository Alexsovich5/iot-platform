'use strict';

/**
 * Secret values read from files.
 *
 * readSecret(value, file) returns `value` when it is a non-empty string,
 * otherwise the trimmed contents of `file`, otherwise ''. A configured
 * file that is missing or empty is an error, so a broken deployment fails
 * at start instead of running without the secret.
 *
 * loadOrCreateKey(file) returns {key, created}: the key stored in `file`,
 * or a new random key written there (mode 0600, parent directories
 * created) when the file does not exist yet.
 *
 * Error messages name the file, never its contents.
 */

var crypto = require('crypto');
var fs = require('fs');
var path = require('path');

var MIN_KEY_LENGTH = 24;

function readFileSecret(file) {
    var value;
    try {
        value = fs.readFileSync(file, 'utf8').trim();
    } catch (e) {
        throw new Error('Cannot read secret file ' + file + ' (' + (e.code || 'error') + ')');
    }
    if (!value) {
        throw new Error('Secret file ' + file + ' is empty');
    }
    return value;
}

function readSecret(value, file) {
    if (typeof value === 'string' && value.length > 0) {
        return value;
    }
    if (typeof file === 'string' && file.length > 0) {
        return readFileSecret(file);
    }
    return '';
}

function mkdirp(dir) {
    try {
        fs.mkdirSync(dir, parseInt('700', 8));
    } catch (e) {
        if (e.code === 'ENOENT') {
            mkdirp(path.dirname(dir));
            return mkdirp(dir);
        }
        if (e.code !== 'EEXIST') {
            throw e;
        }
    }
}

function loadOrCreateKey(file) {
    if (typeof file !== 'string' || file.length === 0) {
        throw new Error('No API key file configured (api.keyFile)');
    }
    var existing = null;
    try {
        existing = fs.readFileSync(file, 'utf8').trim();
    } catch (e) {
        if (e.code !== 'ENOENT') {
            throw new Error('Cannot read API key file ' + file + ' (' + (e.code || 'error') + ')');
        }
    }
    if (existing !== null) {
        if (existing.length < MIN_KEY_LENGTH) {
            throw new Error('API key in ' + file + ' is too short (at least ' + MIN_KEY_LENGTH +
                ' characters required)');
        }
        return {key: existing, created: false};
    }

    var key = crypto.randomBytes(32).toString('hex');
    mkdirp(path.dirname(file));
    // 'wx' fails if another process created the file in the meantime;
    // that key is then used instead.
    try {
        fs.writeFileSync(file, key + '\n', {mode: parseInt('600', 8), flag: 'wx'});
    } catch (e) {
        if (e.code === 'EEXIST') {
            return loadOrCreateKey(file);
        }
        throw new Error('Cannot write API key file ' + file + ' (' + (e.code || 'error') + ')');
    }
    return {key: key, created: true};
}

module.exports = {
    readSecret: readSecret,
    loadOrCreateKey: loadOrCreateKey
};
