# iot-platform — Specification

Target period: October 2015 to February 2016. Every runtime dependency and packaged software version was released on or before 2016-02-29. Build-time helper tooling (node:10 for shrinkwrap generation, Docker Compose v2 CLI) is modern and documented as such.

## Problem

A small fleet of networked sensors and actuators needs one place to manage it. Devices speak MQTT. The platform has to:

- register and authenticate devices
- store the telemetry they report
- show live and historical readings on a web dashboard
- send commands and firmware updates to devices
- raise alerts when readings cross thresholds

Other programs reach the same functions through a REST API. This rebuild keeps the concept of the original README and trims it to a core that one person can build and that actually works. No physical hardware is involved. A device-fleet simulator stands in for the devices.

## In scope

1. **MQTT device communication.** The platform subscribes to `devices/+/{register,telemetry,status,alerts,firmware}` on a Mosquitto broker, validates every payload, and routes it by message type. (Original: "MQTT-based device communication".)
2. **Command dispatch.** The REST endpoint `POST /api/devices/:id/commands` and the dashboard Socket.IO event `send_command` both publish JSON commands to `devices/<id>/commands` with QoS 1. Each command gets a `commandId`. (Original: "command dispatch".)
3. **Device provisioning (automated onboarding).** There are two ways to provision a device:
   - An operator calls `POST /api/devices`. The platform creates the device and returns a one-time device token.
   - A device publishes to `devices/<id>/register` with the shared provisioning key. The platform creates the device and replies on `devices/<id>/provisioned` with its token.

   Re-registering an existing device ID is rejected. (Original: "automated device provisioning", "device registration".)
4. **Device authentication.** Every inbound device message must carry `token`. The platform compares its SHA-256 hash with `tokenHash` in constant time. Messages with a bad or missing token, and messages from decommissioned devices, are dropped and counted in `/health`. (Original: "device ... authentication".)
5. **Lifecycle management.** Devices move through the states `registered → online ⇄ offline`, `maintenance`, and `decommissioned`, and transitions are validated. Traffic from a device sets it online. A presence sweeper marks a device offline when it has been silent for longer than `presence.offlineAfterSec`. An operator can set `maintenance` or decommission a device through the API. Decommissioning revokes the token. (Original: "lifecycle management".)
6. **Telemetry storage and history API.** Telemetry holds temperature, humidity, pressure and battery. Readings are stored on the device document in a capped embedded array of the last 1000 points. The endpoint `GET /api/devices/:id/telemetry?limit=N` returns that history. (Original: "device registry and telemetry storage".)
7. **Real-time dashboard.** The dashboard is built with React 0.14 and served by Express. It shows:
   - a stats bar with device counts by status
   - a filterable device list
   - a device detail panel with a historical line chart (Chart.js 1.x)
   - live telemetry and status pushed over Socket.IO
   - an alerts feed with acknowledge
   - controls for sending commands and firmware updates

   (Original: "real-time telemetry dashboard with historical charts", "Socket.IO".)
8. **Alert rules engine.** Rules are CRUD objects with these fields:
   - scope: a single device or a device type
   - metric
   - operator: `gt`, `gte`, `lt` or `lte`
   - threshold
   - cooldown
   - enabled

   Rules are evaluated against each telemetry message. Matches create persisted `Alert` documents. Device-originated alerts on `devices/<id>/alerts` are persisted too. Alerts can be listed and acknowledged. (Original: "alert rules engine with threshold-based notifications".)
