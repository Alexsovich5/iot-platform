'use strict';

var assert = require('assert');
var layout = require('../../scripts/layout_tree');

describe('scripts/layout_tree', function() {
    var files = ['src/models/device.js', 'README.md', 'src/app.js', '.babelrc', 'bin/simulate-devices.js'];

    it('renders directories with a trailing slash and two-space indentation', function() {
        assert.strictEqual(layout.renderTree(files), [
            '.babelrc',
            'README.md',
            'bin/',
            '  simulate-devices.js',
            'src/',
            '  app.js',
            '  models/',
            '    device.js'
        ].join('\n'));
    });

    it('ignores blank lines and duplicate entries', function() {
        var tree = layout.renderTree(['a/b.js', '', 'a/b.js', 'c.js']);
        assert.strictEqual(tree, 'a/\n  b.js\nc.js');
    });

    it('parses a rendered tree back into the original file paths', function() {
        var parsed = layout.parseTree(layout.renderTree(files));
        assert.deepEqual(parsed.slice().sort(), files.slice().sort());
    });

    it('extracts the fenced block under the Layout heading', function() {
        var md = '# T\n\n## Running it\n\n```bash\nmake up\n```\n\n## Layout\n\n```\na/\n  b.js\n```\n';
        assert.strictEqual(layout.extractLayoutBlock(md), 'a/\n  b.js');
    });

    it('returns null when there is no Layout block', function() {
        assert.strictEqual(layout.extractLayoutBlock('# T\n\nno layout\n'), null);
    });

    it('check reports a mismatch between the README block and the file list', function() {
        var md = '## Layout\n\n```\na.js\n```\n';
        assert.strictEqual(layout.check(md, ['a.js']).ok, true);
        var result = layout.check(md, ['a.js', 'b.js']);
        assert.strictEqual(result.ok, false);
        assert(/b\.js/.test(result.message), result.message);
    });
});
