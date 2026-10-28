"""Hardware guard (D136, D143). Runs as its own container: root, no capabilities, read-only root filesystem,
no network, host /sys mounted read-only. Non-root processes cannot read the DMI serials, so this is the only
component that sees the machine. It reports hashed fingerprint sources to the backend through a file on a
shared volume that the backend mounts read-only. It never reads the license: matching happens in the backend,
so a root container never parses a file that a compromised backend could write.

The collection rules must stay identical to services/installer/engine/detect.py (the license is issued from
that output); services/package/tests/test_guard.py compares the two on the same fixture trees.
"""
import hashlib
import json
import os
import re
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

SCHEMA_VERSION = "1.0"
BAD = {"", "0", "none", "unknown", "default string", "to be filled by o.e.m.", "not specified", "system serial number"}
IGNORED_DISKS = ("loop", "ram", "dm-", "md", "zram", "sr", "nbd")


def _read(path):
    try:
        return Path(path).read_text(encoding="utf-8").strip()
    except (OSError, UnicodeError):
        return ""


def _stamp(moment):
    return moment.strftime("%Y-%m-%dT%H:%M:%SZ")


def collect(sys_root):
    """Valid fingerprint sources as [{source, sha256}], the same shape the license carries."""
    root = Path(sys_root)
    values = {}
    for name in ("product_uuid", "product_serial", "board_serial", "chassis_serial"):
        values[name] = _read(root / "class/dmi/id" / name).lower()
    for card in sorted((root / "class/net").glob("*")):
        if (card / "device").exists():  # only cards backed by a physical device; bridges and veth have none
            values["mac:" + card.name] = _read(card / "address").lower()
    for disk in sorted((root / "block").glob("*")):
        if disk.name.startswith(IGNORED_DISKS) or _read(disk / "removable") == "1" or "/usb" in disk.resolve().as_posix():
            continue  # the installer's USB stick leaves with the engineer and must not be part of the identity
        serial = disk / "device/serial"
        if serial.exists():
            value = _read(serial).lower()
        else:
            try:
                raw = (disk / "device/vpd_pg80").read_bytes().decode("utf-8", errors="ignore")
                value = re.sub(r"[\x00-\x1f\x7f-\x9f]", "", raw).strip().lower()
            except OSError:
                value = ""
        values["disk:" + disk.name] = value
    result = []
    for name, value in values.items():
        compact = re.sub(r"[-:\s]", "", value)
        if value not in BAD and compact and set(compact) != {"0"} and set(compact) != {"f"}:
            result.append({"source": name, "sha256": hashlib.sha256(value.encode()).hexdigest()})
    return result


def report(sys_root, started, now=None):
    return {"schemaVersion": SCHEMA_VERSION, "generatedAt": _stamp(now or datetime.now(timezone.utc)),
            "startedAt": _stamp(started), "sources": collect(sys_root)}


def write_atomic(path, value):
    """Readers see the previous report or the new one, never a partial file."""
    target = Path(path)
    handle, temporary = tempfile.mkstemp(prefix=".guard-", suffix=".tmp", dir=target.parent)
    try:
        with os.fdopen(handle, "w", encoding="utf-8") as stream:
            json.dump(value, stream, separators=(",", ":"))
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(temporary, 0o644)
        os.replace(temporary, target)
    except BaseException:
        Path(temporary).unlink(missing_ok=True)
        raise


def main(environ=None, sleep=time.sleep, iterations=None):
    env = os.environ if environ is None else environ
    sys_root = env.get("GUARD_SYS_ROOT", "/host/sys")
    result = env.get("GUARD_RESULT_FILE", "/guard/result.json")
    interval = int(env.get("GUARD_INTERVAL", "300"))
    started = datetime.now(timezone.utc)
    count = 0
    while iterations is None or count < iterations:
        try:
            write_atomic(result, report(sys_root, started))
        except Exception as error:  # keep running: a missed report only ages the previous one (24 hour tolerance)
            print("guard: report failed: " + type(error).__name__, file=sys.stderr, flush=True)
        count += 1
        if iterations is None or count < iterations:
            sleep(interval)


if __name__ == "__main__":
    main()
