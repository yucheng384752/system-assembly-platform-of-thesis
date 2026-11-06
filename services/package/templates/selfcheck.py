"""On-site environment and consistency self-check (D182).

The Kits' unit tests ran before this package was produced (the release gate). What can still differ on the customer's machine
is the environment and whether the pieces fit together, so that is all this module verifies, and it refuses to serve until
everything holds. Every finding names the Kit that supplied the faulty part, or says what area it belongs to.

Checks, in the order they are reported:
  package     files under backend/ and kits/ are byte-identical to the signed manifest
  contract    every selected Kit has a readable contract that names itself
  dependency  every capability a Kit consumes is provided by a selected Kit
  entry       the permission directory and the Kits' contracts declare the same entry points
  route       every route an entry point declares exists, and every route that exists is declared by some entry point
  database    the database answers, every table the models declare exists, and the default tenant exists

Messages never contain secret values: they name files, routes, tables and capabilities only.
"""
import asyncio
import hashlib
import json
import logging
import os
import re
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

logger = logging.getLogger(__name__)

DEFAULT_FILE = "/system/data/selfcheck.json"
INTEGRITY_ROOTS = (("backend/", "/system/backend/"), ("kits/", "/system/kits/"))
RECHECK_SECONDS = 30
OPEN_PATHS = frozenset({"/healthz"})
SKIPPED_METHODS = frozenset({"HEAD", "OPTIONS"})
AREAS = {"package": "安裝包", "contract": "Kit 契約", "dependency": "Kit 相依", "entry": "入口權限", "route": "路由", "database": "資料庫"}


def finding(kit, check, reason):
    """One thing that is wrong: the Kit responsible (None when it belongs to no Kit), the check that found it, and why."""
    return {"kit": kit, "check": check, "reason": reason}


def describe(findings):
    """One line per finding for a person reading a log or an installer error."""
    return "；".join(f"{item['kit'] or AREAS.get(item['check'].split('-')[0], '系統')}：{item['reason']}" for item in findings)


def owners_of(manifest):
    """Package path of a file -> the Kit that supplied it (recorded by the assembler for backend sources)."""
    return {entry["path"]: entry["kit"] for entry in manifest.get("files", []) if entry.get("kit")}


def module_owner(module, owners):
    base = "backend/" + (module or "").replace(".", "/")
    return owners.get(base + ".py") or owners.get(base + "/__init__.py")


def selected_kits(manifest):
    return [entry["kit"] for entry in manifest.get("kits", []) if isinstance(entry, dict) and entry.get("kit")]


# ---- package ---------------------------------------------------------------------------------------------------------

def package_integrity(manifest, roots=INTEGRITY_ROOTS):
    """A file that was changed, removed or damaged after signing. permissions/ is a volume the administrator may edit, so it is not covered."""
    owners = owners_of(manifest)
    found = []
    for entry in manifest.get("files", []):
        for prefix, base in roots:
            if not entry["path"].startswith(prefix):
                continue
            target = Path(base) / entry["path"][len(prefix):]
            try:
                digest = hashlib.sha256(target.read_bytes()).hexdigest()
            except OSError:
                found.append(finding(owners.get(entry["path"]), "package-file-missing", f"安裝包的檔案不存在：{entry['path']}"))
                break
            if digest != entry["sha256"]:
                found.append(finding(owners.get(entry["path"]), "package-file-changed", f"檔案內容與簽章的清單不符：{entry['path']}"))
            break
    return found


# ---- contracts, dependencies, entry points, routes ----------------------------------------------------------------------

def read_contracts(manifest, kits_root):
    contracts, found = {}, []
    for kit in selected_kits(manifest):
        try:
            contract = json.loads((Path(kits_root) / kit / "kit.contract.json").read_text(encoding="utf-8-sig"))
        except (OSError, ValueError):
            found.append(finding(kit, "contract-unreadable", "找不到或無法讀取 kit.contract.json"))
            continue
        if not isinstance(contract, dict) or contract.get("kit") != kit:
            found.append(finding(kit, "contract-mismatch", f"契約宣告的 Kit 是「{contract.get('kit') if isinstance(contract, dict) else None}」，與安裝的 Kit 不符"))
            continue
        contracts[kit] = contract
    return contracts, found


