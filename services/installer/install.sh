#!/bin/sh
set -eu
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if ! command -v python3 >/dev/null 2>&1; then
    printf '%s\n' '尚未提供可用 Python；需要 Python 3.10 以上。' >&2
    exit 10
fi
exec python3 -B "$here/engine/cli.py" "$@"
