'use strict';

var fs = require('fs');
var os = require('os');
var path = require('path');
var crypto = require('crypto');
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
            keyFile: '',
            username: '',
            passwordFile: '',
            duration: 0,
            type: 'sensor'
        });
    });

    it('reads every flag in both --flag value and --flag=value form', function() {
        var opts = cli.parseArgs([
            '--count', '3', '--prefix=lab', '--interval', '500', '--mqtt', 'mqtt://mosquitto:1883',
            '--key=abc', '--key-file', '/k', '--username=device', '--password-file', '/pw',
            '--duration', '30', '--type', 'gateway'
        ], {});
        expect(opts).to.deep.equal({
            count: 3,
            prefix: 'lab',
            interval: 500,
            mqtt: 'mqtt://mosquitto:1883',
            key: 'abc',
            keyFile: '/k',
            username: 'device',
            passwordFile: '/pw',
            duration: 30,
            type: 'gateway'
        });
    });

    it('takes the key from PROVISIONING_KEY when no flag is given', function() {
        expect(cli.parseArgs([], {PROVISIONING_KEY: 'from-env'}).key).to.equal('from-env');
    });

    it('takes broker credentials and the key file from the environment', function() {
        var opts = cli.parseArgs([], {
            MQTT_DEVICE_USERNAME: 'device',
            MQTT_DEVICE_PASSWORD_FILE: '/secrets/mqtt_device_password',
            PROVISIONING_KEY_FILE: '/secrets/provisioning_key'
        });
        expect(opts.username).to.equal('device');
        expect(opts.passwordFile).to.equal('/secrets/mqtt_device_password');
        expect(opts.keyFile).to.equal('/secrets/provisioning_key');
    });

    it('has no flag that takes a password on the command line', function() {
        expect(function() { cli.parseArgs(['--password', 'x'], {}); }).to.throw(/Unknown option/);
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

    describe('readSecrets', function() {
        var dir;

        beforeEach(function() {
            dir = path.join(os.tmpdir(), 'sim-cli-' + crypto.randomBytes(6).toString('hex'));
            fs.mkdirSync(dir);
        });

        it('reads the broker password and provisioning key from their files', function() {
            fs.writeFileSync(path.join(dir, 'pw'), 'device-pw\n');
            fs.writeFileSync(path.join(dir, 'key'), 'prov-key\n');
            var opts = cli.parseArgs(['--password-file', path.join(dir, 'pw'), '--key-file', path.join(dir, 'key')], {});
            expect(cli.readSecrets(opts)).to.deep.equal({password: 'device-pw', key: 'prov-key'});
        });

        it('prefers an explicit --key over the key file', function() {
            fs.writeFileSync(path.join(dir, 'key'), 'prov-key\n');
            var opts = cli.parseArgs(['--key', 'inline', '--key-file', path.join(dir, 'key')], {});
            expect(cli.readSecrets(opts).key).to.equal('inline');
        });

        it('fails naming the missing file', function() {
            var opts = cli.parseArgs(['--password-file', path.join(dir, 'nope')], {});
            expect(function() { cli.readSecrets(opts); }).to.throw(/nope/);
        });
    });
});
