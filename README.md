# IoT Device Management Platform

![Project Status](https://img.shields.io/badge/Status-Complete-brightgreen)
![Timeline](https://img.shields.io/badge/Timeline-October%202015%20--%20February%202016-blue)
![Technology](https://img.shields.io/badge/Tech-Node.js%20%7C%20MongoDB%20%7C%20MQTT-orange)

## Project Overview

Centralized IoT device management platform with MQTT-based communication, real-time monitoring dashboard, and automated device provisioning.

**Role**: IT Operations Specialist
**Organization**: ACORIA
**Duration**: October 2015 - February 2016
**Project**: #11 of 30 in IT Career Portfolio

## Business Impact

- **500+ Devices Managed**: Centralized control for distributed IoT fleet
- **Real-time Monitoring**: Sub-second telemetry visualization
- **Automated Provisioning**: Device onboarding reduced from hours to minutes
- **99.5% Uptime**: Reliable MQTT message delivery

## Technology Stack

- **Node.js 4.x**: Backend API and MQTT broker integration
- **MongoDB 3.2**: Device registry and telemetry storage
- **MQTT (Mosquitto)**: Lightweight messaging protocol
- **React 0.14**: Frontend dashboard
- **Express 4.x**: REST API framework
- **Socket.IO**: Real-time dashboard updates

## Key Features

- MQTT-based device communication and command dispatch
- Device registration, authentication, and lifecycle management
- Real-time telemetry dashboard with historical charts
- Firmware update distribution and tracking
- Alert rules engine with threshold-based notifications
- RESTful API for third-party integrations

## Project Structure

```
iot-platform/
├── README.md
├── package.json
├── docker-compose.yml
├── config/
│   └── default.json
└── src/
    ├── server.js
    ├── mqtt_handler.js
    ├── models/
    │   └── device.js
    ├── routes/
    │   └── api.js
    └── frontend/
        └── App.jsx
```

## Installation and Setup

### Prerequisites
- Node.js 4.x+
- MongoDB 3.2+
- Mosquitto MQTT Broker

### Quick Start
```bash
git clone https://github.com/Alexsovich5/iot-platform.git
cd iot-platform
npm install
# Start MongoDB and Mosquitto
docker-compose up -d mongo mosquitto
# Start the application
npm start
```

## Contributing

This is a historical project from October 2015 - February 2016, preserved for portfolio purposes.

## License

Professional portfolio project - ACORIA

---

**Developed during October 2015 - February 2016**
*Part of Alexander Efrem's IT Career Portfolio (2012-2024)*

### Career Timeline Context

- **Network Administrator** (2012-2013): Projects 1-4
- **IT Administrator** (2013-2015): Projects 5-9
- **IT Operations Specialist - ACORIA** (2015-2023): Projects 10-21
- **IT Administrator - Zambaiti** (2017-2020): Projects 22-26
- **IT Operations Specialist - AEL Dubai** (2023-Present): Projects 27-30
