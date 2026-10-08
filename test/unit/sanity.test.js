'use strict';

var assert = require('assert');
var path = require('path');
var pkg = require('../../package.json');

describe('runtime sanity', function() {
    it('runs on Node 4.3.1', function() {
        assert.strictEqual(process.version, 'v4.3.1');
    });

    describe('pinned dependencies', function() {
        var all = {};
        Object.keys(pkg.dependencies || {}).forEach(function(name) {
            all[name] = pkg.dependencies[name];
        });
        Object.keys(pkg.devDependencies || {}).forEach(function(name) {
            all[name] = pkg.devDependencies[name];
        });

        Object.keys(all).forEach(function(name) {
            it(name + ' is pinned exactly and resolves at that version', function() {
                assert(/^\d+\.\d+\.\d+$/.test(all[name]), name + ' is not an exact pin: ' + all[name]);
                var resolved = require.resolve(name);
                assert(resolved.indexOf(path.join('node_modules', name)) !== -1, name + ' resolved to ' + resolved);
                var installed = require(name + '/package.json').version;
                assert.strictEqual(installed, all[name]);
            });
        });
    });
});
