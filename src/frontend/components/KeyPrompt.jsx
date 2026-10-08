/**
 * Asks for the operator API key before the dashboard loads any data.
 */

'use strict';

var React = require('react');

var KeyPrompt = React.createClass({
    propTypes: {
        onSubmit: React.PropTypes.func.isRequired,
        error: React.PropTypes.string
    },

    getInitialState: function() {
        return {key: ''};
    },

    onChange: function(e) {
        this.setState({key: e.target.value});
    },

    submit: function(e) {
        e.preventDefault();
        var key = this.state.key.trim();
        if (key) {
            this.props.onSubmit(key);
        }
    },

    render: function() {
        return (
            <form className="key-prompt" onSubmit={this.submit}>
                <h1>IoT Device Management</h1>
                <label>
                    Operator API key
                    <input type="password" autoComplete="off" value={this.state.key} onChange={this.onChange}/>
                </label>
                {this.props.error ? <p className="key-error">{this.props.error}</p> : null}
                <button type="submit" disabled={!this.state.key.trim()}>Open dashboard</button>
            </form>
        );
    }
});

module.exports = KeyPrompt;
