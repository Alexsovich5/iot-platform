/**
 * Dashboard root component: loads devices and stats over REST and listens
 * for live alerts and telemetry over Socket.IO.
 */

'use strict';

require('whatwg-fetch');
var React = require('react');
var io = require('socket.io-client');
var StatsBar = require('./components/StatsBar.jsx');
var DeviceList = require('./components/DeviceList.jsx');

var STATUSES = ['registered', 'online', 'offline', 'maintenance', 'decommissioned'];
var TYPES = ['sensor', 'actuator', 'gateway', 'controller'];
var MAX_LIVE_POINTS = 100;
var METRICS = ['temperature', 'humidity', 'pressure', 'battery'];

var App = React.createClass({
    getInitialState: function() {
        return {
            devices: [],
            alerts: [],
            stats: {},
            selectedDevice: null,
            liveTelemetry: [],
            statusFilter: '',
            typeFilter: ''
        };
    },

    componentDidMount: function() {
        this.socket = io();
        this.fetchDevices();
        this.fetchStats();

        this.socket.on('alert', function(payload) {
            this.setState(function(prev) {
                return {alerts: [payload.alert].concat(prev.alerts).slice(0, 50)};
            });
        }.bind(this));

        this.socket.on('telemetry', function(payload) {
            if (this.state.selectedDevice !== payload.deviceId) {
                return;
            }
            this.setState(function(prev) {
                return {
                    liveTelemetry: prev.liveTelemetry.concat([payload.data]).slice(-MAX_LIVE_POINTS)
                };
            });
        }.bind(this));
    },

    componentWillUnmount: function() {
        if (this.socket) {
            this.socket.disconnect();
        }
    },

    fetchDevices: function() {
        fetch('/api/devices')
            .then(function(res) { return res.json(); })
            .then(function(data) {
                this.setState({devices: data.devices});
            }.bind(this));
    },

    fetchStats: function() {
        fetch('/api/stats')
            .then(function(res) { return res.json(); })
            .then(function(data) {
                this.setState({stats: data});
            }.bind(this));
    },

    selectDevice: function(deviceId) {
        if (this.state.selectedDevice === deviceId) {
            return;
        }
        if (this.state.selectedDevice) {
            this.socket.emit('unsubscribe_device', this.state.selectedDevice);
        }
        this.socket.emit('subscribe_device', deviceId);
        this.setState({selectedDevice: deviceId, liveTelemetry: []});
    },

    onStatusFilter: function(e) {
        this.setState({statusFilter: e.target.value});
    },

    onTypeFilter: function(e) {
        this.setState({typeFilter: e.target.value});
    },

    filteredDevices: function() {
        var status = this.state.statusFilter;
        var type = this.state.typeFilter;
        return this.state.devices.filter(function(device) {
            return (!status || device.status === status) && (!type || device.type === type);
        });
    },

    renderOptions: function(values, allLabel) {
        return [<option key="" value="">{allLabel}</option>].concat(values.map(function(value) {
            return <option key={value} value={value}>{value}</option>;
        }));
    },

    renderLive: function() {
        if (!this.state.selectedDevice) {
            return null;
        }
        var points = this.state.liveTelemetry;
        var latest = points[points.length - 1];
        return (
            <div className="live-panel">
                <h2>{this.state.selectedDevice}</h2>
                <p className="live-count">{points.length} live readings</p>
                {latest ? (
                    <dl className="live-latest">
                        {METRICS.filter(function(m) { return latest[m] !== undefined; }).map(function(m) {
                            return [<dt key={m + '-k'}>{m}</dt>, <dd key={m + '-v'}>{latest[m]}</dd>];
                        })}
                    </dl>
                ) : <p className="muted">Waiting for telemetry</p>}
            </div>
        );
    },

    render: function() {
        return (
            <div className="dashboard">
                <h1>IoT Device Management</h1>
                <StatsBar stats={this.state.stats}/>
                <div className="filters">
                    <label>
                        Status
                        <select value={this.state.statusFilter} onChange={this.onStatusFilter}>
                            {this.renderOptions(STATUSES, 'All statuses')}
                        </select>
                    </label>
                    <label>
                        Type
                        <select value={this.state.typeFilter} onChange={this.onTypeFilter}>
                            {this.renderOptions(TYPES, 'All types')}
                        </select>
                    </label>
                </div>
                <div className="main">
                    <DeviceList devices={this.filteredDevices()}
                                selected={this.state.selectedDevice}
                                onSelect={this.selectDevice}/>
                    {this.renderLive()}
                </div>
            </div>
        );
    }
});

module.exports = App;
