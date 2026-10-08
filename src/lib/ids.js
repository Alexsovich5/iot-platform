'use strict';

// Device IDs appear in MQTT topics and URLs, so they are limited to
// characters that need no escaping in either.
exports.DEVICE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
