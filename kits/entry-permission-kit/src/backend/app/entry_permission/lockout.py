from datetime import timedelta

MAX_FAILURES = 5
LOCK_DURATION = timedelta(minutes=15)


def is_locked(locked_until, now):
    return locked_until is not None and now < locked_until


def failed_attempt(count, locked_until, now):
    if is_locked(locked_until, now):
        return count, locked_until
    if locked_until is not None:
        count = 0
    count += 1
    return count, now + LOCK_DURATION if count >= MAX_FAILURES else None
