'use strict';

var expect = require('chai').expect;
var React = require('react');
var ReactDOMServer = require('react-dom/server');
var TestUtils = require('react-addons-test-utils');
var DeviceList = require('../../../src/frontend/components/DeviceList.jsx');

var DEVICES = [
    {deviceId: 'dev-1', name: 'Boiler room', status: 'online', type: 'sensor'},
    {deviceId: 'dev-2', name: 'Roof valve', status: 'offline', type: 'actuator'}
];

function noop() {}

describe('DeviceList', function() {
    it('renders one .device-card per device with its status class', function() {
        var html = ReactDOMServer.renderToStaticMarkup(
            <DeviceList devices={DEVICES} onSelect={noop}/>
        );
        expect(html.match(/class="device-card[ "]/g)).to.have.length(2);
        expect(html).to.contain('class="device-card online');
        expect(html).to.contain('class="device-card offline');
        expect(html).to.contain('Boiler room');
        expect(html).to.contain('Roof valve');
    });

    it('marks the selected device', function() {
        var html = ReactDOMServer.renderToStaticMarkup(
            <DeviceList devices={DEVICES} selected="dev-2" onSelect={noop}/>
        );
        expect(html).to.contain('class="device-card offline selected"');
    });

    it('calls onSelect with the deviceId when a card is clicked', function() {
        var selected = [];
        var renderer = TestUtils.createRenderer();
        renderer.render(
            <DeviceList devices={DEVICES} onSelect={function(id) { selected.push(id); }}/>
        );
        var output = renderer.getRenderOutput();
        var cards = React.Children.toArray(output.props.children);
        expect(cards).to.have.length(2);
        cards[1].props.onClick();
        expect(selected).to.deep.equal(['dev-2']);
    });
});