def _capability(item):
    return item.get("capability") if isinstance(item, dict) else item


def dependencies(contracts):
    provided = {"api": set(), "db": set()}
    for contract in contracts.values():
        for kind in provided:
            provided[kind].update(filter(None, (_capability(i) for i in (contract.get("provides") or {}).get(kind, []))))
    found = []
    for kit, contract in sorted(contracts.items()):
        for kind in provided:
            for need in filter(None, (_capability(i) for i in (contract.get("consumes") or {}).get(kind, []))):
                if need not in provided[kind]:
                    found.append(finding(kit, "dependency-missing", f"需要「{need}」，但選入的 Kit 沒有提供"))
    return found


def entry_directory(contracts, directory):
    """The directory the permission middleware reads must hold exactly the entry points the selected Kits declare."""
    declared = {(kit, entry["key"]) for kit, contract in contracts.items() for entry in contract.get("entryPoints", [])}
    loaded = {(entry["kitId"], entry["key"]) for entry in directory["entryPoints"]}
    found = [finding(kit, "entry-missing", f"契約宣告的入口「{key}」不在權限目錄中，該功能會被拒絕") for kit, key in sorted(declared - loaded)]
    known = set(contracts)
    found += [finding(kit if kit in known else None, "entry-extra", f"權限目錄有契約沒有宣告的入口「{key}」") for kit, key in sorted(loaded - declared)]
    return found


def _shape(path):
    return re.sub(r"\{[^/{}]+\}", "{}", path)


def routes_consistency(contracts, directory, routes, owners, builtin=frozenset()):
    """routes: [(method, path, module)] of the running application, without documentation and static mounts.

    A route that no entry point declares is answered only for the built-in administrator, so it is allowed only when a contract
    says so on purpose (adminRoutes) or the permission middleware itself serves it (builtin: the self-service and directory routes).
    """
    actual = {(method, _shape(path)) for method, path, _ in routes}
    on_purpose = {(route["method"], _shape(route["path"])) for contract in contracts.values() for route in contract.get("adminRoutes", [])}
    on_purpose |= {(method, _shape(path)) for method, path in builtin}
    found = []
    for kit, contract in sorted(contracts.items()):
        for entry in contract.get("entryPoints", []):
            for route in entry.get("routes", []):
                if (route["method"], _shape(route["path"])) not in actual:
                    found.append(finding(kit, "route-missing", f"入口「{entry['key']}」宣告的 {route['method']} {route['path']} 在系統中不存在"))
    for method, path, module in sorted(set(routes)):
        concrete = re.sub(r"\{[^/{}]+\}", "x", path)
        if directory.is_public(method, concrete) or directory.matching(method, concrete) or (method, _shape(path)) in on_purpose:
            continue
        found.append(finding(module_owner(module, owners), "route-undeclared", f"{method} {path} 沒有任何入口宣告，只有內建管理員能呼叫"))
    return found


def middleware_routes():
    """Routes the entry-permission middleware answers for any signed-in user, so no entry point needs to declare them."""
    try:
        from app.entry_permission.middleware import DIRECTORY_ROUTES, SELF_ROUTES
    except ImportError:
        return frozenset()
    return frozenset(SELF_ROUTES) | frozenset(DIRECTORY_ROUTES)


def application_routes(app):
    """The routes FastAPI registered, with the module that defines each one."""
    routes = []
    for route in app.routes:
        methods = getattr(route, "methods", None)
        if not methods:
            continue
        module = getattr(getattr(route, "endpoint", None), "__module__", "")
        routes.extend((method, route.path, module) for method in sorted(methods - SKIPPED_METHODS))
    return routes


# ---- database ---------------------------------------------------------------------------------------------------------------

