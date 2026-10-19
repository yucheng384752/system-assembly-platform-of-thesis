"""設定中心（樂觀鎖、提交後才套用）、閘門順序、第二階段子功能（入庫單、回鍋單、備註、照片）。"""

import unittest

from base import ApiCase

KEY = "batch.require_assignment"
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32


class SettingsTest(ApiCase):
    async def test_optimistic_lock_history_and_apply_after_commit(self):
        cur = await self.ok("admin", "GET", f"/settings/{KEY}")
        self.assertEqual((cur["value"], cur["version"], cur["source"]), (True, 0, "default"))
        await self.ok("op1", "PUT", f"/settings/{KEY}", 403, json={"value": False, "expected_version": 0, "reason": "x"})
        await self.ok("admin", "PUT", f"/settings/{KEY}", 422, json={"value": False, "expected_version": 0})  # 中風險要原因
        new = await self.ok("admin", "PUT", f"/settings/{KEY}", json={"value": False, "expected_version": 0, "reason": "試產不指派"})
        self.assertEqual((new["value"], new["version"], new["source"]), (False, 1, "runtime"))
        # 別人拿舊版本來改 → 409，不覆蓋。
        r = await self.call("manager", "PUT", f"/settings/{KEY}", json={"value": True, "expected_version": 0, "reason": "改回"})
        self.assertEqual(r.status_code, 409)
        # 同值不加版本、不留紀錄。
        same = await self.ok("admin", "PUT", f"/settings/{KEY}", json={"value": False, "expected_version": 1, "reason": "同值"})
        self.assertEqual(same["version"], 1)
        self.assertEqual(len(await self.ok("admin", "GET", f"/settings/{KEY}/history")), 1)
        # 提交後通知批次 Kit：開單不再要求指派。
        await self.ok("manager", "POST", "/batches", 201, json={"product_model_id": self.model_id})
        reset = await self.ok("admin", "POST", f"/settings/{KEY}/reset", json={"expected_version": 1, "reason": "恢復"})
        self.assertEqual((reset["value"], reset["version"], reset["source"]), (True, 2, "default"))
        await self.ok("manager", "POST", "/batches", 422, json={"product_model_id": self.model_id})
        exported = await self.ok("admin", "GET", "/settings/export")
        self.assertEqual(exported[KEY]["version"], 2)


class GateOrderTest(ApiCase):
    async def test_equipment_gate_then_more_specific_gate_wins(self):
        from app.core.gates import GateBase, gates

        await self.ok("manager", "POST", "/equipment", 201, json={"code": "EQ1", "name": "攪拌機一號"})
        await self.ok("manager", "PUT", "/equipment/EQ1/checklist",
                      json=[{"frequency": "daily", "key": "clean", "label": "清潔", "kind": "bool"}])
        batch = await self.open_batch(equipment_ref="EQ1")
        bid = batch["id"]
        await self.ok("manager", "POST", f"/batches/{bid}/dispatch")
        r = await self.call("op1", "POST", f"/batches/{bid}/measurements", json={"station_code": "prepare", "metric_key": "prep_weight", "value_num": 1})
        self.assertEqual(r.status_code, 409)
        equipment_reason = r.json()["detail"]
        self.assertIn("攪拌機一號", equipment_reason)

        class Earlier(GateBase):
            key, order = "test.earlier", 5

            async def write_blocker(self, ctx, station_code):
                return "更具體的原因"

        gates.register(Earlier())
        try:
            r = await self.call("op1", "POST", f"/batches/{bid}/measurements", json={"station_code": "prepare", "metric_key": "prep_weight", "value_num": 1})
            self.assertEqual(r.json()["detail"], "更具體的原因")
        finally:
            gates._gates.pop("test.earlier")

        # 完成今日點檢 → 設備閘門放行；總覽的設備區塊同步。
        await self.ok("op1", "POST", "/equipment/EQ1/checks", json={"frequency": "daily", "results": {"clean": True}})
        await self.measure("op1", bid, "prepare", "prep_weight", value_num=1)
        overview = await self.ok("manager", "GET", "/dashboard/overview")
        equipment = next(s for s in overview["sections"] if s["key"] == "equipment")
        self.assertEqual(equipment["counts"], {"可用": 1, "不可用": 0})


class ExtrasTest(ApiCase):
    async def test_warehouse_rework_notes_attachments(self):
        from harness import store

        batch = await self.open_batch()
        bid = batch["id"]
        await self.ok("manager", "POST", f"/batches/{bid}/dispatch")

        # 入庫單：明細合計須等於數量；送出後鎖定。
        await self.ok("op1", "GET", f"/batches/{bid}/warehouse-entry", 404)
        await self.ok("op1", "PUT", f"/batches/{bid}/warehouse-entry", json={"quantity": 10, "unit": "kg", "lines": [{"label": "A", "qty": 4}]})
        await self.ok("op1", "POST", f"/batches/{bid}/warehouse-entry/submit", 422)
        await self.ok("op1", "PUT", f"/batches/{bid}/warehouse-entry", json={"quantity": 10, "unit": "kg", "lines": [{"label": "A", "qty": 4}, {"label": "B", "qty": 6}]})
        entry = await self.ok("op1", "POST", f"/batches/{bid}/warehouse-entry/submit")
        self.assertEqual(entry["status"], "submitted")
        await self.ok("op1", "PUT", f"/batches/{bid}/warehouse-entry", 409, json={"quantity": 1, "unit": "kg"})

        # 回鍋單：填單者不能自己確認；待確認時擋完成。
        rec = await self.ok("manager", "POST", f"/batches/{bid}/rework-records", 201, json={"quantity": 2, "reason": "重工"})
        await self.ok("manager", "POST", f"/rework-records/{rec['id']}/confirm", 409)
        r = await self.call("manager", "POST", f"/batches/{bid}/complete")
        self.assertIn("回鍋確認單待確認", r.json()["detail"])
        confirmed = await self.ok("admin", "POST", f"/rework-records/{rec['id']}/confirm")
        self.assertEqual(confirmed["status"], "confirmed")

        # 備註只增不改。
        await self.ok("op1", "POST", f"/batches/{bid}/notes", 201, json={"station_code": "process", "text": "溫度偏高"})
        await self.ok("auditor", "GET", f"/batches/{bid}/notes", 404)  # 唯讀角色看不到未完成批次
        self.assertEqual(len(await self.ok("manager", "GET", f"/batches/{bid}/notes")), 1)

        # 照片：以檔頭判斷格式；重傳取代舊物件；刪除會回收物件。
        await self.ok("op1", "POST", f"/batches/{bid}/attachments/photo", 422, files={"file": ("x.png", b"not an image", "image/png")})
        await self.ok("op1", "POST", f"/batches/{bid}/attachments/other", 422, files={"file": ("x.png", PNG, "image/png")})
        first = await self.ok("op1", "POST", f"/batches/{bid}/attachments/photo", files={"file": ("../evil name.png", PNG, "image/jpeg")})
        self.assertEqual(first["content_type"], "image/png")
        self.assertNotIn("/", first["filename"])
        await self.ok("op1", "POST", f"/batches/{bid}/attachments/photo", files={"file": ("again.png", PNG, "image/png")})
        self.assertEqual(len(store().objects), 1)
        self.assertEqual(len(await self.ok("op1", "GET", f"/batches/{bid}/attachments")), 1)
        await self.ok("op1", "DELETE", f"/batches/{bid}/attachments/photo", 204)
        self.assertEqual(store().objects, {})


if __name__ == "__main__":
    unittest.main()