9. **Alert notifications.** New alerts are pushed to the dashboard over Socket.IO. If `alerts.webhookUrl` is set, each alert is also POSTed as JSON to that URL. (Original: "threshold-based notifications".)
10. **Firmware registry.** Firmware binaries are uploaded with `POST /api/firmware?version=&deviceType=` and an `application/octet-stream` body. The platform stores them on a volume, records size and MD5, lists them, and serves them for download. (Original: "firmware update distribution".)
11. **Firmware update distribution and tracking.** An update can target one device or roll out to every non-decommissioned device of a type. The platform publishes a `firmware_update` command with the URL and MD5, then records per-device progress (`pending → downloading → installing → success|failed`) from `devices/<id>/firmware`. When an update succeeds, `device.firmware` is set to the new version. (Original: "firmware update distribution and tracking".)
12. **RESTful API for third-party integrations.** All of the above is exposed as JSON over HTTP under `/api`, plus `/health`. (Original: "RESTful API".)
    Every `/api` route requires the operator API key as `Authorization: Bearer <key>` (constant-time compare, 401 otherwise). The key is generated at first start into `api.keyFile` (`/secrets/api_key` in the `secrets` volume), never committed and never logged. Dashboard Socket.IO connections must present the same key; the dashboard prompts for it and keeps it in `sessionStorage` only.
13. **Device-fleet simulator.** `bin/simulate-devices.js` starts N simulated devices. Each one self-provisions, publishes telemetry, answers commands and runs the firmware flow. The integration tests and the smoke demo both use it.

## Out of scope

| Original README item | Reason |
|---|---|
| "500+ devices managed" | This is a fabricated metric. The simulator can run any count, but the project claims no fleet size. |
| "Sub-second telemetry visualization" | Fabricated metric. The dashboard is live via Socket.IO, but latency is neither measured nor claimed. |
| "Onboarding reduced from hours to minutes" | Fabricated business metric. Provisioning is automated (feature 3) and nothing more is claimed. |
| "99.5% uptime / reliable delivery" | Fabricated metric. QoS 1 is used, but availability is not measured. |
| TLS on Mosquitto and HTTP, per-device broker accounts | Broker authentication and ACLs are in scope (see "Broker authentication" below), but all devices share one broker account and nothing is encrypted in transit. Certificates and per-device accounts add operational weight beyond a solo core. |
| Email and SMS notifications | These need an external SMTP or SMS provider. The webhook (feature 9) is the integration point. |
| Separate time-series telemetry store and long-term retention | Keeping the last 1000 embedded points per device is enough for charts at this scale. |
| Dashboard user accounts and roles | Not described in the original. One operator API key protects the REST API and the dashboard. |
| Multi-tenant or horizontally scaled deployment | One app container, one broker, one MongoDB. |
| Real hardware / embedded firmware | Replaced by the fleet simulator (feature 13). Firmware binaries are arbitrary blobs. |

### Broker authentication

Mosquitto runs with `allow_anonymous false`, a password file and an ACL (`docker/mosquitto/mosquitto.conf`, `docker/mosquitto/acl`). A one-shot `secrets` compose service (`docker/secrets/init.sh`, run in the `eclipse-mosquitto:1.4.8` image) creates random passwords for a `platform` and a `device` account and the provisioning key in the `secrets` volume on first start, and rebuilds the password file from them on every start. `app` and `mosquitto` start only after it has completed.

| Account | May publish | May receive |
|---|---|---|
| `platform` | `devices/+/provisioned`, `devices/+/commands` | `devices/#` |
| `device` (client ID = device ID) | `devices/<own id>/{register,telemetry,status,alerts,firmware}` | `devices/<own id>/{provisioned,commands}` |

Mosquitto 1.4 grants every SUBSCRIBE and applies `read` rules when it delivers, so a device that subscribes to `devices/+/provisioned` receives only its own replies.

## Architecture

