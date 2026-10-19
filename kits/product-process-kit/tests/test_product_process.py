"""配方計算、表單解析、異動比對與定義檔檢查的行為測試。

執行（不需第三方套件）：
  PYTHONPATH=kits/product-process-kit/src/backend python -m unittest discover -s kits/product-process-kit/tests
"""

import json
import unittest
from decimal import Decimal as D
from pathlib import Path

from app.core.definition_changes import ReasonRequiredError, changed_fields, require_reason, summarize
from app.core.form_resolver import MetricDef, ModelSpecDef, StepDef, effective_metrics, steps_for, with_model_specs
from app.core.product_line_status import SourceStatusError, map_source_status, source_line_to_seed
from app.core.recipe import RecipeError, RecipeLine, compute_theoretical, validate_lines
from app.core.seed_check import check_seed

SEED = Path(__file__).resolve().parents[1] / "seed" / "product-lines.sample.json"


def _lines():
    return [
        RecipeLine("main", "主料", "ITEM-M"),
        RecipeLine("aux", "輔料", "ITEM-A", ratio_pct=D("11")),
        RecipeLine("add", "添加劑", None, ratio_pct=D("2"), ratio_base="aux"),
    ]


class RecipeTest(unittest.TestCase):
    def test_remainder_line_takes_what_is_left(self):
        lines = _lines()
        lines[0] = RecipeLine("main", "主料", "ITEM-M", is_remainder=True)
        out = {r.key: r.weight for r in compute_theoretical(lines, D("100"))}
        self.assertEqual(out["aux"], D("11"))
        self.assertEqual(out["add"], D("0.22"))  # 輔料用量的 2%，不是總重的 2%
        self.assertEqual(out["main"], D("88.78"))
        self.assertEqual(sum(out.values()), D("100"))

    def test_no_ratio_data_returns_empty_so_the_user_fills_by_hand(self):
        lines = [RecipeLine("main", "主料", is_remainder=True), RecipeLine("aux", "輔料")]
        self.assertEqual(compute_theoretical(lines, D("50")), [])

    def test_item_numbers_are_carried_through(self):
        lines = [RecipeLine("main", "主料", "ITEM-M", is_remainder=True), RecipeLine("aux", "輔料", "ITEM-A", ratio_pct=D("10"))]
        self.assertEqual({r.key: r.item_no for r in compute_theoretical(lines, D("10"))}, {"main": "ITEM-M", "aux": "ITEM-A"})

    def test_cycle_is_rejected(self):
        lines = [RecipeLine("a", "A", ratio_pct=D("1"), ratio_base="b"), RecipeLine("b", "B", ratio_pct=D("1"), ratio_base="a")]
        with self.assertRaises(RecipeError):
            validate_lines(lines)

    def test_invalid_definitions_are_rejected(self):
        bad = [
            [RecipeLine("a", "A"), RecipeLine("a", "A2")],
            [RecipeLine("total", "T", ratio_pct=D("1"))],
            [RecipeLine("a", "A", is_remainder=True), RecipeLine("b", "B", is_remainder=True)],
            [RecipeLine("a", "A", ratio_pct=D("101"))],
            [RecipeLine("a", "A", ratio_pct=D("5"), ratio_base="missing")],
            [RecipeLine("a", "A", is_remainder=True, ratio_pct=D("5"))],
        ]
        for lines in bad:
            with self.subTest(lines=lines), self.assertRaises(RecipeError):
                validate_lines(lines)

    def test_negative_remainder_is_an_error_not_a_silent_negative(self):
        lines = [RecipeLine("main", "主料", is_remainder=True), RecipeLine("a", "A", ratio_pct=D("60")), RecipeLine("b", "B", ratio_pct=D("60"))]
        with self.assertRaises(RecipeError):
            compute_theoretical(lines, D("10"))


def _metric(i, station, key, model=None, order=0, source="constant"):
    return MetricDef(id=i, station_id=station, key=key, label=key, product_model_id=model, display_order=order, spec_source=source)


