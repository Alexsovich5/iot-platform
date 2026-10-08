'use strict';

var expect = require('chai').expect;
var cli = require('../../bin/simulate-devices');

describe('simulate-devices argument parsing', function() {
    it('applies defaults', function() {
        var opts = cli.parseArgs([], {});
        expect(opts).to.deep.equal({
            count: 5,
            prefix: 'sim',
            interval: 2000,
            mqtt: 'mqtt://localhost:1883',
            key: '',
            duration: 0,
            type: 'sensor'
        });
    });

    it('reads every flag in both --flag value and --flag=value form', function() {
        var opts = cli.parseArgs([
            '--count', '3', '--prefix=lab', '--interval', '500', '--mqtt', 'mqtt://mosquitto:1883',
            '--key=abc', '--duration', '30', '--type', 'gateway'
        ], {});
        expect(opts).to.deep.equal({
            count: 3,
            prefix: 'lab',
            interval: 500,
            mqtt: 'mqtt://mosquitto:1883',
            key: 'abc',
            duration: 30,
            type: 'gateway'
        });
    });

    it('takes the key from PROVISIONING_KEY when no flag is given', function() {
        expect(cli.parseArgs([], {PROVISIONING_KEY: 'from-env'}).key).to.equal('from-env');
    });

    it('rejects unknown flags, bad numbers, bad types and bad prefixes', function() {
        expect(function() { cli.parseArgs(['--colour', 'red'], {}); }).to.throw(/Unknown option/);
        expect(function() { cli.parseArgs(['--count', '0'], {}); }).to.throw(/--count/);
        expect(function() { cli.parseArgs(['--interval', 'fast'], {}); }).to.throw(/--interval/);
        expect(function() { cli.parseArgs(['--duration', '-1'], {}); }).to.throw(/--duration/);
        expect(function() { cli.parseArgs(['--type', 'toaster'], {}); }).to.throw(/--type/);
        expect(function() { cli.parseArgs(['--prefix', 'a/b'], {}); }).to.throw(/--prefix/);
        expect(function() { cli.parseArgs(['--count'], {}); }).to.throw(/needs a value/);
    });

    it('builds device ids from the prefix', function() {
        expect(cli.deviceIds('lab', 3)).to.deep.equal(['lab-1', 'lab-2', 'lab-3']);
    });
});
