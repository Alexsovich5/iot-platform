'use strict';

var expect = require('chai').expect;
var React = require('react');
var ReactDOMServer = require('react-dom/server');
var TestUtils = require('react-addons-test-utils');
var KeyPrompt = require('../../../src/frontend/components/KeyPrompt.jsx');

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

function byType(type) {
    return function(el) {
        return el.type === type;
    };
}

describe('KeyPrompt', function() {
    it('asks for the key in a password field', function() {
        var html = ReactDOMServer.renderToStaticMarkup(<KeyPrompt onSubmit={function() {}}/>);
        expect(html).to.match(/<input[^>]*type="password"/);
        expect(html).to.contain('API key');
    });

    it('shows an error message when given one', function() {
        var html = ReactDOMServer.renderToStaticMarkup(
            <KeyPrompt onSubmit={function() {}} error="The API key was rejected"/>);
        expect(html).to.contain('The API key was rejected');
    });

    it('submits the trimmed key', function() {
        var submitted = [];
        var renderer = TestUtils.createRenderer();
        renderer.render(<KeyPrompt onSubmit={function(key) { submitted.push(key); }}/>);
        var input = findAll(renderer.getRenderOutput(), byType('input'))[0];
        input.props.onChange({target: {value: '  abc123  '}});
        var form = renderer.getRenderOutput();
        form.props.onSubmit({preventDefault: function() {}});
        expect(submitted).to.deep.equal(['abc123']);
    });

    it('does not submit an empty key', function() {
        var submitted = [];
        var renderer = TestUtils.createRenderer();
        renderer.render(<KeyPrompt onSubmit={function(key) { submitted.push(key); }}/>);
        renderer.getRenderOutput().props.onSubmit({preventDefault: function() {}});
        expect(submitted).to.deep.equal([]);
    });
});
