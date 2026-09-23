/**
 * IoT Dashboard - Main App Component
 */

var React = require('react');
var io = require('socket.io-client');

var App = React.createClass({
    getInitialState: function() {
        return {
            devices: [],
            alerts: [],
            stats: {},
            selectedDevice: null
        };
    },

    componentDidMount: function() {
        this.socket = io();
        this.fetchDevices();
        this.fetchStats();

        this.socket.on('alert', function(alert) {
            this.setState(function(prev) {
                return { alerts: [alert].concat(prev.alerts).slice(0, 50) };
            });
        }.bind(this));

        this.socket.on('telemetry', function(data) {
            if (this.state.selectedDevice === data.deviceId) {
                this.forceUpdate();
            }
        }.bind(this));
    },

    fetchDevices: function() {
        fetch('/api/devices')
            .then(function(res) { return res.json(); })
            .then(function(data) {
                this.setState({ devices: data.devices });
            }.bind(this));
    },

    fetchStats: function() {
        fetch('/api/stats')
            .then(function(res) { return res.json(); })
            .then(function(data) {
                this.setState({ stats: data });
            }.bind(this));
    },

    selectDevice: function(deviceId) {
        this.socket.emit('subscribe_device', deviceId);
        this.setState({ selectedDevice: deviceId });
    },

    render: function() {
        return React.createElement('div', { className: 'dashboard' },
            React.createElement('h1', null, 'IoT Device Management'),
            React.createElement('div', { className: 'stats-bar' },
                Object.keys(this.state.stats).map(function(key) {
                    return React.createElement('div', { key: key, className: 'stat' },
                        React.createElement('span', { className: 'stat-label' }, key),
                        React.createElement('span', { className: 'stat-value' }, this.state.stats[key])
                    );
                }.bind(this))
            ),
            React.createElement('div', { className: 'device-list' },
                this.state.devices.map(function(device) {
                    return React.createElement('div', {
                        key: device.deviceId,
                        className: 'device-card ' + device.status,
                        onClick: this.selectDevice.bind(this, device.deviceId)
                    },
                        React.createElement('h3', null, device.name),
                        React.createElement('span', null, device.status),
                        React.createElement('small', null, device.type)
                    );
                }.bind(this))
            )
        );
    }
});

module.exports = App;
