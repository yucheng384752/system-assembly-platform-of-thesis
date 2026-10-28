"""Hardware binding policy (D136, D137, D143).

The guard container writes a report of hashed fingerprint sources; this module decides what a report means for
the license. A mismatch first shows a warning, then allows a 24 hour grace period, and the system is blocked only
once the block window (default weekdays 09:00 to 15:00, local time) is open, so that someone can answer the call.
A guard that stops reporting is tolerated for 24 hours and then treated like a mismatch. Once blocking has started
it stays until the hardware matches again. Pure functions with an injected clock; no I/O except the two small files.
"""
import json
import os
import re
import tempfile
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from app.core import license as lic

GRACE = timedelta(hours=24)
UNREACHABLE_TOLERANCE = timedelta(hours=24)
CLOCK_SKEW = timedelta(minutes=5)
DEFAULT_WINDOW = "mon-fri 09:00-15:00"
DEFAULT_TIMEZONE = "Asia/Taipei"
DAYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")
WARNING_STATES = frozenset({"grace", "awaiting-window", "blocked"})
_STAMP = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z")
_HEX64 = re.compile(r"[a-f0-9]{64}")
_SOURCE = re.compile(r"(product_uuid|product_serial|board_serial|chassis_serial|(?:mac|disk):[^/\s]+)")


def stamp(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_stamp(value):
    if not isinstance(value, str) or not _STAMP.fullmatch(value):
        raise ValueError("invalid timestamp")
    return datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)


class BlockWindow:
    """'mon-fri 09:00-15:00', 'daily 08:00-17:30' or 'mon,wed,fri 09:00-12:00' in the site's local time."""

    def __init__(self, spec: str):
        match = re.fullmatch(r"(daily|[a-z]{3}(?:-[a-z]{3}|(?:,[a-z]{3})*)) ([01][0-9]|2[0-3]):([0-5][0-9])-([01][0-9]|2[0-3]):([0-5][0-9])", spec.strip())
        if not match:
            raise ValueError("block window must look like 'mon-fri 09:00-15:00'")
        days, *clock = match.groups()
        if days == "daily":
            self.days = set(range(7))
        elif "-" in days:
            first, last = (self._day(d) for d in days.split("-"))
            self.days = {(first + i) % 7 for i in range((last - first) % 7 + 1)}
        else:
            self.days = {self._day(d) for d in days.split(",")}
        self.start = (int(clock[0]), int(clock[1]))
        self.end = (int(clock[2]), int(clock[3]))
        if self.end <= self.start:
            raise ValueError("block window must end after it starts, within one day")

    @staticmethod
    def _day(name):
        if name not in DAYS:
            raise ValueError("unknown weekday " + name)
        return DAYS.index(name)

    def contains(self, local: datetime) -> bool:
        return local.weekday() in self.days and self.start <= (local.hour, local.minute) < self.end

    def next_start(self, local: datetime) -> datetime:
        """First moment at or after `local` at which a window opens."""
        for offset in range(8):
            day = local + timedelta(days=offset)
            candidate = day.replace(hour=self.start[0], minute=self.start[1], second=0, microsecond=0)
            if day.weekday() in self.days and candidate >= local:
                return candidate
        raise ValueError("block window never opens")


@dataclass
class Report:
    generated_at: datetime
    started_at: datetime
    sources: tuple = ()

    @property
    def hashes(self):
        return {sha for _, sha in self.sources}


def read_report(path, now: datetime):
    """The guard's latest report, or None when it is missing, malformed or dated in the future."""
    try:
        value = json.loads(Path(path).read_text("utf-8"))
        if not isinstance(value, dict) or value.get("schemaVersion") != "1.0":
            return None
        generated, started = parse_stamp(value["generatedAt"]), parse_stamp(value["startedAt"])
        sources = value["sources"]
        if not isinstance(sources, list) or generated > now + CLOCK_SKEW:
            return None
        parsed = []
        for item in sources:
            if not isinstance(item, dict) or set(item) != {"source", "sha256"}:
                return None
            if not _SOURCE.fullmatch(str(item["source"])) or not _HEX64.fullmatch(str(item["sha256"])):
                return None
            parsed.append((item["source"], item["sha256"]))
        return Report(generated, started, tuple(parsed))
    except (OSError, UnicodeError, ValueError, KeyError, TypeError):
        return None


