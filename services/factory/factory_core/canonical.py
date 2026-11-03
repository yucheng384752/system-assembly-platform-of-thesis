"""Canonical JSON and content hashes that must match libs/aov-integration/index.ts byte for byte.

Contract section 5: keys sorted by UTF-16 code unit, numbers written as ECMAScript Number::toString,
no Unicode normalization, compact output, UTF-8. fixtures/executable-plan/canonical-vectors.json pins this.
"""
from __future__ import annotations

from decimal import Decimal
import hashlib
import json
import math

_SAFE_INTEGER = 2 ** 53


def _integer(token: str) -> int | float:
    value = int(token)
    return value if abs(value) <= _SAFE_INTEGER else float(token)  # JavaScript reads every JSON number as a double


def parse_json(text: str) -> object:
    """json.loads that reads numbers the way JavaScript does, so plans produced there hash identically here."""
    return json.loads(text, parse_int=_integer)


class CanonicalError(ValueError):
    """The value has no single canonical form (NaN, huge integers, lone surrogates, non-JSON types)."""


def _number(value: int | float) -> str:
    if isinstance(value, int):
        if abs(value) > _SAFE_INTEGER:
            raise CanonicalError(f'integer {value} is outside the range a JavaScript number keeps exactly')
        return str(value)
    if not math.isfinite(value):
        raise CanonicalError('JSON has no NaN or Infinity')
    if value == 0:
        return '0'  # also -0.0, as JSON.stringify writes it
    sign = '-' if value < 0 else ''
    _, digit_tuple, exponent = Decimal(repr(abs(value))).as_tuple()
    digits = ''.join(map(str, digit_tuple)).rstrip('0') or '0'
    # value = 0.digits * 10**n, so n is the decimal point position the ES algorithm uses
    n = len(digit_tuple) + exponent  # type: ignore[operator]
    k = len(digits)
    if k <= n <= 21:
        text = digits + '0' * (n - k)
    elif 0 < n <= 21:
        text = digits[:n] + '.' + digits[n:]
    elif -6 < n <= 0:
        text = '0.' + '0' * -n + digits
    else:
        e = n - 1
        mantissa = digits[0] + ('.' + digits[1:] if k > 1 else '')
        text = f"{mantissa}e{'+' if e >= 0 else '-'}{abs(e)}"
    return sign + text


def _string(value: str) -> str:
    try:
        value.encode('utf-8')
    except UnicodeEncodeError as error:
        raise CanonicalError('string holds a lone surrogate, which has no UTF-8 form') from error
    return json.dumps(value, ensure_ascii=False)  # same escapes as JSON.stringify: lowercase \u00xx, DEL raw


def canonical_json(value: object) -> str:
    if isinstance(value, bool):
        return 'true' if value else 'false'
    if value is None:
        return 'null'
    if isinstance(value, (int, float)):
        return _number(value)
    if isinstance(value, str):
        return _string(value)
    if isinstance(value, (list, tuple)):
        return '[' + ','.join(canonical_json(item) for item in value) + ']'
    if isinstance(value, dict):
        if not all(isinstance(key, str) for key in value):
            raise CanonicalError('object keys must be strings')
        keys = sorted(value, key=lambda key: key.encode('utf-16-be'))  # UTF-16 code unit order, not code point
        return '{' + ','.join(_string(key) + ':' + canonical_json(value[key]) for key in keys) + '}'
    raise CanonicalError(f'{type(value).__name__} is not a JSON value')


def content_sha256(value: object) -> str:
    return hashlib.sha256(canonical_json(value).encode('utf-8')).hexdigest()
