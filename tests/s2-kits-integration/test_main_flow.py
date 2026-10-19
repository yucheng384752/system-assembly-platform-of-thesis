"""主流程：開單 → 派工 → 量測 → 報警 → 異常簽核 → 重填 → 簽核 → 完成，以及事件與交易的整體行為。"""

import unittest

from base import ApiCase


class MainFlowTest(ApiCase):
    async def test_open_measure_alarm_exception_sign_complete(self):
        batch = await self.open_batch()
        bid = batch["id"]
        self.assertEqual(batch["status"], "not_started")
        materials = await self.ok("manager", "GET", f"/batches/{bid}/materials")
        self.assertEqual([m["kind"] for m in materials], ["total"])

        # 未派工不能填。
        await self.measure("op1", bid, "prepare", "prep_weight", 409, value_num=10)
        await self.ok("manager", "POST", f"/batches/{bid}/dispatch")
        await self.measure("op1", bid, "prepare", "prep_weight", value_num=10)
        self.assertEqual((await self.ok("op1", "GET", f"/batches/{bid}"))["current_station"], "加工")

        # 關鍵量測超出型號規格（1～5）→ 規格範圍報警 + 異常簽核閘門擋住後續站點。
        await self.measure("op1", bid, "process", "quality_value", value_num=9)
        alarms = await self.ok("manager", "GET", "/alarms", params={"status_filter": "unresolved", "batch_id": bid})
        self.assertEqual(len(alarms), 1)
        self.assertEqual(alarms[0]["batch_label"], batch["lot_no"])
        r = await self.call("manager", "POST", f"/batches/{bid}/measurements",
                            json={"station_code": "inspect", "metric_key": "appearance", "value_text": "OK"})
        self.assertEqual((r.status_code, r.json()["detail"]), (409, "初始量測異常尚未通過，無法填寫後續站點"))
        self.assertEqual((await self.ok("op1", "GET", f"/batches/{bid}"))["current_station"], "加工")

        # 申請 → admin 核准重工 → 重填合格值 → 報警自動解除。
        req = await self.ok("op1", "POST", f"/batches/{bid}/exception-requests", 201, json={"reason": "重新量測"})
        await self.ok("manager", "POST", f"/exception-requests/{req['id']}/decision", 403, json={"status": "rework_approved"})
        await self.ok("admin", "POST", f"/exception-requests/{req['id']}/decision", json={"status": "rework_approved"})
        await self.measure("op1", bid, "process", "quality_value", value_num=3)
        self.assertEqual(await self.ok("manager", "GET", "/alarms", params={"status_filter": "unresolved", "batch_id": bid}), [])

        # 檢驗項目只限 manager 填。
        await self.measure("op1", bid, "inspect", "appearance", 403, value_text="OK")
        await self.measure("manager", bid, "inspect", "appearance", value_text="OK")
        self.assertIsNone((await self.ok("op1", "GET", f"/batches/{bid}"))["current_station"])

        # 簽核：操作員不能簽檢驗員欄；簽過不能再簽。完成前缺什麼由同一份清單回報。
        r = await self.call("manager", "POST", f"/batches/{bid}/complete")
        self.assertEqual(r.status_code, 409)
        self.assertEqual(r.json()["detail"], "尚未符合完成條件：操作員簽名、檢驗員簽名")
        await self.ok("op1", "POST", f"/batches/{bid}/sign", 403, json={"role": "inspector"})
        signed = await self.ok("op1", "POST", f"/batches/{bid}/sign", json={"role": "operator"})
        self.assertEqual(signed["signed_by_name"], "op1")
        await self.ok("op2", "POST", f"/batches/{bid}/sign", 409, json={"role": "operator"})
        await self.ok("manager", "POST", f"/batches/{bid}/sign", json={"role": "inspector"})
        done = await self.ok("manager", "POST", f"/batches/{bid}/complete")
        self.assertEqual(done["status"], "completed")
        await self.measure("op1", bid, "prepare", "prep_weight", 409, value_num=11)

        # BatchChanged → 活動紀錄（儀表板 Kit 訂閱），由新到舊。
        activity = await self.ok("manager", "GET", "/dashboard/activity", params={"batch_id": bid})
        self.assertGreaterEqual(len(activity), 10)
        self.assertEqual(activity, sorted(activity, key=lambda a: a["id"], reverse=True))
        self.assertTrue(all(a["batch_label"] == batch["lot_no"] for a in activity))
        overview = await self.ok("manager", "GET", "/dashboard/overview")
        self.assertEqual(overview["batches"], {"completed": 1})
        self.assertEqual([s["key"] for s in overview["sections"]], ["alarm", "equipment"])
        self.assertTrue(all(s["error"] is None for s in overview["sections"]))
        trace = await self.ok("auditor", "GET", f"/dashboard/batches/{bid}/trace")
        self.assertEqual({(c["station_code"], c["metric_key"]) for c in trace},
                         {("prepare", "prep_weight"), ("process", "quality_value"), ("inspect", "appearance")})

    async def test_subscriber_failure_rolls_back_the_measurement(self):
        """訂閱者與量測同一交易：訂閱者拋例外，量測也不能留下。"""
        from app.core.events import MeasurementRecorded, bus

        batch = await self.open_batch()
        await self.ok("manager", "POST", f"/batches/{batch['id']}/dispatch")

        async def boom(db, event):
            raise RuntimeError("訂閱者寫入失敗")

        bus.subscribe(MeasurementRecorded, boom)
        try:
            with self.assertRaises(RuntimeError):
                await self.call("op1", "POST", f"/batches/{batch['id']}/measurements",
                                json={"station_code": "prepare", "metric_key": "prep_weight", "value_num": 10})
        finally:
            bus._handlers[MeasurementRecorded].remove(boom)
        self.assertEqual(await self.ok("op1", "GET", f"/batches/{batch['id']}/measurements"), [])


if __name__ == "__main__":
    unittest.main()
