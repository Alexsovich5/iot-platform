# iot-platform — Implementation Plan

This plan implements `docs/SPEC.md` in 18 tasks, T1 to T18. Each task is exactly one commit and leaves `make test` green. The tasks are dependency-ordered.

Conventions used by every task:

- `make test` always rebuilds the test image first (`$(COMPOSE) -f docker-compose.yml -f docker-compose.test.yml build test`), then runs `$(COMPOSE) -f docker-compose.yml -f docker-compose.test.yml run --rm test` against the app image (Node 4.3.1 on `buildpack-deps:jessie`), the mongo image (MongoDB 3.2.3 on `debian:wheezy`, built from `docker/mongo/Dockerfile`) and `eclipse-mosquitto:1.4.8`, then runs `down -v`. The official `node:4.3.1` and `mongo:3.2.3` tags serve schema-1 manifests and cannot be pulled by current Docker, which is why those two images are built (see SPEC "Docker images"). The source is copied into the image at build time, so without the rebuild `run` would test the previous commit's code. `make test-unit` also rebuilds, then runs only `test/unit`, with no services. `make smoke` uses `up -d --build`.
- mongo and mosquitto publish no host ports. Tests reach them by service name on the compose network, so `make test` does not clash with a MongoDB or MQTT broker already running on the host.
- Every test that constructs an `MQTTHandler`, a `SimDevice` or a raw `mqtt` client closes it in its `after` hook (`handler.close(done)`). MQTT clientIds are built from `crypto.randomBytes(6).toString('hex')`, never `Date.now()`, so parallel clients never kick each other off the broker.
- Integration suites use `test/support/db.js`, which drops the test database and then calls `ensureIndexes` on every registered model, so unique-index conflicts (E11000) still occur. Handlers that return 409 on duplicates do an explicit `findOne` pre-check and keep E11000 only as the race fallback.
- Code is ES5 with `'use strict'`: `var`, prototypes and callbacks, as in the existing files. That is the Node 4 house style of the period. Arrow functions and `const` work in Node 4 strict mode but are not used. The browser code is compiled from JSX only.
- Write the tests first. Each task lists its red tests. The acceptance command must exit 0 before committing.

---

## T1 — Scaffold Docker, Makefile and test harness

**Goal:** From this commit on, `make test` builds the period image, starts mongo and mosquitto, and runs mocha.

