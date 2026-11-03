"""License gate (D142, D143): serves the license status page and blocks everything else while the license is
invalid or the hardware does not match for too long.

It runs as the outermost middleware, so the license routes below never reach the entry-permission or
endpoint-permission middleware. Uploading needs no login on purpose: a blocked system has no usable session,
and only a license that passes the full chain, manifest and hardware check is ever written. Hardware matching
uses the guard container's report (license_hardware.py): warning, then 24 hours of grace, then blocked once the
block window is open; a guard that stops reporting is tolerated for 24 hours.
"""
import hashlib
import html
import json
import logging
import os
import tempfile
import threading
import time
from collections import deque
from datetime import datetime, timezone
from pathlib import Path

from starlette.responses import HTMLResponse, JSONResponse, RedirectResponse

from app.core import license as lic
from app import license_hardware as hw

logger = logging.getLogger(__name__)

OPEN_PATHS = frozenset({"/healthz"})
MAX_UPLOAD = 65536
RECHECK_SECONDS = 60
HARDWARE_RECHECK_SECONDS = 30
ATTEMPTS, WINDOW = 10, 60
DEFAULT_GUARD_FILE = "/guard/result.json"
DEFAULT_STATE_FILE = "/system/data/license-state.json"
MESSAGES = {
    "ok": "授權有效",
    "license-missing": "找不到授權檔",
    "root-key-missing": "找不到信任的根公鑰，安裝可能不完整",
    "manifest-missing": "找不到安裝包 manifest，安裝可能不完整",
    "malformed": "授權檔格式不符或已損毀",
    "signature": "授權簽章不符",
    "certificate": "授權的簽發憑證不被信任",
    "issued-outside-certificate": "授權簽發時間不在簽發憑證的有效期間內",
    "licensee-mismatch": "授權的客戶與簽發憑證不一致",
    "expired": "授權已到期",
    "manifest-mismatch": "授權不是為這個版本的安裝包簽發的",
    "hardware-mismatch": "授權與這台機器的硬體不符",
    "guard-unreachable": "硬體守衛超過容忍時間沒有回報，無法確認硬體",
    "throttled": "嘗試次數過多，請稍後再試",
    "too-large": "檔案過大",
}
HARDWARE_TEXT = {
    "unchecked": "尚未檢查（授權無效）",
    "pending": "等待硬體守衛第一次回報",
    "match": "硬體與授權相符",
    "grace": "硬體與授權不符，寬限期內仍可使用",
    "awaiting-window": "寬限期已到，將在下一個封鎖生效時段開始時停止服務",
    "blocked": "硬體與授權不符，已停止服務",
}
HEADERS = {"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer"}


def _message(code):
    return MESSAGES.get(code, "授權無法驗證")


