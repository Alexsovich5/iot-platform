'use strict';

var expect = require('chai').expect;
var React = require('react');
var ReactDOMServer = require('react-dom/server');

function store(key) {
    return {
        get: function() { return key; },
        set: function() {},
        clear: function() {}
    };
}

describe('App', function() {
    var App;

    before(function() {
        App = require('../../../src/frontend/App.jsx');
    });

    it('asks for the operator key before showing any fleet data', function() {
        var html = ReactDOMServer.renderToStaticMarkup(<App keyStore={store(null)}/>);
        expect(html).to.contain('key-prompt');
        expect(html).to.not.contain('device-list');
        expect(html).to.not.contain('alerts-feed');
    });

    it('shows the dashboard once a key is stored', function() {
        var html = ReactDOMServer.renderToStaticMarkup(<App keyStore={store('k1')}/>);
        expect(html).to.not.contain('key-prompt');
        expect(html).to.contain('stats-bar');
        expect(html).to.contain('device-list');
    });
});
