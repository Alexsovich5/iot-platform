'use strict';

var fs = require('fs');
var os = require('os');
var path = require('path');
var crypto = require('crypto');
var expect = require('chai').expect;
var sinon = require('sinon');
var secrets = require('../../src/lib/secrets');

function tmpDir() {
    var dir = path.join(os.tmpdir(), 'secrets-test-' + crypto.randomBytes(6).toString('hex'));
    fs.mkdirSync(dir);
    return dir;
}

describe('secrets', function() {
    describe('readSecret', function() {
        var dir;

        beforeEach(function() {
            dir = tmpDir();
        });

        it('prefers a non-empty value over the file', function() {
            var file = path.join(dir, 'pw');
            fs.writeFileSync(file, 'from-file\n');
            expect(secrets.readSecret('inline', file)).to.equal('inline');
        });

        it('reads and trims the file when no value is given', function() {
            var file = path.join(dir, 'pw');
            fs.writeFileSync(file, '  from-file\n');
            expect(secrets.readSecret('', file)).to.equal('from-file');
            expect(secrets.readSecret(undefined, file)).to.equal('from-file');
        });

        it('returns an empty string when neither is set', function() {
            expect(secrets.readSecret('', '')).to.equal('');
        });

        it('throws a message naming the file, not its contents, when the file is missing or empty', function() {
            expect(function() {
                secrets.readSecret('', path.join(dir, 'missing'));
            }).to.throw(/missing/);
            var empty = path.join(dir, 'empty');
            fs.writeFileSync(empty, '\n');
            expect(function() {
                secrets.readSecret('', empty);
            }).to.throw(/empty/);
        });
    });

    describe('loadOrCreateKey', function() {
        var dir;
        var log;

        beforeEach(function() {
            dir = tmpDir();
            log = sinon.stub(console, 'log');
        });

        afterEach(function() {
            log.restore();
        });

        it('creates a random 64-hex key readable only by its owner', function() {
            var file = path.join(dir, 'nested', 'api_key');
            var result = secrets.loadOrCreateKey(file);
            log.restore();
            expect(result.created).to.equal(true);
            expect(result.key).to.match(/^[0-9a-f]{64}$/);
            expect(fs.readFileSync(file, 'utf8').trim()).to.equal(result.key);
            expect(fs.statSync(file).mode & parseInt('077', 8)).to.equal(0);
        });

        it('reuses an existing key file', function() {
            var file = path.join(dir, 'api_key');
            fs.writeFileSync(file, 'existing-key-value-1234567890\n');
            var result = secrets.loadOrCreateKey(file);
            expect(result).to.deep.equal({key: 'existing-key-value-1234567890', created: false});
        });

        it('gives a different key for each new file', function() {
            var a = secrets.loadOrCreateKey(path.join(dir, 'a')).key;
            var b = secrets.loadOrCreateKey(path.join(dir, 'b')).key;
            expect(a).to.not.equal(b);
        });

        it('never logs the key value', function() {
            var errors = sinon.stub(console, 'error');
            var result;
            try {
                result = secrets.loadOrCreateKey(path.join(dir, 'api_key'));
            } finally {
                errors.restore();
            }
            var output = log.args.concat(errors.args).map(function(args) {
                return args.join(' ');
            }).join('\n');
            expect(output).to.not.contain(result.key);
        });

        it('refuses a key file that is too short to be a real key', function() {
            var file = path.join(dir, 'api_key');
            fs.writeFileSync(file, 'short\n');
            expect(function() {
                secrets.loadOrCreateKey(file);
            }).to.throw(/too short/);
        });

        it('throws when no file is configured', function() {
            expect(function() {
                secrets.loadOrCreateKey('');
            }).to.throw(/key file/);
        });
    });
});
