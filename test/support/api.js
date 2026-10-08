'use strict';

/**
 * supertest wrapper for the operator API. api(target) returns an object
 * with get/post/put/delete that send the test operator key as a Bearer
 * token; target is an Express app or a base URL.
 */

var request = require('supertest');

var TEST_API_KEY = 'test-operator-key-0123456789abcdef';

function api(target, key) {
    var agent = request(target);
    var header = 'Bearer ' + (key || TEST_API_KEY);
    var out = {};
    ['get', 'post', 'put', 'delete'].forEach(function(method) {
        out[method] = function(url) {
            return agent[method](url).set('Authorization', header);
        };
    });
    return out;
}

module.exports = {
    TEST_API_KEY: TEST_API_KEY,
    api: api
};
