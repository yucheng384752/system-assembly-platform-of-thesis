"""Deployed factory-core-kit end-to-end check: real entry-permission middleware, real JWT, real PostgreSQL.

Runs inside the backend container so it needs no extra tooling; httpx and psycopg are already installed there.
All data is synthetic and the passwords are test values only.

    docker compose ... cp fixtures/executable-plan/valid.json backend:/tmp/valid.json
    docker compose ... cp fixtures/executable-plan/forms.json backend:/tmp/forms.json
    docker compose ... exec -T backend python - run    < services/package/e2e/factory_e2e.py
    docker compose ... restart backend                  # wait until healthy
    docker compose ... exec -T backend python - verify < services/package/e2e/factory_e2e.py

`run` expects the bootstrap admin (create_admin) and a fresh database; `verify` expects `run` to have finished.
"""
import json
import os
import sys

import httpx
from sqlalchemy import text

from app.factory_api.deploy import make_engine
from app.factory_core.plan import plan_id_of

PHASE = sys.argv[1] if len(sys.argv) > 1 else "run"
BASE = "http://127.0.0.1:8000"
ADMIN_PW, NEW_PW = "bootstrap-secret-1", "changed-secret-123"
results = []


def check(name, ok, detail=""):
    results.append(bool(ok))
    print(("PASS  " if ok else "FAIL  ") + name + ("" if ok else "  :: " + str(detail)[:400]), flush=True)


def bearer(token):
    return {"Authorization": "Bearer " + token}


c = httpx.Client(base_url=BASE, timeout=30)


def login(user, password):
    r = c.post("/api/auth/login", json={"username": user, "password": password})
    return bearer(r.json().get("access_token", "")) if r.status_code == 200 else None


def runnable_plan():
    """The contract fixture made runnable on this deployment: kits that exist here, no guards, no judge node. The form stays: it is uploaded."""
    plan = json.load(open("/tmp/valid.json", encoding="utf-8"))
    for node in plan["nodes"]:
        for key in ("guard", "route", "decision", "checks", "verdicts"):
            node.pop(key, None)
        if node["category"] == "judge":
            node["category"] = "transform"
        if "binding" in node:
            node["binding"]["kitId"] = "platform-core-kit"
    plan["planId"] = plan_id_of(plan)
    return plan


def sql(statement):
    engine = make_engine(os.environ["DATABASE_URL"])
    try:
        with engine.begin() as conn:
            return conn.execute(text(statement)).all()
    finally:
        engine.dispose()


def refused_by_database(statement):
    try:
        sql(statement)
    except Exception as error:  # noqa: BLE001 - the message is what is checked
        return "append-only" in str(error) or "pinned" in str(error) or "never deleted" in str(error) or "only the start" in str(error)
    return False


