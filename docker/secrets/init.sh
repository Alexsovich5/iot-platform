#!/bin/sh
# Creates the stack's shared secrets in the secrets volume on first start
# and rebuilds the Mosquitto password file from them on every start.
# Existing secrets are kept. Secret values are never printed.
set -eu
umask 077

DIR=${SECRETS_DIR:-/secrets}
mkdir -p "$DIR/mosquitto"

random_hex() {
    hexdump -v -n 32 -e '/1 "%02x"' /dev/urandom
}

for name in mqtt_platform_password mqtt_device_password provisioning_key; do
    if [ ! -s "$DIR/$name" ]; then
        random_hex > "$DIR/$name.tmp"
        mv "$DIR/$name.tmp" "$DIR/$name"
        echo "created $DIR/$name"
    fi
done

passwd="$DIR/mosquitto/passwd"
: > "$passwd.tmp"
mosquitto_passwd -b "$passwd.tmp" platform "$(cat "$DIR/mqtt_platform_password")"
mosquitto_passwd -b "$passwd.tmp" device "$(cat "$DIR/mqtt_device_password")"
mv "$passwd.tmp" "$passwd"

# The broker drops root privileges to the mosquitto user before it reads
# the password file.
chown -R mosquitto:mosquitto "$DIR/mosquitto"
chmod 700 "$DIR/mosquitto"
chmod 600 "$passwd"
echo "mosquitto password file ready"
