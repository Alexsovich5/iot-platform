# IoT Device Management Platform

A Node.js service that manages a fleet of MQTT devices. Devices provision themselves (or are created by an operator) and authenticate every message with a per-device token. The service stores their telemetry in MongoDB, evaluates threshold rules into alerts, sends commands and firmware updates back over MQTT, and exposes all of it through a JSON REST API and a React dashboard that updates live over Socket.IO. A bundled device-fleet simulator stands in for real hardware.

Personal project built on the 2015-era stack (Node 4.3, Express 4.13, MQTT.js 1.7, Mongoose 4.4, MongoDB 3.2, Mosquitto 1.4, React 0.14, Socket.IO 1.4).

## Status

**Implemented**

- **MQTT device communication**: subscribes to `devices/+/{register,telemetry,status,alerts,firmware}`, validates device IDs and JSON payloads, and routes each message by type (`src/mqtt_handler.js`, `src/lib/topics.js`, `src/lib/ids.js`; `test/unit/mqtt_handler.test.js`, `test/unit/topics.test.js`, `test/integration/mqtt_flow.test.js`).
- **Command dispatch**: `POST /api/devices/:id/commands` and the Socket.IO `send_command` event publish `{commandId, command, payload, timestamp}` to `devices/<id>/commands` with QoS 1 (`src/lib/commands.js`, `src/routes/devices.js`, `src/socket.js`; `test/unit/socket.test.js`, `test/integration/commands.test.js`).
- **Device provisioning**: an operator creates a device with `POST /api/devices` and receives a one-time token, or a device registers itself on `devices/<id>/register` with the shared provisioning key and gets its token on `devices/<id>/provisioned`. Re-registering an existing ID is rejected (`src/routes/devices.js`, `src/mqtt_handler.js`; `test/integration/devices_api.test.js`, `test/unit/mqtt_handler.test.js`).
- **Device authentication**: every inbound device message must carry a token whose SHA-256 hash is compared in constant time with the stored `tokenHash`. Bad, missing or revoked tokens are dropped and counted in `/health` as `rejectedMessages` (`src/lib/tokens.js`, `src/mqtt_handler.js`; `test/unit/tokens.test.js`, `test/unit/mqtt_handler.test.js`).
- **Lifecycle management**: validated transitions between `registered`, `online`, `offline`, `maintenance` and `decommissioned`. Traffic sets a device online, a presence sweeper marks silent devices offline after `presence.offlineAfterSec`, and decommissioning revokes the token (`src/lib/lifecycle.js`, `src/lib/presence.js`; `test/unit/lifecycle.test.js`, `test/unit/presence.test.js`, `test/integration/presence.test.js`).
- **Telemetry storage and history**: temperature, humidity, pressure and battery readings are kept on the device document, capped at the last 1000 points, and served by `GET /api/devices/:id/telemetry?limit=N` (`src/models/device.js`, `src/routes/devices.js`; `test/unit/device_model.test.js`, `test/integration/devices_api.test.js`).
- **Real-time dashboard**: React 0.14 components for a stats bar, a filterable device list, a device detail panel with a Chart.js line chart, an alerts feed with acknowledge, and command and firmware controls, fed by Socket.IO and bundled with browserify (`src/frontend/`, `public/`; `test/unit/frontend/`, `test/integration/static.test.js`).
- **Alert rules engine**: CRUD rules scoped to one device, a device type or all devices, with `gt`/`gte`/`lt`/`lte` thresholds, a cooldown and an enabled flag. Matches and device-originated alerts are stored as `Alert` documents that can be listed and acknowledged (`src/lib/rules.js`, `src/lib/alerts.js`, `src/models/rule.js`, `src/models/alert.js`, `src/routes/rules.js`, `src/routes/alerts.js`; `test/unit/rules.test.js`, `test/unit/rule_model.test.js`, `test/unit/rules_routes.test.js`, `test/unit/alerts_service.test.js`, `test/integration/alerts_flow.test.js`).
- **Alert notifications**: new alerts are emitted to the dashboard over Socket.IO and, when `alerts.webhookUrl` is set, POSTed as JSON to that URL (`src/lib/notifier.js`, `src/lib/alerts.js`; `test/unit/notifier.test.js`, `test/integration/alerts_flow.test.js`).
- **Firmware registry**: `POST /api/firmware?version=&deviceType=` stores an `application/octet-stream` body of up to 10 MB on a volume with its size and MD5, lists uploads, and serves them at `/firmware/:deviceType/:version.bin` (`src/routes/firmware.js`, `src/models/firmware.js`; `test/integration/firmware_registry.test.js`).
- **Firmware update distribution and tracking**: updates go to one device or roll out to every non-decommissioned device of a type. Each device's progress (`pending → downloading → installing → success|failed`) is recorded from `devices/<id>/firmware`, and a successful update sets the device's firmware version (`src/lib/firmware.js`, `src/models/firmware_update.js`; `test/unit/firmware.test.js`, `test/integration/firmware_rollout.test.js`).
- **REST API**: everything above is available as JSON under `/api`, plus `/health`, which answers 200 `healthy` only while both MongoDB and the broker are connected and 503 `degraded` otherwise (`src/app.js`, `src/routes/`; `test/unit/app.test.js`, `test/integration/devices_api.test.js`, `test/integration/server_start.test.js`).
- **Operator API key**: every `/api` route requires `Authorization: Bearer <key>`, compared in constant time; a missing or wrong key gets 401 before the request body is parsed. The key is generated at first start into `/secrets/api_key` in the `secrets` volume and is never committed or logged. Dashboard Socket.IO connections need the same key, and the dashboard asks for it and keeps it in `sessionStorage` only (`src/lib/api_auth.js`, `src/lib/secrets.js`, `src/socket.js`, `src/frontend/lib/api.js`, `src/frontend/components/KeyPrompt.jsx`; `test/unit/api_auth.test.js`, `test/unit/secrets.test.js`, `test/unit/socket.test.js`, `test/unit/frontend/`, `test/integration/devices_api.test.js`, `test/integration/e2e.test.js`).
- **Broker authentication and ACLs**: Mosquitto refuses anonymous clients. A one-shot `secrets` service generates random passwords for a `platform` and a `device` account (plus the provisioning key) into the `secrets` volume on first start and writes the Mosquitto password file. The ACL lets only the platform account read `devices/#` and publish on `provisioned` and `commands`; a device account connects with its device ID as client ID and can only publish its own inbound topics and read its own `provisioned` and `commands` topics (`docker/secrets/init.sh`, `docker/mosquitto/`; `test/integration/broker_auth.test.js`).
- **Secrets kept out of logs**: the webhook URL is logged only as `scheme://host[:port]` with `<redacted>` for userinfo, path and query; broker passwords, the provisioning key and the API key are read from files and never printed (`src/lib/redact.js`, `src/lib/notifier.js`; `test/unit/redact.test.js`, `test/unit/notifier.test.js`, `test/integration/broker_auth.test.js`).
- **Device-fleet simulator**: `bin/simulate-devices.js` starts N simulated devices that log in with the device account, self-provision, publish random-walk telemetry, answer commands and run the firmware download (capped at 10 MB and 15 s), MD5 check and progress reporting (`src/sim/device.js`; `test/unit/sim_device.test.js`, `test/unit/simulate_cli.test.js`, `test/integration/simulator.test.js`, `test/integration/e2e.test.js`).