```
  +-------------------------+        MQTT 3.1.1 (QoS 1)        +---------------------------+
  | Device-fleet simulator  | <------------------------------> | Mosquitto 1.4.8 (broker)  |
  | bin/simulate-devices.js |  devices/<id>/{register,         +-------------+-------------+
  | (N fake devices)        |   telemetry,status,alerts,                     |
  +-----------+-------------+   firmware} ->   <- commands,provisioned       |
              | HTTP GET firmware binary                                     |
              v                                                              v
  +---------------------------------------------------------------------------------------+
  | app (Node 4.3.1 on buildpack-deps:jessie)                                             |
  |  src/server.js  bootstrap: config, mongoose.connect, http server, Socket.IO           |
  |  src/app.js     Express app factory: body-parser, /api routes, /health, static public/ |
  |  src/mqtt_handler.js  subscribe, parse topic, auth token, dispatch                    |
  |     |-> src/lib/lifecycle.js   state transitions                                      |
  |     |-> src/lib/tokens.js      generate / hash / constant-time verify                 |
  |     |-> src/lib/rules.js       pure threshold evaluation + cooldown                   |
  |     |-> src/lib/alerts.js      persist Alert, emit socket 'alert', notifier           |
  |     |-> src/lib/notifier.js    webhook POST (http core module)                        |
  |     '-> src/lib/firmware.js    update state machine, rollout                          |
  |  src/lib/presence.js  interval sweeper -> offline                                     |
  |  src/routes/*.js      devices, rules, alerts, firmware, stats                         |
  +-----------+-------------------------------+-------------------------------------------+
              | mongoose 4.4.5                | Socket.IO 1.4.5
              v                               v
  +------------------------+      +--------------------------------------+
  | MongoDB 3.2.3 (wheezy) |      | Browser: React 0.14 dashboard        |
  | devices, rules, alerts,|      | public/js/bundle.js (browserify +    |
  | firmwares,             |      | babelify), Chart.js 1.0.2            |
  | firmwareupdates        |      +--------------------------------------+
  +------------------------+
  firmware binaries: /data/firmware volume
```

Telemetry data flow:

1. The device publishes `devices/d1/telemetry` with `{token, temperature, ...}`.
2. `mqtt_handler` parses the topic and JSON, looks up the device, and verifies the token. If verification fails the message is dropped and a counter goes up.
3. The lifecycle moves the device to `online`. `$push` with `$slice: -1000` appends the reading and `lastSeen` is set.
4. Socket.IO emits `telemetry` to room `device_d1`.
5. `rules.evaluate(enabledRules, device, reading, lastFired, now)` returns zero or more alerts. Each one is persisted, emitted as `alert`, and POSTed to the webhook if one is configured.

## Data model & interfaces

### Mongo collections (Mongoose 4 schemas)

**Device** (`src/models/device.js`, extends the existing schema)
```
deviceId: String, required, unique      name: String, required
type: enum sensor|actuator|gateway|controller (default sensor)
status: enum registered|online|offline|maintenance|decommissioned (default registered)
firmware: String       location: {building, floor, zone}     uptime: Number
telemetry: [{timestamp, temperature, humidity, pressure, battery}]  (capped at 1000 via $slice)
tags: [String]         metadata: Mixed        registeredAt: Date   lastSeen: Date
tokenHash: String (select: false)             provisionedBy: enum api|mqtt
timestamps: createdAt/updatedAt
indexes: {status:1}, {lastSeen:-1}
```

**Rule** (`src/models/rule.js`)
```
name: String, required     deviceId: String (optional)     deviceType: String (optional)
metric: enum temperature|humidity|pressure|battery
operator: enum gt|gte|lt|lte    threshold: Number, required
severity: enum info|warning|critical (default warning)
cooldownSec: Number (default 300)   enabled: Boolean (default true)
```
A rule must have `deviceId`, `deviceType` or neither (neither means all devices). It may not have both. This is enforced by a synchronous path validator on `deviceType`, so `validateSync` catches it.

**Alert** (`src/models/alert.js`)
```
deviceId, ruleId (ObjectId|null), source: enum rule|device, severity, message,
metric, value, threshold, acknowledged: Boolean (default false), acknowledgedAt, createdAt
index {createdAt:-1}, {acknowledged:1}
```

**Firmware** (`src/models/firmware.js`)
```
version: String, required    deviceType: String, required    (unique compound index)
filename, size: Number, md5: String, createdAt
```

**FirmwareUpdate** (`src/models/firmware_update.js`)
```
deviceId, version, state: enum pending|downloading|installing|success|failed,
error: String, history: [{state, at}], createdAt, updatedAt
```

