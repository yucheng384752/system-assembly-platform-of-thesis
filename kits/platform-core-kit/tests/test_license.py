"""License 3.0 verification (composer-refactor D129 to D132, D142).

Each test states the business reason it guards: a license must only start the package it was issued
for, must come from the offline root key through a sub-key certificate, must never be accepted by
accident (wrong root, edited payload, old format), and must survive the sub-key certificate expiring.
"""
from __future__ import annotations

import base64
import hashlib
import importlib.util
import json
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa

REPO = Path(__file__).resolve().parents[3]
LICENSE_PY = REPO / "kits" / "platform-core-kit" / "src" / "backend" / "app" / "core" / "license.py"
NOW = datetime(2026, 10, 28, 12, 0, 0, tzinfo=timezone.utc)
MANIFEST = b'{"format":"composer-system-assembly","systemId":"demo"}'
MANIFEST_SHA = hashlib.sha256(MANIFEST).hexdigest()
HARDWARE = [("product_uuid", "1" * 64), ("board_serial", "2" * 64), ("mac:eth0", "3" * 64)]


def load_module():
    spec = importlib.util.spec_from_file_location("composer_license_v3", LICENSE_PY)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module  # dataclasses resolves string annotations through sys.modules
    spec.loader.exec_module(module)
    return module


lic = load_module()


def pem_public(key) -> str:
    return key.public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo).decode()


def key_id(key) -> str:
    der = key.public_key().public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
    return hashlib.sha256(der).hexdigest()


def sign(payload, key, raw=None) -> dict:
    text = raw if raw is not None else json.dumps(payload, separators=(",", ":"))
    signature = key.sign(text.encode(), padding.PSS(mgf=padding.MGF1(hashes.SHA256()), salt_length=32), hashes.SHA256())
    return {"payload": text, "signature": base64.b64encode(signature).decode(), "algorithm": "RSA-PSS-SHA256"}


def stamp(moment: datetime) -> str:
    return moment.strftime("%Y-%m-%dT%H:%M:%SZ")