class LicenseGate:
    def __init__(self, environ=None, clock=time.monotonic, now=None):
        self.environ = os.environ if environ is None else environ
        self.clock = clock
        self.now = now or (lambda: datetime.now(timezone.utc))
        self.lock = threading.Lock()
        self.cached = None
        self.stamp = None
        self.checked = 0.0
        self.attempts = deque()
        self.verdict = None
        self.verdict_stamp = None
        self.verdict_checked = 0.0
        self.window, self.zone = hw.settings(self.environ)

    def files(self):
        get = self.environ.get
        return (get("LICENSE_FILE", lic.DEFAULT_LICENSE_FILE), get("LICENSE_ROOT_KEY_FILE", lic.DEFAULT_ROOT_KEY_FILE),
                get("SYSTEM_MANIFEST_FILE", lic.DEFAULT_MANIFEST_FILE))

    def guard_file(self):
        return self.environ.get("GUARD_RESULT_FILE", DEFAULT_GUARD_FILE)

    def state_file(self):
        return self.environ.get("LICENSE_STATE_FILE", DEFAULT_STATE_FILE)

    @staticmethod
    def _marks(names):
        marks = []
        for name in names:
            try:
                info = os.stat(name)
                marks.append((info.st_mtime_ns, info.st_size))
            except OSError:
                marks.append(None)
        return tuple(marks)

    def result(self):
        """Re-verify when a file changed or after RECHECK_SECONDS (a license can expire while running)."""
        with self.lock:
            now = self.clock()
            stamp = self._marks(self.files())
            if self.cached is None or stamp != self.stamp or now - self.checked >= RECHECK_SECONDS:
                self.cached = lic.installed_license(self.environ, self.now())
                self.stamp, self.checked = stamp, now
                if not self.cached.valid:
                    logger.warning("License is not valid: %s", self.cached.code)
            return self.cached

    def report(self):
        return hw.read_report(self.guard_file(), self.now())

    def hardware(self):
        """What the guard's report means for the license now; persists grace and block timestamps."""
        current = self.result()
        with self.lock:
            now = self.clock()
            stamp = (self._marks([self.guard_file()]), id(current))
            if self.verdict is not None and stamp == self.verdict_stamp and now - self.verdict_checked < HARDWARE_RECHECK_SECONDS:
                return self.verdict
            state = hw.load_state(self.state_file())
            before = dict(state)
            verdict = hw.evaluate(state, self.report(), current, self.now(), self.window, self.zone)
            if state != before:
                try:
                    hw.save_state(self.state_file(), state)
                except OSError:
                    logger.error("License state could not be saved; grace timing may restart")
                if verdict.warning and not before.get("mismatchSince"):
                    logger.warning("Hardware does not match the license (%s)", verdict.reason)
            self.verdict, self.verdict_stamp, self.verdict_checked = verdict, stamp, now
            return verdict

    def throttled(self):
        now = self.clock()
        while self.attempts and now - self.attempts[0] > WINDOW:
            self.attempts.popleft()
        if len(self.attempts) >= ATTEMPTS:
            return True
        self.attempts.append(now)
        return False

    def install(self, text):
        """Write the uploaded license only if it verifies against the root key, the manifest and this hardware."""
        path, root_file, manifest_file = self.files()
        try:
            root = Path(root_file).read_text("utf-8-sig")
            manifest = Path(manifest_file).read_bytes()
        except OSError:
            return lic.LicenseResult(False, "root-key-missing", "trust files unavailable")
        result = lic.verify_license_text(text, root, hashlib.sha256(manifest).hexdigest(), self.now())
        if not result.valid:
            return result
        report = self.report()
        if report is None or self.now() - report.generated_at > hw.UNREACHABLE_TOLERANCE:
            return lic.LicenseResult(False, "guard-unreachable", "no recent hardware report", licensee=result.licensee)
        if not lic.fingerprint_matches(result, report.hashes)[0]:
            return lic.LicenseResult(False, "hardware-mismatch", "license does not match this hardware", licensee=result.licensee)
        directory = Path(path).parent
        handle, temporary = tempfile.mkstemp(prefix=".license-", suffix=".tmp", dir=directory)
        try:
            with os.fdopen(handle, "w", encoding="utf-8") as stream:
                stream.write(text)
                stream.flush()
                os.fsync(stream.fileno())
            os.chmod(temporary, 0o644)
            os.replace(temporary, path)  # readers see the old or the new file, never a partial one
        except OSError:
            Path(temporary).unlink(missing_ok=True)
            return lic.LicenseResult(False, "license-missing", "license file could not be written")
        with self.lock:
            self.cached = None
            self.verdict = None
        return result

    def rebind_request(self):
        """What the issuer needs to bind a new license to this machine; hashes only, never raw serials."""
        report = self.report()
        if report is None:
            return None
        try:
            system_id = json.loads(Path(self.files()[2]).read_text("utf-8")).get("systemId", "")
            manifest_sha256 = hashlib.sha256(Path(self.files()[2]).read_bytes()).hexdigest()
        except (OSError, ValueError, AttributeError):
            return None
        return {"format": "composer-rebind-request", "version": 1, "generatedAt": hw.stamp(self.now()),
                "systemId": system_id, "licensee": self.result().licensee, "manifestSha256": manifest_sha256,
                "reportAt": hw.stamp(report.generated_at),
                "sources": [{"source": s, "sha256": h} for s, h in report.sources]}


GATE = LicenseGate()


def describe(result, verdict):
    return {"valid": result.valid, "code": result.code, "message": _message(result.code), "licensee": result.licensee,
            "expiresAt": result.expires_at, "systemId": result.system_id,
            "hardware": {**verdict.as_dict(), "message": HARDWARE_TEXT.get(verdict.status, "")}}


def warning_header(verdict):
    if not verdict.warning:
        return None
    detail = "blocked" if verdict.blocked else ("block-from=" + verdict.block_from if verdict.block_from else "grace-ends=" + verdict.grace_ends_at)
    return "hardware-mismatch; " + detail