### MQTT topics (JSON payloads, QoS 1)

| Topic | Direction | Payload |
|---|---|---|
| `devices/<id>/register` | device → platform | `{provisioningKey, name, type, firmware}` |
| `devices/<id>/provisioned` | platform → device | `{token}` or `{error}` |
| `devices/<id>/telemetry` | device → platform | `{token, temperature?, humidity?, pressure?, battery?}` |
| `devices/<id>/status` | device → platform | `{token, status?: online, firmware?, uptime?}` |
| `devices/<id>/alerts` | device → platform | `{token, severity?, message}` |
| `devices/<id>/firmware` | device → platform | `{token, updateId, state, error?}` |
| `devices/<id>/commands` | platform → device | `{commandId, command, payload, timestamp}`; for firmware: `command: "firmware_update", payload: {updateId, version, url, md5}` |

Device IDs must match `^[A-Za-z0-9_-]{1,64}$`. Any other ID is ignored. The regex is defined once, as `DEVICE_ID_RE` in `src/lib/ids.js`, and imported by the Device model, `src/lib/topics.js` and the routes.

### REST API (all JSON)

```
GET    /health                                   -> {status, uptime, mongodb, mqtt, rejectedMessages}
                                                    200 status "healthy" only when MongoDB and MQTT are
                                                    both connected, else 503 "degraded"; no key needed
GET    /api/stats                                -> {registered: n, online: n, ...}
GET    /api/devices?status=&type=                -> {devices: [...], count}
POST   /api/devices {deviceId,name,type,location?,tags?}  -> 201 {device, token}   409 if exists
GET    /api/devices/:id                          -> device (no telemetry, no tokenHash; `.select('-telemetry')`)
PUT    /api/devices/:id {name,location,tags,metadata,status?}  -> device  (whitelisted fields;
                                                    status only via valid lifecycle transition, else 409)
DELETE /api/devices/:id                          -> device (status decommissioned, token revoked)
GET    /api/devices/:id/telemetry?limit=100      -> {deviceId, telemetry: [...]}   (limit 1..1000)
POST   /api/devices/:id/commands {command,payload?}  -> 202 {commandId}  (503 if MQTT down)
GET    /api/rules            POST /api/rules     PUT /api/rules/:id     DELETE /api/rules/:id
GET    /api/alerts?acknowledged=&deviceId=&limit=   -> {alerts, count}
POST   /api/alerts/:id/ack                       -> alert
POST   /api/firmware?version=&deviceType=  (body: application/octet-stream, max 10 MB) -> 201 firmware
GET    /api/firmware                             -> {firmware: [...]}
GET    /firmware/:deviceType/:version.bin        -> binary download
POST   /api/devices/:id/firmware {version}       -> 202 FirmwareUpdate
POST   /api/firmware/:deviceType/:version/rollout -> 202 {updates: [...]}
GET    /api/firmware/updates?deviceId=&state=    -> {updates}
```
Every `/api` route needs `Authorization: Bearer <operator key>`; without it, or with a wrong key, the answer is `401 {error}` with `WWW-Authenticate: Bearer`, before the body is parsed. `/health` and `GET /firmware/...` are public. Validation errors return `400 {error}`. Missing resources return `404 {error}`.

### Socket.IO events

- Server to client:
  - `telemetry {deviceId, data}` goes to room `device_<id>`.
  - `status {deviceId, data}` is emitted once to everyone with `io.emit`. Clients filter by `deviceId`.
  - `alert {alert}` goes to everyone.
  - `firmware {update}` goes to everyone.
- The handshake must carry the operator key as the `apiKey` query parameter (or a Bearer `Authorization` header); otherwise the connection is refused with `error "Unauthorized"`.
- Client to server:
  - `subscribe_device id`
  - `unsubscribe_device id`
  - `send_command {deviceId, command, payload}`

### Configuration (`config` 1.19, `config/*.json`)

