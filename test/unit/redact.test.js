'use strict';

var expect = require('chai').expect;
var redactUrl = require('../../src/lib/redact').redactUrl;

describe('redactUrl', function() {
    it('keeps scheme, host and port and hides userinfo, path and query', function() {
        var out = redactUrl('https://user:S3NTINEL-pw@hooks.example.com:8443/T0/S3NTINEL-path?token=S3NTINEL-q');
        expect(out).to.equal('https://<redacted>@hooks.example.com:8443/<redacted>');
        expect(out).to.not.contain('S3NTINEL');
    });

    it('leaves a bare origin unchanged', function() {
        expect(redactUrl('http://example.com')).to.equal('http://example.com');
        expect(redactUrl('http://example.com/')).to.equal('http://example.com');
    });

    it('hides a query on the root path', function() {
        expect(redactUrl('http://example.com/?key=S3NTINEL')).to.equal('http://example.com/<redacted>');
    });

    it('returns a placeholder for values that are not absolute URLs', function() {
        expect(redactUrl('S3NTINEL-not-a-url')).to.equal('<redacted url>');
        expect(redactUrl('')).to.equal('<redacted url>');
        expect(redactUrl(null)).to.equal('<redacted url>');
    });
});
