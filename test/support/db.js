'use strict';

/**
 * Test database helper for integration suites.
 *
 * connect() opens the shared mongoose connection to the test URI unless it
 * is already open or opening. reset() drops the test database and then
 * rebuilds the indexes of every registered model, because Mongoose builds
 * indexes only once when a model is first compiled and a dropped database
 * would otherwise lose its unique indexes.
 */

var mongoose = require('mongoose');
var config = require('config');

function connect(cb) {
    var conn = mongoose.connection;
    if (conn.readyState === 1) {
        return cb();
    }
    if (conn.readyState === 0) {
        mongoose.connect(config.get('mongodb.uri'));
    }
    var finished = false;
    function finish(err) {
        if (finished) {
            return;
        }
        finished = true;
        conn.removeListener('open', onOpen);
        conn.removeListener('error', finish);
        cb(err);
    }
    function onOpen() {
        finish();
    }
    conn.once('open', onOpen);
    conn.once('error', finish);
}

function ensureAllIndexes(names, cb) {
    if (names.length === 0) {
        return cb();
    }
    mongoose.model(names[0]).ensureIndexes(function(err) {
        if (err) {
            return cb(err);
        }
        ensureAllIndexes(names.slice(1), cb);
    });
}

function reset(cb) {
    connect(function(err) {
        if (err) {
            return cb(err);
        }
        mongoose.connection.db.dropDatabase(function(dropErr) {
            if (dropErr) {
                return cb(dropErr);
            }
            ensureAllIndexes(mongoose.modelNames(), cb);
        });
    });
}

module.exports = {
    connect: connect,
    reset: reset
};
