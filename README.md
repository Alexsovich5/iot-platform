# IoT Device Management Platform

Centralized IoT device management platform with MQTT-based communication, real-time monitoring dashboard, and automated device provisioning.

Personal project, built to explore device management over MQTT with a live dashboard. It is not production software — see **Status** below for exactly what is and isn't implemented.

## Status

**Implemented**

- Express API with device routes
- MQTT handler for device telemetry
- Mongoose device model
- React front-end component
- Socket.io for live updates

**Not implemented / known limitations**

- No device authentication — any client may publish
- No provisioning workflow despite the description
- No tests

## Built with

- **Node** — config, express, mongoose, mqtt, socket.io

## Running it

```bash
npm install
npm start
```

## Layout

```
config/
  default.json
docker-compose.yml
package.json
src/
  frontend/
    App.jsx
  models/
    device.js
  mqtt_handler.js
  routes/
    api.js
  server.js
```

