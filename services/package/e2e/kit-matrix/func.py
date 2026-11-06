"""Functional operations for one installed config. Sections run only when the matching routes exist in the running backend."""
import json
import sys
import uuid
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:8080"
cfg = sys.argv[1]
OUT = f"/home/gslab/kv/out/{cfg}"
routes = json.load(open(f"{OUT}/routes.json"))
have = {p for _, p in routes}
results = []


def has(prefix):
    return any(p.startswith(prefix) for p in have)


def call(method, path, token=None, body=None, files=None, headers=None):
    h = dict(headers or {})
    data = None
    if files is not None:
        boundary = "kv" + uuid.uuid4().hex
        parts = []
        for name, (fname, content, ctype) in files.items():
            parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"; filename="{fname}"\r\nContent-Type: {ctype}\r\n\r\n'.encode() + content + b"\r\n")
        data = b"".join(parts) + f"--{boundary}--\r\n".encode()
        h["Content-Type"] = "multipart/form-data; boundary=" + boundary
    elif body is not None:
        data = json.dumps(body).encode()
        h["Content-Type"] = "application/json"
    if token:
        h["Authorization"] = "Bearer " + token
    req = urllib.request.Request(BASE + path, method=method, headers=h, data=data)
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            raw = r.read()
            status = r.status
    except urllib.error.HTTPError as e:
        raw, status = e.read(), e.code
    except Exception as e:
        return -1, {"error": str(e)}
    try:
        return status, json.loads(raw)
    except Exception:
        return status, raw.decode("utf-8", "replace")


def check(name, ok, detail=""):
    results.append({"name": name, "ok": bool(ok), "detail": str(detail)[:300]})
    print(("PASS  " if ok else "FAIL  ") + name + ("" if ok else "  :: " + str(detail)[:300]), flush=True)


def login(user, pw):
    s, j = call("POST", "/api/auth/login", body={"username": user, "password": pw})
    return j.get("access_token", "") if s == 200 and isinstance(j, dict) else ""


adm = login("admin", "changed-secret-123") or login("admin", "bootstrap-secret-1")
check("admin session", bool(adm))

# ---- users and roles (entry-permission-kit, always present) ----
s, roles = call("GET", "/api/roles", adm)
roles = {r["name"]: r for r in roles} if s == 200 else {}
check("roles admin/manager/operator/audit exist", {"admin", "manager", "operator", "audit"} <= set(roles), list(roles))
tok = {}
for name, role in (("mgr", "manager"), ("op", "operator"), ("aud", "audit")):
    s, j = call("POST", "/api/users", adm, {"username": name, "password": "initial-pass-123", "display_name": name, "role_id": roles[role]["id"]})
    if s == 409 or s == 400:
        pass  # rerun: user already exists
    else:
        check(f"admin creates {role}", s == 201, (s, j))
    t = login(name, "initial-pass-123")
    if t:
        call("POST", "/api/auth/change-password", t, {"current_password": "initial-pass-123", "new_password": "changed-secret-123"})
    tok[name] = login(name, "changed-secret-123")
    check(f"{role} can log in after the forced password change", bool(tok[name]))