**Files:**
- create `Dockerfile`: `# syntax=docker/dockerfile:1.6`, `FROM buildpack-deps:jessie`, `ADD --checksum=sha256:1952d92af83b1bd7ffdb4735999f93a91e0d34ba1315ea1210f16f2e411125e4 https://nodejs.org/dist/v4.3.1/node-v4.3.1-linux-x64.tar.xz /tmp/node.tar.xz` (checksum from the release's `SHASUMS256.txt`), `RUN tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1 && rm /tmp/node.tar.xz && node -v && npm -v`. No apt calls. Then `WORKDIR /usr/src/app`. Copy `package.json` and `npm-shrinkwrap.json`, run `npm install`, copy the source, `CMD ["npm","start"]`.
- create `docker-compose.test.yml`: a `test` service built from `.`, with `NODE_ENV=test`, `depends_on: [mongo, mosquitto]`, and command `npm test`. `depends_on` does not wait for readiness; the root hook below does.
- create `Makefile` with these targets: `build test test-unit lint up down smoke shrinkwrap`. It exports `DOCKER_DEFAULT_PLATFORM=linux/amd64`, and `COMPOSE ?= docker compose`. `test` and `test-unit` run `$(COMPOSE) -f docker-compose.yml -f docker-compose.test.yml build test` before `run --rm test`, and `test` always runs `down -v` afterwards. `smoke` uses `$(COMPOSE) up -d --build`.
- create `docker/mongo/Dockerfile`: `# syntax=docker/dockerfile:1.6`, `FROM debian:wheezy`, `ADD --checksum=sha256:7231498ba835e22095843e56d69d3b63f4645d3a434f36bb1ff7bbf4611c478f https://fastdl.mongodb.org/linux/mongodb-linux-x86_64-3.2.3.tgz /tmp/mongo.tgz`, `RUN tar -xzf /tmp/mongo.tgz -C /usr/local --strip-components=1 && rm /tmp/mongo.tgz && mkdir -p /data/db`, `EXPOSE 27017`, `CMD ["mongod","--bind_ip","0.0.0.0","--dbpath","/data/db"]`.
- create `docker/mosquitto/mosquitto.conf`: `listener 1883`, `allow_anonymous true`, `persistence false`, `log_dest stdout`.
- create `.dockerignore` (node_modules, .git, public/js/bundle.js), `.gitignore` (node_modules, public/js/bundle.js, *.log) and `.eslintrc` (eslint 1.x, env node/mocha, plugin react).
- create `test/mocha.opts` (`--recursive --timeout 10000 --reporter spec`, no `--require` of the root hooks), `test/support/wait_for.js` (retry helper for TCP ports) and `test/support/root_hooks.js`: a top-level `before` that waits up to 30 s for TCP on `mongo:27017` and `mosquitto:1883`. It is loaded as the first spec path in the `test` script, not with `--require`: in mocha 2.4.5, `bin/_mocha` loads `--require` modules before `loadFiles` emits `pre-require`, which is where the bdd interface defines `before`, so a required file would throw `ReferenceError: before is not defined`. A top-level `before` in a listed spec file is a root hook, and mocha loads listed files in order, so it runs before any suite and alphabetical file order no longer matters. `test:unit` does not list it; it also keeps a `SKIP_SERVICES=1` guard as a safety net.
- create `test/unit/sanity.test.js` and `test/integration/services.test.js`.
- create `config/test.json`: mongo `mongodb://mongo:27017/iot-platform-test`, mqtt host `mosquitto`.
- create `npm-shrinkwrap.json`. `make shrinkwrap` runs `node:10` (a manifest list, pullable) with `npm install --before=2016-03-01 --package-lock-only` and then `npm shrinkwrap`. Confirm that `npm install` in the app image (npm 2.14.12) accepts it. If it doesn't, install inside the app image (`docker compose run --rm test npm install`) and run npm 2's `npm shrinkwrap` instead.
- modify `package.json`:
  - Set exact pins from SPEC ("Stack & pinned versions") and remove nodemon.
  - Set `"engines": {"node": "4.3.1"}`.
  - Scripts: `start`, `test` (`mocha test/support/root_hooks.js test/unit test/integration`), `test:unit` (`SKIP_SERVICES=1 mocha test/unit`), `lint` (`eslint src bin test`) and `build` (a placeholder until T15, `echo no bundle yet`).
- modify `docker-compose.yml`:
  - Replace the mongo `image:` with `build: docker/mongo` (MongoDB 3.2.3 on `debian:wheezy`) and pin `eclipse-mosquitto:1.4.8`.
  - Mount `docker/mosquitto/mosquitto.conf` to `/mosquitto/config/mosquitto.conf`.
  - Drop port 9001, and drop the host port mappings `27017:27017` and `1883:1883` (anyone who wants host access can add them in an untracked `docker-compose.override.yml`).
  - Add environment variables `MONGO_URI=mongodb://mongo:27017/iot-platform` and `MQTT_HOST=mosquitto`.
  - Set the top-level `name: iot-platform` (the obsolete `version:` key is dropped), tag the built images `iot-platform:app`, `iot-platform:mongo` and `iot-platform:test`, publish the app on host port `21000:3000` instead of `3000:3000`, and pin the default network to subnet `172.50.0.0/24`, so the stack does not collide with other compose projects on the same Docker host.

**Tests to write first:**
- `sanity.test.js`: `process.version` equals `v4.3.1`. Every pinned dependency in `package.json` resolves with `require.resolve`.
- `services.test.js`: after the root hook, a TCP connect to `mongo:27017` and to `mosquitto:1883` succeeds. A `mqtt.connect` round-trip (random clientId, client closed in `after`) publish/subscribe on `test/ping` receives its message.

**Acceptance command:** `make test`

**Commit message:**
```
Add Docker test harness with pinned period dependencies

Pin every npm dependency exactly and freeze the tree with a shrinkwrap.
make test now runs mocha on Node 4.3.1 against MongoDB 3.2 and Mosquitto,
with Node and MongoDB installed from checksummed release archives.
```

---

## T2 — Split server into testable app factory

**Goal:** Build the Express app in `src/app.js` without side effects, and move all bootstrap work to `src/server.js`. Fix the Express 4.13 incompatibility.

**Files:**
- create `src/app.js`: `createApp({mqttHandler, stats})` returns an Express app. It sets up `body-parser.json({limit:'100kb'})`, `express.static(path.join(__dirname,'..','public'))`, `/api` routes, `/health` and a JSON 404/500 handler.
- modify `src/server.js`:
  - config, `mongoose.connect`, `http.createServer(createApp(...))`, Socket.IO setup, MQTT handler setup and `listen`.
  - Declare `mqttHandler` before the app uses it.
  - Export `{start}`, and call it only when `require.main === module`. `start(opts, cb)` accepts overrides `{port, mongoUri, mqtt, publicBaseUrl, webhookUrl}`. `port: 0` binds an ephemeral port. The public base URL is resolved in the `listen` callback, before `start` calls back: `opts.publicBaseUrl` if given; otherwise `'http://localhost:' + server.address().port` when `opts.port === 0`; otherwise config `firmware.publicBaseUrl`. The result is returned as `baseUrl` (T13 also assigns it to `firmwareService.baseUrl` at that point). It skips `mongoose.connect` when `mongoose.connection.readyState !== 0`, so it can run in a mocha process that is already connected (Mongoose 4 throws 'Trying to open unclosed connection.' on a second connect). It calls back with `{server, port, baseUrl, mqttHandler, close}`, and `close(cb)` stops the presence sweeper, closes the MQTT handler and the HTTP server but leaves a reused mongoose connection open.
- create `config/custom-environment-variables.json` covering `MONGO_URI`, `MQTT_HOST`, `MQTT_PORT`, `PROVISIONING_KEY`, `ALERT_WEBHOOK_URL`, `FIRMWARE_DIR` and `PUBLIC_BASE_URL`.
- modify `config/default.json` to add the `provisioning`, `presence`, `telemetry`, `alerts` and `firmware` sections from SPEC.
- create `public/index.html`: a minimal page with a `#root` div and `<script src="/js/bundle.js">`.

**Tests to write first:**
- `test/unit/app.test.js` (supertest, stub `mqttHandler.isConnected`):
  - `GET /health` returns 200 with keys `status, uptime, mongodb, mqtt, rejectedMessages`.
  - An unknown `/api/nope` returns a 404 JSON body.
- `test/integration/server_start.test.js`: `server.start({port: 0}, cb)` calls back with a non-zero `port` and `baseUrl === 'http://localhost:' + port`; `server.start({port: 0, publicBaseUrl: 'http://example.test'}, cb)` keeps the override. Both call `close` in `after`.
  - A malformed JSON body returns 400 JSON.

**Acceptance command:** `make test`

**Commit message:**
```
Split Express app factory out of server bootstrap

Replace express.json (absent in Express 4.13) with body-parser and make
the app constructible in tests without Mongo or MQTT side effects.
```

---

## T3 — Add device lifecycle rules and extend Device model

**Goal:** Put all state transitions in one pure module, and give the model the fields that provisioning and auth need.

**Files:**
- create `src/lib/ids.js`: exports `DEVICE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/`. This is the only definition of the device-ID regex.
- create `src/lib/lifecycle.js`:
  - `canTransition(from, to)`
  - `nextStatusOnTraffic(current)`: registered, offline and online all become online. maintenance and decommissioned are unchanged.
  - `STATUSES`
- modify `src/models/device.js`:
  - Add `tokenHash {type:String, select:false}` and `provisionedBy {enum:['api','mqtt']}`.
  - Use `require('../lib/ids').DEVICE_ID_RE` as the `deviceId` `match` validator (no second copy of the regex), and add a `toJSON` transform that strips `tokenHash` and `__v`.

**Tests to write first:**
- `test/unit/lifecycle.test.js`: a full transition truth table. For example, decommissioned → anything is false, and maintenance → online is false via traffic but true via the operator path to `offline`/`online`.
- `test/unit/device_model.test.js` (`validateSync`, no DB):
  - A missing `name` fails.
  - A bad `type` or `status` enum fails.
  - `toJSON` omits `tokenHash`.

**Acceptance command:** `make test`

**Commit message:**
```
Add device lifecycle module and provisioning fields

Centralise status transitions in a pure module and store a hashed
device token on the Device model, hidden from JSON output.
```

---

## T4 — Add device token generation and verification

**Goal:** Implement device credentials that are safe to store and verify on Node 4, which has no `crypto.timingSafeEqual`.

**Files:**
- create `src/lib/tokens.js`:
  - `generate()` returns 32 hex chars from `crypto.randomBytes(16)`.
  - `hash(token)` returns a sha256 hex digest.
  - `verify(token, tokenHash)` uses a manual constant-time compare and returns false for non-string input.

**Tests to write first:**
- `test/unit/tokens.test.js`:
  - `generate` has the right format and does not collide over 1000 runs.
  - `verify` returns true for the matching token, false for a wrong token, a length mismatch, `undefined` or a missing hash.

**Acceptance command:** `make test`

**Commit message:**
```
Add device token generation and constant-time verification

Tokens are random 128-bit values stored only as SHA-256 hashes; the
comparison avoids early exit since Node 4 lacks timingSafeEqual.
```

---

## T5 — Harden device REST API and add operator provisioning

**Goal:** Extend the existing device routes with provisioning, safe updates and decommissioning.

**Files:**
- modify `src/routes/api.js`:
  - Keep the list, detail and stats handlers, and move the device handlers into `src/routes/devices.js`. `api.js` becomes the router aggregator.
  - Change the detail handler to `.select('-telemetry')` so it no longer returns the embedded telemetry array.
  - Add `POST /devices`, which returns 201 `{device, token}`. It does a `Device.findOne({deviceId})` pre-check and returns 409 if the device exists; E11000 from the unique index is kept as the race fallback and also mapped to 409.
  - `PUT` whitelists `name, location, tags, metadata, status`. A status change goes through `lifecycle.canTransition`, with 409 on an invalid transition.
  - Add `DELETE` for decommission, which unsets `tokenHash`.
  - The telemetry `limit` is clamped to 1..1000.
  - Validate `deviceId` against `DEVICE_ID_RE` from `src/lib/ids.js` and return 400 on failure.
- create `src/routes/devices.js`.
- create `test/support/db.js`: connect mongoose to the test URI (only if `mongoose.connection.readyState === 0`) and, before each suite, drop the database and then call `Model.ensureIndexes(cb)` for every registered model (`mongoose.modelNames()`: Device now, and Rule, Alert, Firmware, FirmwareUpdate as later tasks add them). Without this, Mongoose 4 builds indexes only once at model init and the unique indexes disappear after the drop.

**Tests to write first:**
- `test/integration/devices_api.test.js` (supertest against the real Mongo):
  - A create returns a 32-hex token and the stored document has `tokenHash`.
  - A duplicate returns 409.
  - After `db.reset()` the unique index on `deviceId` still exists (`Device.collection.indexInformation`), and a direct `Device.create` of a duplicate raises E11000.
  - `GET /api/devices/:id` has no `telemetry` and no `tokenHash` key.
  - `PUT {telemetry: [], tokenHash: 'x'}` ignores the non-whitelisted fields.
  - `PUT status: decommissioned → online` returns 409.
  - `DELETE` makes a subsequent `GET` show `decommissioned`.
  - Filters on `?status=` and `?type=` work.
  - `/api/stats` counts devices by status.
  - `limit=5000` returns at most 1000 points.

**Acceptance command:** `make test`

**Commit message:**
```
Add operator provisioning and harden device REST API

POST /api/devices returns a one-time token, updates are limited to a
field whitelist with lifecycle checks, and DELETE decommissions.
```

---

## T6 — Authenticate and route MQTT messages with injected dependencies

**Goal:** Make the MQTT handler testable and secure, and add self-provisioning over MQTT.

**Files:**
- create `src/lib/topics.js`: `parse(topic)` returns `{deviceId, type}` or null, using `DEVICE_ID_RE` from `src/lib/ids.js` and an allowed type list. It also has `commandTopic(id)` and `provisionedTopic(id)`.
- modify `src/mqtt_handler.js`:
  - The constructor becomes `MQTTHandler(config, io, deps)`, where deps is `{Device, mqtt, provisioningKey, onTelemetry}`. It defaults to the real modules.
  - Subscribe to `register`, `telemetry`, `status`, `alerts` and `firmware`.
  - `_authenticate(deviceId, token, cb)` loads the device with `+tokenHash`, rejects decommissioned devices, and increments `rejectedCount` on failure.
  - Registration checks the provisioning key, creates the device with `provisionedBy:'mqtt'`, and publishes `{token}` or `{error}` to `devices/<id>/provisioned`.
  - Telemetry and status apply `lifecycle.nextStatusOnTraffic`, and telemetry uses `$slice: -config telemetry.maxPoints`.
  - `sendCommand` returns a `commandId` and errors when the handler is disconnected.
  - `stats()` returns `{rejectedMessages}` for `/health`.
  - The MQTT clientId is `'iot-platform-' + crypto.randomBytes(6).toString('hex')`, and `close(cb)` ends the client (`client.end(false, cb)`).
- create `test/support/fake_mqtt.js` and `test/support/fake_io.js`.
- modify `src/server.js` to wire in `provisioningKey` and to pass `mqttHandler.stats` to `/health`.

**Tests to write first:**
- `test/unit/topics.test.js`: valid and invalid topics, IDs containing `/`, `+` or `#`, and over-long IDs.
- `test/unit/mqtt_handler.test.js` (FakeMqttClient, FakeIo, sinon-stubbed Device):
  - Non-JSON input is dropped.
  - A bad token is dropped, `rejectedCount` increments and nothing is emitted.
  - A valid telemetry message calls `findOneAndUpdate` with `$push/$slice` and emits to room `device_<id>`.
  - Registration with the wrong key publishes `{error}`.
  - Registration with the right key publishes a token.
- `test/integration/mqtt_flow.test.js` (real broker and Mongo):
  - A client registers over MQTT, receives its token, and publishes telemetry.
  - The telemetry appears in `GET /api/devices/:id/telemetry` and the status is `online`.
  - A publish with a wrong token does not change the DB.
  - A second `register` for the same ID is rejected with `{error}` (relies on the pre-check and on the index rebuilt by `db.js`).
  - The suite's `MQTTHandler` and raw clients are closed in `after`.

**Acceptance command:** `make test`

**Commit message:**
```
Authenticate device MQTT messages and add self-provisioning

Every inbound message is checked against the device token hash; devices
can register with the shared provisioning key and receive a token.
```

---

## T7 — Mark silent devices offline with a presence sweeper

**Goal:** Change devices from online to offline when `lastSeen` is older than `offlineAfterSec`, and notify the dashboard.

**Files:**
- create `src/lib/presence.js`: `Presence({Device, io, offlineAfterSec, intervalSec})` with `start()`, `stop()` and `sweep(cb)`. `sweep` runs `updateMany`-style `Device.update({status:'online', lastSeen:{$lt: cutoff}}, {$set:{status:'offline'}}, {multi:true})`, emits one `status` event per affected ID with `io.emit` (IDs found first), and calls back with the count.
- modify `src/server.js` to start the presence sweeper after Mongo connects.

**Tests to write first:**
- `test/unit/presence.test.js` (sinon fake timers, stubbed Device): `start` triggers a sweep every interval, the cutoff is computed from `now - offlineAfterSec`, and `stop` clears the timer.
- `test/integration/presence.test.js`: seed one online device with `lastSeen` 10 min ago and one with `lastSeen` now. After `sweep`, only the first is offline.

**Acceptance command:** `make test`

**Commit message:**
```
Mark silent devices offline with a presence sweeper

A periodic sweep flips online devices whose lastSeen exceeds the
configured threshold to offline and pushes the change to dashboards.
```

---

## T8 — Expose command dispatch over REST and Socket.IO

**Goal:** Let operators and third-party integrations send commands to devices.

**Files:**
- modify `src/routes/devices.js`: `POST /devices/:id/commands {command, payload}`. `command` must match `^[a-z_]{1,32}$`. It returns 404 for an unknown device, 409 if the device is decommissioned, 503 if MQTT is disconnected, and otherwise 202 `{commandId}`.
- create `src/socket.js`: `attach(io, mqttHandler, Device)`. It moves the connection handlers out of `server.js`, validates `send_command` the same way, adds `unsubscribe_device`, and acks errors back to the client.
- modify `src/server.js` to use `socket.attach`.

**Tests to write first:**
- `test/unit/socket.test.js`: a fake socket's `send_command` with an invalid command does not call `sendCommand`. `subscribe_device` joins the room.
- `test/integration/commands.test.js`: subscribe a real MQTT client to `devices/c1/commands`, POST a command, and receive `{commandId, command:'reboot'}`. A decommissioned device returns 409.

**Acceptance command:** `make test`

**Commit message:**
```
Expose device command dispatch over REST and Socket.IO

Commands are validated, given an id and published to the device's
commands topic with QoS 1; decommissioned devices are refused.
```

---

## T9 — Implement threshold alert rules engine

**Goal:** Write a pure, fully unit-tested rule evaluation.

**Files:**
- create `src/models/rule.js` and `src/models/alert.js` (SPEC schemas). The one-scope check is a synchronous path validator on `deviceType`: `validate: {validator: function (v) { return !(v && this.deviceId); }, message: 'deviceId and deviceType are mutually exclusive'}`. It is not a `pre('validate')` hook, because Mongoose 4.4 `validateSync` runs only synchronous path validators and never runs middleware.
- create `src/lib/rules.js`:
  - `matchesScope(rule, device)`
  - `compare(op, value, threshold)`
  - `evaluate(rules, device, reading, lastFiredMap, now)` returns an array of `{rule, value}`. It skips disabled rules, missing metrics and rules still in their cooldown.
  - `formatMessage(rule, device, value)`

**Tests to write first:**
- `test/unit/rules.test.js`:
  - A table covering each operator at the boundary (e.g. `gt` at equality is false, `gte` is true).
  - Scope by `deviceId`, by `deviceType` and global.
  - A disabled rule is skipped.
  - A metric absent from the reading is skipped.
  - A rule inside its cooldown is suppressed, and fires again after the cooldown.
  - Multiple rules can fire together.
- `test/unit/rule_model.test.js`: `validateSync` rejects a bad operator and rejects having both scopes.

**Acceptance command:** `make test`

**Commit message:**
```
Add threshold alert rules engine and alert models

Rules scope to a device, a device type or all devices, compare one
metric against a threshold, and respect a per-rule cooldown.
```

---

## T10 — Wire rules into telemetry and add rules/alerts API

**Goal:** Make telemetry produce persisted alerts, pushed live. Persist device-originated alerts too, and allow acknowledging them.

**Files:**
- create `src/lib/alerts.js`: `AlertService({Alert, Rule, io, notifier})`.
  - `onTelemetry(device, reading, cb)` loads enabled rules (cached for 10 s; `invalidateRules()` clears the cache), evaluates them with an in-memory `lastFired` map, persists matches and emits `alert`.
  - `fromDevice(deviceId, payload, cb)` persists alerts with `source:'device'`.
- modify `src/mqtt_handler.js`: telemetry calls `deps.alerts.onTelemetry` after it saves, and `_handleAlert` calls `alerts.fromDevice`, replacing the emit-only behaviour.
- create `src/routes/rules.js` (CRUD with validation errors as 400; every successful create, update and delete calls `alertService.invalidateRules()`) and `src/routes/alerts.js` (list with filters, `POST /:id/ack`).
- modify `src/routes/api.js` to mount them, and `src/server.js` to construct AlertService.

**Tests to write first:**
- `test/unit/alerts_service.test.js` (stubs): two telemetry messages within the cooldown create one alert, and each created alert triggers an `io.emit('alert')`. After `invalidateRules()`, the next `onTelemetry` calls `Rule.find` again instead of using the cached set.
- `test/unit/rules_routes.test.js` (supertest with a stubbed Rule model and a spy AlertService): `POST`, `PUT` and `DELETE /api/rules` each call `invalidateRules` once.
- `test/integration/alerts_flow.test.js`:
  - Construct the app and `AlertService` in the test with injected dependencies (the suite closes its `MQTTHandler` in `after`).
  - Create the rule `temperature gt 30` via the API.
  - Provision a device and publish `temperature: 35` over MQTT.
  - `GET /api/alerts` shows one unacknowledged alert.
  - Ack it, and it shows `acknowledged:true`.
  - A device publish on `alerts` creates a `source:'device'` alert.
  - `POST /api/rules` with both scopes returns 400.

**Acceptance command:** `make test`

**Commit message:**
```
Persist rule and device alerts and add rules/alerts API

Telemetry is evaluated against enabled rules; matches and device-sent
alerts are stored, pushed to dashboards and can be acknowledged.
```

---

## T11 — Send alert notifications to a webhook

**Goal:** Add an optional outbound notification for each new alert.

**Files:**
- create `src/lib/notifier.js`: `Notifier({url, timeoutMs})`. `notify(alert, cb)` POSTs JSON with the `http`/`https` core modules and a 5 s timeout. It never throws, it logs non-2xx responses, and it is a no-op when `url` is empty.
- create `test/support/webhook_stub.js`: a local `http.createServer` that records requests and can be told to return 500 or to hang.
- modify `src/lib/alerts.js` to call `notifier.notify` after it saves an alert, and `src/server.js` to build the Notifier from `alerts.webhookUrl`.

**Tests to write first:**
- `test/unit/notifier.test.js` (against the stub):
  - The body and `Content-Type` are correct.
  - An empty URL makes no request.
  - A 500 response calls back with an error but does not throw.
  - A hanging stub times out.
- Extend `alerts_flow.test.js`: construct `Notifier({url: stub.url})` and pass it to `AlertService` directly (dependency injection). The `config` module reads environment variables once and is frozen after the first `get`, so setting `ALERT_WEBHOOK_URL` inside mocha would have no effect. A fired rule produces one webhook request.

**Acceptance command:** `make test`

**Commit message:**
```
Send alert notifications to an optional webhook

Each new alert is POSTed as JSON to alerts.webhookUrl with a timeout;
failures are logged and never block alert persistence.
```

---

## T12 — Add firmware registry with upload and download

**Goal:** Store firmware binaries per device type and version, with integrity metadata.

**Files:**
- create `src/models/firmware.js`.
- create `src/routes/firmware.js`:
  - `POST /api/firmware?version=&deviceType=` uses `bodyParser.raw({type:'application/octet-stream', limit:'10mb'})`. It validates the version (`^\d+\.\d+\.\d+$`) and the device type, writes `<dir>/<type>/<version>.bin`, computes the md5, and saves the metadata. Duplicates return 409 via a `Firmware.findOne({version, deviceType})` pre-check, with E11000 on the compound unique index as the race fallback.
  - `GET /api/firmware` lists the registry.
- modify `src/app.js` to add `GET /firmware/:deviceType/:version.bin`, which streams the file with a 404 if it is missing.
- modify `docker-compose.yml` to add a `firmware_data` volume at `/data/firmware`. `config/test.json` uses `/tmp/firmware-test`.

**Tests to write first:**
- `test/integration/firmware_registry.test.js`:
  - Upload 1 KB of random bytes. The response md5 equals the locally computed one, the download is byte-identical, and a duplicate returns 409.
  - A bad version returns 400.
  - A wrong content-type returns 415 or 400.
  - An 11 MB body returns 413.

**Acceptance command:** `make test`

**Commit message:**
```
Add firmware registry with upload, listing and download

Binaries are stored per device type and version on a volume with size
and MD5 recorded so devices can verify what they download.
```

---

## T13 — Distribute firmware updates and track progress

**Goal:** Push firmware to one device or a whole device type, and follow each update to success or failure.

**Files:**
- create `src/models/firmware_update.js`.
- create `src/lib/firmware.js`:
  - `canAdvance(from, to)` enforces the order `pending → downloading → installing → success|failed`. `failed` is reachable from any non-terminal state.
  - `FirmwareService({FirmwareUpdate, Device, mqttHandler, io, baseUrl})`. `baseUrl` is injected and stored as the public property `this.baseUrl`, not read from the frozen config inside the module. `src/server.js` constructs the service before `listen` with any known value, then in the `listen` callback sets `firmwareService.baseUrl` to the base URL resolved as in T2 (so with `port: 0` and no `publicBaseUrl` it becomes `http://localhost:<bound port>`) before `start` calls back.
  - `startUpdate(device, firmware, cb)` creates the record and publishes a `firmware_update` command whose URL is `this.baseUrl + '/firmware/<type>/<version>.bin'`, read at call time, so a later assignment takes effect.
  - `rollout(deviceType, version, cb)` targets all non-decommissioned devices of that type that are not already on that version.
  - `handleProgress(deviceId, payload, cb)` validates the transition, appends to `history`, sets `device.firmware` on success, and emits `firmware`.
- modify `src/routes/firmware.js`: add `POST /api/devices/:id/firmware`, `POST /api/firmware/:deviceType/:version/rollout` and `GET /api/firmware/updates`.
- modify `src/mqtt_handler.js` to route `devices/+/firmware` (authenticated) to `firmware.handleProgress`.

**Tests to write first:**
- `test/unit/firmware.test.js`: a transition table in which success → downloading is rejected, updateIds that don't belong to the device are rejected, and the command payload contains the url and md5. After `service.baseUrl = 'http://localhost:4567'` is assigned post-construction, the next command URL starts with `http://localhost:4567/firmware/`.
- `test/integration/firmware_rollout.test.js`:
  - Upload firmware, provision three sensors, and decommission one.
  - Rollout creates two updates.
  - A raw MQTT client plays the device and publishes downloading, installing, success.
  - `device.firmware` equals the new version and the update history has four entries.

**Acceptance command:** `make test`

**Commit message:**
```
Distribute firmware updates and track per-device progress

Updates target one device or roll out to a device type; devices report
progress over MQTT and a successful install updates the device record.
```

---

## T14 — Add device-fleet simulator

**Goal:** Replace physical hardware with simulated devices that the tests and demo can use.

**Files:**
- create `src/sim/device.js`: `SimDevice({id, type, mqttUrl, provisioningKey, intervalMs, random})` with `start(cb)` and `stop(cb)`.
  - `start` connects, registers, waits for `provisioned`, then publishes `status {status:'online', firmware:'1.0.0'}` and random-walk telemetry every interval.
  - On `firmware_update` it downloads the url over `http`, compares the MD5, reports `downloading → installing → success|failed`, and bumps its firmware.
  - On `reboot` it republishes its status.
  - The random source is injectable.
- create `bin/simulate-devices.js`: parses argv by hand (no extra dependency), with flags `--count --prefix --interval --mqtt --key --duration --type`, and stops cleanly on SIGINT.
- modify `package.json` to add the `"simulate": "node bin/simulate-devices.js"` script.

**Tests to write first:**
- `test/unit/sim_device.test.js` (FakeMqttClient, seeded random, local HTTP stub serving firmware): the random walk stays inside its bounds, telemetry carries the token, and an md5 mismatch reports `failed`.
- `test/integration/simulator.test.js`: start the app in-process with `server.start({port: 0}, cb)` and no `publicBaseUrl`. `start` sets `firmwareService.baseUrl` to `http://localhost:<bound port>` in its listen callback (T2, T13), so the result's `baseUrl` equals `'http://localhost:' + port`. Then start two SimDevices against the real broker.
  - Within 10 s, both are `online` via the API and have at least 2 telemetry points.
  - Upload a firmware blob via `POST /api/firmware`, roll it out to the device type, and assert that both SimDevices download it from the platform's real `GET /firmware/:type/:version.bin`, that the rollout command URL starts with `'http://localhost:' + port + '/firmware/'`, that both pass the MD5 check, and that both FirmwareUpdates reach `success` with `device.firmware` equal to the new version.
  - `after` stops both SimDevices and calls the server's `close`.

**Acceptance command:** `make test`

**Commit message:**
```
Add device-fleet simulator for tests and demos

Simulated devices self-provision, publish random-walk telemetry, answer
commands and run the firmware download, verify and report flow.
```

---

## T15 — Build the React dashboard bundle with browserify

**Goal:** Compile the existing `App.jsx` into a served bundle, converting it to JSX while keeping its createClass structure.

**Files:**
- modify `src/frontend/App.jsx`:
  - Convert `React.createElement` calls to JSX.
  - `require('whatwg-fetch')`.
  - Keep `getInitialState`, the socket wiring, `fetchDevices`, `fetchStats` and `selectDevice`.
  - Replace `forceUpdate` with a `liveTelemetry` state that appends readings for the selected device.
  - Add status and type filter selects.
- create `src/frontend/index.jsx`: `ReactDOM.render(<App/>, document.getElementById('root'))`.
- create `src/frontend/components/StatsBar.jsx` and `src/frontend/components/DeviceList.jsx`, extracted from `App.render`.
- create `.babelrc` (`{"presets":["react"]}`) and `public/css/dashboard.css` (plain CSS, no framework).
- modify `package.json` so that `"build": "browserify src/frontend/index.jsx --extension=.jsx -t babelify -o public/js/bundle.js"`, and so that `test` becomes `mocha --require test/setup-babel.js test/support/root_hooks.js test/unit test/integration` and `test:unit` becomes `SKIP_SERVICES=1 mocha --require test/setup-babel.js test/unit` (`--require` is safe here because `setup-babel.js` uses no mocha globals). `test/setup-babel.js` is `require('babel-core/register')({presets: ['react'], only: /(src\/frontend|test\/unit\/frontend)/, extensions: ['.js', '.jsx']})`, so JSX inside `test/unit/frontend/*.test.js` compiles too.
- modify `Dockerfile` to run `npm run build` after the source is copied.
- modify `public/index.html` to link the CSS.

**Tests to write first:**
- `test/unit/frontend/stats_bar.test.js`: `renderToStaticMarkup(<StatsBar stats={{online:2}}/>)` contains `online` and `2`.
- `test/unit/frontend/device_list.test.js`: rendering two devices gives two `.device-card` elements with the status class, and the TestUtils shallow renderer's onClick calls `onSelect(id)`.
- `test/integration/static.test.js`: `GET /` returns index.html and `GET /js/bundle.js` returns 200 with non-trivial size (the bundle is built in the image).

**Acceptance command:** `make build && make test`

**Commit message:**
```
Build React dashboard bundle with browserify and babelify

Convert App.jsx to JSX, extract stats and device list components and
serve the compiled bundle from Express.
```

---

## T16 — Add dashboard detail chart, alerts feed and controls

**Goal:** Add the rest of the dashboard: historical and live chart, alerts with acknowledge, and command and firmware controls.

**Files:**
- create `src/frontend/lib/chart_data.js`: `toLineData(points, metric, maxPoints)` returns Chart.js 1.x `{labels, datasets}`. `appendPoint(points, point, max)` returns a new array without mutating the input.
- create `src/frontend/components/DeviceDetail.jsx`:
  - It fetches `/api/devices/:id/telemetry?limit=100` and renders a Chart.js 1.0.2 `Line` on a canvas in `componentDidMount`/`componentDidUpdate`, destroying it on unmount.
  - Chart.js is required lazily inside `componentDidMount` (`var Chart = require('chart.js');`), never at the top of the module. Chart.js 1.0.2 calls `window.requestAnimationFrame` when it loads and throws `ReferenceError: window is not defined` under Node. browserify still bundles it because the `require` call is static.
  - It has a metric selector.
  - It has a command form that emits `send_command`.
  - It has a firmware version select that POSTs `/api/devices/:id/firmware`.
- create `src/frontend/components/AlertsFeed.jsx`: lists alerts newest first with an Ack button that POSTs `/api/alerts/:id/ack`.
- modify `src/frontend/App.jsx` to load the initial `/api/alerts?acknowledged=false`, handle the `status` and `firmware` socket events, and compose the new components.
- modify `public/css/dashboard.css`.

**Tests to write first:**
- `test/unit/frontend/chart_data.test.js`: labels are formatted HH:MM:SS, missing metric values become null, points are capped at max, and the input is not mutated.
- `test/unit/frontend/alerts_feed.test.js`: acknowledged alerts render without a button, and the shallow-rendered Ack click calls `onAck(id)`.
- `test/unit/frontend/device_detail.test.js`: `renderToStaticMarkup` shows the device name, firmware and a canvas element. Requiring `DeviceDetail.jsx` in Node does not load Chart.js (assert `require.cache` has no `chart.js` entry after rendering), because the `require` sits inside `componentDidMount`, which does not run on the server render path.

**Acceptance command:** `make build && make test`

**Commit message:**
```
Add telemetry chart, alerts feed and device controls

The device panel charts history plus live readings with Chart.js and
can send commands or firmware updates; alerts can be acknowledged.
```

---

## T17 — Add end-to-end test and smoke target

**Goal:** Prove that the whole stack works together, the way a user would run it.

**Files:**
- create `test/integration/e2e.test.js`:
  - Boot the full `server.start({port: 0})` in-process with real Mongo and Mosquitto. It reuses the mongoose connection already opened by `test/support/db.js` (readyState check) and gets a random MQTT clientId. Every earlier integration suite has closed its own `MQTTHandler` in `after`, so no stale subscriber doubles the results.
  - Create a rule that will fire (`battery lt 101`) before spawning the simulator, so the first telemetry already sees it. Rule creation also calls `invalidateRules()`.
  - Spawn `bin/simulate-devices.js --count 3 --duration 8` as a child process.
  - Assert that 3 devices exist, `/api/stats` shows `online >= 3`, at least one alert is present, and a `socket.io-client` connection receives a `telemetry` event after `subscribe_device`.
  - `after` kills the child process, disconnects the socket client and calls the server's `close`.
- create `scripts/smoke.sh`: after `docker compose up -d --build`, wait for `/health`, run the simulator for 15 s in the app container, and `curl /api/stats` asserting `online >= 1` (with `grep`/`node -e`, no jq).
- modify `Makefile` so the `smoke` target calls `scripts/smoke.sh` and then `down -v`.
- modify `docker-compose.yml` to set the app's `PROVISIONING_KEY` and `PUBLIC_BASE_URL=http://app:3000`.

**Tests to write first:**
- `e2e.test.js` (above).

**Acceptance command:** `make test && make smoke`

**Commit message:**
```
Add end-to-end test and docker smoke target

Run the simulator against the full stack and assert devices come online,
rules fire and dashboards receive live telemetry.
```

---

## T18 — Regenerate README from template with honest status

**Goal:** Replace the README with the `tools/readme_template.md` format, reflecting exactly what the code does.

**Files:**
- modify `README.md`:
  - Title "IoT Device Management Platform" and a one-paragraph description.
  - "Personal project built on the 2015-era stack (Node 4.3, Express 4.13, MQTT.js 1.7, Mongoose 4.4, MongoDB 3.2, Mosquitto 1.4, React 0.14, Socket.IO 1.4)".
  - **Implemented:** one bullet per SPEC in-scope feature 1–13, each mapped to code and tests.
  - **Not implemented / known limitations:** every SPEC out-of-scope item and known limitation, plus explicit statements that physical devices are simulated by `bin/simulate-devices.js`, that firmware images are arbitrary blobs, and that the notification webhook is exercised only against a local stub server.
  - **Built with:** the pinned versions.
  - **Running it:** `docker compose up` and `make smoke`.
  - **Tests:** `make test` and one sentence on coverage.
  - **Layout:** a tree generated by `git ls-files | <tree script>`, never hand-written.
  - No badges, employer, role, dates or metrics. The template's rules comment is deleted.
- create `scripts/layout_tree.js`: prints a tree from a file list on stdin (the Makefile feeds it `git ls-files --cached --others --exclude-standard`, so new untracked files are included). With `--check README.md` it compares that tree to the README's Layout block. It is used to generate the Layout section and is itself in the tree.
- modify `Makefile` to add the `readme-check` target.

**Tests to write first:**
- `test/unit/readme.test.js`:
  - Every path in the README Layout block exists (`fs.existsSync`).
  - The README matches none of these fabrication patterns: `/ACORIA/`, `/Status-Complete/`, `/\d+(\.\d+)?%\s*uptime/i`, `/\*\*Role\*\*/`, `/Organization/`, `/Developed during/`. The plain word `uptime` is allowed, because `/health` and devices legitimately report it.
  - The README has "Implemented" and "Not implemented" headings.
  - The README mentions "simulat".

**Acceptance command:** `git add -A && make test && make readme-check`. `make readme-check` pipes `git ls-files --cached --others --exclude-standard` into `$(COMPOSE) -f docker-compose.yml -f docker-compose.test.yml run --rm --no-deps -T -v $PWD:/usr/src/app test node scripts/layout_tree.js --check README.md` (the built app image, since the official `node:4.3.1` tag cannot be pulled), which exits non-zero if the README's Layout block differs from the generated tree.

**Commit message:**
```
Rewrite README from template with honest status and layout

Describe exactly what is implemented and tested, name the simulated
devices and webhook stub, and generate the layout from git ls-files.
```
