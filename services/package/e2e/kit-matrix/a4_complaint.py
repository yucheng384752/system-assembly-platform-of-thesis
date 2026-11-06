"""Complaint-mode run of analytical-four-kit with all three layers, against a local stand-in for the AI service,
then the feedback flow: submit, approve, publish, and a second run that uses the published case version.
Run on the VM after a config that contains analytical-four-kit is installed (see README.md)."""
import json
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer

BASE = "http://127.0.0.1:8080"
LLM_PORT = 18900
LLM_HOST = "192.168.200.63"
results = []
llm_calls = []


class Stub(BaseHTTPRequestHandler):
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
        llm_calls.append(body)
        data = json.dumps({"diagnosis": "stand-in answer", "event_id": body.get("new_event", {}).get("event_id")}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *args):
        pass


server = HTTPServer(("0.0.0.0", LLM_PORT), Stub)
threading.Thread(target=server.serve_forever, daemon=True).start()


def call(method, path, token=None, body=None):
    headers = {"Content-Type": "application/json"} if body is not None else {}
    if token:
        headers["Authorization"] = "Bearer " + token
    request = urllib.request.Request(BASE + path, method=method, headers=headers, data=json.dumps(body).encode() if body is not None else None)
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            raw, status = response.read(), response.status
    except urllib.error.HTTPError as error:
        raw, status = error.read(), error.code
    try:
        return status, json.loads(raw)
    except ValueError:
        return status, raw.decode("utf-8", "replace")


def check(name, ok, detail=""):
    results.append(bool(ok))
    print(("PASS  " if ok else "FAIL  ") + name + ("" if ok else "  :: " + str(detail)[:400]), flush=True)


def login(user):
    status, body = call("POST", "/api/auth/login", body={"username": user, "password": "changed-secret-123"})
    return body.get("access_token", "") if status == 200 else ""


adm, mgr, op = login("admin"), login("mgr"), login("op")
check("sessions for admin, manager and operator", all((adm, mgr, op)))

check("demo data loads", call("POST", "/api/analytical-four/demo", adm)[0] in (200, 201))
settings = {"schemaVersion": 1, "layers": {"a": True, "b": True, "c": True}, "mode": "complain",
            "analysisConfig": "config/analysis_config_complaint.json",
            "llm": {"endpoint": f"http://{LLM_HOST}:{LLM_PORT}/v1/diagnose", "timeoutSeconds": 30, "apiKeyEnv": ""},
            "columnMapping": {}}
status, body = call("PUT", "/api/analytical-four/settings", adm, settings)
check("settings accept complaint mode with all layers", status == 200, (status, body))
status, body = call("PUT", "/api/analytical-four/settings", op, settings)
check("operator cannot change settings (403)", status == 403, status)
bad = json.loads(json.dumps(settings))
bad["llm"]["endpoint"] = "http://user:secret@host/x"
status, _ = call("PUT", "/api/analytical-four/settings", adm, bad)
check("an address with credentials is refused (422)", status == 422, status)

status, body = call("GET", "/api/analytical-four/status", adm)
print("status:", json.dumps(body, ensure_ascii=False)[:600])
check("every layer is ready", status == 200 and all(layer["ready"] for layer in body["readiness"].values()), body)
status, body = call("GET", "/api/analytical-four/data-check", adm)
check("data check passes for the complaint data", status == 200 and body.get("ok", True), body)


def run_once(label):
    status, body = call("POST", "/api/analytical-four/runs", adm)
    check(f"{label}: run starts (202)", status == 202, (status, body))
    run_id = body.get("runId")
    for _ in range(120):
        time.sleep(2)
        status, detail = call("GET", f"/api/analytical-four/runs/{run_id}", adm)
        state = detail.get("state") if isinstance(detail, dict) else None
        if state in ("succeeded", "failed"):
            break
    check(f"{label}: run completes", state == "succeeded", json.dumps(detail, ensure_ascii=False)[:500])
    return run_id, detail


run_id, detail = run_once("complaint run")
print("stages:", [stage["id"] + ":" + stage["state"] + ":" + stage["detail"] for stage in detail.get("stages", [])])
status, listing = call("GET", f"/api/analytical-four/runs/{run_id}/results", adm)
names = listing.get("results", []) if isinstance(listing, dict) else []
check("result files include the AI responses", any("llm" in name.lower() for name in names), names[:12])
check("the stand-in AI service answered every event", len(llm_calls) >= 6, len(llm_calls))
events = [name for name in names if name.startswith("serialized_events/")]
event_id = None
if events:
    event_id = events[0].split("event_")[-1].replace(".json", "")
check("an event is available for feedback", bool(event_id), names[:5])

status, body = call("POST", "/api/analytical-four/feedback", op, {"runId": run_id, "eventId": event_id, "confirmedNg": "NG-NEW-001", "actualCause": "stand-in cause", "note": "operator"})
check("operator submission is accepted as pending", status == 201 and body.get("status") == "pending", (status, body))
fid = body.get("feedbackId") if isinstance(body, dict) else None
status, _ = call("POST", f"/api/analytical-four/feedback/{fid}/decision", op, {"approve": True})
check("operator cannot approve (403)", status == 403, status)
status, body = call("POST", f"/api/analytical-four/feedback/{fid}/decision", mgr, {"approve": True, "note": "ok"})
check("manager approves", status == 200 and body.get("status") == "approved", (status, body))
status, body = call("POST", "/api/analytical-four/library/publish", mgr)
check("publishing creates a case library version", status == 201, (status, body))
status, body = call("GET", "/api/analytical-four/library/versions", adm)
check("the version is listed", status == 200 and len(body.get("versions", [])) >= 1, body)
status, body = call("POST", "/api/analytical-four/feedback", mgr, {"runId": run_id, "eventId": event_id, "confirmedNg": "NG-NEW-001", "actualCause": "again"})
print("manager direct submission:", status, json.dumps(body, ensure_ascii=False)[:200])
check("a manager's submission takes effect at once", status == 201 and body.get("status") == "approved", (status, body))

run_once("second complaint run after publish")
print(f"SUMMARY a4-complaint: {sum(results)}/{len(results)} passed")
server.shutdown()
