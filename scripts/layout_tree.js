#!/usr/bin/env node
'use strict';

/**
 * Prints a directory tree for a list of file paths read from stdin, one per
 * line (as produced by `git ls-files`).
 *
 *   git ls-files | node scripts/layout_tree.js
 *   git ls-files | node scripts/layout_tree.js --check README.md
 *
 * With --check it compares the tree with the fenced block under the
 * README's "## Layout" heading and exits 1 when they differ.
 */

var fs = require('fs');

var INDENT = '  ';

function buildNode(paths) {
    var root = {};
    paths.forEach(function(p) {
        p = String(p).trim();
        if (!p) {
            return;
        }
        var parts = p.split('/');
        var node = root;
        parts.forEach(function(part, i) {
            if (i === parts.length - 1) {
                node[part] = node[part] || null;
            } else {
                node[part] = node[part] || {};
                node = node[part];
            }
        });
    });
    return root;
}

function compareNames(a, b) {
    if (a < b) {
        return -1;
    }
    return a > b ? 1 : 0;
}

function renderNode(node, depth, lines) {
    Object.keys(node).sort(compareNames).forEach(function(name) {
        var prefix = new Array(depth + 1).join(INDENT);
        if (node[name] === null) {
            lines.push(prefix + name);
        } else {
            lines.push(prefix + name + '/');
            renderNode(node[name], depth + 1, lines);
        }
    });
    return lines;
}

// renderTree(paths) -> tree text, directories suffixed with '/'
function renderTree(paths) {
    return renderNode(buildNode(paths), 0, []).join('\n');
}

// parseTree(text) -> list of the file paths named by a rendered tree
function parseTree(text) {
    var stack = [];
    var files = [];
    text.split('\n').forEach(function(line) {
        if (!line.trim()) {
            return;
        }
        var depth = 0;
        while (line.indexOf(INDENT, depth * INDENT.length) === depth * INDENT.length) {
            depth += 1;
        }
        var name = line.slice(depth * INDENT.length);
        stack.length = depth;
        if (name.charAt(name.length - 1) === '/') {
            stack.push(name.slice(0, -1));
        } else {
            files.push(stack.concat(name).join('/'));
        }
    });
    return files;
}

// extractLayoutBlock(markdown) -> contents of the first fenced block after
// the "## Layout" heading, or null
function extractLayoutBlock(markdown) {
    var match = /^## Layout[ \t]*\n[\s\S]*?^```[^\n]*\n([\s\S]*?)^```/m.exec(markdown);
    if (!match) {
        return null;
    }
    return match[1].replace(/\s+$/, '');
}

// check(markdown, paths) -> {ok, message}
function check(markdown, paths) {
    var block = extractLayoutBlock(markdown);
    if (block === null) {
        return {ok: false, message: 'README has no fenced block under "## Layout"'};
    }
    var expected = renderTree(paths);
    if (block === expected) {
        return {ok: true, message: 'Layout block matches the file list'};
    }
    var listed = parseTree(block);
    var actual = parseTree(expected);
    var missing = actual.filter(function(p) {
        return listed.indexOf(p) === -1;
    });
    var extra = listed.filter(function(p) {
        return actual.indexOf(p) === -1;
    });
    var lines = ['Layout block differs from the generated tree.'];
    if (missing.length) {
        lines.push('Not in README: ' + missing.join(', '));
    }
    if (extra.length) {
        lines.push('In README but not in the file list: ' + extra.join(', '));
    }
    if (!missing.length && !extra.length) {
        lines.push('Same files, different formatting or order.');
    }
    lines.push('Expected:', expected);
    return {ok: false, message: lines.join('\n')};
}

function main(argv) {
    var input = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', function(chunk) {
        input += chunk;
    });
    process.stdin.on('end', function() {
        var paths = input.split('\n');
        var at = argv.indexOf('--check');
        if (at === -1) {
            process.stdout.write(renderTree(paths) + '\n');
            return;
        }
        var readmePath = argv[at + 1];
        if (!readmePath) {
            process.stderr.write('--check needs a README path\n');
            process.exit(2);
        }
        var result = check(fs.readFileSync(readmePath, 'utf8'), paths);
        (result.ok ? process.stdout : process.stderr).write(result.message + '\n');
        process.exit(result.ok ? 0 : 1);
    });
}

module.exports = {
    renderTree: renderTree,
    parseTree: parseTree,
    extractLayoutBlock: extractLayoutBlock,
    check: check
};

if (require.main === module) {
    main(process.argv.slice(2));
}
