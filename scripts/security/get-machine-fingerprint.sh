#!/bin/sh
# Run on the target machine; prints the fingerprint a license binds to (spec 12.2, D38).
# Same algorithm as license.py: /etc/machine-id trimmed and lowercased, SHA-256 of its UTF-8 bytes.
# In Docker, mount the host file read-only (-v /etc/machine-id:/etc/machine-id:ro) or the IDs will differ.
set -eu
if [ ! -r /etc/machine-id ]; then
  echo "cannot read /etc/machine-id" >&2
  exit 1
fi
raw=$(tr -d '[:space:]' < /etc/machine-id | tr '[:upper:]' '[:lower:]')
if [ -z "$raw" ]; then
  echo "/etc/machine-id is empty" >&2
  exit 1
fi
hash=$(printf '%s' "$raw" | sha256sum | cut -d' ' -f1)
printf '{"machineFingerprint":"%s","fingerprintSource":"linux-machine-id"}\n' "$hash"
