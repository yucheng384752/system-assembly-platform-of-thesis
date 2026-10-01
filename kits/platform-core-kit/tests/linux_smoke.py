"""Linux smoke test for license.py using only the standard library plus the system `cryptography`.

Run on a target machine without pytest or pip (for example Ubuntu 22.04 with its stock
cryptography 3.4.8):  python3 linux_smoke.py <license.py> <get-machine-fingerprint.sh> [license.lic public-key.pem]

Checks, in order:
  1. the shell fingerprint tool and license.py compute the same value for /etc/machine-id;
  2. a license signed here for this machine's fingerprint is accepted, and one for another machine is refused;
  3. optionally, a license.lic signed elsewhere (by the Node tool) is accepted with the given public key.
"""
from __future__ import annotations

import base64
import importlib.util
import json
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path


def load(path: Path):
    spec = importlib.util.spec_from_file_location("composer_license", path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def check(label: str, condition: bool, detail: str = "") -> bool:
    print(("PASS " if condition else "FAIL ") + label + (f" -- {detail}" if detail and not condition else ""))
    return condition


def main() -> int:
    license_py, tool = Path(sys.argv[1]), Path(sys.argv[2])
    module = load(license_py)
    ok = True

    out = subprocess.run(["sh", str(tool)], capture_output=True, text=True, check=True).stdout
    tool_value = json.loads(out)
    runtime = module.machine_fingerprint("linux-machine-id")
    ok &= check("fingerprint tool reports linux-machine-id", tool_value["fingerprintSource"] == "linux-machine-id")
    ok &= check("license.py and the shell tool compute the same fingerprint", runtime == tool_value["machineFingerprint"], f"{runtime} vs {tool_value['machineFingerprint']}")
    ok &= check("windows-machine-guid cannot be read on Linux", module.machine_fingerprint("windows-machine-guid") is None)

    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import padding, rsa
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    module._PUBLIC_KEY_PEM = key.public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo).decode()

    def issue(fingerprint: str, source: str = "linux-machine-id", days: int = 365) -> str:
        now = datetime.now(timezone.utc)
        body = json.dumps({"schemaVersion": "2.0", "issuedAt": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
                           "expiresAt": (now + timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%SZ"), "licensee": {"name": "linux-smoke"},
                           "recipe": "smoke", "enabledKits": ["platform-core-kit"], "machineFingerprint": fingerprint,
                           "fingerprintSource": source, "packageManifestSha256": "b" * 64}, separators=(",", ":"))
        sig = key.sign(body.encode(), padding.PSS(mgf=padding.MGF1(hashes.SHA256()), salt_length=32), hashes.SHA256())
        return json.dumps({"payload": body, "signature": base64.b64encode(sig).decode(), "algorithm": "RSA-PSS-SHA256"})

    mine = module.verify_license_text(issue(tool_value["machineFingerprint"]))
    ok &= check("license for this machine is accepted", mine.valid, mine.reason)
    other = module.verify_license_text(issue("c" * 64))
    ok &= check("license for another machine is refused", not other.valid and "different machine" in other.reason, other.reason)
    expired = module.verify_license_text(issue(tool_value["machineFingerprint"], days=-1))
    ok &= check("expired license is refused", expired.reason == "license expired", expired.reason)
    wrong = module.verify_license_text(issue(tool_value["machineFingerprint"], source="windows-machine-guid"))
    ok &= check("license for the Windows source cannot be checked on Linux", not wrong.valid and "cannot read the windows-machine-guid" in wrong.reason, wrong.reason)

    if len(sys.argv) >= 5:
        module._PUBLIC_KEY_PEM = Path(sys.argv[4]).read_text()
        foreign = module.verify_license_text(Path(sys.argv[3]).read_text("utf-8-sig"))
        ok &= check("license signed by the Node tool is accepted", foreign.valid, foreign.reason)

    print("ALL PASSED" if ok else "SOME FAILED")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
