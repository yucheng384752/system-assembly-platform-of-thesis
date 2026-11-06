"""Generic smoke for one installed config: license, frontend, auth flow, every parameterless GET route (no 5xx)."""
import json
import sys
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:8080"
cfg = sys.argv[1]
results = []


def call(method, path, token=None, body=None, headers=None):
    h = {"Content-Type": "application/json", **(headers or {})}
    if token:
        h["Authorization"] = "Bearer " + token
    req = urllib.request.Request(BASE + path, method=method, headers=h, data=json.dumps(body).encode() if body is not None else None)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()
    except Exception as e:  # network-level failure is a failure, not a skip
        return -1, str(e).encode()


def check(name, ok, detail=""):
    results.append({"name": name, "ok": bool(ok), "detail": str(detail)[:300]})
    print(("PASS  " if ok else "FAIL  ") + name + ("" if ok else "  :: " + str(detail)[:300]), flush=True)


s, b = call("GET", "/healthz")
check("healthz 200", s == 200, (s, b[:100]))
s, b = call("GET", "/")
check("frontend index served (200, html)", s == 200 and b"<div" in b.lower() and b"script" in b.lower(), (s, b[:120]))
s, b = call("GET", "/api/license/status")
j = json.loads(b) if s == 200 else {}
check("license valid and hardware match", j.get("valid") is True and j.get("hardware", {}).get("status") == "match", b[:200])
s, _ = call("GET", "/api/users")
check("no credentials -> 401", s == 401, s)
s, b = call("POST", "/api/auth/login", body={"username": "admin", "password": "wrong-password-xx"})
check("wrong password -> 401", s == 401, (s, b[:100]))
s, b = call("POST", "/api/auth/login", body={"username": "admin", "password": "bootstrap-secret-1"})
if s == 200:
    check("bootstrap admin logs in", True)
    tok = json.loads(b).get("access_token", "")
    s, _ = call("GET", "/api/users", tok)
    check("forced password change blocks business endpoints (403)", s == 403, s)
    s, b = call("POST", "/api/auth/change-password", tok, {"current_password": "bootstrap-secret-1", "new_password": "changed-secret-123"})
    check("admin changes the password", s == 200, (s, b[:150]))
else:
    print("NOTE  bootstrap password already changed by an earlier run; first-login checks skipped")
s, b = call("POST", "/api/auth/login", body={"username": "admin", "password": "changed-secret-123"})
tok = json.loads(b).get("access_token", "") if s == 200 else ""
check("admin logs in with the new password", bool(tok), (s, b[:150]))

routes = json.load(open(f"/home/gslab/kv/out/{cfg}/routes.json"))  # [[methods, path]] listed inside the backend container
paths = {}
for methods, path in routes:
    paths.setdefault(path, {}).update({m.lower(): True for m in methods})
check("route list read from the running backend", bool(paths), len(paths))
seen = {}
for path, ops in sorted(paths.items()):
    if "get" not in ops or "{" in path:
        continue
    s, b = call("GET", path, tok)
    seen[path] = s
    check(f"GET {path} no 5xx", 0 < s < 500, (s, b[:200]))
json.dump({"cfg": cfg, "results": results, "getRoutes": seen, "allPaths": sorted(paths)}, open(f"/home/gslab/kv/out/{cfg}/smoke.json", "w"), ensure_ascii=False, indent=1)
fails = [r for r in results if not r["ok"]]
print(f"SUMMARY {cfg}: {len(results) - len(fails)}/{len(results)} passed; GET routes exercised: {len(seen)}")
sys.exit(1 if fails else 0)