`default.json`:
```
server.port 3000
api.keyFile "/secrets/api_key"           (created with a random key when missing)
mongodb.uri mongodb://localhost:27017/iot-platform
mqtt.{host,port,username,password,passwordFile}
provisioning.{key "", keyFile ""}        (empty key: every self-registration is refused)
presence.{offlineAfterSec 120, sweepIntervalSec 30}
telemetry.maxPoints 1000
alerts.webhookUrl ""
firmware.dir "/data/firmware"
firmware.publicBaseUrl "http://app:3000"
```

Other config files:

- `test.json` points at the compose service names, the platform broker account (`/secrets/mqtt_platform_password`), a temporary API key file and a temporary firmware directory.
- `custom-environment-variables.json` maps these environment variables: `API_KEY_FILE`, `MONGO_URI`, `MQTT_HOST`, `MQTT_PORT`, `MQTT_USERNAME`, `MQTT_PASSWORD_FILE`, `PROVISIONING_KEY`, `PROVISIONING_KEY_FILE`, `ALERT_WEBHOOK_URL`, `FIRMWARE_DIR` and `PUBLIC_BASE_URL`.
- Secrets are read from files; a configured file that is missing or empty stops the server at start. The webhook URL is only ever logged in redacted form (`scheme://host[:port]`, `<redacted>` for userinfo, path and query).

### CLI

```
node bin/simulate-devices.js --count 5 --prefix sim --interval 2000 \
     --mqtt mqtt://mosquitto:1883 --username device \
     --password-file /secrets/mqtt_device_password --key-file /secrets/provisioning_key \
     [--key KEY] [--duration 30] [--type sensor]
```
The broker password is only accepted from a file. Defaults come from `MQTT_DEVICE_USERNAME`, `MQTT_DEVICE_PASSWORD_FILE`, `PROVISIONING_KEY` and `PROVISIONING_KEY_FILE`. Each simulated device connects with its device ID as MQTT client ID, and abandons a firmware download above 10 MB or after 15 s in total.

## Stack & pinned versions

All npm pins pass `tools/check_period.py` (22 checked, 0 problems, period end 2016-02-29).

| Component | Version | Released | Why it was the popular choice then |
|---|---|---|---|
| Node.js | 4.3.1 (npm 2.14.12) | 2016-02-16 | First LTS line ("Argon"), the production default of late 2015 |
| express | 4.13.4 | 2016-01-22 | The de-facto Node web framework |
| body-parser | 1.15.0 | 2016-02-11 | Express 4 split out body parsing (`express.json()` did not exist until 4.16) |
| mongoose | 4.4.5 | 2016-02-24 | Standard MongoDB ODM for Node. 4.4 adds `timestamps` and supports MongoDB 3.2 |
| mqtt (MQTT.js) | 1.7.3 | 2016-02-27 | The dominant Node MQTT client |
| socket.io | 1.4.5 | 2016-01-26 | Standard real-time layer for Node dashboards |
| socket.io-client | 1.4.5 | 2016-01-26 | Matches the server |
| config | 1.19.0 | 2016-01-12 | Widely used hierarchical config, already in the repo |
| react / react-dom | 0.14.7 | 2016-01-28 | Current React. 0.14 split out `react-dom` |
| react-addons-test-utils | 0.14.7 | 2016-01-28 | Official React test utilities (shallow renderer) |
| chart.js | 1.0.2 | 2015-03-10 | The go-to lightweight canvas chart library of 2015 |
| whatwg-fetch | 0.11.0 | 2016-01-19 | GitHub's `fetch` polyfill, needed by the existing `App.jsx` |
| browserify | 13.0.0 | 2016-01-09 | Most common React bundler alongside webpack 1, and simpler |
| babelify | 7.2.0 | 2015-11-02 | Babel 6 transform for browserify |
| babel-core | 6.5.2 | 2016-02-12 | Babel 6 (released Oct 2015) compiles JSX |
| babel-preset-react | 6.5.0 | 2016-02-07 | JSX preset for Babel 6 |
| mocha | 2.4.5 | 2016-01-28 | The standard Node test runner |
| chai | 3.5.0 | 2016-01-28 | Assertion library paired with mocha |
| sinon | 1.17.3 | 2016-01-27 | Spies, stubs and fake timers |
| supertest | 1.2.0 | 2016-02-11 | HTTP assertions against Express apps |
| eslint | 1.10.3 | 2015-12-01 | The 1.x line was the norm until 2.0 in mid-Feb 2016 |
| eslint-plugin-react | 3.16.1 | 2016-01-24 | JSX lint rules compatible with eslint 1.x |
| MongoDB server | 3.2.3 | 2016-02-17 | 3.2 (Dec 2015) makes WiredTiger the default. The original README names MongoDB 3.2 |
| Mosquitto broker | 1.4.8 | 2016-02-14 | The reference open-source MQTT broker |

