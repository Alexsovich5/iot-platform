'use strict';

var expect = require('chai').expect;
var api = require('../../../src/frontend/lib/api');

function fakeStorage() {
    var data = {};
    return {
        data: data,
        getItem: function(k) {
            return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null;
        },
        setItem: function(k, v) {
            data[k] = String(v);
        },
        removeItem: function(k) {
            delete data[k];
        }
    };
}

function fakeResponse(status) {
    return {status: status, ok: status >= 200 && status < 300};
}

describe('dashboard API helpers', function() {
    describe('keyStore', function() {
        it('stores, reads and clears the operator key', function() {
            var storage = fakeStorage();
            var store = api.keyStore(storage);
            expect(store.get()).to.equal(null);
            store.set('abc');
            expect(store.get()).to.equal('abc');
            expect(storage.data[api.STORAGE_KEY]).to.equal('abc');
            store.clear();
            expect(store.get()).to.equal(null);
        });

        it('works without storage and when storage throws', function() {
            var none = api.keyStore(null);
            none.set('abc');
            expect(none.get()).to.equal(null);
            var broken = api.keyStore({
                getItem: function() { throw new Error('denied'); },
                setItem: function() { throw new Error('denied'); },
                removeItem: function() { throw new Error('denied'); }
            });
            expect(function() {
                broken.set('abc');
                broken.clear();
            }).to.not.throw();
            expect(broken.get()).to.equal(null);
        });
    });

    describe('defaultStorage', function() {
        it('uses sessionStorage, never localStorage', function() {
            var session = fakeStorage();
            var local = fakeStorage();
            expect(api.defaultStorage({sessionStorage: session, localStorage: local})).to.equal(session);
            expect(api.defaultStorage({localStorage: local})).to.equal(null);
        });

        it('returns null outside a browser', function() {
            expect(api.defaultStorage(undefined)).to.equal(null);
        });
    });

    it('adds the key as a Bearer Authorization header', function() {
        expect(api.authHeaders('k1', {'Content-Type': 'application/json'})).to.deep.equal({
            'Content-Type': 'application/json',
            Authorization: 'Bearer k1'
        });
    });

    it('builds the Socket.IO query with the key URL-encoded', function() {
        expect(api.socketQuery('a b&c')).to.equal('apiKey=a%20b%26c');
    });

    describe('apiFetch', function() {
        it('sends the key with the request and resolves with the response', function() {
            var calls = [];
            function fetchImpl(url, opts) {
                calls.push({url: url, opts: opts});
                return Promise.resolve(fakeResponse(200));
            }
            return api.apiFetch('k1', '/api/stats', {method: 'POST', headers: {'X-A': '1'}}, fetchImpl)
                .then(function(res) {
                    expect(res.status).to.equal(200);
                    expect(calls).to.have.length(1);
                    expect(calls[0].url).to.equal('/api/stats');
                    expect(calls[0].opts.method).to.equal('POST');
                    expect(calls[0].opts.headers).to.deep.equal({'X-A': '1', Authorization: 'Bearer k1'});
                });
        });

        it('rejects with an unauthorized error on 401', function() {
            function fetchImpl() {
                return Promise.resolve(fakeResponse(401));
            }
            return api.apiFetch('bad', '/api/stats', {}, fetchImpl).then(function() {
                throw new Error('expected a rejection');
            }, function(err) {
                expect(err.unauthorized).to.equal(true);
            });
        });
    });
});