if PHASE == "run":
    r = c.post("/api/auth/login", json={"username": "admin", "password": ADMIN_PW})
    first = bearer(r.json().get("access_token", ""))
    c.post("/api/auth/change-password", headers=first, json={"current_password": ADMIN_PW, "new_password": NEW_PW})
    adm = login("admin", NEW_PW)
    check("admin logs in after the forced password change", adm is not None)
    roles = {x["name"]: x for x in c.get("/api/roles", headers=adm).json()}
    for name, role in (("mia", "manager"), ("oscar", "operator"), ("ada", "audit")):
        r = c.post("/api/users", headers=adm, json={"username": name, "password": "initial-pass-123", "display_name": name, "role_id": roles[role]["id"]})
        check("admin creates " + role, r.status_code == 201, r.text)
        s = login(name, "initial-pass-123")
        c.post("/api/auth/change-password", headers=s, json={"current_password": "initial-pass-123", "new_password": NEW_PW})
    mia, oscar, ada = (login(n, NEW_PW) for n in ("mia", "oscar", "ada"))
    plan = runnable_plan()
    body = json.dumps(plan, ensure_ascii=False)

    check("no token -> 401", c.get("/api/factory/plans").status_code == 401)
    check("a forged identity header does nothing without a token", c.get("/api/factory/plans", headers={"X-Test-User": "x", "X-Test-Role": "admin"}).status_code == 401)
    check("operator cannot publish a plan (entry factory.plan_publish)", c.post("/api/factory/plans", headers=oscar, content=body).status_code == 403)
    check("audit cannot publish a plan", c.post("/api/factory/plans", headers=ada, content=body).status_code == 403)
    r = c.post("/api/factory/plans", headers=mia, content=body)
    check("manager publishes the plan", r.status_code == 201 and r.json()["planId"] == plan["planId"] and r.json()["executable"], r.text)
    tampered = json.loads(body)
    tampered["nodes"][1]["name"] = "changed after sealing"
    r = c.post("/api/factory/plans", headers=mia, content=json.dumps(tampered, ensure_ascii=False))
    check("a plan whose content no longer matches its id is refused", r.status_code == 422 and r.json()["errors"][0]["code"] == "plan-id-mismatch", r.text)
    plan_id = plan["planId"]
    check("operator and audit can view plans", c.get("/api/factory/plans", headers=oscar).status_code == 200 and c.get("/api/factory/plans", headers=ada).status_code == 200)

    form = json.load(open("/tmp/forms.json", encoding="utf-8"))["forms"][0]
    form_url = "/api/factory/forms"
    r = c.post("/api/factory/work-orders", headers=oscar, json={"orderId": "wo-early", "planId": plan_id})
    check("no work order before the form it names is uploaded", r.status_code == 409 and r.json()["errors"][0]["code"] == "form-unavailable", r.text)
    check("operator cannot upload a form (entry factory.plan_publish)", c.post(form_url, headers=oscar, json=form).status_code == 403)
    check("audit cannot upload a form", c.post(form_url, headers=ada, json=form).status_code == 403)
    edited = json.loads(json.dumps(form))
    edited["definition"]["name"] = "edited after hashing"
    r = c.post(form_url, headers=mia, json=edited)
    check("a definition that does not match its claimed hash is refused", r.status_code == 422 and r.json()["errors"][0]["code"] == "form-hash-mismatch", r.text)
    check("and nothing was filed under that hash", c.get(f"{form_url}/{form['contentSha256']}", headers=mia).status_code == 404)
    r = c.post(form_url, headers=mia, json=form)
    check("manager uploads the form", r.status_code == 201 and r.json()["contentSha256"] == form["contentSha256"], r.text)
    r = c.get(f"{form_url}/{form['contentSha256']}", headers=oscar)
    check("operator can read the stored form", r.status_code == 200 and r.json()["definition"]["id"] == "mix-record", r.text)

    sets = f"/api/factory/plans/{plan_id}/parameter-sets"
    check("audit cannot propose (read-only role)", c.post(sets, headers=ada, json={"values": {"mix_minutes": 12}, "reason": "r"}).status_code == 403)
    r = c.post(sets, headers=oscar, json={"values": {"mix_minutes": 12}, "alarmIntervals": {"temp-out-of-range": 10}, "reason": "cooler room"})
    check("operator proposes a change", r.status_code == 201 and r.json()["proposedBy"] and r.json()["status"] == "pending", r.text)
    check("a proposer id in the body is refused", c.post(sets, headers=oscar, json={"values": {}, "reason": "r", "proposedBy": "mia"}).status_code == 422)
    check("operator cannot approve (entry factory.params_approve)", c.post(sets + "/1/decision", headers=oscar, json={"approve": True}).status_code == 403)
    r = c.post(sets + "/1/decision", headers=mia, json={"approve": True})
    check("manager approves", r.status_code == 200 and r.json()["status"] == "approved", r.text)
    r = c.post(sets, headers=mia, json={"values": {"mix_minutes": 14}, "reason": "own change"})
    check("manager proposes", r.status_code == 201, r.text)
    check("manager approves their own proposal", c.post(sets + "/2/decision", headers=mia, json={"approve": True}).status_code == 200)

    # Version 2 is approved before any order starts, so the order below pins version 2.
    r = c.post("/api/factory/work-orders", headers=oscar, json={"orderId": "wo-1", "planId": plan_id})
    check("operator creates a work order", r.status_code == 201, r.text)
    r = c.post("/api/factory/work-orders/wo-1/start", headers=oscar)
    check("starting pins the latest approved set", r.status_code == 200 and r.json()["setVersion"] == 2, r.text)
    c.post(sets, headers=oscar, json={"values": {"mix_minutes": 18}, "reason": "later"})
    c.post(sets + "/3/decision", headers=mia, json={"approve": True})
    r = c.get("/api/factory/work-orders/wo-1", headers=oscar)
    check("a set approved after the start does not reach the running order", r.json().get("setVersion") == 2 and r.json()["effectiveParams"]["mix_minutes"] == 14, r.text)

    r = c.post("/api/factory/work-orders/wo-1/alarms", headers=oscar, json={"ruleId": "temp-out-of-range", "detail": "31 C"})
    check("operator raises an alarm", r.status_code == 201 and r.json()["status"] == "open", r.text)
    alarm_id = r.json()["alarmId"]
    check("the alarm holds its node", c.get("/api/factory/work-orders/wo-1", headers=oscar).json()["heldNodes"] == ["qc"])
    check("operator cannot acknowledge (entry factory.alarm_acknowledge)", c.post(f"/api/factory/alarms/{alarm_id}/acknowledge", headers=oscar, json={}).status_code == 403)
    check("the node is still held after the refusal", c.get("/api/factory/work-orders/wo-1", headers=oscar).json()["heldNodes"] == ["qc"])
    check("operator cannot collect reminders", c.post("/api/factory/alarms/reminders", headers=oscar).status_code == 403)
    r = c.post("/api/factory/alarms/reminders", headers=mia)
    check("manager collects reminders (none are due yet)", r.status_code == 200 and r.json()["due"] == [], r.text)

    check("a route outside every entry is refused to a manager", c.get("/api/factory/unlisted", headers=mia).status_code == 403)
    check("and reaches the router for the built-in admin (404 there)", c.get("/api/factory/unlisted", headers=adm).status_code == 404)

    check("the database refuses editing a parameter set", refused_by_database("UPDATE parameter_sets SET reason = 'edited'"))
    check("the database refuses deleting a plan", refused_by_database("DELETE FROM plans"))
    check("the database refuses editing a stored form", refused_by_database("UPDATE forms SET definition = '{}'"))
    check("the database refuses truncating the form registry", refused_by_database("TRUNCATE forms"))
    check("the database refuses repinning a started order", refused_by_database("UPDATE work_orders SET set_version = 1 WHERE order_id = 'wo-1'"))
    check("the database refuses truncating the notice log (the guard, not a foreign key)", refused_by_database("TRUNCATE alarm_notices"))
    check("nothing was changed by those attempts", sql("SELECT reason FROM parameter_sets WHERE set_version = 1")[0][0] == "cooler room")
    check("the plan tables exist next to the shared schema", {r[0] for r in sql("SELECT tablename FROM pg_tables WHERE schemaname = 'public'")} >= {"plans", "forms", "work_orders", "alarms", "alembic_version", "ep_users"})

