"""把七個 S2 Kit 組成一個 FastAPI 應用程式，供整合測試使用。

- 平台部分（設定、資料庫）由 platform_stub 提供替身，資料庫為記憶體內 SQLite（aiosqlite）。
- 啟動順序依各 Kit README：entry-permission → product-process → batch（含 extras）→
  alarm / equipment → dashboard → runtime-settings（最後，再 apply_all）。
- 登錄表是程序層級的全域狀態，所以整個測試程序只組裝一次；每個測試案例各自重建資料表與種子資料。
"""

import json
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[1]
KITS = ("entry-permission-kit", "product-process-kit", "batch-production-kit", "alarm-exception-kit",
        "equipment-maintenance-kit", "production-dashboard-kit", "runtime-settings-kit")
for path in [HERE / "platform_stub", *(ROOT / "kits" / k / "src" / "backend" for k in KITS)][::-1]:
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

REQUIRED = ("fastapi", "sqlalchemy", "aiosqlite", "httpx", "bcrypt", "jose")
MISSING = [m for m in REQUIRED if __import__("importlib.util").util.find_spec(m) is None]

GATING = {"stationCode": "process", "metricKey": "quality_value"}
SEED = json.loads((ROOT / "kits" / "product-process-kit" / "seed" / "product-lines.sample.json").read_text(encoding="utf-8"))

_app = None
_store = None


class MemoryStore:
    """照片佐證用的物件儲存替身。"""

    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}

    def put(self, batch_id, filename, content_type, data):
        ref = f"{batch_id}/{len(self.objects)}/{filename}"
        self.objects[ref] = data
        return ref

    def delete(self, ref):
        self.objects.pop(ref, None)

    def url(self, ref):
        return f"memory://{ref}"


def build_app():
    """組裝一次；之後呼叫回傳同一個應用程式。"""
    global _app, _store
    if _app is not None:
        return _app
    from fastapi import FastAPI

    from app.core.database import configure
    configure()

    # entry-permission：入口目錄、範圍機制（匯入即可）。
    from app.api import routes_auth, routes_users
    # product-process：註冊入口與「產線」範圍。
    from app.api import routes_forms, routes_products
    # batch-production：核心設定 + 第二階段。
    from app.api import routes_batches
    from app.core.batch_settings import configure as configure_batch, load_batch_settings
    from app.core.extras_startup import enable_batch_extras
    configure_batch(load_batch_settings({}))
    _store = MemoryStore()
    extra_routers = enable_batch_extras({"enabled": ["warehouse-entry", "rework-record", "batch-notes", "attachments"], "attachmentExtraKeys": ["photo"]},
                                        object_store=_store)
    # alarm / equipment：訂閱事件、註冊閘門、登錄儀表板區塊。
    from app.core.alarm_startup import enable_alarm_kit
    from app.core.equipment_startup import enable_equipment_kit
    from app.api import routes_alarms, routes_equipment
    enable_alarm_kit({"gating": GATING})
    enable_equipment_kit({})
    # dashboard。
    from app.core.dashboard_startup import enable_dashboard_kit
    from app.api import routes_dashboard
    enable_dashboard_kit({})
    # runtime-settings：最後。批次 Kit 沒有自己的啟動函式，由平台登錄它的參數。
    from app.core import batch_params
    batch_params.register()
    from app.core.settings_startup import enable_runtime_settings_kit
    from app.api import routes_settings
    enable_runtime_settings_kit({})

    app = FastAPI()
    for r in (routes_auth.router, routes_users.router, routes_products.router, routes_forms.router, routes_batches.router,
              *extra_routers, routes_alarms.router, *routes_equipment.routers, routes_dashboard.router, routes_settings.router):
        app.include_router(r)
    _app = app
    return app


def store() -> MemoryStore:
    return _store