`nodemon` has been removed from the manifest because nothing uses it. Transitive dependencies are frozen with `npm-shrinkwrap.json`. T1 generates it with `npm install --before=2016-03-01` under a later npm (node:10 image, npm 6, lockfileVersion 1), so the whole tree resolves to period releases. Node 4.3.1's npm 2.14.12 then installs from it.

## Docker images

The official `node:4.3.1` and `mongo:3.2.3` tags (and `node:4.3`, `node:4.3.2`, `node:4.4.0`, `node:4.3.1-slim`, `mongo:3.2.4`, `mongo:3.2.5`) exist on Docker Hub but still serve schema-1 manifests (`application/vnd.docker.distribution.manifest.v1+prettyjws`), which current Docker cannot pull. So the app and mongo images are built from pullable Debian bases, with the period binaries installed from the official release archives. Every base tag below was checked on the Docker Hub API (`hub.docker.com/v2/repositories/library/<name>/tags/<tag>`, HTTP 200) and on the registry, where it serves a manifest list or a schema-2 manifest.

| Service | Image | Notes |
|---|---|---|
| app / test | built from `Dockerfile`, `FROM buildpack-deps:jessie` (manifest list) | The base already has xz. The build `ADD`s `https://nodejs.org/dist/v4.3.1/node-v4.3.1-linux-x64.tar.xz` (Node 4.3.1, released 2016-02-16, bundles npm 2.14.12) with `--checksum=sha256:1952d92af83b1bd7ffdb4735999f93a91e0d34ba1315ea1210f16f2e411125e4`, the value from the release's `SHASUMS256.txt`, and unpacks it into `/usr/local`. No apt calls are needed, because the jessie mirrors are archived |
| mongo | built from `docker/mongo/Dockerfile`, `FROM debian:wheezy` (manifest list) | The build `ADD`s `https://fastdl.mongodb.org/linux/mongodb-linux-x86_64-3.2.3.tgz` (MongoDB 3.2.3, released 2016-02-17) with `--checksum=sha256:7231498ba835e22095843e56d69d3b63f4645d3a434f36bb1ff7bbf4611c478f`, the value from MongoDB's published `.sha256`. It uses the generic Linux build, which needs only glibc, so wheezy needs no extra packages. It runs `mongod --bind_ip 0.0.0.0 --dbpath /data/db`. Replaces the candidate `mongo:3.0`: 3.2 is inside the period and is what the original README names |
| mosquitto | `eclipse-mosquitto:1.4.8` (schema 2) | `eclipse-mosquitto:1.4` returns 404, so 1.4.8 is the nearest period tag. The image was published later, but it packages Mosquitto 1.4.8 |
| secrets | `eclipse-mosquitto:1.4.8`, entrypoint `docker/secrets/init.sh` | One-shot job that uses the image's `mosquitto_passwd` and `hexdump` to create the broker passwords, the provisioning key and the password file in the `secrets` volume |