class LicenseV3Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.root = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        cls.sub = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        cls.other = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        cls.root_pem = pem_public(cls.root)

    def certificate(self, **change):
        payload = {"schemaVersion": "1.0", "keyId": key_id(self.sub), "issuerKeyId": key_id(self.root),
                   "subjectPublicKey": pem_public(self.sub), "licensee": {"name": "demo-client"},
                   "notBefore": stamp(NOW - timedelta(hours=1)), "notAfter": stamp(NOW + timedelta(hours=23))}
        payload.update(change)
        return sign(payload, self.root)

    def payload(self, **change):
        value = {"schemaVersion": "3.0", "issuedAt": stamp(NOW), "expiresAt": stamp(NOW + timedelta(days=365)),
                 "licensee": {"name": "demo-client"}, "systemId": "demo", "recipe": "demo", "enabledKits": ["a", "b"],
                 "fingerprint": {"minMatch": 2, "sources": [{"source": s, "sha256": h} for s, h in HARDWARE]},
                 "packageManifestSha256": MANIFEST_SHA}
        value.update(change)
        return value

    def license(self, payload=None, certificate=None, signer=None, raw=None):
        envelope = sign(payload or self.payload(), signer or self.sub, raw)
        return {**envelope, "issuerCertificate": certificate or self.certificate()}

    def verify(self, value, root_pem=None, manifest=MANIFEST_SHA, now=NOW):
        text = value if isinstance(value, str) else json.dumps(value)
        return lic.verify_license_text(text, root_pem or self.root_pem, manifest, now)

    def rejected(self, result, code):
        self.assertFalse(result.valid)
        self.assertEqual(result.code, code, result.reason)

    def test_valid_chain_is_accepted_and_exposes_license_facts(self):
        result = self.verify(self.license())
        self.assertTrue(result.valid, result.reason)
        self.assertEqual((result.licensee, result.system_id, result.enabled_kits), ("demo-client", "demo", ("a", "b")))
        self.assertEqual(result.sources, tuple(HARDWARE))

    def test_license_signed_by_a_key_the_root_never_certified_is_rejected(self):
        self.rejected(self.verify(self.license(signer=self.other)), "signature")

    def test_wrong_root_is_rejected(self):
        self.rejected(self.verify(self.license(), root_pem=pem_public(self.other)), "certificate")

    def test_certificate_signed_by_someone_else_is_rejected(self):
        forged = sign(json.loads(self.certificate()["payload"]), self.other)
        self.rejected(self.verify(self.license(certificate=forged)), "certificate")

    def test_certificate_naming_another_issuer_or_key_is_rejected(self):
        self.rejected(self.verify(self.license(certificate=self.certificate(issuerKeyId="0" * 64))), "certificate")
        self.rejected(self.verify(self.license(certificate=self.certificate(keyId="0" * 64))), "certificate")

    def test_edited_payload_is_rejected(self):
        value = self.license()
        value["payload"] = value["payload"].replace("demo-client", "other-client")
        self.rejected(self.verify(value), "signature")

    def test_license_issued_outside_the_certificate_interval_is_rejected(self):
        late = self.payload(issuedAt=stamp(NOW + timedelta(days=2)))
        self.rejected(self.verify(self.license(late)), "issued-outside-certificate")

    def test_license_survives_the_certificate_expiring_after_issuance(self):
        # The sub-key is short lived on purpose; the license it issued must keep working.
        self.assertTrue(self.verify(self.license(), now=NOW + timedelta(days=30)).valid)

    def test_licensee_must_match_the_certificate(self):
        self.rejected(self.verify(self.license(self.payload(licensee={"name": "someone-else"}))), "licensee-mismatch")

    def test_expired_license_is_refused_but_still_reports_who_it_belongs_to(self):
        result = self.verify(self.license(self.payload(expiresAt=stamp(NOW - timedelta(seconds=1)))))
        self.rejected(result, "expired")
        self.assertEqual(result.licensee, "demo-client")

    def test_license_for_another_package_is_refused(self):
        result = self.verify(self.license(), manifest="f" * 64)
        self.rejected(result, "manifest-mismatch")
        self.assertEqual(result.system_id, "demo")

    def test_old_format_and_junk_are_rejected_not_ignored(self):
        old = {"schemaVersion": "2.0", "machineFingerprint": "a" * 64}
        self.rejected(self.verify(self.license(payload=old)), "malformed")
        for junk in ("", "not json", "[]", "null", json.dumps({"payload": "x"})):
            self.rejected(self.verify(junk), "malformed")
        self.assertFalse(lic.verify_license_text(None, self.root_pem, MANIFEST_SHA, NOW).valid)

    def test_payload_contract_violations_are_rejected(self):
        fewer = self.payload(fingerprint={"minMatch": 2, "sources": [{"source": s, "sha256": h} for s, h in HARDWARE[:2]]})
        duplicate = self.payload(fingerprint={"minMatch": 2, "sources": [{"source": "mac:eth0", "sha256": str(i) * 64} for i in range(3)]})
        for bad in (fewer, duplicate, self.payload(extra=True), self.payload(enabledKits=[]), self.payload(enabledKits=["a", "a"]),
                    self.payload(expiresAt="2027-02-30T00:00:00Z"), self.payload(systemId="Bad_Id")):
            self.rejected(self.verify(self.license(bad)), "malformed")

    def test_unsupported_algorithm_and_bad_signature_encoding_are_rejected(self):
        value = self.license()
        self.rejected(self.verify({**value, "algorithm": "RSA-PKCS1"}), "malformed")
        self.rejected(self.verify({**value, "signature": "!!!"}), "malformed")

    def test_matching_counts_distinct_hashes_and_ignores_source_names(self):
        result = self.verify(self.license())
        self.assertEqual(lic.fingerprint_matches(result, ["1" * 64, "2" * 64]), (True, 2))
        self.assertEqual(lic.fingerprint_matches(result, ["1" * 64, "9" * 64]), (False, 1))
        # One machine value appearing under two interface names must not be counted twice.
        self.assertEqual(lic.fingerprint_matches(result, ["1" * 64, "1" * 64]), (False, 1))

    def test_installed_license_reads_the_mounted_files_and_names_what_is_missing(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            env = {"LICENSE_FILE": str(base / "license.lic"), "LICENSE_ROOT_KEY_FILE": str(base / "root.pem"),
                   "SYSTEM_MANIFEST_FILE": str(base / "manifest.json")}
            self.assertEqual(lic.installed_license(env, NOW).code, "root-key-missing")
            (base / "root.pem").write_text(self.root_pem)
            self.assertEqual(lic.installed_license(env, NOW).code, "manifest-missing")
            (base / "manifest.json").write_bytes(MANIFEST)
            self.assertEqual(lic.installed_license(env, NOW).code, "license-missing")
            (base / "license.lic").write_text(json.dumps(self.license()))
            self.assertTrue(lic.installed_license(env, NOW).valid)
            (base / "manifest.json").write_bytes(MANIFEST + b" ")
            self.assertEqual(lic.installed_license(env, NOW).code, "manifest-mismatch")


if __name__ == "__main__":
    unittest.main()
