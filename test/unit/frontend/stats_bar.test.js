'use strict';

var expect = require('chai').expect;
var React = require('react');
var ReactDOMServer = require('react-dom/server');
var StatsBar = require('../../../src/frontend/components/StatsBar.jsx');

describe('StatsBar', function() {
    it('renders each stat label with its count', function() {
        var html = ReactDOMServer.renderToStaticMarkup(<StatsBar stats={{online: 2}}/>);
        expect(html).to.contain('online');
        expect(html).to.match(/>2</);
        expect(html).to.contain('stats-bar');
    });

    it('renders one stat element per key', function() {
        var html = ReactDOMServer.renderToStaticMarkup(
            <StatsBar stats={{online: 2, offline: 5, registered: 1}}/>
        );
        expect(html.match(/class="stat"/g)).to.have.length(3);
        expect(html).to.match(/>5</);
    });
});