if has("/api/forms"):
    s, _ = call("GET", "/api/forms", tok["op"])
    check("operator reads forms", s == 200, s)
    s, _ = call("POST", "/api/forms", tok["op"], {})
    check("operator cannot design forms (403)", s == 403, s)
    s, _ = call("POST", "/api/upload", tok["aud"]) if "/api/upload" in have else (403, None)
    check("audit cannot upload (403)", s == 403, s)

    # ---- forms, schema, CSV import ----
    s, j = call("POST", "/api/edit/reasons", adm, {"code": "kv-" + uuid.uuid4().hex[:6], "label": "verification"})
    reason = j.get("id") if s in (200, 201) and isinstance(j, dict) else None
    check("admin creates an edit reason", bool(reason), (s, j))
    code, code2 = "kv" + uuid.uuid4().hex[:6], "kw" + uuid.uuid4().hex[:6]
    for c_ in (code, code2):
        s, j = call("POST", "/api/forms", adm, {"code": c_, "name": "KV " + c_, "sort_order": 0})
        check(f"admin creates form {c_}", s in (200, 201), (s, j))
    fields = [{"name": "lot_no", "type": "string", "required": True, "is_key": True}, {"name": "qty", "type": "integer"}, {"name": "note", "type": "string"}]
    s, j = call("PUT", f"/api/forms/{code}/schema", adm, {"fields": fields, "reason_id": reason})
    check("admin defines the field schema", s in (200, 201), (s, j))

    def csv_file(text):
        return {"file": ("rows.csv", text.encode("utf-8"), "text/csv")}

    s, j = call("POST", f"/api/forms/{code}/import/preview", adm, files=csv_file("lot_no,qty,note\nL1,10,a\nL2,abc,b\nL3,5,c\n"))
    ok = s == 200 and isinstance(j, dict) and j.get("total") == 3 and j.get("valid_count") == 2 and len(j.get("errors", [])) == 1
    check("preview: 3 rows, 2 importable, 1 row error", ok, (s, j))
    msg = json.dumps(j.get("errors", []), ensure_ascii=False) if isinstance(j, dict) else ""
    check("row error is in business language (整數), no English type name", "整數" in msg and "integer" not in msg, msg)
    s, j = call("POST", f"/api/forms/{code}/import/commit", adm, files=csv_file("lot_no,qty,note\nL1,10,a\nL2,abc,b\nL3,5,c\n"))
    check("commit imports the 2 valid rows", s in (200, 202) and isinstance(j, dict) and j.get("imported") == 2, (s, j))
    s, j = call("POST", f"/api/forms/{code}/import/preview", adm, files=csv_file("lot_no,qty,note\nL1,10,a\nL4,7,d\n"))
    rows = j.get("preview_rows", []) if isinstance(j, dict) else []
    check("preview: duplicate counted once and left out of the table", isinstance(j, dict) and j.get("duplicate_count") == 1 and [r.get("lot_no") for r in rows] == ["L4"], (s, j))
    s, j = call("POST", f"/api/forms/{code}/import/preview", adm, files={"file": ("x.exe", bytes([0x4d,0x5a,0x90,0,3,0,0xff,0xfe,0,0,4,0]) * 40, "application/octet-stream")})
    check("non-CSV file is rejected with 422, not 500", s == 422, (s, j))
    s, j = call("POST", f"/api/forms/{code}/import/preview", adm, files=csv_file(""))
    check("empty file is rejected with 422", s == 422, (s, j))

    s, j = call("GET", f"/api/forms/{code}/records", adm)
    items = j.get("records", j) if isinstance(j, dict) else j
    check("records list shows the 2 imported rows", s == 200 and isinstance(items, list) and len(items) == 2, (s, str(j)[:200]))
    rid = items[0].get("id") if isinstance(items, list) and items else None

    if "/api/analytics/trend" in have:
        s, j = call("GET", f"/api/analytics/trend?code={code}&field=qty", adm)
        check("analytics: trend over a real form's numeric field answers (200)", s == 200, (s, str(j)[:200]))
        s, j = call("GET", f"/api/analytics/trend?code={code}&field=note", adm)
        check("analytics: trend on a text field is rejected (422)", s == 422, (s, str(j)[:200]))

    lot_path = next((p for p in have if p.endswith("/lot/{lot_no}")), None)
    trace_path = next((p for p in have if p.endswith("/trace/{lot_no}")), None)
    if lot_path:
        s, j = call("GET", lot_path.replace("{lot_no}", "L1"), adm)
        check("query: known lot L1 is found (200)", s == 200 and "L1" in json.dumps(j), (s, str(j)[:200]))
        s, j = call("GET", lot_path.replace("{lot_no}", "NO-SUCH-LOT"), adm)
        check("query: unknown lot answers an empty result without error (200/404, no 5xx)", s in (200, 404) and "NO-SUCH" not in json.dumps(j), (s, str(j)[:200]))
        s, j = call("GET", lot_path.replace("{lot_no}", "L1"), tok["aud"])
        check("query: audit role may read (not 401/403)", s not in (401, 403), s)
    if trace_path:
        s, j = call("GET", trace_path.replace("{lot_no}", "L1"), adm)
        check("trace: known lot answers without error (200/404, no 5xx)", s in (200, 404), (s, str(j)[:200]))
        s, j = call("GET", trace_path.replace("{lot_no}", "NO-SUCH-LOT"), adm)
        check("trace: unknown lot answers an empty graph without error (200/404, no 5xx)", s in (200, 404), (s, str(j)[:200]))

    if has("/api/edit/records") and rid:
        s, j = call("PATCH", f"/api/edit/records/{code}/{rid}", adm, {"reason_id": reason, "changes": {"qty": 99}})
        check("admin edits a record with a reason", s == 200, (s, j))
        s, j = call("GET", f"/api/forms/{code}/records", adm)
        items = j.get("records", j) if isinstance(j, dict) else j
        check("edited value is visible in the list", "99" in json.dumps(items), str(items)[:200])
        s, j = call("PATCH", f"/api/edit/records/{code}/{rid}", tok["op"], {"reason_id": reason, "changes": {"qty": 1}})
        check("operator edit follows the entry permission (not 401)", s != 401, (s, j))
    if rid:
        s, j = call("DELETE", f"/api/forms/{code}/records/{rid}", adm)
        check("admin deletes a record", s in (200, 204), (s, j))

    if has("/api/dataflows"):
        s, j = call("POST", "/api/dataflows/links", adm, {"flow_code": "kv", "from_station_code": code, "to_station_code": code2, "parent_column": "lot_no", "child_column": "lot_no"})
        check("admin creates a dataflow link", s in (200, 201), (s, j))
        s, j = call("GET", "/api/dataflows/links?flow_code=kv", adm)
        check("link appears in the list", s == 200 and code2 in json.dumps(j), (s, str(j)[:200]))
        s, j = call("DELETE", f"/api/dataflows/links/{code}/{code2}?flow_code=kv", adm)
        check("admin deletes the link", s in (200, 204), (s, j))

    for c_ in (code, code2):
        s, j = call("DELETE", f"/api/forms/{c_}", adm)
        check(f"admin deletes form {c_}", s in (200, 204), (s, j))

