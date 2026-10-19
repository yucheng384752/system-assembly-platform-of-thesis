"""可見性與範圍：產線範圍、唯讀角色、首次登入改密碼、入口覆寫、登入鎖定。"""

import unittest

from base import ApiCase


class VisibilityTest(ApiCase):
    async def test_product_line_scope_hides_batches_everywhere(self):
        batch = await self.open_batch()
        bid = batch["id"]
        await self.ok("manager", "POST", f"/batches/{bid}/dispatch")
        await self.measure("op1", bid, "process", "quality_value", value_num=9)  # 開一筆報警

        mgr = self.users["manager"]
        await self.ok("admin", "PUT", f"/users/{mgr}/scopes/product-line", 404, json={"keys": ["line_z"]})
        user = await self.ok("admin", "PUT", f"/users/{mgr}/scopes/product-line", json={"keys": ["line_b"]})
        self.assertEqual(user["scopes"]["product-line"], ["line_b"])
        await self.ok("op1", "PUT", f"/users/{mgr}/scopes/product-line", 403, json={"keys": []})

        # 範圍外的批次一律當作不存在；清單、報警、儀表板也不洩漏。
        await self.ok("manager", "GET", f"/batches/{bid}", 404)
        self.assertEqual(await self.ok("manager", "GET", "/batches"), [])
        self.assertEqual(await self.ok("manager", "GET", "/alarms"), [])
        self.assertEqual(await self.ok("manager", "GET", "/dashboard/batches"), [])
        self.assertEqual((await self.ok("manager", "GET", "/dashboard/overview"))["batches"], {})
        self.assertEqual(await self.ok("manager", "GET", "/dashboard/activity"), [])
        self.assertEqual([l["code"] for l in await self.ok("manager", "GET", "/product-lines")], ["line_b"])
        r = await self.call("manager", "POST", "/batches", json={"product_model_id": self.model_id})
        self.assertEqual((r.status_code, r.json()["detail"]), (403, "不在可管理的產線範圍內"))

        # 清空綁定 = 不限制。
        await self.ok("admin", "PUT", f"/users/{mgr}/scopes/product-line", json={"keys": []})
        await self.ok("manager", "GET", f"/batches/{bid}")
        self.assertEqual(len(await self.ok("manager", "GET", "/alarms")), 1)

    async def test_read_only_role_sees_only_completed_batches_and_cannot_write(self):
        batch = await self.open_batch(target_weight=None)
        bid = batch["id"]
        await self.ok("auditor", "GET", f"/batches/{bid}", 404)
        await self.ok("auditor", "POST", f"/batches/{bid}/sign", 403, json={"role": "operator"})
        self.assertEqual(await self.ok("auditor", "GET", "/batches"), [])

        await self.ok("manager", "POST", f"/batches/{bid}/dispatch")
        await self.measure("op1", bid, "prepare", "prep_weight", value_num=10)
        await self.measure("op1", bid, "process", "quality_value", value_num=3)
        await self.measure("manager", bid, "inspect", "appearance", value_text="OK")
        await self.ok("op1", "POST", f"/batches/{bid}/sign", json={"role": "operator"})
        await self.ok("manager", "POST", f"/batches/{bid}/sign", json={"role": "inspector"})
        await self.ok("manager", "POST", f"/batches/{bid}/complete")
        self.assertEqual((await self.ok("auditor", "GET", f"/batches/{bid}"))["status"], "completed")
        self.assertEqual(len(await self.ok("auditor", "GET", "/batches")), 1)

    async def test_first_login_must_change_password(self):
        await self.ok("manager", "POST", "/users", 403, json={"username": "boss", "display_name": "B", "password": "long-enough-1", "role": "admin"})
        await self.ok("manager", "POST", "/users", 400, json={"username": "new_op", "display_name": "N", "password": "short", "role": "operator"})
        created = await self.ok("manager", "POST", "/users", 201, json={"username": "new_op", "display_name": "N", "password": "long-enough-1", "role": "operator"})
        self.assertTrue(created["must_change_password"])
        await self.ok("manager", "POST", "/users", 409, json={"username": "new_op", "display_name": "N", "password": "long-enough-1", "role": "operator"})
        login = await self.ok(None, "POST", "/auth/login", json={"username": "new_op", "password": "long-enough-1"})
        headers = {"Authorization": f"Bearer {login['access_token']}"}
        self.assertEqual((await self.client.get("/auth/me", headers=headers)).status_code, 200)
        r = await self.client.get("/batches", headers=headers)
        self.assertEqual((r.status_code, r.json()["detail"]), (403, "首次登入需先變更密碼"))
        r = await self.client.post("/auth/change-password", headers=headers,
                                   json={"current_password": "long-enough-1", "new_password": "long-enough-2"})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual((await self.client.get("/batches", headers=headers)).status_code, 200)

    async def test_login_lockout_and_uniform_error(self):
        for _ in range(3):
            r = await self.call(None, "POST", "/auth/login", json={"username": "nobody-lock", "password": "x"})
            self.assertEqual((r.status_code, r.json()["detail"]), (401, "帳號或密碼錯誤"))
        r = await self.call(None, "POST", "/auth/login", json={"username": "nobody-lock", "password": "x"})
        self.assertEqual(r.status_code, 429)

    async def test_entry_point_override_and_tag_based_user_directory(self):
        op1 = self.users["op1"]
        await self.ok("op1", "POST", "/batches", 403, json={"product_model_id": self.model_id})
        await self.ok("op1", "GET", "/users", 403)
        await self.ok("admin", "PUT", f"/users/{op1}/entry-point-overrides", 422, json={"overrides": {"no_such_entry": True}})
        user = await self.ok("admin", "PUT", f"/users/{op1}/entry-point-overrides", json={"overrides": {"batch_manage": True}})
        self.assertTrue(user["entry_point_overrides"]["batch_manage"])
        await self.open_batch("op1")
        # batch_manage 帶有 user-directory tag，所以也能讀帳號清單（指派人員用）。
        self.assertEqual(len(await self.ok("op1", "GET", "/users")), len(self.ROLES))
        await self.ok("admin", "PUT", f"/users/{self.users['auditor']}/entry-point-overrides", 422, json={"overrides": {"batch_manage": True}})


if __name__ == "__main__":
    unittest.main()
