"""整合測試共用的基底：每個測試重建資料表、載入種子、建立帳號，並提供以帳號身分呼叫 API 的方法。"""

import unittest

from harness import MISSING, SEED, build_app


@unittest.skipIf(MISSING, f"缺少套件：{', '.join(MISSING)}（見 README）")
class ApiCase(unittest.IsolatedAsyncioTestCase):
    ROLES = {"admin": "admin", "manager": "manager", "op1": "operator", "op2": "operator", "qc": "qc", "auditor": "audit"}
    PASSWORD = "secret-pass-123"

    _hash = None

    async def asyncSetUp(self):
        import asyncio

        import httpx
        from sqlalchemy import select

        from app.core import database
        from app.core.batch_settings import configure as configure_batch, load_batch_settings
        from app.core.security import create_access_token, hash_password
        from app.core.seed_loader import apply_seed
        from app.core.settings_service import apply_all
        from app.models.model_spec import ModelSpec
        from app.models.product_line import ProductLine
        from app.models.product_model import ProductModel
        from app.models.user import User

        asyncio.get_running_loop().set_debug(False)  # bcrypt 很慢，除錯模式會一直警告
        self.app = build_app()
        if ApiCase._hash is None:
            ApiCase._hash = hash_password(self.PASSWORD)
        configure_batch(load_batch_settings({}))  # 上一個測試可能透過設定中心改過
        engine = database.configure()
        self.engine = engine
        async with engine.begin() as conn:
            await conn.run_sync(database.Base.metadata.create_all)
        async with database.session() as db:
            await apply_seed(db, SEED)
            self.users = {}
            for name, role in self.ROLES.items():
                user = User(username=name, display_name=name, role=role, password_hash=ApiCase._hash,
                            must_change_password=False)
                db.add(user)
                await db.flush()
                self.users[name] = user.id
            line = await db.scalar(select(ProductLine).where(ProductLine.code == "line_a"))
            model = ProductModel(product_line_id=line.id, code="M1", display_name="型號一", process_variant=None, attributes={})
            db.add(model)
            await db.flush()
            db.add(ModelSpec(product_model_id=model.id, metric_key="quality_value", spec_min=1, spec_max=5))
            self.model_id = model.id
            await db.commit()
            await apply_all(db)
        self.tokens = {name: create_access_token(str(uid)) for name, uid in self.users.items()}
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=self.app), base_url="http://test")

    async def asyncTearDown(self):
        await self.client.aclose()
        await self.engine.dispose()

    async def call(self, who, method, url, **kw):
        headers = {"Authorization": f"Bearer {self.tokens[who]}"} if who else {}
        return await self.client.request(method, url, headers=headers, **kw)

    async def ok(self, who, method, url, status=200, **kw):
        r = await self.call(who, method, url, **kw)
        self.assertEqual(r.status_code, status, f"{method} {url} → {r.status_code} {r.text}")
        return r.json() if r.content else None

    async def open_batch(self, who="manager", **extra):
        body = {"product_model_id": self.model_id, "target_weight": 100,
                "assigned_operator1_id": self.users["op1"], "assigned_operator2_id": self.users["op2"],
                "assigned_qc_id": self.users["qc"], **extra}
        return await self.ok(who, "POST", "/batches", 201, json=body)

    async def measure(self, who, batch_id, station, key, status=200, **value):
        return await self.ok(who, "POST", f"/batches/{batch_id}/measurements", status,
                             json={"station_code": station, "metric_key": key, **value})