`ADD <url> --checksum` is fetched and verified by BuildKit on the host, so the old CA bundles inside jessie and wheezy never take part in TLS. It needs the Dockerfile 1.6 syntax, so both Dockerfiles start with `# syntax=docker/dockerfile:1.6`. The Node and MongoDB binaries are linux/x64 builds, so the Makefile exports `DOCKER_DEFAULT_PLATFORM=linux/amd64`.

## Simulated/mocked integrations

- **Physical IoT devices**: replaced by the **device-fleet simulator** (`src/sim/device.js`, `bin/simulate-devices.js`). It provisions over MQTT, publishes random-walk telemetry, answers commands and runs the firmware download → MD5 verify → report flow. No real hardware is used.
- **Firmware images**: arbitrary byte blobs that the tests and smoke script generate. Nothing is flashed.
- **Alert notification receiver**: the webhook target is a **local Node `http` stub server** that the tests start (`test/support/webhook_stub.js`). No third-party notification service is contacted.
- **MQTT client in unit tests**: a **FakeMqttClient** (EventEmitter with a recorded `publish`/`subscribe`, `test/support/fake_mqtt.js`). Integration tests use the real Mosquitto container.
- **Socket.IO in unit tests**: a **FakeIo** that records `io.emit` and `to(room).emit` calls (`test/support/fake_io.js`).

## Existing code inventory

All 9 files from `git ls-files`: keep 0, refactor 9, delete 0.

| File | Decision | Reason |
|---|---|---|
| `README.md` | refactor | Regenerated in the final task from `tools/readme_template.md`, with a Status section that matches the code |
| `config/default.json` | refactor | Keep its structure. Add `provisioning`, `presence`, `alerts`, `firmware` and `telemetry` sections |
| `docker-compose.yml` | refactor | Build mongo 3.2.3 from `docker/mongo/Dockerfile` (the official `mongo:3.2.3` tag cannot be pulled), pin `eclipse-mosquitto:1.4.8`, add a mosquitto config mount and the firmware volume, drop the unused 9001 port and the host port mappings for mongo and mosquitto (tests use service names), and add a Dockerfile for `build: .`, which is currently missing |
| `package.json` | refactor | Change caret ranges to exact period pins, add frontend, build and test deps, remove nodemon, and fix scripts (`test/` dir, `build`, `lint`) |
| `src/frontend/App.jsx` | refactor | Keep the createClass component, socket wiring and stats and device list. Convert to JSX, replace `forceUpdate` with real telemetry state, and add a detail/chart panel, an alerts feed and controls. Polyfill `fetch` |
| `src/models/device.js` | refactor | Keep the schema. Add `tokenHash` (select:false) and `provisionedBy`. The existing `timestamps: true` is valid in Mongoose 4.4 |
| `src/mqtt_handler.js` | refactor | Keep the constructor/prototype design and topic scheme. Inject dependencies, add token auth, validate IDs and payloads, route to lifecycle, rules and firmware, and add the provisioning reply |
| `src/routes/api.js` | refactor | Keep the list, detail, telemetry and stats handlers. Fix the mass-assignment `$set: req.body` with a field whitelist, clamp the telemetry `limit`, and split out rules, alerts and firmware routers |
| `src/server.js` | refactor | Split into `src/app.js` (testable factory) and `src/server.js` (bootstrap). Replace `express.json()`, which is missing in Express 4.13, with body-parser. Fix `mqttHandler` being referenced before assignment in `/health` |

## Test strategy

