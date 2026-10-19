"""活動紀錄文字化、保留期限、設定與總覽提供者登錄的行為測試。

執行（不需第三方套件）：
  PYTHONPATH=kits/production-dashboard-kit/src/backend python -m unittest discover -s kits/production-dashboard-kit/tests
"""

import unittest
from datetime import datetime, timedelta, timezone

from app.core.activity import MAX_LEN, describe
from app.core.dashboard_settings import DashboardSettingsError, load_dashboard_settings
from app.core.providers import MAX_ROWS, ProviderRegistry
from app.core.retention import RetentionError, cutoff


class DescribeTest(unittest.TestCase):
    def test_known_reasons(self):
        self.assertEqual(describe("measurement"), "填寫量測")
        self.assertEqual(describe("completed"), "完成工單")

    def test_signed_roles(self):
        self.assertEqual(describe("signed:operator"), "操作員簽核")
        self.assertEqual(describe("signed:inspector"), "檢驗員簽核")
        self.assertEqual(describe("signed:other"), "other簽核")

    def test_deleted_shows_the_reason_and_cleans_it(self):
        self.assertEqual(describe("deleted:填錯批號"), "刪除批次（原因：填錯批號）")
        self.assertEqual(describe("deleted:"), "刪除批次")
        self.assertNotIn("\n", describe("deleted:a\nb"))

    def test_unknown_reason_is_shown_safely(self):
        self.assertEqual(describe("something_new"), "something_new")
        self.assertEqual(describe(""), "（未知異動）")
        self.assertNotIn("\x07", describe("bell\x07"))
        self.assertEqual(len(describe("x" * 500)), MAX_LEN + 1)

    def test_overrides_win(self):
        self.assertEqual(describe("measurement", {"measurement": "記錄數值"}), "記錄數值")
        self.assertEqual(describe("custom", {"custom": "自訂"}), "自訂")


class RetentionTest(unittest.TestCase):
    NOW = datetime(2026, 10, 19, tzinfo=timezone.utc)

    def test_zero_means_keep_forever(self):
        self.assertIsNone(cutoff(self.NOW, 0))

    def test_cutoff_is_n_days_back(self):
        self.assertEqual(cutoff(self.NOW, 90), self.NOW - timedelta(days=90))

    def test_range_is_enforced(self):
        for bad in (-1, 3651):
            with self.subTest(days=bad), self.assertRaises(RetentionError):
                cutoff(self.NOW, bad)


class SettingsTest(unittest.TestCase):
    def test_defaults(self):
        s = load_dashboard_settings({})
        self.assertEqual((s.activity_enabled, s.activity_retention_days, s.list_limit, s.reason_labels), (True, 0, 50, {}))

    def test_custom(self):
        s = load_dashboard_settings({"activityEnabled": False, "activityRetentionDays": 30, "listLimit": 20, "reasonLabels": {"a": "b"}})
        self.assertEqual((s.activity_enabled, s.activity_retention_days, s.list_limit, s.reason_labels), (False, 30, 20, {"a": "b"}))

    def test_bad_values(self):
        for raw in ({"nope": 1}, {"activityRetentionDays": -5}, {"listLimit": 0}, {"listLimit": 500}):
            with self.subTest(raw=raw), self.assertRaises(DashboardSettingsError):
                load_dashboard_settings(raw)


class P:
    def __init__(self, key, order, result=None, boom=False):
        self.key, self.title, self.order, self._r, self._boom = key, key.upper(), order, result, boom

    async def fetch(self, db, actor):
        if self._boom:
            raise RuntimeError("壞了")
        return self._r


class ProviderTest(unittest.IsolatedAsyncioTestCase):
    async def test_no_providers_gives_no_sections(self):
        self.assertEqual(await ProviderRegistry().collect(None, None), [])

    def test_sections_follow_order_then_key(self):
        reg = ProviderRegistry()
        reg.register(P("b", 20, {"counts": {}}))
        reg.register(P("a", 20, {"counts": {}}))
        reg.register(P("z", 5, {"counts": {}}))
        self.assertEqual(reg.keys(), ["z", "a", "b"])

    async def test_one_failure_does_not_break_the_rest(self):
        reg = ProviderRegistry()
        reg.register(P("ok", 1, {"counts": {"待處理": 3}, "rows": [{"x": 1}]}))
        reg.register(P("bad", 2, boom=True))
        ok, bad = await reg.collect(None, None)
        self.assertEqual((ok.counts, ok.rows, ok.error), ({"待處理": 3}, [{"x": 1}], None))
        self.assertEqual((bad.counts, bad.error), ({}, "此區塊暫時無法取得"))

    async def test_rows_are_capped(self):
        reg = ProviderRegistry()
        reg.register(P("many", 1, {"counts": {}, "rows": [{"i": i} for i in range(MAX_ROWS + 10)]}))
        self.assertEqual(len((await reg.collect(None, None))[0].rows), MAX_ROWS)

    def test_duplicate_or_keyless_provider_is_rejected(self):
        reg = ProviderRegistry()
        reg.register(P("a", 1, {}))
        with self.assertRaises(ValueError):
            reg.register(P("a", 2, {}))
        with self.assertRaises(ValueError):
            reg.register(P("", 1, {}))


if __name__ == "__main__":
    unittest.main()
