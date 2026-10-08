'use strict';

var assert = require('assert');
var fs = require('fs');
var path = require('path');
var layout = require('../../scripts/layout_tree');

var ROOT = path.join(__dirname, '..', '..');
var README = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');

describe('README.md', function() {
    it('has a Layout block naming files that all exist', function() {
        var block = layout.extractLayoutBlock(README);
        assert(block, 'README has no Layout block');
        var paths = layout.parseTree(block);
        assert(paths.length > 10, 'Layout block lists too few files');
        paths.forEach(function(p) {
            assert(fs.existsSync(path.join(ROOT, p)), 'README names a missing file: ' + p);
        });
    });

    [
        /ACORIA/,
        /Status-Complete/,
        /\d+(\.\d+)?%\s*uptime/i,
        /\*\*Role\*\*/,
        /Organization/,
        /Developed during/
    ].forEach(function(pattern) {
        it('does not match ' + pattern, function() {
            assert(!pattern.test(README), 'README matches ' + pattern);
        });
    });

    it('has Implemented and Not implemented headings', function() {
        assert(/^\*\*Implemented\*\*$/m.test(README), 'missing Implemented heading');
        assert(/^\*\*Not implemented[^*]*\*\*$/m.test(README), 'missing Not implemented heading');
    });

    it('says that devices are simulated', function() {
        assert(/simulat/i.test(README));
    });

    it('no longer carries the template rules comment', function() {
        assert(!/Rules for this README/.test(README));
        assert(!/\{\{/.test(README));
    });
});
