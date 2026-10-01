"""
License verification for Form System Kit Composer generated systems.
Checks RSA-PSS signature, expiry, and machine binding. Startup code must treat
invalid results as fatal.

Machine binding (composer-refactor D37-D38, replaces the baseline TPM binding):
  - license payload schemaVersion 2.0 must carry machineFingerprint and fingerprintSource.
  - windows-machine-guid: SHA-256 of HKLM\\SOFTWARE\\Microsoft\\Cryptography MachineGuid.
  - linux-machine-id: SHA-256 of /etc/machine-id (mount it read-only into containers).
  - Both values are trimmed and lowercased before hashing, matching
    scripts/security/get-machine-fingerprint.ps1 / .sh in composer-refactor.
  - These IDs are copied along with VM or disk images; binding only stops moving files
    to another machine (D44).
  - TPM EK fingerprints and machinePublicKey challenge-response are no longer supported;
    such licenses are rejected with an explicit reason instead of being ignored.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
import platform
import subprocess
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

logger = logging.getLogger(__name__)

# Replaced with the issuer's RSA-2048 SubjectPublicKeyInfo PEM when the system is assembled.
# Left as the placeholder, every license is refused so a missing key cannot pass as "invalid license" (D41).
_PUBLIC_KEY_PLACEHOLDER = "__COMPOSER_LICENSE_PUBLIC_KEY__"
_PUBLIC_KEY_PEM = _PUBLIC_KEY_PLACEHOLDER

SCHEMA_VERSION = "2.0"
FINGERPRINT_SOURCES = ("windows-machine-guid", "linux-machine-id")
_REQUIRED_FIELDS = (
    "schemaVersion", "issuedAt", "expiresAt", "licensee", "recipe", "enabledKits",
    "machineFingerprint", "fingerprintSource", "packageManifestSha256",
)


@dataclass
class LicenseResult:
    valid: bool
    licensee: str = ""
    expires_at: str = ""
    reason: str = ""


def _find_license_file() -> Path | None:
    here = Path(__file__).resolve()
    candidates = [
        Path(os.getcwd()) / "license.lic",
        Path(os.getcwd()).parent / "license.lic",
    ]
    for idx in (3, 4, 5):
        try:
            candidates.insert(idx - 3, here.parents[idx] / "license.lic")
        except IndexError:
            continue
    for p in candidates:
        try:
            if p.exists():
                return p
        except (OSError, ValueError):
            continue
    return None


def verify_license() -> LicenseResult:
    lic_path = _find_license_file()
    if lic_path is None:
        return LicenseResult(valid=False, reason="license.lic not found")
    return verify_license_text(lic_path.read_text("utf-8-sig"))


def verify_license_text(text: str) -> LicenseResult:
    """Verify a license.lic document: signature, payload contract, expiry, then machine binding."""
    if _PUBLIC_KEY_PEM.strip() == _PUBLIC_KEY_PLACEHOLDER:
        return LicenseResult(valid=False, reason="issuer public key was not embedded at assembly; no license can be verified")

    try:
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import padding
        from cryptography.exceptions import InvalidSignature
        import base64
    except ImportError:
        return LicenseResult(valid=False, reason="cryptography package not installed")

    try:
        lic_data = json.loads(text)
        payload_str: str = lic_data["payload"]
        sig_b64: str = lic_data["signature"]
        if lic_data.get("algorithm") != "RSA-PSS-SHA256":
            return LicenseResult(valid=False, reason=f"unsupported algorithm: {lic_data.get('algorithm')!r}")
    except Exception as exc:
        return LicenseResult(valid=False, reason=f"malformed license.lic: {exc}")

    # Verify RSA-PSS license signature (issuer signs the exact payload string)
    try:
        pub_key = serialization.load_pem_public_key(_PUBLIC_KEY_PEM.encode())
        # salt_length=32 matches Node.js saltLength 32 used by scripts/security/lib.mjs.
        # PSS.DIGEST_LENGTH is only available in cryptography >= 41; use the
        # literal value so older deployments (Ubuntu 22.04 default) are supported.
        pub_key.verify(
            base64.b64decode(sig_b64, validate=True),
            payload_str.encode("utf-8"),
            padding.PSS(
                mgf=padding.MGF1(hashes.SHA256()),
                salt_length=32,
            ),
            hashes.SHA256(),
        )
    except InvalidSignature:
        return LicenseResult(valid=False, reason="signature verification failed")
    except Exception as exc:
        return LicenseResult(valid=False, reason=f"signature error: {exc}")

    try:
        payload = json.loads(payload_str)
    except Exception as exc:
        return LicenseResult(valid=False, reason=f"payload parse error: {exc}")
    problem = _payload_problem(payload)
    if problem:
        return LicenseResult(valid=False, reason=problem)

    expires_at = payload["expiresAt"]
    licensee = payload["licensee"]["name"]
    try:
        expiry_dt = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
    except ValueError as exc:
        return LicenseResult(valid=False, reason=f"payload parse error: {exc}")
    if datetime.now(timezone.utc) > expiry_dt:
        return LicenseResult(valid=False, licensee=licensee, expires_at=expires_at, reason="license expired")

    source = payload["fingerprintSource"]
    current_fp = machine_fingerprint(source)
    if current_fp is None:
        return LicenseResult(valid=False, licensee=licensee, expires_at=expires_at,
                             reason=f"cannot read the {source} machine identity on this machine")
    if not hmac.compare_digest(current_fp, payload["machineFingerprint"]):
        return LicenseResult(valid=False, licensee=licensee, expires_at=expires_at,
                             reason="machine fingerprint mismatch - license issued for a different machine")

    return LicenseResult(valid=True, licensee=licensee, expires_at=expires_at)


def _payload_problem(payload: object) -> str:
    """Return why a signed payload is unacceptable, or an empty string."""
    if not isinstance(payload, dict):
        return "payload must be a JSON object"
    if "machinePublicKey" in payload:
        return "TPM-bound licenses are no longer supported; re-issue with a machine fingerprint (schemaVersion 2.0)"
    if payload.get("schemaVersion") != SCHEMA_VERSION:
        return f"unsupported license schemaVersion {payload.get('schemaVersion')!r}; expected {SCHEMA_VERSION}"
    missing = [name for name in _REQUIRED_FIELDS if name not in payload]
    if missing:
        return f"license payload missing: {', '.join(missing)}"
    if payload["fingerprintSource"] not in FINGERPRINT_SOURCES:
        return f"unknown fingerprintSource {payload['fingerprintSource']!r}"
    if not isinstance(payload["licensee"], dict) or not isinstance(payload["licensee"].get("name"), str):
        return "license payload licensee.name must be a string"
    if not isinstance(payload["expiresAt"], str) or not isinstance(payload["machineFingerprint"], str):
        return "license payload expiresAt and machineFingerprint must be strings"
    return ""


def machine_fingerprint(source: str) -> str | None:
    """SHA-256 of this machine's identity for the given source; None when unavailable or the wrong platform."""
    is_windows = platform.system() == "Windows"
    if source == "windows-machine-guid":
        return _hash_identity(_windows_machine_guid()) if is_windows else None
    if source == "linux-machine-id":
        return _hash_identity(_linux_machine_id()) if not is_windows else None
    return None


def _hash_identity(raw: str | None) -> str | None:
    value = (raw or "").strip().lower()
    return hashlib.sha256(value.encode("utf-8")).hexdigest() if value else None


def _windows_machine_guid() -> str | None:
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Cryptography",
                            0, winreg.KEY_READ | winreg.KEY_WOW64_64KEY) as key:
            value, _ = winreg.QueryValueEx(key, "MachineGuid")
            return str(value)
    except (ImportError, OSError) as exc:
        logger.warning("license: cannot read MachineGuid from the registry: %s", exc)
    try:
        result = subprocess.run(
            [
                "powershell", "-NoProfile", "-NonInteractive", "-Command",
                "(Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Cryptography' -Name MachineGuid).MachineGuid",
            ],
            capture_output=True, text=True, timeout=10,
        )
        return result.stdout if result.returncode == 0 else None
    except (OSError, subprocess.TimeoutExpired) as exc:
        logger.warning("license: cannot read MachineGuid via PowerShell: %s", exc)
        return None


def _linux_machine_id() -> str | None:
    try:
        return Path("/etc/machine-id").read_text("utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        logger.warning("license: cannot read /etc/machine-id: %s", exc)
        return None
