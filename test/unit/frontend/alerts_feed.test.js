'use strict';

var expect = require('chai').expect;
var React = require('react');
var ReactDOMServer = require('react-dom/server');
var TestUtils = require('react-addons-test-utils');
var AlertsFeed = require('../../../src/frontend/components/AlertsFeed.jsx');

var ALERTS = [
    {_id: 'a1', deviceId: 'dev-1', severity: 'warning', message: 'older open',
        acknowledged: false, createdAt: '2016-01-15T10:00:00.000Z'},
    {_id: 'a2', deviceId: 'dev-2', severity: 'critical', message: 'newest open',
        acknowledged: false, createdAt: '2016-01-15T12:00:00.000Z'},
    {_id: 'a3', deviceId: 'dev-1', severity: 'info', message: 'already seen',
        acknowledged: true, createdAt: '2016-01-15T11:00:00.000Z'}
];

function noop() {}

function findAll(element, predicate, found) {
    found = found || [];
    if (!element || typeof element !== 'object') {
        return found;
    }
    if (predicate(element)) {
        found.push(element);
    }
    React.Children.forEach(element.props && element.props.children, function(child) {
        findAll(child, predicate, found);
    });
    return found;
}

describe('AlertsFeed', function() {
    it('lists alerts newest first', function() {
        var html = ReactDOMServer.renderToStaticMarkup(<AlertsFeed alerts={ALERTS} onAck={noop}/>);
        var newest = html.indexOf('newest open');
        var middle = html.indexOf('already seen');
        var oldest = html.indexOf('older open');
        expect(newest).to.be.above(-1);
        expect(newest).to.be.below(middle);
        expect(middle).to.be.below(oldest);
    });

    it('renders an Ack button only for unacknowledged alerts', function() {
        var html = ReactDOMServer.renderToStaticMarkup(<AlertsFeed alerts={ALERTS} onAck={noop}/>);
        expect(html.match(/<button/g)).to.have.length(2);

        var acked = ReactDOMServer.renderToStaticMarkup(
            <AlertsFeed alerts={[ALERTS[2]]} onAck={noop}/>
        );
        expect(acked).to.contain('already seen');
        expect(acked).to.not.contain('<button');
    });

    it('calls onAck with the alert id when Ack is clicked', function() {
        var acked = [];
        var renderer = TestUtils.createRenderer();
        renderer.render(<AlertsFeed alerts={ALERTS} onAck={function(id) { acked.push(id); }}/>);
        var buttons = findAll(renderer.getRenderOutput(), function(el) {
            return el.type === 'button';
        });
        expect(buttons).to.have.length(2);
        buttons[0].props.onClick();
        expect(acked).to.deep.equal(['a2']);
    });
});
