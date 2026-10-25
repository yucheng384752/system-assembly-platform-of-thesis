import json
import subprocess
import sys

import httpx

BASE = "http://127.0.0.1:18080"
ENV = sys.argv[1]
TENANT = "00000000-0000-4000-8000-000000000001"
OTHER = "00000000-0000-4000-8000-0000000000ff"
results = []
ADMIN_PW, NEW_PW = "bootstrap-secret-1", "changed-secret-123"


def check(name, ok, detail=""):
    results.append(bool(ok))
    print(("PASS  " if ok else "FAIL  ") + name + ("" if ok else "  :: " + str(detail)[:300]), flush=True)


def psql(sql):
    out = subprocess.run(["docker", "compose", "-p", "wp3a", "--env-file", ENV, "-f", "docker-compose.yml", "exec", "-T", "postgres",
                          "psql", "-U", "sysuser", "-d", "sysdb", "-Atc", sql], capture_output=True, text=True, encoding="utf-8")
    return out.stdout.strip()


def login(c, user, pw):
    return c.post("/api/auth/login", json={"username": user, "password": pw})


def bearer(t):
    return {"Authorization": "Bearer " + t}


c = httpx.Client(base_url=BASE, timeout=30)
r = c.get("/healthz")
check("healthz through the proxy", r.status_code == 200, r.text)
r = c.get("/")
check("proxy root says the frontend is not included (503)", r.status_code == 503 and "前端" in r.text, (r.status_code, r.text))
check("no credentials -> 401", c.get("/api/forms").status_code == 401)
check("machine API key is not provided -> 401", c.get("/api/forms", headers={"X-Admin-API-Key": "anything"}).status_code == 401)

bad1 = login(c, "admin", "wrong-password-xx")
bad2 = login(c, "nobody", "wrong-password-xx")
check("unknown user and wrong password give identical 401", bad1.status_code == 401 and bad1.json() == bad2.json(), (bad1.text, bad2.text))
r = login(c, "admin", ADMIN_PW)
check("bootstrap admin logs in", r.status_code == 200, r.text)
t = r.json().get("access_token", "")
check("forced password change blocks business endpoints", c.get("/api/forms", headers=bearer(t)).status_code == 403)
r = c.post("/api/auth/change-password", headers=bearer(t), json={"current_password": ADMIN_PW, "new_password": NEW_PW})
check("admin changes the password", r.status_code == 200, r.text)
adm = bearer(t)
check("admin reads forms", c.get("/api/forms", headers=adm).status_code == 200)
check("tenant header other than the default is rejected", c.get("/api/forms", headers={**adm, "X-Tenant-Id": OTHER}).status_code == 403)
check("default tenant header accepted", c.get("/api/forms", headers={**adm, "X-Tenant-Id": TENANT}).status_code == 200)

roles = {x["name"]: x for x in c.get("/api/roles", headers=adm).json()}
users = {}
for name, role in (("mgr", "manager"), ("op", "operator"), ("aud", "audit")):
    r = c.post("/api/users", headers=adm, json={"username": name, "password": "initial-pass-123", "display_name": name, "role_id": roles[role]["id"]})
    check("admin creates " + role, r.status_code == 201, r.text)
    users[name] = r.json()
S = {}
for name in users:
    s = login(c, name, "initial-pass-123").json().get("access_token", "")
    c.post("/api/auth/change-password", headers=bearer(s), json={"current_password": "initial-pass-123", "new_password": NEW_PW})
    S[name] = bearer(login(c, name, NEW_PW).json().get("access_token", ""))


def code(method, path, who, **kw):
    return c.request(method, path, headers=who, **kw).status_code


