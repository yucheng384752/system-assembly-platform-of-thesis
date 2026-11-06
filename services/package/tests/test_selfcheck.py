"""On-site self-check of the generated backend (D182).

The release gate already ran every Kit's tests, so this check only has to find what can differ on the customer's machine:
files changed after signing, parts that do not fit together, an unready database. Each test states the situation an
engineer would meet and what the system must say, including which Kit is named. Needs starlette and httpx (the pinned
runtime packages), so it runs in the backend image or a venv, not with Node.
"""
import asyncio
import hashlib
import importlib.util
import json
import re
import sys
import tempfile
import unittest
from pathlib import Path

from starlette.applications import Starlette
from starlette.responses import JSONResponse
from starlette.routing import Route
from starlette.testclient import TestClient

REPO = Path(__file__).resolve().parents[3]
SPEC = importlib.util.spec_from_file_location("selfcheck_under_test", REPO / "services/package/templates/selfcheck.py")
sc = importlib.util.module_from_spec(SPEC)
sys.modules["selfcheck_under_test"] = sc
SPEC.loader.exec_module(sc)

EP_SOURCE = REPO / "kits/entry-permission-kit/src/backend"


def directory_class():
    """The real permission directory, so the route check uses the same matching as the middleware."""
    sys.path.insert(0, str(EP_SOURCE))
    try:
        from app.entry_permission.directory import Directory
    finally:
        sys.path.remove(str(EP_SOURCE))
    return Directory


def sha(data):
    return hashlib.sha256(data).hexdigest()


class Temp(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.root = Path(self._tmp.name)

    def write(self, name, data):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data if isinstance(data, bytes) else data.encode("utf-8"))
        return path


class PackageIntegrity(Temp):
    def manifest(self, files):
        return {"files": [{"path": p, "sha256": sha(d), "bytes": len(d), **({"kit": k} if k else {})} for p, d, k in files]}

    def test_untouched_files_pass(self):
        self.write("backend/app/a.py", b"x = 1")
        manifest = self.manifest([("backend/app/a.py", b"x = 1", "alpha-kit")])
        self.assertEqual(sc.package_integrity(manifest, (("backend/", str(self.root / "backend") + "/"),)), [])

    def test_a_file_edited_after_signing_is_reported_with_its_kit(self):
        self.write("backend/app/a.py", b"x = 2")
        manifest = self.manifest([("backend/app/a.py", b"x = 1", "alpha-kit")])
        found = sc.package_integrity(manifest, (("backend/", str(self.root / "backend") + "/"),))
        self.assertEqual([(f["kit"], f["check"]) for f in found], [("alpha-kit", "package-file-changed")])
        self.assertIn("backend/app/a.py", found[0]["reason"])

    def test_a_missing_file_is_reported(self):
        manifest = self.manifest([("backend/app/gone.py", b"x", "alpha-kit")])
        found = sc.package_integrity(manifest, (("backend/", str(self.root / "backend") + "/"),))
        self.assertEqual(found[0]["check"], "package-file-missing")

    def test_only_the_covered_folders_are_read(self):
        # permissions/ is a volume the administrator may edit, so a different file there is not tampering
        manifest = self.manifest([("permissions/entry_points.json", b"original", None), ("frontend/x.js", b"y", None)])
        self.write("permissions/entry_points.json", b"edited by the administrator")
        self.assertEqual(sc.package_integrity(manifest, (("backend/", str(self.root / "backend") + "/"),)), [])


class Contracts(Temp):
    def contract(self, kit, document):
        self.write(f"{kit}/kit.contract.json", json.dumps(document))

    def test_a_missing_or_unreadable_contract_names_the_kit(self):
        self.contract("beta-kit", {"kit": "beta-kit"})
        self.write("alpha-kit/kit.contract.json", "{not json")
        contracts, found = sc.read_contracts({"kits": [{"kit": "alpha-kit"}, {"kit": "beta-kit"}, {"kit": "gamma-kit"}]}, self.root)
        self.assertEqual(sorted(contracts), ["beta-kit"])
        self.assertEqual(sorted((f["kit"], f["check"]) for f in found), [("alpha-kit", "contract-unreadable"), ("gamma-kit", "contract-unreadable")])

    def test_a_contract_that_names_another_kit_is_refused(self):
        self.contract("alpha-kit", {"kit": "beta-kit"})
        _, found = sc.read_contracts({"kits": [{"kit": "alpha-kit"}]}, self.root)
        self.assertEqual(found[0]["check"], "contract-mismatch")

    def test_a_capability_nobody_provides_is_reported_for_the_kit_that_needs_it(self):
        contracts = {"alpha-kit": {"provides": {"db": [{"capability": "db.x"}]}, "consumes": {"db": ["db.x", "db.y"], "api": ["api.z"]}},
                     "beta-kit": {"provides": {"api": [{"capability": "api.z"}]}, "consumes": {}}}
        found = sc.dependencies(contracts)
        self.assertEqual([(f["kit"], f["check"]) for f in found], [("alpha-kit", "dependency-missing")])
        self.assertIn("db.y", found[0]["reason"])

    def test_dependencies_may_be_written_as_names_or_as_objects(self):
        contracts = {"a-kit": {"provides": {"api": [{"capability": "c1", "method": "GET", "path": "/x"}]}, "consumes": {}},
                     "b-kit": {"provides": {}, "consumes": {"api": [{"capability": "c1"}, "c1"]}}}
        self.assertEqual(sc.dependencies(contracts), [])