class FormResolverTest(unittest.TestCase):
    def test_model_specific_metrics_replace_the_shared_set_wholesale(self):
        ms = [_metric(1, 1, "a", order=1), _metric(2, 1, "b", order=2), _metric(3, 1, "x", model=7, order=1)]
        self.assertEqual([m.key for m in effective_metrics(ms, 1, 7)], ["x"])
        self.assertEqual([m.key for m in effective_metrics(ms, 1, 8)], ["a", "b"])
        self.assertEqual([m.key for m in effective_metrics(ms, 1, None)], ["a", "b"])

    def test_other_station_metrics_are_not_mixed_in(self):
        ms = [_metric(1, 1, "a"), _metric(2, 2, "z")]
        self.assertEqual([m.key for m in effective_metrics(ms, 2, None)], ["z"])

    def test_steps_prefer_the_model_variant_and_fall_back_to_shared(self):
        steps = [StepDef(1, 1, "共用1"), StepDef(1, 2, "共用2"), StepDef(1, 2, "變體2", variant="v2")]
        self.assertEqual([s.instruction for s in steps_for(steps, 1, "v2")], ["共用1", "變體2"])
        self.assertEqual([s.instruction for s in steps_for(steps, 1, None)], ["共用1", "共用2"])
        self.assertEqual([s.instruction for s in steps_for(steps, 1, "unknown")], ["共用1", "共用2"])

    def test_model_spec_is_display_only_and_keeps_the_constant_spec(self):
        base = MetricDef(1, 1, "k", "K", spec_source="model", spec_min=D("1"), spec_text="方法 X")
        out = with_model_specs(base, {"k": ModelSpecDef("k", D("5"), D("9"))})
        self.assertEqual((out.model_spec_min, out.model_spec_max, out.spec_min, out.spec_text), (D("5"), D("9"), D("1"), "方法 X"))
        self.assertIsNone(with_model_specs(base, {}).model_spec_min)
        const = MetricDef(2, 1, "k", "K")
        self.assertIs(with_model_specs(const, {"k": ModelSpecDef("k", D("5"))}), const)


class DefinitionChangesTest(unittest.TestCase):
    def test_numeric_equal_values_are_not_changes(self):
        self.assertEqual(changed_fields({"r": D("10.0")}, {"r": 10}), {})
        self.assertEqual(changed_fields({"r": D("10")}, {"r": 11}), {"r": (D("10"), 11)})

    def test_summary_lists_old_and_new(self):
        text = summarize({"r": (None, D("11.50"))}, {"r": "輔料佔比"})
        self.assertEqual(text, "輔料佔比：(無) → 11.5")

    def test_reason_is_required_and_trimmed(self):
        self.assertEqual(require_reason("  校正  "), "校正")
        for empty in (None, "", "   "):
            with self.assertRaises(ReasonRequiredError):
                require_reason(empty)


class SeedCheckTest(unittest.TestCase):
    def test_sample_seed_is_valid_and_has_reserved_lines(self):
        doc = json.loads(SEED.read_text(encoding="utf-8"))
        self.assertEqual(check_seed(doc), [])
        statuses = {l["code"]: l["status"] for l in doc["productLines"]}
        self.assertEqual(statuses["line_a"], "defined")
        self.assertIn("reserved", statuses.values())

    def test_reserved_line_cannot_carry_stations(self):
        doc = {"productLines": [{"code": "x", "status": "reserved", "stations": [{"code": "s", "sequence": 1}]}]}
        self.assertTrue(any("預留" in e for e in check_seed(doc)))

    def test_duplicate_and_bad_values_are_reported(self):
        doc = {"productLines": [{"code": "x", "status": "defined", "stations": [
            {"code": "s", "sequence": 1, "metrics": [
                {"key": "k", "dataType": "number", "specMin": 5, "specMax": 1},
                {"key": "k", "dataType": "bogus"}]}]},
            {"code": "x", "status": "reserved"}]}
        text = "\n".join(check_seed(doc))
        for needle in ("產線代碼重複", "項目 key 重複", "dataType 不合法", "規格下限大於上限"):
            self.assertIn(needle, text)


class SourceStatusTest(unittest.TestCase):
    def test_ok_maps_to_defined_and_wip_to_reserved(self):
        self.assertEqual(map_source_status("ok"), "defined")
        self.assertEqual(map_source_status("wip"), "reserved")
        self.assertEqual(map_source_status(" OK "), "defined")

    def test_unknown_or_missing_status_is_an_error_not_a_guess(self):
        for raw in ("done", "", None, 1, "defined"):
            with self.subTest(raw=raw), self.assertRaises(SourceStatusError):
                map_source_status(raw)

    def test_seed_line_passes_seed_check(self):
        station = {"code": "s1", "name": "站一", "sequence": 1, "metrics": [{"key": "k", "label": "K", "dataType": "number"}]}
        defined = source_line_to_seed("line_x", "X", "ok", [station])
        reserved = source_line_to_seed("line_y", "Y", "wip", [station])
        self.assertEqual(defined["stations"], [station])
        self.assertNotIn("stations", reserved)
        self.assertEqual(check_seed({"productLines": [defined, reserved]}), [])


if __name__ == "__main__":
    unittest.main()
