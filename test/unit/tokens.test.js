'use strict';

var crypto = require('crypto');
var expect = require('chai').expect;
var tokens = require('../../src/lib/tokens');

describe('tokens', function() {
    describe('generate', function() {
        it('returns 32 lowercase hex characters', function() {
            expect(tokens.generate()).to.match(/^[0-9a-f]{32}$/);
        });

        it('does not repeat over 1000 runs', function() {
            var seen = {};
            for (var i = 0; i < 1000; i++) {
                var t = tokens.generate();
                expect(seen).to.not.have.property(t);
                seen[t] = true;
            }
            expect(Object.keys(seen)).to.have.length(1000);
        });
    });

    describe('hash', function() {
        it('returns the sha256 hex digest of the token', function() {
            var expected = crypto.createHash('sha256').update('abc').digest('hex');
            expect(tokens.hash('abc')).to.equal(expected);
            expect(tokens.hash('abc')).to.equal(
                'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
        });

        it('does not return the token itself', function() {
            var t = tokens.generate();
            expect(tokens.hash(t)).to.not.equal(t);
        });
    });

    describe('verify', function() {
        var token, stored;

        beforeEach(function() {
            token = tokens.generate();
            stored = tokens.hash(token);
        });

        it('accepts the token that produced the hash', function() {
            expect(tokens.verify(token, stored)).to.equal(true);
        });

        it('rejects a different token of the same length', function() {
            var other = tokens.generate();
            expect(tokens.verify(other, stored)).to.equal(false);
        });

        it('rejects a token that differs only in the last character', function() {
            var last = token.charAt(31) === '0' ? '1' : '0';
            expect(tokens.verify(token.slice(0, 31) + last, stored)).to.equal(false);
        });

        it('rejects a hash of a different length', function() {
            expect(tokens.verify(token, stored.slice(0, 32))).to.equal(false);
            expect(tokens.verify(token, stored + '00')).to.equal(false);
        });

        it('rejects an empty token', function() {
            expect(tokens.verify('', stored)).to.equal(false);
        });

        it('rejects an undefined token', function() {
            expect(tokens.verify(undefined, stored)).to.equal(false);
        });

        it('rejects non-string tokens', function() {
            expect(tokens.verify(null, stored)).to.equal(false);
            expect(tokens.verify(12345, stored)).to.equal(false);
            expect(tokens.verify({}, stored)).to.equal(false);
        });

        it('rejects when the stored hash is missing', function() {
            expect(tokens.verify(token, undefined)).to.equal(false);
            expect(tokens.verify(token, null)).to.equal(false);
            expect(tokens.verify(token, '')).to.equal(false);
        });

        it('returns a boolean, never a truthy number', function() {
            expect(tokens.verify(token, stored)).to.be.a('boolean');
            expect(tokens.verify('x', stored)).to.be.a('boolean');
        });
    });
});
