/**
 * Dashboard root component: loads devices, stats, open alerts and the
 * firmware catalogue over REST and listens for live alerts, telemetry,
 * status changes and firmware progress over Socket.IO.
 *
 * Nothing is loaded until the operator has entered the API key. The key
 * is kept in sessionStorage (lib/api) and dropped again as soon as the
 * platform rejects it.
 */

'use strict';

require('whatwg-fetch');
var React = require('react');
var io = require('socket.io-client');
var StatsBar = require('./components/StatsBar.jsx');
var DeviceList = require('./components/DeviceList.jsx');
var DeviceDetail = require('./components/DeviceDetail.jsx');
var AlertsFeed = require('./components/AlertsFeed.jsx');
var KeyPrompt = require('./components/KeyPrompt.jsx');
var chartData = require('./lib/chart_data');
var api = require('./lib/api');

var STATUSES = ['registered', 'online', 'offline', 'maintenance', 'decommissioned'];
var TYPES = ['sensor', 'actuator', 'gateway', 'controller'];
var MAX_LIVE_POINTS = 100;
var MAX_ALERTS = 50;

function browserWindow() {
    return typeof window !== 'undefined' ? window : undefined;
}

var App = React.createClass({
    propTypes: {
        keyStore: React.PropTypes.object
    },

    keyStore: function() {
        if (!this._keyStore) {
            this._keyStore = this.props.keyStore || api.keyStore(api.defaultStorage(browserWindow()));
        }
        return this._keyStore;
    },

    getInitialState: function() {
        return {
            apiKey: this.keyStore().get(),
            authError: null,
            devices: [],
            alerts: [],
            stats: {},
            selectedDevice: null,
            liveTelemetry: [],
            firmware: [],
            firmwareUpdates: {},
            statusFilter: '',
            typeFilter: ''
        };
    },

    componentDidMount: function() {
        if (this.state.apiKey) {
            this.connect();
        }
    },

    setApiKey: function(key) {
        this.keyStore().set(key);
        this.setState({apiKey: key, authError: null}, this.connect);
    },

    // Called whenever the platform rejects the key: forget it and ask again.
    unauthorized: function() {
        this.keyStore().clear();
        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
        }
        this.setState({apiKey: null, authError: 'The API key was rejected', selectedDevice: null});
    },

    apiFetch: function(url, opts) {
        return api.apiFetch(this.state.apiKey, url, opts, fetch).catch(function(err) {
            if (err.unauthorized) {
                this.unauthorized();
            }
            throw err;
        }.bind(this));
    },

    getJson: function(url, apply) {
        this.apiFetch(url)
            .then(function(res) { return res.json(); })
            .then(apply.bind(this))
            .catch(function() {});
    },

    connect: function() {
        this.socket = io({query: api.socketQuery(this.state.apiKey), forceNew: true});
        this.fetchDevices();
        this.fetchStats();
        this.fetchAlerts();
        this.fetchFirmware();

        this.socket.on('error', function(err) {
            if (String(err) === 'Unauthorized') {
                this.unauthorized();
            }
        }.bind(this));

        this.socket.on('alert', function(payload) {
            this.setState(function(prev) {
                return {alerts: [payload.alert].concat(prev.alerts).slice(0, MAX_ALERTS)};
            });
        }.bind(this));

        this.socket.on('status', function(payload) {
            this.updateDevice(payload.deviceId, payload.data);
            if (payload.data && payload.data.status) {
                this.fetchStats();
            }
        }.bind(this));

        this.socket.on('firmware', function(payload) {
            var update = payload.update;
            this.setState(function(prev) {
                var updates = Object.assign({}, prev.firmwareUpdates);
                updates[update.deviceId] = update;
                return {firmwareUpdates: updates};
            });
            if (update.state === 'success') {
                this.updateDevice(update.deviceId, {firmware: update.version});
            }
        }.bind(this));

        this.socket.on('telemetry', function(payload) {
            if (this.state.selectedDevice !== payload.deviceId) {
                return;
            }
            this.setState(function(prev) {
                return {
                    liveTelemetry: chartData.appendPoint(prev.liveTelemetry, payload.data, MAX_LIVE_POINTS)
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
        this.getJson('/api/devices', function(data) {
            this.setState({devices: data.devices || []});
        });
    },

    fetchStats: function() {
        this.getJson('/api/stats', function(data) {
            this.setState({stats: data});
        });
    },

    fetchAlerts: function() {
        this.getJson('/api/alerts?acknowledged=false', function(data) {
            this.setState({alerts: data.alerts || []});
        });
    },

    fetchFirmware: function() {
        this.getJson('/api/firmware', function(data) {
            this.setState({firmware: data.firmware || []});
        });
    },

    updateDevice: function(deviceId, fields) {
        this.setState(function(prev) {
            return {
                devices: prev.devices.map(function(device) {
                    return device.deviceId === deviceId ? Object.assign({}, device, fields) : device;
                })
            };
        });
    },

    ackAlert: function(alertId) {
        this.apiFetch('/api/alerts/' + encodeURIComponent(alertId) + '/ack', {method: 'POST'})
            .then(function(res) { return res.ok ? res.json() : null; })
            .then(function(acked) {
                if (!acked) {
                    return;
                }
                this.setState(function(prev) {
                    return {
                        alerts: prev.alerts.map(function(alert) {
                            return alert._id === acked._id ? acked : alert;
                        })
                    };
                });
            }.bind(this))
            .catch(function() {});
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

    selectedDevice: function() {
        var id = this.state.selectedDevice;
        return this.state.devices.filter(function(device) {
            return device.deviceId === id;
        })[0] || null;
    },

    firmwareVersionsFor: function(device) {
        return this.state.firmware.filter(function(fw) {
            return fw.deviceType === device.type;
        }).map(function(fw) {
            return fw.version;
        });
    },

    renderDetail: function() {
        var device = this.selectedDevice();
        if (!device) {
            return null;
        }
        var update = this.state.firmwareUpdates[device.deviceId];
        return (
            <div className="detail-panel">
                <DeviceDetail device={device}
                              liveTelemetry={this.state.liveTelemetry}
                              firmwareVersions={this.firmwareVersionsFor(device)}
                              apiFetch={this.apiFetch}
                              socket={this.socket}/>
                {update ? (
                    <p className={'firmware-progress ' + update.state}>
                        Firmware {update.version}: {update.state}
                    </p>
                ) : null}
            </div>
        );
    },

    render: function() {
        if (!this.state.apiKey) {
            return <KeyPrompt onSubmit={this.setApiKey} error={this.state.authError}/>;
        }
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
                    {this.renderDetail()}
                </div>
                <AlertsFeed alerts={this.state.alerts} onAck={this.ackAlert}/>
            </div>
        );
    }
});

module.exports = App;