- **Runner**: mocha 2.4.5 with chai and sinon, inside the app image (Node 4.3.1 on `buildpack-deps:jessie`). `make test` first rebuilds the test image (`docker compose -f docker-compose.yml -f docker-compose.test.yml build test`) so it never runs stale code, then runs `docker compose -f docker-compose.yml -f docker-compose.test.yml run --rm test`, which runs `npm test` (mocha over `test/unit` and `test/integration`) with mongo and mosquitto up, then tears the stack down with `-v`. mongo and mosquitto publish no host ports; tests reach them by service name on the compose network. A root-level `before` hook in `test/support/root_hooks.js` waits for `mongo:27017` and `mosquitto:1883` before any suite runs. It is passed to mocha as the first spec path (`mocha test/support/root_hooks.js test/unit test/integration`), not with `--require`: in mocha 2.4.5, `--require` modules load before the bdd interface defines `before`, whereas a top-level `before` in a listed spec file becomes a root hook. `test:unit` leaves the file out.
- **Unit tests** (`test/unit`, no network):
  - `lifecycle` transitions
  - token generate, hash and verify
  - topic parsing and payload validation
  - the `rules.evaluate` truth table and cooldown
  - firmware state-machine transitions
  - presence sweeper, using sinon fake timers and a stubbed model
  - `mqtt_handler` dispatch, using FakeMqttClient and FakeIo with stubbed models
  - the notifier against the local webhook stub
  - the frontend telemetry→chart-data helper
  - the React components, rendered with `react-dom/server` `renderToStaticMarkup` and the TestUtils shallow renderer
  - Chart.js 1.0.2 is browser-only (it touches `window` at load time). It is `require`d lazily inside `DeviceDetail.componentDidMount` and is never loaded on the server render path used by the tests.
- **Integration tests** (`test/integration`, real MongoDB 3.2.3 and Mosquitto 1.4.8 containers):
  - service reachability
  - the REST API via supertest against a real DB (dropped per suite, then `ensureIndexes` rebuilt for every model so unique-index 409s still fire)
  - MQTT provisioning, telemetry and auth rejection through the real broker
  - rule → alert → webhook
  - firmware upload → rollout → two SimDevices download from the real `GET /firmware/:type/:version.bin` (app started in-process with `server.start({port: 0})`; with no `publicBaseUrl` and `port: 0`, `start` sets `firmwareService.baseUrl` to `http://localhost:<bound port>` in the listen callback, before it calls back) → MD5 check → both updates `success` (T14, `test/integration/simulator.test.js`)
  - an end-to-end run with `bin/simulate-devices.js`
- **Lint**: `make lint` runs eslint 1.10.3 inside the image. It is not part of `make test`.
- **Broker auth** (`test/integration/broker_auth.test.js`, real Mosquitto): anonymous and wrong-password clients are refused; a device account subscribed to `devices/+/provisioned` and `devices/#` receives nothing addressed to another device, while the addressed device does; a device's publishes to another device's topics are dropped; a refused platform password never appears in the platform's log output.
- **Smoke**: `make smoke` brings up the stack, checks that `/api/stats` refuses a request without the operator key, runs the simulator for 15 s, and asserts through `curl /api/stats` (key read from the app container and passed on stdin) that at least one device is online.

## Known limitations that will remain

- All devices share one broker account. A holder of the device password can connect with another device's ID as client ID, which disconnects that device and lets the impostor read its `provisioned` and `commands` topics. The per-device token is still required on every message the platform accepts.
- Nothing is encrypted in transit: MQTT and HTTP are plain TCP. The app port is published on `127.0.0.1` only.
- There is one operator API key and no user accounts or roles. Firmware downloads are public so devices can fetch them without it. The dashboard sends the key to Socket.IO as a query parameter.
- Only the last 1000 telemetry points per device are retained, embedded in the device document. There is no downsampling or long-term history.
- The only notification channel is a webhook. There is no email or SMS.
- Firmware binaries live on a local Docker volume, limited to 10 MB each. They are neither signed nor delta-encoded.
- Command delivery is QoS 1 fire-and-forget. Only firmware updates have tracked acknowledgements.
- The presence sweeper runs in-process, so it assumes a single app instance.
- Transitive npm dependencies are frozen by an `npm-shrinkwrap.json` resolved with `--before=2016-03-01`. It was generated by npm 6, and npm 2 might not honour every field. If it doesn't, T1 falls back to an npm 2 `npm shrinkwrap` taken from a known-good install.
- The images are linux/amd64 only. They run under emulation on ARM hosts.