def load_state(path) -> dict:
    try:
        value = json.loads(Path(path).read_text("utf-8"))
        return {k: v for k, v in value.items() if k in ("unreachableSince", "mismatchSince", "blockedSince")
                and isinstance(v, str) and _STAMP.fullmatch(v)}
    except (OSError, UnicodeError, ValueError, AttributeError):
        return {}


def save_state(path, state: dict) -> None:
    target = Path(path)
    handle, temporary = tempfile.mkstemp(prefix=".license-state-", suffix=".tmp", dir=target.parent)
    try:
        with os.fdopen(handle, "w", encoding="utf-8") as stream:
            json.dump(state, stream, separators=(",", ":"))
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, target)
    except BaseException:
        Path(temporary).unlink(missing_ok=True)
        raise


@dataclass
class Verdict:
    status: str  # unchecked | pending | match | grace | awaiting-window | blocked
    reason: str = ""  # '', 'mismatch' or 'guard-unreachable'
    matched: int | None = None
    min_match: int = 2
    since: str = ""
    grace_ends_at: str = ""
    block_from: str = ""
    report_at: str = ""

    @property
    def blocked(self) -> bool:
        return self.status == "blocked"

    @property
    def warning(self) -> bool:
        return self.status in WARNING_STATES

    def as_dict(self) -> dict:
        return {"status": self.status, "reason": self.reason, "matched": self.matched, "minMatch": self.min_match,
                "since": self.since, "graceEndsAt": self.grace_ends_at, "blockFrom": self.block_from,
                "reportAt": self.report_at}


def evaluate(state: dict, report, result, now: datetime, window: BlockWindow, zone) -> Verdict:
    """Mutates `state` (the caller saves it when it changed) and returns what the report means right now."""
    min_match = result.min_match if result is not None else 2
    if result is None or not result.valid:
        return Verdict("unchecked", min_match=min_match)
    report_at = stamp(report.generated_at) if report else ""
    matched = None
    if report is None:
        if not state.get("mismatchSince") and not state.get("blockedSince"):
            since = parse_stamp(state["unreachableSince"]) if state.get("unreachableSince") else now
            state["unreachableSince"] = stamp(since)
            if now - since < UNREACHABLE_TOLERANCE:
                return Verdict("pending", "guard-unreachable", None, min_match, stamp(since))
        reason = "guard-unreachable"
    elif now - report.generated_at > UNREACHABLE_TOLERANCE:
        state.pop("unreachableSince", None)
        reason = "guard-unreachable"
    else:
        state.pop("unreachableSince", None)
        ok, matched = lic.fingerprint_matches(result, report.hashes)
        if ok:
            for key in ("mismatchSince", "blockedSince"):
                state.pop(key, None)
            return Verdict("match", "", matched, min_match, report_at=report_at)
        reason = "mismatch"
    since = parse_stamp(state["mismatchSince"]) if state.get("mismatchSince") else now
    state["mismatchSince"] = stamp(since)
    grace_end = since + GRACE
    common = dict(reason=reason, matched=matched, min_match=min_match, since=stamp(since), grace_ends_at=stamp(grace_end),
                  report_at=report_at)
    if state.get("blockedSince"):
        return Verdict("blocked", **common)
    if now < grace_end:
        return Verdict("grace", **common)
    local = now.astimezone(zone)
    if window.contains(local):
        state["blockedSince"] = stamp(now)
        return Verdict("blocked", **common)
    return Verdict("awaiting-window", block_from=stamp(window.next_start(local)), **common)


def settings(environ):
    """Window and time zone from the environment (a Site setting reaches the container as these two values)."""
    window = BlockWindow(environ.get("LICENSE_BLOCK_WINDOW") or DEFAULT_WINDOW)
    return window, ZoneInfo(environ.get("LICENSE_TIMEZONE") or DEFAULT_TIMEZONE)