class Directory(unittest.TestCase):
    def directory(self, entries, public=()):
        return directory_class()({"format": "composer-entry-points", "version": 1, "publicPaths": list(public), "entryPoints": entries})

    @staticmethod
    def entry(kit, key, *routes):
        return {"key": key, "label": "x", "access": "read", "defaultRoles": ["admin"], "kitId": kit,
                "routes": [{"capability": "c.x", "method": m, "path": p} for m, p in routes]}

    def test_an_entry_point_missing_from_the_directory_is_reported_for_its_kit(self):
        contracts = {"alpha-kit": {"entryPoints": [{"key": "a.read"}, {"key": "a.write"}]}}
        document = {"entryPoints": [{"kitId": "alpha-kit", "key": "a.read"}]}
        found = sc.entry_directory(contracts, document)
        self.assertEqual([(f["kit"], f["check"]) for f in found], [("alpha-kit", "entry-missing")])
        self.assertIn("a.write", found[0]["reason"])

    def test_an_entry_point_nobody_declares_is_reported(self):
        found = sc.entry_directory({"alpha-kit": {"entryPoints": []}}, {"entryPoints": [{"kitId": "alpha-kit", "key": "a.read"}, {"kitId": "ghost-kit", "key": "g.read"}]})
        # the Kit that no contract belongs to cannot be named, so only the area is reported for it
        self.assertEqual(sorted((f["kit"] or "", f["check"]) for f in found), [("", "entry-extra"), ("alpha-kit", "entry-extra")])

    def test_a_declared_route_that_does_not_exist_is_reported(self):
        contracts = {"alpha-kit": {"entryPoints": [{"key": "a.read", "routes": [{"method": "GET", "path": "/api/things/{id}"}, {"method": "GET", "path": "/api/gone"}]}]}}
        directory = self.directory([self.entry("alpha-kit", "a.read", ("GET", "/api/things/{id}"), ("GET", "/api/gone"))])
        found = sc.routes_consistency(contracts, directory, [("GET", "/api/things/{thing}", "app.api.things")], {})
        self.assertEqual([(f["kit"], f["check"]) for f in found], [("alpha-kit", "route-missing")])
        self.assertIn("/api/gone", found[0]["reason"])

    def test_a_route_no_entry_point_declares_is_reported_for_the_kit_that_defines_it(self):
        directory = self.directory([self.entry("alpha-kit", "a.read", ("GET", "/api/things"))])
        owners = {"backend/app/api/secret.py": "beta-kit"}
        routes = [("GET", "/api/things", "app.api.things"), ("DELETE", "/api/secret/{id}", "app.api.secret")]
        found = sc.routes_consistency({}, directory, routes, owners)
        self.assertEqual([(f["kit"], f["check"]) for f in found], [("beta-kit", "route-undeclared")])
        self.assertIn("DELETE /api/secret/{id}", found[0]["reason"])

    def test_public_admin_only_and_middleware_served_routes_are_not_reported(self):
        directory = self.directory([], public=["/healthz"])
        contracts = {"alpha-kit": {"adminRoutes": [{"method": "GET", "path": "/api/roles/{role_id}"}]}}
        routes = [("GET", "/healthz", "m"), ("GET", "/api/roles/{id}", "m"), ("GET", "/api/auth/me", "m")]
        self.assertEqual(sc.routes_consistency(contracts, directory, routes, {}, {("GET", "/api/auth/me")}), [])

    def test_the_same_path_with_another_method_is_still_undeclared(self):
        directory = self.directory([self.entry("alpha-kit", "a.read", ("GET", "/api/things"))])
        found = sc.routes_consistency({}, directory, [("DELETE", "/api/things", "m")], {})
        self.assertEqual(found[0]["check"], "route-undeclared")