def database_findings(reachable, existing_tables, declared, tenant_present, owners):
    """declared: {table name: module of the model}. Reports what the system cannot work without."""
    if not reachable:
        return [finding(None, "database-unreachable", "資料庫連不上")]
    found = [finding(module_owner(declared[table], owners), "database-table-missing", f"資料表「{table}」不存在，尚未初始化或已被移除")
             for table in sorted(set(declared) - set(existing_tables))]
    if not tenant_present:
        found.append(finding(None, "database-tenant-missing", "預設租戶不存在，尚未初始化"))
    return found


async def collect_database(database, Tenant, tenant_id):
    """Reads what database_findings needs; any database error counts as unreachable."""
    from sqlalchemy import inspect, text
    from sqlalchemy.exc import SQLAlchemyError

    declared = {name: next((mapper.class_.__module__ for mapper in database.Base.registry.mappers if mapper.local_table.name == name), "")
                for name in database.Base.metadata.tables}
    try:
        async with database.engine.connect() as connection:
            await connection.execute(text("SELECT 1"))
            tables = await connection.run_sync(lambda conn: set(inspect(conn).get_table_names()))
        async with database.async_session_factory() as session:
            tenant_present = await session.get(Tenant, tenant_id) is not None
    except (SQLAlchemyError, OSError):
        return False, set(), declared, False
    return True, tables, declared, tenant_present


# ---- the whole check and its state ---------------------------------------------------------------------------------------------

def static_findings(manifest, app, directory, kits_root="/system/kits", roots=INTEGRITY_ROOTS):
    """Everything that needs no database: package, contracts, dependencies, entry points and routes."""
    owners = owners_of(manifest)
    contracts, found = read_contracts(manifest, kits_root)
    found = package_integrity(manifest, roots) + found + dependencies(contracts)
    found += entry_directory(contracts, directory.document)
    found += routes_consistency(contracts, directory, application_routes(app), owners, middleware_routes())
    return found


def result_of(findings):
    return {"status": "failed" if findings else "passed", "checkedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "findings": findings}


def write_result(result, path):
    """Atomic, so the installer never reads half a file. Best effort: a read-only data volume must not hide the failure itself."""
    try:
        directory = Path(path).parent
        directory.mkdir(parents=True, exist_ok=True)
        handle, temporary = tempfile.mkstemp(dir=directory, prefix=".selfcheck-")
        with os.fdopen(handle, "w", encoding="utf-8") as stream:
            json.dump(result, stream, ensure_ascii=False)
        os.replace(temporary, path)
    except OSError:
        logger.warning("selfcheck result could not be written to %s", path)


class SelfCheck:
    """Holds the latest result. A failed result is re-checked every RECHECK_SECONDS, so a database that was briefly down at start recovers."""

    def __init__(self, runner, path=None, clock=time.monotonic):
        self.runner, self.clock = runner, clock
        self.path = path or os.environ.get("SELFCHECK_FILE", DEFAULT_FILE)
        self.result, self.checked_at, self.lock = None, 0.0, None

    async def run(self):
        try:
            findings = await self.runner()
        except Exception as error:  # a check that cannot run is a failure, never a pass
            findings = [finding(None, "selfcheck-error", f"自檢本身無法執行：{type(error).__name__}")]
        self.result, self.checked_at = result_of(findings), self.clock()
        write_result(self.result, self.path)
        if findings:
            logger.error("self-check failed: %s", describe(findings))
        return self.result

    async def current(self):
        if self.lock is None:
            self.lock = asyncio.Lock()
        if self.result is None or (self.result["status"] != "passed" and self.clock() - self.checked_at >= RECHECK_SECONDS):
            async with self.lock:
                if self.result is None or (self.result["status"] != "passed" and self.clock() - self.checked_at >= RECHECK_SECONDS):
                    await self.run()
        return self.result


def refusal(result):
    return {"detail": "現場自檢未通過，系統暫不提供服務：" + describe(result["findings"]), "findings": result["findings"]}


def gate(state):
    """Middleware: while the self-check fails nothing is served except /healthz, which reports the same findings."""
    from starlette.responses import JSONResponse

    async def middleware(request, call_next):
        result = await state.current()
        if result["status"] == "passed" or request.url.path in OPEN_PATHS:
            return await call_next(request)
        return JSONResponse(status_code=503, content=refusal(result))

    return middleware