# Real entry directory (permissions/entry_points.json), not a test fixture.
check("operator reads forms (forms.read)", code("GET", "/api/forms", S["op"]) == 200)
check("operator cannot design forms (forms.design is admin, manager)", code("POST", "/api/forms", S["op"], json={}) == 403)
check("manager passes forms.design (body error, not authorization)", code("POST", "/api/forms", S["mgr"], json={}) not in (401, 403))
check("operator may use upload.run (validation error, not authorization)", code("POST", "/api/upload", S["op"]) not in (401, 403))
check("audit cannot use upload.run (readonly)", code("POST", "/api/upload", S["aud"]) == 403)
check("audit reads logs (logs.read) and the endpoint works (200, table exists)", code("GET", "/api/logs/", S["aud"]) == 200)
check("log summary works (200)", code("GET", "/api/logs/summary", S["aud"]) == 200)
check("operator cannot read logs", code("GET", "/api/logs/", S["op"]) == 403)
check("operator cannot read analytics", code("GET", "/api/analytics/trend", S["op"]) == 403)
check("audit reads analytics", code("GET", "/api/analytics/trend", S["aud"]) not in (401, 403))
check("operator can read the contract list", code("GET", "/api/kit/contracts", S["op"]) == 200)
check("operator cannot use the generic kit proxy", code("POST", "/api/kit/call/db.forms.list", S["op"], json={}) == 403)
check("manager can use the generic kit proxy (read)", code("POST", "/api/kit/call/db.forms.list", S["mgr"], json={}) not in (401, 403))
check("manager cannot read endpoint permissions", code("GET", "/api/admin/endpoint-permissions", S["mgr"]) == 403)
check("admin reads endpoint permissions", code("GET", "/api/admin/endpoint-permissions", adm) == 200)
check("uncatalogued route: operator denied", code("GET", "/api/zzz-unknown", S["op"]) == 403)
check("uncatalogued route: admin passes the entry layer (404 from the app)", code("GET", "/api/zzz-unknown", adm) == 404)
r = c.post("/api/edit/reasons", headers=S["op"], json={"code": "x1", "label": "x"})
check("operator denied by the entry layer for edit.reasons_manage", r.status_code == 403)
r = c.post("/api/edit/reasons", headers=S["mgr"], json={"code": "x2", "label": "x"})
check("manager passes both layers for edit reasons", r.status_code not in (401, 403), (r.status_code, r.text))

hook = "/api/mod/subscriptions/webhook"
body = {"external_subscription_id": "s1", "event": "subscription.updated"}
r = c.post(hook, json=body)
check("webhook is public but still needs its secret (401 from the endpoint)", r.status_code == 401 and "webhook" in r.text.lower(), (r.status_code, r.text))
secret = [l.split("=", 1)[1] for l in open(ENV, encoding="utf-8").read().splitlines() if l.startswith("MOD_WEBHOOK_SECRET=")][0]
r = c.post(hook, headers={"X-Mod-Webhook-Secret": "wrong"}, json=body)
check("webhook with a wrong secret -> 401", r.status_code == 401, (r.status_code, r.text))
r = c.post(hook, headers={"X-Mod-Webhook-Secret": secret}, json={})
check("webhook with the right secret reaches the handler (validation error, not 401)", r.status_code in (200, 400, 422), (r.status_code, r.text))

r = c.put("/api/users/" + users["op"]["id"] + "/entry-point-overrides", headers=adm, json={"entries": {"forms.design": True}})
check("admin grants an override", r.status_code == 200, r.text)
check("override opens forms.design for the operator", code("POST", "/api/forms", S["op"], json={}) not in (401, 403))
c.put("/api/users/" + users["op"]["id"] + "/entry-point-overrides", headers=adm, json={"entries": {"forms.design": None}})
check("removing the override restores the default", code("POST", "/api/forms", S["op"], json={}) == 403)
r = c.put("/api/users/" + users["aud"]["id"] + "/entry-point-overrides", headers=adm, json={"entries": {"forms.design": True}})
check("override for a readonly user is rejected", r.status_code in (400, 403, 409, 422), r.status_code)
check("readonly user still cannot design forms", code("POST", "/api/forms", S["aud"], json={}) == 403)
check("manager cannot manage roles", code("GET", "/api/roles", S["mgr"]) == 403)
r = c.post("/api/users", headers=S["mgr"], json={"username": "x", "password": "initial-pass-123", "display_name": "x", "role_id": roles["admin"]["id"]})
check("manager cannot create an admin", r.status_code == 403, r.status_code)

for _ in range(5):
    login(c, "op", "wrong-password-zz")
r = login(c, "op", NEW_PW)
check("five failures lock the account (same 401 body)", r.status_code == 401 and r.json() == bad1.json(), r.text)
check("lock persisted in the database", psql("select locked_until is not null from ep_users where username='op'") == "t")
psql("update ep_users set locked_until = now() - interval '1 second' where username='op'")
check("login works after expiry", login(c, "op", NEW_PW).status_code == 200)

check("exactly one administrator", psql("select count(*) from ep_users u join ep_roles r on r.id=u.role_id where r.name='admin' and r.is_builtin") == "1")
check("password stored as bcrypt", psql("select left(password_hash,3) from ep_users where username='admin'") == "$2b")

print("\n" + str(sum(results)) + "/" + str(len(results)) + " passed", flush=True)
sys.exit(0 if all(results) else 1)