**Not implemented / known limitations**

- Physical devices are simulated by `bin/simulate-devices.js`. Nothing has been run against real hardware or embedded firmware.
- Firmware images are arbitrary blobs generated by the tests and the smoke script. Nothing is flashed; the simulator only downloads the file and checks its MD5.
- Firmware images live on a local Docker volume, limited to 10 MB each. They are neither signed nor delta-encoded.
- The notification webhook is exercised only against a local stub server started by the tests (`test/support/webhook_stub.js`). No third-party notification service has been contacted.
- No email or SMS notifications. The webhook is the only integration point.
- All devices share one broker account. Anyone holding the device password can connect with another device's ID as client ID, which disconnects that device and lets the impostor read its `provisioned` and `commands` topics; the per-device token still has to be presented on every message the platform accepts. Per-device broker accounts or client certificates are not implemented.
- No TLS on MQTT or HTTP. Passwords, the provisioning key, the API key and device tokens cross the compose network and the published port in clear text. The app port is published on `127.0.0.1` only.
- Firmware downloads (`GET /firmware/:deviceType/:version.bin`) need no key, because devices fetch them without the operator key.
- The dashboard passes the API key to Socket.IO as a query parameter, so it appears in the WebSocket URL.
- Commands are delivered with QoS 1 and not tracked afterwards. Only firmware updates have tracked acknowledgements.
- No dashboard user accounts or roles. There is one operator API key; whoever has it has full control of the REST API and the dashboard. It is rotated by deleting `/secrets/api_key` and restarting the app.
- No separate time-series store or long-term retention. Only the last 1000 readings per device are kept.
- No multi-tenant or horizontally scaled deployment: one app container, one broker, one MongoDB. The presence sweeper runs in-process and assumes a single app instance.
- Transitive dependencies are frozen by an `npm-shrinkwrap.json` resolved with npm 6, which npm 2 might not honour in every field.
- The images are linux/amd64 only and run under emulation on ARM hosts.
- No fleet size, latency or availability figures are claimed. None have been measured.

## Built with

