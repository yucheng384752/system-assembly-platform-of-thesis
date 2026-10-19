"""產品定義：型號與配方、異動紀錄、理論用量、表單（變體步驟、型號規格、預留產線），以及開單預填理論用量。"""

import unittest

from base import ApiCase

RECIPE = [{"key": "main", "label": "主料", "ratio_pct": 80}, {"key": "rest", "label": "其餘", "is_remainder": True}]


class ProductProcessTest(ApiCase):
    async def test_model_recipe_change_log_and_theoretical(self):
        body = {"product_line_code": "line_a", "code": "M2", "process_variant": "alt", "recipe_lines": RECIPE, "reason": "新品"}
        await self.ok("op1", "POST", "/product-models", 403, json=body)
        await self.ok("manager", "POST", "/product-models", 409, json={**body, "product_line_code": "line_b"})  # 預留產線
        model = await self.ok("manager", "POST", "/product-models", 201, json=body)
        await self.ok("manager", "POST", "/product-models", 409, json=body)
        theo = await self.ok("op1", "GET", f"/product-models/{model['id']}/theoretical", params={"total": 50})
        self.assertEqual({t["key"]: t["weight"] for t in theo}, {"main": 40.0, "rest": 10.0})

        # 沒有實際變動：不要求原因、不留紀錄；有變動：必填原因。
        await self.ok("manager", "PATCH", f"/product-models/{model['id']}", json={"display_name": None, "process_variant": "alt"})
        await self.ok("manager", "PATCH", f"/product-models/{model['id']}", 400, json={"display_name": "新名稱"})
        await self.ok("manager", "PATCH", f"/product-models/{model['id']}", json={"display_name": "新名稱", "reason": "改名"})
        logs = await self.ok("manager", "GET", f"/product-models/{model['id']}/change-logs")
        self.assertEqual([l["reason"] for l in logs], ["改名", "新品"])
        self.assertIn("品名", logs[0]["summary"])

        # 開單時依配方預填理論用量。
        batch = await self.ok("manager", "POST", "/batches", 201, json={
            "product_model_id": model["id"], "target_weight": 50, "assigned_operator1_id": self.users["op1"],
            "assigned_operator2_id": self.users["op2"], "assigned_qc_id": self.users["qc"]})
        mats = await self.ok("manager", "GET", f"/batches/{batch['id']}/materials")
        self.assertEqual({m["kind"]: m["theoretical_qty"] for m in mats}, {"total": 50, "main": 40, "rest": 10})

    async def test_form_resolves_variant_steps_and_model_specs(self):
        form = await self.ok("op1", "GET", "/forms/line_a", params={"model_id": self.model_id})
        process = next(s for s in form["stations"] if s["code"] == "process")
        self.assertEqual([s["instruction"] for s in process["steps"]], ["投料", "主要加工"])
        q = process["metrics"][0]
        self.assertEqual((q["model_spec_min"], q["model_spec_max"]), (1, 5))
        await self.ok("op1", "GET", "/forms/line_b", 409)
        await self.ok("op1", "GET", "/forms/line_z", 404)
        await self.ok("op1", "GET", "/forms/line_a", 404, params={"model_id": 999})
        lines = await self.ok("op1", "GET", "/product-lines")
        self.assertEqual({l["code"]: l["status"] for l in lines}, {"line_a": "defined", "line_b": "reserved", "line_c": "reserved"})

    async def test_seed_is_idempotent(self):
        from app.core import database
        from app.core.seed_loader import apply_seed
        from harness import SEED

        async with database.session() as db:
            self.assertEqual(await apply_seed(db, SEED), {"lines": 0, "stations": 0, "metrics": 0, "steps": 0})


if __name__ == "__main__":
    unittest.main()
