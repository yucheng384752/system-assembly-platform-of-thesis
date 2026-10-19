"""點檢週期、項目判斷、閘門判斷、匯出與設定的行為測試。

執行（不需第三方套件）：
  PYTHONPATH=kits/equipment-maintenance-kit/src/backend python -m unittest discover -s kits/equipment-maintenance-kit/tests
"""

import unittest
from datetime import date
from decimal import Decimal as D

from app.core.check_rules import CheckError, ItemDef, can_resubmit, evaluate, validate_review
from app.core.equipment_settings import SettingsError, load_equipment_settings
from app.core.export_csv import safe_cell, to_csv
from app.core.gate_rules import CheckState, EquipmentFacts, blocker, global_blocker
from app.core.periods import period_key, valid_month


class PeriodTest(unittest.TestCase):
    def test_keys(self):
        d = date(2026, 10, 19)
        self.assertEqual(period_key("daily", d), "2026-10-19")
        self.assertEqual(period_key("weekly", d), "2026-W43")
        self.assertEqual(period_key("monthly", d), "2026-10")

    def test_iso_week_year_boundary(self):
        self.assertEqual(period_key("weekly", date(2026, 1, 1)), "2026-W01")
        self.assertEqual(period_key("weekly", date(2027, 1, 1)), "2026-W53")

    def test_unknown_frequency_and_month_format(self):
        with self.assertRaises(ValueError):
            period_key("yearly", date(2026, 1, 1))
        self.assertTrue(valid_month("2026-10"))
        for bad in ("2026-13", "2026-1", "26-10", "2026-10-01", ""):
            self.assertFalse(valid_month(bad))


ITEMS = [ItemDef("clean", "清潔"), ItemDef("temp", "溫度", "num", "°C", D("20"), D("30")), ItemDef("memo", "備註項", "bool", required=False)]


class EvaluateTest(unittest.TestCase):
    def test_all_normal(self):
        ev = evaluate(ITEMS, {"clean": True, "temp": 25}, None)
        self.assertEqual((ev.abnormal, ev.normalized), ((), {"clean": True, "temp": "25"}))

    def test_missing_required_is_rejected_and_optional_may_be_blank(self):
        with self.assertRaisesRegex(CheckError, "清潔"):
            evaluate(ITEMS, {"temp": 25}, None)
        evaluate(ITEMS, {"clean": True, "temp": 25}, None)

    def test_boundary_values_are_normal(self):
        self.assertEqual(evaluate(ITEMS, {"clean": True, "temp": 20}, None).abnormal, ())
        self.assertEqual(evaluate(ITEMS, {"clean": True, "temp": 30}, None).abnormal, ())

    def test_abnormal_needs_a_note(self):
        with self.assertRaisesRegex(CheckError, "說明"):
            evaluate(ITEMS, {"clean": False, "temp": 31}, None)
        with self.assertRaisesRegex(CheckError, "說明"):
            evaluate(ITEMS, {"clean": False, "temp": 25}, "  ")
        ev = evaluate(ITEMS, {"clean": False, "temp": 31}, "已通知維修")
        self.assertEqual(ev.abnormal, ("清潔異常", "溫度 31°C 超出範圍"))

    def test_type_errors(self):
        for results in ({"clean": "yes", "temp": 25}, {"clean": True, "temp": "abc"}, {"clean": True, "temp": True},
                        {"clean": True, "temp": "NaN"}, {"clean": True, "temp": 25, "ghost": 1}):
            with self.subTest(results=results), self.assertRaises(CheckError):
                evaluate(ITEMS, results, "x")

    def test_item_definition_validation(self):
        with self.assertRaises(CheckError):
            ItemDef("a", "A", "text")
        with self.assertRaises(CheckError):
            ItemDef("a", "A", "num", low=D("5"), high=D("1"))


class ReviewTest(unittest.TestCase):
    def test_review_rules(self):
        validate_review(1, 2, "submitted", True)
        validate_review(1, 1, "submitted", False)
        with self.assertRaisesRegex(CheckError, "本人"):
            validate_review(1, 1, "submitted", True)
        with self.assertRaises(CheckError):
            validate_review(1, 2, "reviewed", True)

    def test_resubmission_locks_after_review(self):
        self.assertTrue(can_resubmit(None))
        self.assertTrue(can_resubmit("submitted"))
        self.assertFalse(can_resubmit("reviewed"))


