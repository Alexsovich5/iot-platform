/**
 * Detail panel for the selected device: a Chart.js line chart of stored
 * plus live telemetry, a command form and a firmware update control.
 *
 * Chart.js touches window when it loads, so it is required inside
 * componentDidMount, which only runs in the browser.
 */

'use strict';

var React = require('react');
var chartData = require('../lib/chart_data');

var METRICS = ['temperature', 'humidity', 'pressure', 'battery'];
var MAX_POINTS = 100;

var DeviceDetail = React.createClass({
    propTypes: {
        device: React.PropTypes.object.isRequired,
        liveTelemetry: React.PropTypes.array.isRequired,
        firmwareVersions: React.PropTypes.array.isRequired,
        apiFetch: React.PropTypes.func.isRequired,
        socket: React.PropTypes.object
    },

    getInitialState: function() {
        return {
            history: [],
            metric: 'temperature',
            command: '',
            payload: '',
            firmwareVersion: '',
            message: null
        };
    },

    componentDidMount: function() {
        this.Chart = require('chart.js');
        this.fetchHistory(this.props.device.deviceId);
        this.drawChart();
    },

    componentWillReceiveProps: function(next) {
        if (next.device.deviceId !== this.props.device.deviceId) {
            this.setState({history: [], message: null, firmwareVersion: ''});
            this.fetchHistory(next.device.deviceId);
        }
    },

    componentDidUpdate: function() {
        this.drawChart();
    },

    componentWillUnmount: function() {
        this.unmounted = true;
        this.destroyChart();
    },

    fetchHistory: function(deviceId) {
        this.props.apiFetch('/api/devices/' + encodeURIComponent(deviceId) + '/telemetry?limit=' + MAX_POINTS)
            .then(function(res) { return res.json(); })
            .then(function(data) {
                if (this.unmounted || deviceId !== this.props.device.deviceId) {
                    return;
                }
                this.setState({history: data.telemetry || []});
            }.bind(this))
            .catch(function() {});
    },

    points: function() {
        return this.state.history.concat(this.props.liveTelemetry);
    },

    destroyChart: function() {
        if (this.chart) {
            this.chart.destroy();
            this.chart = null;
        }
    },

    drawChart: function() {
        this.destroyChart();
        var points = this.points();
        if (!this.Chart || points.length === 0) {
            return;
        }
        var ctx = this.refs.canvas.getContext('2d');
        this.chart = new this.Chart(ctx).Line(
            chartData.toLineData(points, this.state.metric, MAX_POINTS),
            {animation: false, responsive: true, pointDotRadius: 2}
        );
    },

    onMetric: function(e) {
        this.setState({metric: e.target.value});
    },

    onField: function(name) {
        return function(e) {
            var change = {};
            change[name] = e.target.value;
            this.setState(change);
        }.bind(this);
    },

    sendCommand: function(e) {
        e.preventDefault();
        var payload = {};
        if (this.state.payload.trim()) {
            try {
                payload = JSON.parse(this.state.payload);
            } catch (err) {
                return this.setState({message: 'Payload must be JSON'});
            }
        }
        var command = this.state.command.trim();
        this.props.socket.emit('send_command', {
            deviceId: this.props.device.deviceId,
            command: command,
            payload: payload
        }, function(reply) {
            if (this.unmounted) {
                return;
            }
            this.setState({
                message: reply && reply.error ? 'Command failed: ' + reply.error : 'Command sent: ' + command
            });
        }.bind(this));
    },

    startFirmware: function(e) {
        e.preventDefault();
        var version = this.state.firmwareVersion;
        if (!version) {
            return;
        }
        this.props.apiFetch('/api/devices/' + encodeURIComponent(this.props.device.deviceId) + '/firmware', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({version: version})
        })
            .then(function(res) {
                return res.json().then(function(body) {
                    return {ok: res.ok, body: body};
                });
            })
            .then(function(result) {
                if (this.unmounted) {
                    return;
                }
                this.setState({
                    message: result.ok ? 'Firmware ' + version + ' update started' :
                        'Firmware update failed: ' + result.body.error
                });
            }.bind(this))
            .catch(function() {});
    },

    renderOptions: function(values) {
        return values.map(function(value) {
            return <option key={value} value={value}>{value}</option>;
        });
    },

    render: function() {
        var device = this.props.device;
        var latest = this.points()[this.points().length - 1];
        return (
            <div className="device-detail">
                <h2>{device.name}</h2>
                <dl className="device-facts">
                    <dt>ID</dt><dd>{device.deviceId}</dd>
                    <dt>Status</dt><dd>{device.status}</dd>
                    <dt>Type</dt><dd>{device.type}</dd>
                    <dt>Firmware</dt><dd className="device-firmware">{device.firmware || 'unknown'}</dd>
                </dl>

                <div className="chart-controls">
                    <label>
                        Metric
                        <select value={this.state.metric} onChange={this.onMetric}>
                            {this.renderOptions(METRICS)}
                        </select>
                    </label>
                    <span className="live-count">
                        {this.props.liveTelemetry.length} live readings
                        {latest && typeof latest[this.state.metric] === 'number' ?
                            ', latest ' + latest[this.state.metric] : ''}
                    </span>
                </div>
                <canvas ref="canvas" className="telemetry-chart" width="600" height="260"></canvas>

                <form className="command-form" onSubmit={this.sendCommand}>
                    <h3>Send command</h3>
                    <input type="text" placeholder="command, e.g. reboot" value={this.state.command}
                           onChange={this.onField('command')}/>
                    <input type="text" placeholder='payload JSON, e.g. {"interval":30}' value={this.state.payload}
                           onChange={this.onField('payload')}/>
                    <button type="submit" disabled={!this.state.command.trim()}>Send</button>
                </form>

                <form className="firmware-form" onSubmit={this.startFirmware}>
                    <h3>Firmware update</h3>
                    <select value={this.state.firmwareVersion} onChange={this.onField('firmwareVersion')}>
                        <option value="">Choose version</option>
                        {this.renderOptions(this.props.firmwareVersions)}
                    </select>
                    <button type="submit" disabled={!this.state.firmwareVersion}>Update</button>
                </form>

                {this.state.message ? <p className="detail-message">{this.state.message}</p> : null}
            </div>
        );
    }
});

module.exports = DeviceDetail;
