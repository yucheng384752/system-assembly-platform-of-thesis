"""
License 3.0 verification for generated systems (composer-refactor D129 to D132, D142).

Chain: the offline root key signs a short-lived sub-key certificate; the sub-key signs the license.
The license is bound to the exact system-manifest.json (sha256) and carries hashed hardware
fingerprint sources. This module verifies signature chain, validity and manifest binding. Hardware
matching is separate (fingerprint_matches) because only the guard container can read the host.

Rules mirror scripts/security/system-license.mjs and services/installer/engine/license.py:
  - envelopes are { payload (exact JSON string), signature (base64), algorithm "RSA-PSS-SHA256" }, salt length 32.
  - key id = SHA-256 of the SPKI DER of the public key.
  - the certificate is signed by the root key; the license by the certificate's key.
  - issuedAt must lie inside the certificate interval; the certificate expiring afterwards does not
    invalidate an already issued license.
  - licensee must match the certificate, expiresAt must be in the future, packageManifestSha256 must
    equal the installed manifest hash.
The 2.0 format (single machine fingerprint, embedded public key) is no longer accepted.
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa

DEFAULT_LICENSE_FILE = "/system/license/license.lic"
DEFAULT_ROOT_KEY_FILE = "/system/trust/root.pem"
DEFAULT_MANIFEST_FILE = "/system/manifest/system-manifest.json"

_HEX64 = re.compile(r"[a-f0-9]{64}")
_STAMP = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z")
_SOURCE = re.compile(r"(product_uuid|product_serial|board_serial|chassis_serial|(?:mac|disk):[^/\s]+)")
_SYSTEM_ID = re.compile(r"[a-z0-9][a-z0-9-]{0,49}")
_NAME = re.compile(r"[a-z0-9-]+")

# Stable codes; the status page maps them to operator-facing text.
CODES = (
    "ok", "license-missing", "root-key-missing", "manifest-missing", "malformed", "signature",
    "certificate", "issued-outside-certificate", "licensee-mismatch", "expired", "manifest-mismatch",
)


class LicenseError(Exception):
    def __init__(self, code: str, detail: str = ""):
        super().__init__(detail or code)
        self.code = code


@dataclass
class LicenseResult:
    valid: bool
    code: str = "ok"
    reason: str = ""
    licensee: str = ""
    expires_at: str = ""
    system_id: str = ""
    enabled_kits: tuple[str, ...] = ()
    min_match: int = 2
    sources: tuple[tuple[str, str], ...] = field(default_factory=tuple)


def _stamp(value) -> datetime:
    if not isinstance(value, str) or not _STAMP.fullmatch(value):
        raise LicenseError("malformed", "invalid timestamp")
    try:
        return datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    except ValueError:
        raise LicenseError("malformed", "invalid calendar date") from None


def _shape(value, fields: str) -> dict:
    if not isinstance(value, dict) or set(value) != set(fields.split()):
        raise LicenseError("malformed", "unexpected fields")
    return value


def _text(value, low: int, high: int) -> str:
    if not isinstance(value, str) or not low <= len(value) <= high:
        raise LicenseError("malformed", "invalid text")
    return value


def _match(value, expression: re.Pattern) -> str:
    if not isinstance(value, str) or not expression.fullmatch(value):
        raise LicenseError("malformed", "invalid pattern")
    return value


def _licensee(value) -> str:
    _shape(value, "name")
    return _text(value["name"], 1, 100)


def _public_key(pem: str, code: str = "certificate"):
    try:
        key = serialization.load_pem_public_key(pem.encode("utf-8"))
    except (ValueError, TypeError, UnicodeError):
        raise LicenseError(code, "unreadable public key") from None
    if not isinstance(key, rsa.RSAPublicKey) or key.key_size < 2048:
        raise LicenseError(code, "RSA key of at least 2048 bits required")
    return key


def key_id(pem: str, code: str = "certificate") -> str:
    der = _public_key(pem, code).public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
    return hashlib.sha256(der).hexdigest()


def _signed(envelope, pem: str, code: str) -> dict:
    _shape(envelope, "payload signature algorithm")
    _text(envelope["payload"], 2, 65536)
    _text(envelope["signature"], 1, 1024)
    if envelope["algorithm"] != "RSA-PSS-SHA256":
        raise LicenseError("malformed", "unsupported algorithm")
    try:
        signature = base64.b64decode(envelope["signature"], validate=True)
    except ValueError:
        raise LicenseError("malformed", "signature is not base64") from None
    try:
        # salt_length is the literal 32: PSS.DIGEST_LENGTH is missing before cryptography 41.
        _public_key(pem, code).verify(signature, envelope["payload"].encode("utf-8"),
                                      padding.PSS(mgf=padding.MGF1(hashes.SHA256()), salt_length=32), hashes.SHA256())
    except InvalidSignature:
        raise LicenseError(code, "signature verification failed") from None
    try:
        payload = json.loads(envelope["payload"])
    except ValueError:
        raise LicenseError("malformed", "payload is not JSON") from None
    if not isinstance(payload, dict):
        raise LicenseError("malformed", "payload is not an object")
    return payload


def _certificate(envelope, root_pem: str) -> dict:
    cert = _signed(envelope, root_pem, "certificate")
    _shape(cert, "schemaVersion keyId issuerKeyId subjectPublicKey licensee notBefore notAfter")
    if cert["schemaVersion"] != "1.0":
        raise LicenseError("malformed", "unsupported certificate version")
    _licensee(cert["licensee"])
    _match(cert["issuerKeyId"], _HEX64)
    _match(cert["keyId"], _HEX64)
    if cert["issuerKeyId"] != key_id(root_pem):
        raise LicenseError("certificate", "issuerKeyId does not match the trusted root key")
    if cert["keyId"] != key_id(_text(cert["subjectPublicKey"], 1, 8192)):
        raise LicenseError("certificate", "keyId does not match the certificate key")
    if _stamp(cert["notAfter"]) <= _stamp(cert["notBefore"]):
        raise LicenseError("certificate", "invalid certificate interval")
    return cert


def _payload_shape(payload: dict) -> None:
    _shape(payload, "schemaVersion issuedAt expiresAt licensee systemId recipe enabledKits fingerprint packageManifestSha256")
    if payload["schemaVersion"] != "3.0":
        raise LicenseError("malformed", "unsupported license version")
    _stamp(payload["issuedAt"])
    _stamp(payload["expiresAt"])
    _licensee(payload["licensee"])
    _match(payload["systemId"], _SYSTEM_ID)
    _match(payload["recipe"], _NAME)
    kits = payload["enabledKits"]
    if not isinstance(kits, list) or not kits:
        raise LicenseError("malformed", "invalid enabledKits")
    for kit in kits:
        _match(kit, _NAME)
    if len(set(kits)) != len(kits):
        raise LicenseError("malformed", "duplicate enabledKits")
    fingerprint = _shape(payload["fingerprint"], "minMatch sources")
    if isinstance(fingerprint["minMatch"], bool) or fingerprint["minMatch"] != 2:
        raise LicenseError("malformed", "invalid minMatch")
    sources = fingerprint["sources"]
    if not isinstance(sources, list) or len(sources) < 3:
        raise LicenseError("malformed", "at least three fingerprint sources are required")
    for item in sources:
        _shape(item, "source sha256")
        _match(item["source"], _SOURCE)
        _match(item["sha256"], _HEX64)
    if len({item["source"] for item in sources}) != len(sources):
        raise LicenseError("malformed", "duplicate fingerprint source")
    _match(payload["packageManifestSha256"], _HEX64)


def verify_license_text(text: str, root_public_key_pem: str, manifest_sha256: str,
                        now: datetime | None = None) -> LicenseResult:
    """Chain, validity and manifest binding. Never raises for bad input; the result carries a code."""
    now = now or datetime.now(timezone.utc)
    try:
        try:
            value = json.loads(text)
        except (ValueError, TypeError):
            raise LicenseError("malformed", "license is not JSON") from None
        _shape(value, "payload signature algorithm issuerCertificate")
        cert = _certificate(value["issuerCertificate"], root_public_key_pem)
        payload = _signed({k: v for k, v in value.items() if k != "issuerCertificate"}, cert["subjectPublicKey"], "signature")
        _payload_shape(payload)
        if not _stamp(cert["notBefore"]) <= _stamp(payload["issuedAt"]) <= _stamp(cert["notAfter"]):
            raise LicenseError("issued-outside-certificate", "issuedAt is outside the certificate interval")
        if payload["licensee"]["name"] != cert["licensee"]["name"]:
            raise LicenseError("licensee-mismatch", "licensee differs from the certificate")
        base = dict(licensee=payload["licensee"]["name"], expires_at=payload["expiresAt"], system_id=payload["systemId"],
                    enabled_kits=tuple(payload["enabledKits"]), min_match=payload["fingerprint"]["minMatch"],
                    sources=tuple((s["source"], s["sha256"]) for s in payload["fingerprint"]["sources"]))
        if _stamp(payload["expiresAt"]) <= now:
            return LicenseResult(False, "expired", "license expired", **base)
        if payload["packageManifestSha256"] != manifest_sha256:
            return LicenseResult(False, "manifest-mismatch", "license was issued for a different package", **base)
        return LicenseResult(True, "ok", "", **base)
    except LicenseError as error:
        return LicenseResult(False, error.code, str(error))


def fingerprint_matches(result: LicenseResult, current_hashes) -> tuple[bool, int]:
    """Count distinct hash values shared with the machine; source names are ignored (NIC names change)."""
    matched = len({sha for _, sha in result.sources} & set(current_hashes))
    return matched >= result.min_match, matched


def _read(path: str, code: str) -> str:
    try:
        return Path(path).read_text("utf-8-sig")
    except (OSError, UnicodeError):
        raise LicenseError(code, "file unavailable") from None


def installed_license(environ=None, now: datetime | None = None) -> LicenseResult:
    """Verify the installed license against the installed root key and manifest (paths are overridable)."""
    env = os.environ if environ is None else environ
    try:
        root = _read(env.get("LICENSE_ROOT_KEY_FILE", DEFAULT_ROOT_KEY_FILE), "root-key-missing")
        try:
            manifest = Path(env.get("SYSTEM_MANIFEST_FILE", DEFAULT_MANIFEST_FILE)).read_bytes()
        except OSError:
            raise LicenseError("manifest-missing", "manifest unavailable") from None
        text = _read(env.get("LICENSE_FILE", DEFAULT_LICENSE_FILE), "license-missing")
    except LicenseError as error:
        return LicenseResult(False, error.code, str(error))
    return verify_license_text(text, root, hashlib.sha256(manifest).hexdigest(), now)
