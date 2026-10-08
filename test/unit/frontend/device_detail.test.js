'use strict';

var expect = require('chai').expect;
var React = require('react');
var ReactDOMServer = require('react-dom/server');

function chartModuleLoaded() {
    return Object.keys(require.cache).some(function(path) {
        return path.indexOf('/node_modules/chart.js/') !== -1;
    });
}

var DEVICE = {
    deviceId: 'dev-1',
    name: 'Boiler room',
    type: 'sensor',
    status: 'online',
    firmware: '1.2.0'
};

describe('DeviceDetail', function() {
    var DeviceDetail;

    before(function() {
        DeviceDetail = require('../../../src/frontend/components/DeviceDetail.jsx');
    });

    function render(props) {
        return ReactDOMServer.renderToStaticMarkup(
            React.createElement(DeviceDetail, Object.assign({
                device: DEVICE,
                liveTelemetry: [],
                firmwareVersions: ['1.2.0', '1.3.0'],
                socket: {emit: function() {}}
            }, props))
        );
    }

    it('shows the device name, firmware and a chart canvas', function() {
        var html = render();
        expect(html).to.contain('Boiler room');
        expect(html).to.contain('1.2.0');
        expect(html).to.match(/<canvas[^>]*>/);
    });

    it('offers a metric selector and a firmware version select', function() {
        var html = render();
        expect(html).to.match(/<option[^>]* value="temperature"/);
        expect(html).to.match(/<option[^>]* value="battery"/);
        expect(html).to.match(/<option[^>]* value="1.3.0"/);
    });

    it('does not load Chart.js on the server render path', function() {
        render();
        expect(chartModuleLoaded()).to.equal(false);
    });
});