if has("/api/audit/events"):
    # The entry declaration and the endpoint now agree: only the system administrator reads audit events.
    s, _ = call("GET", "/api/audit/events", tok["aud"])
    check("audit role is refused audit events (403)", s == 403, s)
    s, j = call("GET", "/api/audit/events?limit=200", adm)
    events = j.get("items", j.get("events", [])) if isinstance(j, dict) else []
    actions = {e.get("action") for e in events if isinstance(e, dict)}
    check("admin reads audit events (200)", s == 200, (s, str(j)[:200]))
    check("audit events record the form operations performed above", {"forms.create", "forms.schema.save", "forms.import"} <= actions, sorted(a for a in actions if a))
    if has("/api/edit/records"):
        check("audit events record the record edit", "records.edit" in actions, sorted(a for a in actions if a))

if has("/api/analytics"):
    s, j = call("GET", "/api/analytics/trend?code=no-such-form", adm)
    check("analytics: trend on an unknown form gives 404, not 500", s == 404, (s, str(j)[:200]))
    s, j = call("GET", "/api/analytics/upload-history", adm)
    check("analytics: upload history answers (200)", s == 200, (s, str(j)[:200]))
    s, j = call("GET", "/api/analytics/upload-history/export", adm)
    check("analytics: upload history export answers (200)", s == 200, (s, str(j)[:200]))
    s, _ = call("GET", "/api/analytics/trend", tok["op"])
    check("analytics: operator is denied (403)", s == 403, s)
    s, _ = call("GET", "/api/analytics/trend", tok["aud"])
    check("analytics: audit role may read", s not in (401, 403), s)

if has("/api/logs"):
    s, j = call("GET", "/api/logs/", adm)
    check("logs: list answers (200)", s == 200, (s, str(j)[:200]))
    s, j = call("GET", "/api/logs/?log_type=user_action&limit=200", adm)
    logged = {e.get("action") for e in (j.get("items", []) if isinstance(j, dict) else [])}
    check("logs: form operations appear as user actions", {"forms.create", "forms.import"} <= logged, sorted(a for a in logged if a))
    s, j = call("GET", "/api/logs/summary", adm)
    check("logs: summary answers (200)", s == 200, (s, str(j)[:200]))
    s, _ = call("GET", "/api/logs/", tok["op"])
    check("logs: operator is denied (403)", s == 403, s)
    s, _ = call("GET", "/api/logs/", tok["aud"])
    check("logs: audit role may read (200)", s == 200, s)

if "/api/mod/subscriptions/webhook" in have:
    hook = "/api/mod/subscriptions/webhook"
    body = {"external_subscription_id": "s1", "event": "subscription.updated"}
    s, j = call("POST", hook, body=body)
    check("mod: webhook without secret -> 401", s == 401, (s, j))
    s, j = call("POST", hook, body=body, headers={"X-Mod-Webhook-Secret": "wrong"})
    check("mod: webhook with a wrong secret -> 401", s == 401, (s, j))
    s, j = call("POST", hook, body={}, headers={"X-Mod-Webhook-Secret": "kv-webhook-secret-0123456789-0123"})
    check("mod: right secret reaches the handler (400/422, not 401)", s in (200, 400, 422), (s, j))
    s, j = call("GET", "/api/mod/subscriptions/no-such-id", adm)
    check("mod: unknown subscription gives 404, not 500", s == 404, (s, str(j)[:200]))
    s, j = call("GET", "/api/mod/subscriptions/no-such-id/entitlements", adm)
    check("mod: unknown entitlements give 404, not 500", s == 404, (s, str(j)[:200]))

json.dump({"cfg": cfg, "results": results}, open(f"{OUT}/func.json", "w"), ensure_ascii=False, indent=1)
fails = [r for r in results if not r["ok"]]
print(f"SUMMARY {cfg}: {len(results) - len(fails)}/{len(results)} passed")
sys.exit(1 if fails else 0)