- **Node.js 4.3.1** with Express 4.13.4, body-parser 1.15.0, MQTT.js (`mqtt`) 1.7.3, Mongoose 4.4.5, Socket.IO 1.4.5 and config 1.19.0
- **MongoDB 3.2.3** and **Mosquitto 1.4.8**
- **Dashboard**: React and react-dom 0.14.7, Chart.js 1.0.2, socket.io-client 1.4.5, whatwg-fetch 0.11.0, bundled by browserify 13.0.0 with babelify 7.2.0, babel-core 6.5.2 and babel-preset-react 6.5.0
- **Tests and lint**: mocha 2.4.5, chai 3.5.0, sinon 1.17.3, supertest 1.2.0, react-addons-test-utils 0.14.7, eslint 1.10.3 and eslint-plugin-react 3.16.1

Transitive dependencies are frozen in `npm-shrinkwrap.json`.

## Running it

Everything runs in Docker images from the project's era, so nothing needs installing locally beyond Docker.

```bash
docker compose up        # start the stack; the dashboard is on http://127.0.0.1:21000
make smoke               # start the stack, run 3 simulated devices for 15 s, check /api/stats
```

The first start generates the broker passwords, the provisioning key and the operator API key in the `secrets` volume. The dashboard and every `/api` request need the API key:

```bash
docker compose exec app cat /secrets/api_key
```

To drive the running stack by hand, start the simulator inside the app container. It takes the device account and the provisioning key from the container's `MQTT_DEVICE_USERNAME`, `MQTT_DEVICE_PASSWORD_FILE` and `PROVISIONING_KEY_FILE` variables:

```bash
docker compose exec app node bin/simulate-devices.js --count 5 --mqtt mqtt://mosquitto:1883
```

## Tests

```bash
make test                # runs the suite inside the period image
make readme-check        # checks that the Layout block below matches git ls-files
```

Unit tests cover the pure logic, models, routes and React components with fake MQTT and Socket.IO clients, and integration tests run against real MongoDB and Mosquitto containers, including an end-to-end run of the simulator process. There are no browser-level tests of the dashboard.

## Layout

```
.babelrc
.dockerignore
.eslintrc
.gitignore
Dockerfile
Makefile
README.md
bin/
  simulate-devices.js
config/
  custom-environment-variables.json
  default.json
  test.json
docker/
  mongo/
    Dockerfile
  mosquitto/
    acl
    mosquitto.conf
  secrets/
    init.sh
docker-compose.test.yml
docker-compose.yml
docs/
  IMPLEMENTATION_PLAN.md
  SPEC.md
npm-shrinkwrap.json
package.json
public/
  css/
    dashboard.css
  index.html
  js/
    .gitkeep
scripts/
  layout_tree.js
  smoke.sh
src/
  app.js
  frontend/
    App.jsx
    components/
      AlertsFeed.jsx
      DeviceDetail.jsx
      DeviceList.jsx
      KeyPrompt.jsx
      StatsBar.jsx
    index.jsx
    lib/
      api.js
      chart_data.js
  lib/
    alerts.js
    api_auth.js
    commands.js
    firmware.js
    ids.js
    lifecycle.js
    notifier.js
    presence.js
    redact.js
    rules.js
    secrets.js
    tokens.js
    topics.js
  models/
    alert.js
    device.js
    firmware.js
    firmware_update.js
    rule.js
  mqtt_handler.js
  routes/
    alerts.js
    api.js
    devices.js
    firmware.js
    http.js
    rules.js
  server.js
  sim/
    device.js
  socket.js
test/
  integration/
    alerts_flow.test.js
    broker_auth.test.js
    commands.test.js
    devices_api.test.js
    e2e.test.js
    firmware_registry.test.js
    firmware_rollout.test.js
    mqtt_flow.test.js
    presence.test.js
    server_start.test.js
    services.test.js
    simulator.test.js
    static.test.js
  mocha.opts
  setup-babel.js
  support/
    api.js
    db.js
    fake_io.js
    fake_mqtt.js
    mqtt_creds.js
    root_hooks.js
    wait_for.js
    webhook_stub.js
  unit/
    alerts_service.test.js
    api_auth.test.js
    app.test.js
    device_model.test.js
    firmware.test.js
    frontend/
      alerts_feed.test.js
      api.test.js
      app.test.js
      chart_data.test.js
      device_detail.test.js
      device_list.test.js
      key_prompt.test.js
      stats_bar.test.js
    layout_tree.test.js
    lifecycle.test.js
    mqtt_handler.test.js
    notifier.test.js
    presence.test.js
    readme.test.js
    redact.test.js
    rule_model.test.js
    rules.test.js
    rules_routes.test.js
    sanity.test.js
    secrets.test.js
    sim_device.test.js
    simulate_cli.test.js
    socket.test.js
    tokens.test.js
    topics.test.js
```