def page(result, verdict, outcome=None):
    rows = [("狀態", _message(result.code))]
    if result.licensee:
        rows += [("客戶", result.licensee), ("到期日", result.expires_at)]
    rows.append(("硬體綁定", HARDWARE_TEXT.get(verdict.status, "")))
    if verdict.status in hw.WARNING_STATES:
        rows.append(("不符起算時間（UTC）", verdict.since))
        rows.append(("寬限期結束（UTC）", verdict.grace_ends_at))
        if verdict.block_from:
            rows.append(("預計停止服務（UTC）", verdict.block_from))
    if verdict.matched is not None:
        rows.append(("符合的硬體來源", f"{verdict.matched} 項（至少需要 {verdict.min_match} 項）"))
    cells = "".join(f"<tr><th scope=row>{html.escape(k)}</th><td>{html.escape(v)}</td></tr>" for k, v in rows)
    banner = ""
    if outcome:
        banner = f"<p role=status class={'ok' if outcome == 'ok' else 'bad'}>{html.escape(_message(outcome))}</p>"
    warn = "<p role=alert class=bad>硬體與授權不符，請向發行端申請重新綁定。</p>" if verdict.warning else ""
    body = f"""<!doctype html><html lang=zh-Hant><meta charset=utf-8><meta name=viewport content="width=device-width, initial-scale=1">
<title>授權狀態</title>
<style>body{{margin:0;background:#f6f8f9;color:#172b3a;font:1rem/1.6 system-ui,"Microsoft JhengHei",sans-serif}}
main{{max-width:40rem;margin:0 auto;padding:1rem}}section{{background:#fff;border:1px solid #c7d0d8;border-radius:.75rem;padding:1.5rem}}
th{{text-align:left;padding:.5rem 1rem .5rem 0;color:#40576a;font-weight:normal}}td{{padding:.5rem 0}}
input,button,a.button{{min-height:44px;font:inherit}}button,a.button{{display:inline-block;box-sizing:border-box;padding:.5rem 1.5rem;border:1px solid #075e54;border-radius:.5rem;background:#075e54;color:#fff;text-decoration:none}}
a.secondary{{background:#fff;color:#075e54}}:focus-visible{{outline:3px solid #174ea6;outline-offset:2px}}.ok{{color:#075e54}}.bad{{color:#a32222}}</style>
<main><h1>授權狀態</h1><section>{banner}{warn}<table>{cells}</table>
<h2>更換硬體或重新綁定</h2><p>先下載申請檔交給發行端，取得新的授權檔後在下方上傳。</p>
<p><a class="button secondary" href=/api/license/rebind-request download=rebind-request.json>下載重新綁定申請檔</a></p>
<h2>上傳新的授權檔</h2><form method=post action=/api/license/upload enctype=multipart/form-data>
<label>授權檔（license.lic）<br><input type=file name=license required></label><p><button type=submit>驗證並安裝</button></p></form>
<p>授權檔由發行端簽發；只有通過簽章、安裝包與硬體核對的授權才會被安裝。</p></section></main>"""
    return HTMLResponse(body, headers={**HEADERS, "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"})


async def _upload(request, gate):
    if gate.throttled():
        return "throttled", None
    length = request.headers.get("content-length")
    if not length or not length.isdigit() or int(length) > MAX_UPLOAD + 4096:
        return "too-large", None
    if request.headers.get("content-type", "").startswith("multipart/form-data"):
        form = await request.form()
        try:
            item = form.get("license")
            data = await item.read(MAX_UPLOAD + 1) if hasattr(item, "read") else b""
        finally:
            await form.close()
    else:
        data = await request.body()
    if len(data) > MAX_UPLOAD:
        return "too-large", None
    try:
        text = data.decode("utf-8-sig")
    except UnicodeError:
        return "malformed", None
    result = gate.install(text)
    return result.code, result


async def license_gate_middleware(request, call_next, gate=None):
    gate = gate or GATE
    path = request.url.path
    if path == "/license" and request.method in ("GET", "HEAD"):
        return page(gate.result(), gate.hardware(), request.query_params.get("result"))
    if path == "/api/license/status" and request.method == "GET":
        return JSONResponse(describe(gate.result(), gate.hardware()), headers=HEADERS)
    if path == "/api/license/rebind-request" and request.method == "GET":
        value = gate.rebind_request()
        if value is None:
            return JSONResponse({"code": "guard-unreachable", "message": _message("guard-unreachable")}, status_code=503, headers=HEADERS)
        return JSONResponse(value, headers={**HEADERS, "Content-Disposition": "attachment; filename=rebind-request.json"})
    if path == "/api/license/upload" and request.method == "POST":
        code, result = await _upload(request, gate)
        if request.headers.get("content-type", "").startswith("multipart/form-data"):
            return RedirectResponse("/license?result=" + code, status_code=303, headers=HEADERS)
        status = 200 if code == "ok" else (429 if code == "throttled" else 400)
        return JSONResponse({"code": code, "message": _message(code), "valid": code == "ok"}, status_code=status, headers=HEADERS)
    if path in OPEN_PATHS:
        return await call_next(request)
    current = gate.result()
    if not current.valid:
        return JSONResponse({"detail": "license-invalid", "code": current.code, "message": _message(current.code),
                             "statusPage": "/license"}, status_code=503, headers=HEADERS)
    verdict = gate.hardware()
    if verdict.blocked:
        code = "guard-unreachable" if verdict.reason == "guard-unreachable" else "hardware-mismatch"
        return JSONResponse({"detail": "license-invalid", "code": code, "message": _message(code), "statusPage": "/license"},
                            status_code=503, headers=HEADERS)
    response = await call_next(request)
    warning = warning_header(verdict)
    if warning:
        response.headers["X-License-Warning"] = warning  # the future front end shows the banner from this and the status API
    return response
