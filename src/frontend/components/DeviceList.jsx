/**
 * Clickable device cards. The card class carries the device status so the
 * stylesheet can colour it.
 */

'use strict';

var React = require('react');

var DeviceList = React.createClass({
    propTypes: {
        devices: React.PropTypes.array.isRequired,
        selected: React.PropTypes.string,
        onSelect: React.PropTypes.func.isRequired
    },

    render: function() {
        var self = this;
        return (
            <div className="device-list">
                {this.props.devices.map(function(device) {
                    var className = 'device-card ' + device.status;
                    if (device.deviceId === self.props.selected) {
                        className += ' selected';
                    }
                    return (
                        <div key={device.deviceId}
                             className={className}
                             onClick={function() { self.props.onSelect(device.deviceId); }}>
                            <h3>{device.name}</h3>
                            <span className="device-status">{device.status}</span>
                            <small className="device-type">{device.type}</small>
                        </div>
                    );
                })}
            </div>
        );
    }
});

module.exports = DeviceList;
