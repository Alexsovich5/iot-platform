#!/bin/sh
# Smoke test against the docker compose stack: start it, wait for /health,
# run the device simulator inside the app container for 15 s and check that
# /api/stats reports at least one device online.
set -eu

COMPOSE=${COMPOSE:-docker compose}
BASE_URL=${SMOKE_BASE_URL:-http://localhost:21000}

$COMPOSE up -d --build

echo "Waiting for $BASE_URL/health"
tries=0
until curl -fsS "$BASE_URL/health" >/dev/null 2>&1; do
    tries=$((tries + 1))
    if [ "$tries" -ge 60 ]; then
        echo "App did not become healthy" >&2
        $COMPOSE logs app >&2
        exit 1
    fi
    sleep 1
done
curl -fsS "$BASE_URL/health"
echo

echo "Running the simulator for 15 s"
$COMPOSE exec -T app sh -c \
    'node bin/simulate-devices.js --count 3 --prefix smoke --interval 1000 --duration 15 --mqtt mqtt://mosquitto:1883 --key "$PROVISIONING_KEY"'

stats=$(curl -fsS "$BASE_URL/api/stats")
echo "Stats: $stats"
online=$(echo "$stats" | grep -o '"online":[0-9]*' | grep -o '[0-9]*$' || true)
if [ "${online:-0}" -lt 1 ]; then
    echo "Expected at least one device online, got ${online:-0}" >&2
    exit 1
fi
echo "Smoke test passed: $online device(s) online"
