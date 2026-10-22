import asyncio
import json
import os
import sys

import asyncpg
import httpx

BASE = "http://127.0.0.1:8000"
TENANT = os.environ["DEFAULT_TENANT_ID"]
OTHER = "00000000-0000-4000-8000-0000000000ff"
results = []


def check(name, ok, detail=""):
    results.append(bool(ok))
    print(("PASS  " if ok else "FAIL  ") + name + ("" if ok else "  :: " + str(detail)[:300]), flush=True)


def login(c, user, pw):
    return c.post("/api/auth/login", json={"username": user, "password": pw})


def auth(token):
    return {"Authorization": "Bearer " + token}


async def sql(query):
    conn = await asyncpg.connect(os.environ["PG_DSN"])
    try:
        return await conn.fetch(query)
    finally:
        await conn.close()


def main():
    c = httpx.Client(base_url=BASE, timeout=20)
    admin_pw, new_pw = "bootstrap-secret-1", "changed-secret-123"
    check("healthz is public", c.get("/healthz").status_code == 200)
    check("no credentials -> 401", c.get("/api/forms").status_code == 401)
    check("garbage bearer -> 401", c.get("/api/forms", headers=auth("abc.def.ghi")).status_code == 401)

    bad1 = login(c, "admin", "wrong-password-xx")
    bad2 = login(c, "nobody-here", "wrong-password-xx")
    check("unknown user and wrong password return identical 401 bodies",
          bad1.status_code == 401 and bad2.status_code == 401 and bad1.json() == bad2.json(), (bad1.text, bad2.text))
    r = login(c, "admin", admin_pw)
    check("bootstrap admin can log in", r.status_code == 200 and "access_token" in r.json(), r.text)
    t = r.json().get("access_token", "")
    check("forced password change blocks business endpoints", c.get("/api/forms", headers=auth(t)).status_code == 403)
    check("forced password change still allows /me", c.get("/api/auth/me", headers=auth(t)).status_code == 200)
    r = c.post("/api/auth/change-password", headers=auth(t), json={"current_password": admin_pw, "new_password": new_pw})
    check("change-password succeeds", r.status_code == 200, r.text)
    check("business endpoint opens after the change (old token reflects current state)",
          c.get("/api/forms", headers=auth(t)).status_code == 200)
    adm = auth(t)

    check("tenant header: other tenant rejected even for admin",
          c.get("/api/forms", headers={**adm, "X-Tenant-Id": OTHER}).status_code == 403)
    check("tenant header: exact default tenant accepted",
          c.get("/api/forms", headers={**adm, "X-Tenant-Id": TENANT}).status_code == 200)
    r = c.get("/api/forms", headers=[("Authorization", "Bearer " + t), ("X-Tenant-Id", TENANT), ("X-Tenant-Id", TENANT)])
    check("tenant header: duplicated header rejected", r.status_code == 403, r.status_code)

    roles = {x["name"]: x for x in c.get("/api/roles", headers=adm).json()}
    check("builtin roles seeded", {"admin", "audit", "manager", "operator"} <= set(roles), list(roles))
    users = {}
    for name, role in (("mgr", "manager"), ("op", "operator"), ("aud", "audit")):
        r = c.post("/api/users", headers=adm, json={"username": name, "password": "initial-pass-123",
                                                    "display_name": name, "role_id": roles[role]["id"]})
        check("admin creates a " + role + " user", r.status_code == 201, r.text)
        users[name] = r.json()
    session = {}
    for name in users:
        s = login(c, name, "initial-pass-123").json().get("access_token", "")
        c.post("/api/auth/change-password", headers=auth(s), json={"current_password": "initial-pass-123", "new_password": new_pw})
        session[name] = auth(login(c, name, new_pw).json().get("access_token", ""))

    check("operator reads forms (default role)", c.get("/api/forms", headers=session["op"]).status_code == 200)
    check("operator cannot write forms (not in default roles)", c.post("/api/forms", headers=session["op"], json={}).status_code == 403)
    r = c.post("/api/forms", headers=session["mgr"], json={})
    check("manager passes the entry layer for forms.write (a body error is not an authorization error)",
          r.status_code not in (401, 403), r.status_code)
    check("audit reads forms", c.get("/api/forms", headers=session["aud"]).status_code == 200)
    check("audit (readonly) cannot write forms", c.post("/api/forms", headers=session["aud"], json={}).status_code == 403)

    r = c.put("/api/users/" + users["aud"]["id"] + "/entry-point-overrides", headers=adm, json={"entries": {"forms.write": True}})
    check("override targeting a readonly user is rejected", r.status_code in (400, 403, 409, 422), r.status_code)
    check("readonly user still denied after the attempt", c.post("/api/forms", headers=session["aud"], json={}).status_code == 403)
    r = c.put("/api/roles/" + roles["audit"]["id"] + "/entry-points", headers=adm, json={"entries": {"forms.write": True}})
    check("role grant cannot make the readonly role writable",
          c.post("/api/forms", headers=session["aud"], json={}).status_code == 403, r.status_code)

    r = c.put("/api/users/" + users["op"]["id"] + "/entry-point-overrides", headers=adm, json={"entries": {"forms.write": True}})
    check("admin sets an allow override", r.status_code == 200, r.text)
    check("allow override opens forms.write for the operator",
          c.post("/api/forms", headers=session["op"], json={}).status_code not in (401, 403))
    r = c.put("/api/users/" + users["mgr"]["id"] + "/entry-point-overrides", headers=adm, json={"entries": {"forms.write": False}})
    check("admin sets a deny override", r.status_code == 200, r.text)
    check("deny override closes forms.write for the manager", c.post("/api/forms", headers=session["mgr"], json={}).status_code == 403)
    c.put("/api/users/" + users["mgr"]["id"] + "/entry-point-overrides", headers=adm, json={"entries": {"forms.write": None}})
    check("removing the override restores role defaults",
          c.post("/api/forms", headers=session["mgr"], json={}).status_code not in (401, 403))

    r = c.post("/api/edit/reasons", headers=session["op"], json={"code": "x1", "label": "x"})
    check("legacy veto: operator passes the entry layer but the Kit's own manager check denies",
          r.status_code == 403 and "Manager" in r.text, (r.status_code, r.text))
    r = c.post("/api/edit/reasons", headers=session["mgr"], json={"code": "x2", "label": "x"})
    check("manager is allowed by both layers", r.status_code not in (401, 403), (r.status_code, r.text))

    check("manager can list users", c.get("/api/users", headers=session["mgr"]).status_code == 200)
    for target in ("manager", "admin"):
        r = c.post("/api/users", headers=session["mgr"], json={"username": "x-" + target, "password": "initial-pass-123",
                                                              "display_name": "x", "role_id": roles[target]["id"]})
        check("manager cannot create a " + target, r.status_code == 403, r.status_code)
    admin_id = c.get("/api/auth/me", headers=adm).json()["id"]
    r = c.post("/api/users/" + admin_id + "/reset-password", headers=session["mgr"], json={"new_password": "hijack-pass-123"})
    check("manager cannot reset the admin password", r.status_code == 403, r.status_code)
    check("operator cannot list users", c.get("/api/users", headers=session["op"]).status_code == 403)
    check("manager cannot use role management", c.get("/api/roles", headers=session["mgr"]).status_code == 403)
    r = c.put("/api/users/" + users["op"]["id"] + "/entry-point-overrides", headers=session["mgr"], json={"entries": {"forms.write": True}})
    check("non-admin cannot set overrides", r.status_code == 403, r.status_code)

    me = c.get("/api/entry-points/me", headers=session["op"])
    text = json.dumps(me.json()) if me.status_code == 200 else ""
    check("entry-points/me lists the operator's entry layer", me.status_code == 200 and "forms.read" in text and "user_manage" not in text, me.text[:200])

    bare = c.get("/api/forms", headers={"X-Admin-API-Key": "e2e-machine-key"})
    print("INFO  machine key without X-Tenant-Id -> " + str(bare.status_code) + " " + bare.text[:120], flush=True)
    r = c.get("/api/forms", headers={"X-Admin-API-Key": "e2e-machine-key", "X-Tenant-Id": TENANT})
    check("machine key (test double) with the default tenant header reaches the endpoint", r.status_code == 200, (r.status_code, r.text))
    r = c.get("/api/forms", headers={"X-Admin-API-Key": "e2e-machine-key", "X-Tenant-Id": OTHER})
    check("machine key with another tenant header is rejected by the fixed-tenant rule", r.status_code == 403, (r.status_code, r.text))
    check("wrong machine key -> 401", c.get("/api/forms", headers={"X-Admin-API-Key": "nope"}).status_code == 401)
    mixed = {**session["aud"], "X-Admin-API-Key": "e2e-machine-key"}
    check("bearer + machine header uses the user path (readonly user still denied writes)",
          c.get("/api/forms", headers=mixed).status_code == 200 and c.post("/api/forms", headers=mixed, json={}).status_code == 403)

    for _ in range(5):
        login(c, "op", "wrong-password-zz")
    r = login(c, "op", new_pw)
    check("five failures lock the account; the correct password then fails with the same 401 body",
          r.status_code == 401 and r.json() == bad1.json(), r.text)
    rows = asyncio.run(sql("select locked_until is not null as locked from ep_users where username = 'op'"))
    check("the lock is persisted in the database", rows and rows[0]["locked"] is True, rows)
    asyncio.run(sql("update ep_users set locked_until = now() - interval '1 second' where username = 'op'"))
    check("login works after the lock expires", login(c, "op", new_pw).status_code == 200)

    rows = asyncio.run(sql("select count(*) as n from ep_users u join ep_roles r on r.id = u.role_id where r.name = 'admin' and r.is_builtin"))
    check("exactly one bootstrap admin exists", rows[0]["n"] == 1, rows)
    rows = asyncio.run(sql("select password_hash from ep_users where username = 'admin'"))
    check("password stored as a bcrypt hash, not plaintext",
          rows[0]["password_hash"].startswith("$2") and new_pw not in rows[0]["password_hash"])

    print("\n" + str(sum(results)) + "/" + str(len(results)) + " passed", flush=True)
    return 0 if all(results) else 1


sys.exit(main())
