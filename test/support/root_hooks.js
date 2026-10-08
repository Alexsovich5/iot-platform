'use strict';

var waitForPort = require('./wait_for').waitForPort;

var SERVICES = [
    {host: 'mongo', port: 27017},
    {host: 'mosquitto', port: 1883}
];

before(function(done) {
    if (process.env.SKIP_SERVICES === '1') {
        return done();
    }
    this.timeout(35000);

    var pending = SERVICES.length;
    var failed = false;
    SERVICES.forEach(function(service) {
        waitForPort(service.host, service.port, 30000, function(err) {
            if (failed) {
                return;
            }
            if (err) {
                failed = true;
                return done(err);
            }
            pending -= 1;
            if (pending === 0) {
                done();
            }
        });
    });
});