class Database(unittest.TestCase):
    OWNERS = {"backend/app/models/orders.py": "alpha-kit"}

    def test_an_unreachable_database_is_one_finding_not_a_list_of_missing_tables(self):
        found = sc.database_findings(False, set(), {"orders": "app.models.orders"}, False, self.OWNERS)
        self.assertEqual([f["check"] for f in found], ["database-unreachable"])

    def test_a_missing_table_names_the_kit_whose_model_declares_it(self):
        found = sc.database_findings(True, {"other"}, {"orders": "app.models.orders", "other": "app.models.other"}, True, self.OWNERS)
        self.assertEqual([(f["kit"], f["check"]) for f in found], [("alpha-kit", "database-table-missing")])
        self.assertIn("orders", found[0]["reason"])

    def test_a_missing_default_tenant_is_reported(self):
        self.assertEqual([f["check"] for f in sc.database_findings(True, {"orders"}, {"orders": "app.models.orders"}, False, self.OWNERS)], ["database-tenant-missing"])

    def test_a_ready_database_has_no_findings(self):
        self.assertEqual(sc.database_findings(True, {"orders"}, {"orders": "app.models.orders"}, True, self.OWNERS), [])


class Reporting(unittest.TestCase):
    def test_a_message_names_the_kit_or_else_the_area(self):
        text = sc.describe([sc.finding("alpha-kit", "route-missing", "缺少路由"), sc.finding(None, "database-unreachable", "資料庫連不上"), sc.finding(None, "selfcheck-error", "出錯")])
        self.assertEqual(text, "alpha-kit：缺少路由；資料庫：資料庫連不上；系統：出錯")

    def test_the_reasons_the_checks_produce_never_contain_a_secret_shaped_value(self):
        samples = [sc.finding("k-kit", "dependency-missing", "需要「db.x」，但選入的 Kit 沒有提供"),
                   sc.finding("k-kit", "package-file-changed", "檔案內容與簽章的清單不符：backend/app/a.py")]
        for item in samples:
            self.assertIsNone(re.search(r"(password|secret|token|postgresql)", item["reason"], re.I))


class State(Temp):
    def run_state(self, runner, clock):
        return sc.SelfCheck(runner, path=str(self.root / "out" / "selfcheck.json"), clock=clock)

    def test_the_result_is_written_where_the_installer_can_read_it(self):
        async def runner():
            return [sc.finding("alpha-kit", "route-missing", "x")]

        state = self.run_state(runner, lambda: 0.0)
        asyncio.run(state.run())
        written = json.loads((self.root / "out" / "selfcheck.json").read_text(encoding="utf-8"))
        self.assertEqual(written["status"], "failed")
        self.assertEqual(written["findings"][0]["kit"], "alpha-kit")

    def test_a_check_that_crashes_counts_as_a_failure_never_as_a_pass(self):
        async def runner():
            raise RuntimeError("boom")

        result = asyncio.run(self.run_state(runner, lambda: 0.0).run())
        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["findings"][0]["check"], "selfcheck-error")
        self.assertNotIn("boom", json.dumps(result), "the exception text is not copied, only its type")

    def test_a_failure_is_checked_again_after_the_interval_and_recovers(self):
        now, calls = [0.0], []

        async def runner():
            calls.append(1)
            return [sc.finding(None, "database-unreachable", "x")] if len(calls) == 1 else []

        state = self.run_state(runner, lambda: now[0])

        async def go():
            first = await state.current()
            same = await state.current()
            now[0] += sc.RECHECK_SECONDS
            later = await state.current()
            return first, same, later

        first, same, later = asyncio.run(go())
        self.assertEqual((first["status"], same["status"], later["status"]), ("failed", "failed", "passed"))
        self.assertEqual(len(calls), 2, "not re-run on every request while it fails")

    def test_a_pass_is_not_re_run(self):
        calls = []

        async def runner():
            calls.append(1)
            return []

        state = self.run_state(runner, lambda: len(calls) * 1000.0)

        async def go():
            await state.current()
            await state.current()

        asyncio.run(go())
        self.assertEqual(len(calls), 1)


class Gate(Temp):
    def client(self, findings):
        async def runner():
            return findings

        state = sc.SelfCheck(runner, path=str(self.root / "s.json"), clock=lambda: 0.0)

        async def ok(request):
            return JSONResponse({"ok": True})

        app = Starlette(routes=[Route("/api/data", ok), Route("/healthz", ok)])
        app.middleware("http")(sc.gate(state))
        return TestClient(app)

    def test_while_the_self_check_fails_every_request_but_healthz_is_refused_naming_the_kit(self):
        client = self.client([sc.finding("alpha-kit", "route-missing", "入口缺少路由")])
        response = client.get("/api/data")
        self.assertEqual(response.status_code, 503)
        self.assertIn("alpha-kit", response.json()["detail"])
        self.assertEqual(response.json()["findings"][0]["kit"], "alpha-kit")
        self.assertEqual(client.get("/healthz").status_code, 200, "healthz itself reports the failure (see main.py); the gate leaves it to do so")

    def test_when_everything_holds_requests_pass_through(self):
        self.assertEqual(self.client([]).get("/api/data").status_code, 200)


if __name__ == "__main__":
    unittest.main()