def facts(**kw):
    return EquipmentFacts("E1", "混合機", **kw)


class GateTest(unittest.TestCase):
    D_ONLY = ("daily",)

    def test_ready_equipment_passes(self):
        self.assertIsNone(blocker(facts(checks={"daily": CheckState("submitted")}), self.D_ONLY, False, True))

    def test_retired_and_repair_come_first_and_name_the_equipment(self):
        self.assertEqual(blocker(facts(active=False), self.D_ONLY, False, True), "設備 混合機已停用")
        self.assertEqual(blocker(facts(open_repair=True), self.D_ONLY, False, True), "設備 混合機維修中")

    def test_missing_check_names_the_frequency(self):
        self.assertEqual(blocker(facts(), self.D_ONLY, False, True), "設備 混合機尚未完成每日點檢")
        f = facts(checks={"daily": CheckState("reviewed")})
        self.assertEqual(blocker(f, ("daily", "weekly"), False, True), "設備 混合機尚未完成每週點檢")

    def test_review_requirement(self):
        f = facts(checks={"daily": CheckState("submitted")})
        self.assertIn("待複核", blocker(f, self.D_ONLY, True, True))
        self.assertIsNone(blocker(facts(checks={"daily": CheckState("reviewed")}), self.D_ONLY, True, True))

    def test_abnormal_blocks_until_reviewed_when_enabled(self):
        f = facts(checks={"daily": CheckState("submitted", abnormal=True)})
        self.assertIn("有異常", blocker(f, self.D_ONLY, False, True))
        self.assertIsNone(blocker(f, self.D_ONLY, False, False))
        self.assertIsNone(blocker(facts(checks={"daily": CheckState("reviewed", abnormal=True)}), self.D_ONLY, False, True))

    def test_global_summary_caps_the_names(self):
        ok = EquipmentFacts("A", "A", checks={"daily": CheckState("submitted")})
        bad = [EquipmentFacts(f"B{i}", f"B{i}") for i in range(7)]
        self.assertIsNone(global_blocker([ok], self.D_ONLY, False, True))
        msg = global_blocker([ok, *bad], self.D_ONLY, False, True)
        self.assertIn("B0、B1、B2、B3、B4", msg)
        self.assertIn("等 7 台", msg)
        self.assertNotIn("B5", msg)


class ExportTest(unittest.TestCase):
    def test_formula_cells_are_neutralised(self):
        for danger in ("=1+1", "+cmd", "-2", "@SUM(A1)", "\tx"):
            self.assertTrue(safe_cell(danger).startswith("'"))
        self.assertEqual(safe_cell("正常"), "正常")
        self.assertEqual(safe_cell(None), "")

    def test_csv_has_bom_header_and_crlf(self):
        text = to_csv([["E1", "=bad", "daily", "2026-10-19", "submitted", "u1", "t", "", "", "", ""]])
        self.assertTrue(text.startswith("﻿設備代碼"))
        self.assertIn("'=bad", text)
        self.assertTrue(text.endswith("\r\n"))


class SettingsTest(unittest.TestCase):
    def test_defaults(self):
        s = load_equipment_settings({})
        self.assertEqual((s.required_frequencies, s.require_review, s.global_mode, s.gated_stations), (("daily",), False, "off", None))

    def test_custom(self):
        s = load_equipment_settings({"requiredFrequencies": ["daily", "weekly"], "gatedStations": ["s1"], "globalMode": "line-equipment"})
        self.assertEqual(s.gated_stations, frozenset({"s1"}))

    def test_bad_values(self):
        for raw in ({"x": 1}, {"requiredFrequencies": []}, {"requiredFrequencies": ["hourly"]}, {"globalMode": "all"}):
            with self.subTest(raw=raw), self.assertRaises(SettingsError):
                load_equipment_settings(raw)


if __name__ == "__main__":
    unittest.main()
