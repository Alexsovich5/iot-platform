/**
 * Alert list, newest first. Unacknowledged alerts get an Ack button.
 */

'use strict';

var React = require('react');

function newestFirst(a, b) {
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
}

var AlertsFeed = React.createClass({
    propTypes: {
        alerts: React.PropTypes.array.isRequired,
        onAck: React.PropTypes.func.isRequired
    },

    render: function() {
        var self = this;
        var alerts = this.props.alerts.slice().sort(newestFirst);
        return (
            <div className="alerts-feed">
                <h2>Alerts</h2>
                {alerts.length === 0 ? <p className="muted">No alerts</p> : null}
                <ul>
                    {alerts.map(function(alert) {
                        var className = 'alert ' + alert.severity + (alert.acknowledged ? ' acknowledged' : '');
                        return (
                            <li key={alert._id} className={className}>
                                <span className="alert-severity">{alert.severity}</span>
                                <span className="alert-device">{alert.deviceId}</span>
                                <span className="alert-message">{alert.message}</span>
                                <small className="alert-time">{new Date(alert.createdAt).toLocaleString()}</small>
                                {alert.acknowledged ? null : (
                                    <button type="button" onClick={function() { self.props.onAck(alert._id); }}>
                                        Ack
                                    </button>
                                )}
                            </li>
                        );
                    })}
                </ul>
            </div>
        );
    }
});

module.exports = AlertsFeed;