elif PHASE == "verify":
    mia, oscar = login("mia", NEW_PW), login("oscar", NEW_PW)
    r = c.get("/api/factory/work-orders/wo-1", headers=oscar)
    check("after a backend restart the order is still pinned to set 2", r.status_code == 200 and r.json()["setVersion"] == 2, r.text)
    check("and its node is still held by the unacknowledged alarm", r.json().get("heldNodes") == ["qc"], r.text)
    alarm_id = "wo-1:temp-out-of-range:1"
    r = c.post(f"/api/factory/alarms/{alarm_id}/acknowledge", headers=mia, json={"note": "chiller checked"})
    check("manager acknowledges after the restart", r.status_code == 200 and r.json()["acknowledgedBy"], r.text)
    check("the node is released", c.get("/api/factory/work-orders/wo-1", headers=oscar).json()["heldNodes"] == [])
    check("a second acknowledgement conflicts", c.post(f"/api/factory/alarms/{alarm_id}/acknowledge", headers=mia, json={}).status_code == 409)
    r = c.get(f"/api/factory/plans/{json.load(open('/tmp/valid.json', encoding='utf-8'))['planId']}", headers=oscar)
    check("the original (unmodified) fixture was never stored", r.status_code == 404)
    form = json.load(open("/tmp/forms.json", encoding="utf-8"))["forms"][0]
    check("the uploaded form survives the restart", c.get(f"/api/factory/forms/{form['contentSha256']}", headers=oscar).json().get("uploadedBy") is not None)
    check("three parameter sets survive the restart", len(sql("SELECT 1 FROM parameter_sets")) == 3)
else:
    print(__doc__)
    sys.exit(2)

print(f"{sum(results)}/{len(results)} checks passed")
sys.exit(0 if all(results) else 1)
