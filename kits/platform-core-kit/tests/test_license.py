"""License verification after the TPM removal (composer-refactor D37-D41).

Each test states the business reason it guards: a license must only start the system it was
issued for, on the machine it was issued for, until it expires, and must never be accepted
by accident (wrong key, old format, edited payload).
"""
from __future__ import annotations

import base64
import importlib.util
import json
import platform
import shutil
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa

REPO = Path(__file__).resolve().parents[3]
LICENSE_PY = REPO / "kits" / "platform-core-kit" / "src" / "backend" / "app" / "core" / "license.py"
FINGERPRINT = "a" * 64


def _load_module():
    spec = importlib.util.spec_from_file_location("composer_license", LICENSE_PY)
    module = importlib.util.module_from_spec(spec)
    # dataclasses resolves string annotations through sys.modules, so register before executing.
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def key():
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


@pytest.fixture
def lic(key, monkeypatch):
    module = _load_module()
    pem = key.public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo).decode()
    monkeypatch.setattr(module, "_PUBLIC_KEY_PEM", pem)
    monkeypatch.setattr(module, "machine_fingerprint", lambda source: FINGERPRINT if source == "windows-machine-guid" else None)
    return module


def _ts(delta_days: int) -> str:
    return (datetime.now(timezone.utc) + timedelta(days=delta_days)).strftime("%Y-%m-%dT%H:%M:%SZ")


def payload(**changes) -> dict:
    value = {
        "schemaVersion": "2.0", "issuedAt": _ts(0), "expiresAt": _ts(365), "licensee": {"name": "示範客戶"},
        "recipe": "my-system", "enabledKits": ["platform-core-kit"], "machineFingerprint": FINGERPRINT,
        "fingerprintSource": "windows-machine-guid", "packageManifestSha256": "b" * 64,
    }
    value.update(changes)
    return {k: v for k, v in value.items() if v is not None}


def signed(key, body: dict) -> str:
    text = json.dumps(body, ensure_ascii=False, separators=(",", ":"))
    sig = key.sign(text.encode("utf-8"), padding.PSS(mgf=padding.MGF1(hashes.SHA256()), salt_length=32), hashes.SHA256())
    return json.dumps({"payload": text, "signature": base64.b64encode(sig).decode(), "algorithm": "RSA-PSS-SHA256"})


def test_issued_license_starts_the_system_on_its_machine(lic, key):
    result = lic.verify_license_text(signed(key, payload()))
    assert result.valid, result.reason
    assert result.licensee == "示範客戶"


def test_license_signed_by_the_node_tool_is_accepted(lic, key):
    # The signer is Node (scripts/security/lib.mjs) and the verifier Python; the baseline once
    # crash-looped on a mismatch between the two sides, so the pair is tested end to end.
    node = shutil.which("node")
    if node is None:
        pytest.skip("node not on PATH")
    pem = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()).decode()
    script = (
        "import { signPayload } from './scripts/security/lib.mjs';"
        "let input = '';process.stdin.on('data', c => input += c);"
        "process.stdin.on('end', () => { const { key, body } = JSON.parse(input); process.stdout.write(JSON.stringify(signPayload(body, key))); });"
    )
    out = subprocess.run([node, "--input-type=module", "-e", script], input=json.dumps({"key": pem, "body": payload()}),
                         capture_output=True, text=True, encoding="utf-8", cwd=REPO, check=True)
    result = lic.verify_license_text(out.stdout)
    assert result.valid, result.reason


def test_edited_payload_is_rejected(lic, key):
    # Extending the expiry by editing license.lic must not work without the issuer's private key.
    document = json.loads(signed(key, payload(expiresAt=_ts(30))))
    document["payload"] = document["payload"].replace(_ts(30), _ts(3000))
    assert lic.verify_license_text(json.dumps(document)).reason == "signature verification failed"


def test_license_from_another_issuer_is_rejected(lic):
    other = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    assert lic.verify_license_text(signed(other, payload())).reason == "signature verification failed"


def test_license_for_another_machine_is_rejected(lic, key):
    result = lic.verify_license_text(signed(key, payload(machineFingerprint="c" * 64)))
    assert not result.valid
    assert "different machine" in result.reason


def test_license_for_the_other_platform_cannot_be_checked_and_is_rejected(lic, key):
    result = lic.verify_license_text(signed(key, payload(fingerprintSource="linux-machine-id")))
    assert not result.valid
    assert "cannot read the linux-machine-id" in result.reason


def test_expired_license_is_rejected(lic, key):
    result = lic.verify_license_text(signed(key, payload(issuedAt=_ts(-400), expiresAt=_ts(-1))))
    assert result.reason == "license expired"


@pytest.mark.parametrize("changes, reason", [
    ({"machinePublicKey": "-----BEGIN PUBLIC KEY-----"}, "TPM-bound licenses are no longer supported"),
    ({"schemaVersion": "1.0"}, "unsupported license schemaVersion"),
    ({"fingerprintSource": None}, "license payload missing: fingerprintSource"),
    ({"machineFingerprint": None}, "license payload missing: machineFingerprint"),
    ({"fingerprintSource": "tpm-ek"}, "unknown fingerprintSource"),
])
def test_old_or_unbound_licenses_are_refused_with_a_reason(lic, key, changes, reason):
    # Baseline licenses (no binding, TPM binding, schema 1.0) must fail loudly, never pass silently (D41).
    result = lic.verify_license_text(signed(key, payload(**changes)))
    assert not result.valid
    assert reason in result.reason


def test_placeholder_public_key_refuses_every_license(key):
    module = _load_module()
    result = module.verify_license_text(signed(key, payload()))
    assert not result.valid
    assert "public key was not embedded" in result.reason


@pytest.mark.skipif(platform.system() != "Windows", reason="MachineGuid exists only on Windows")
def test_runtime_fingerprint_matches_the_windows_fingerprint_tool():
    # The issuer binds to what the .ps1 prints; the runtime must compute the identical value.
    out = subprocess.run(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
                          str(REPO / "scripts" / "security" / "get-machine-fingerprint.ps1")],
                         capture_output=True, text=True, check=True)
    tool = json.loads(out.stdout)
    assert tool["fingerprintSource"] == "windows-machine-guid"
    assert _load_module().machine_fingerprint("windows-machine-guid") == tool["machineFingerprint"]


@pytest.mark.skipif(platform.system() == "Windows" or not Path("/etc/machine-id").exists(), reason="needs /etc/machine-id")
def test_runtime_fingerprint_matches_the_linux_fingerprint_tool():
    out = subprocess.run(["sh", str(REPO / "scripts" / "security" / "get-machine-fingerprint.sh")], capture_output=True, text=True, check=True)
    assert _load_module().machine_fingerprint("linux-machine-id") == json.loads(out.stdout)["machineFingerprint"]
