'use strict';

var expect = require('chai').expect;
var lifecycle = require('../../src/lib/lifecycle');

describe('lifecycle', function() {
    it('lists the five device statuses', function() {
        expect(lifecycle.STATUSES).to.deep.equal(
            ['registered', 'online', 'offline', 'maintenance', 'decommissioned']);
    });

    describe('canTransition (operator path)', function() {
        // rows: from, columns: to, in STATUSES order
        var table = {
            registered:     {registered: true,  online: true,  offline: true,  maintenance: true,  decommissioned: true},
            online:         {registered: false, online: true,  offline: true,  maintenance: true,  decommissioned: true},
            offline:        {registered: false, online: true,  offline: true,  maintenance: true,  decommissioned: true},
            maintenance:    {registered: false, online: true,  offline: true,  maintenance: true,  decommissioned: true},
            decommissioned: {registered: false, online: false, offline: false, maintenance: false, decommissioned: false}
        };

        Object.keys(table).forEach(function(from) {
            Object.keys(table[from]).forEach(function(to) {
                var expected = table[from][to];
                it(from + ' -> ' + to + ' is ' + expected, function() {
                    expect(lifecycle.canTransition(from, to)).to.equal(expected);
                });
            });
        });

        it('rejects unknown statuses on either side', function() {
            expect(lifecycle.canTransition('online', 'broken')).to.equal(false);
            expect(lifecycle.canTransition('broken', 'online')).to.equal(false);
            expect(lifecycle.canTransition(undefined, 'online')).to.equal(false);
        });
    });

    describe('nextStatusOnTraffic', function() {
        var expected = {
            registered: 'online',
            online: 'online',
            offline: 'online',
            maintenance: 'maintenance',
            decommissioned: 'decommissioned'
        };

        Object.keys(expected).forEach(function(current) {
            it(current + ' becomes ' + expected[current], function() {
                expect(lifecycle.nextStatusOnTraffic(current)).to.equal(expected[current]);
            });
        });

        it('keeps maintenance devices out of online even though an operator may move them there', function() {
            expect(lifecycle.nextStatusOnTraffic('maintenance')).to.not.equal('online');
            expect(lifecycle.canTransition('maintenance', 'online')).to.equal(true);
            expect(lifecycle.canTransition('maintenance', 'offline')).to.equal(true);
        });
    });
});
