"""報警規則、對帳、異常簽核狀態與設定的行為測試。

執行（不需第三方套件）：
  PYTHONPATH=kits/alarm-exception-kit/src/backend python -m unittest discover -s kits/alarm-exception-kit/tests
"""

import unittest
from decimal import Decimal as D

from app.core.alarm_settings import load_alarm_settings
from app.core.exception_gate import (DecisionError, blocks_write, is_blocked, validate_decision, validate_gating_value)
from app.core.reconcile import ActiveAlarm, reconcile
from app.core.rules import (INCOMPLETE, OK, VIOLATED, ConsistencyRule, Outcome, RuleConfigError, ThresholdRule,
                            evaluate_spec_range)


class SpecRangeTest(unittest.TestCase):
    def test_boundaries_are_in_spec(self):
        self.assertEqual(evaluate_spec_range("A", None, D("5"), D("5"), D("10")).state, OK)
        self.assertEqual(evaluate_spec_range("A", None, D("10"), D("5"), D("10")).state, OK)

    def test_out_of_range_message_names_value_and_bounds(self):
        out = evaluate_spec_range("重量", "kg", D("11.50"), D("5"), D("10"))
        self.assertEqual((out.state, out.message), (VIOLATED, "重量 11.5kg 超出規格 5~10kg"))

    def test_open_ended_bounds_and_missing_data_do_not_judge(self):
        self.assertEqual(evaluate_spec_range("A", None, D("1"), None, D("10")).state, OK)
        self.assertEqual(evaluate_spec_range("A", None, D("99"), D("1"), None).state, OK)
        self.assertEqual(evaluate_spec_range("A", None, None, D("1"), D("2")).state, OK)
        self.assertEqual(evaluate_spec_range("A", None, D("99"), None, None).state, OK)


class ThresholdTest(unittest.TestCase):
    def test_strict_less_than_rejects_the_limit_itself(self):
        rule = ThresholdRule("bulk", "bulk", "lt", D("0.5"))
        self.assertEqual(rule.evaluate("散裝", "kg", D("0.49")).state, OK)
        out = rule.evaluate("散裝", "kg", D("0.5"))
        self.assertEqual((out.state, out.message), (VIOLATED, "散裝 0.5kg 超出規格 需小於0.5kg"))

    def test_other_operators_and_matching(self):
        self.assertEqual(ThresholdRule("r", "m", "le", D("1")).evaluate("M", None, D("1")).state, OK)
        self.assertEqual(ThresholdRule("r", "m", "ge", D("1")).evaluate("M", None, D("0.9")).state, VIOLATED)
        rule = ThresholdRule("r", "m", "gt", D("1"), station_code="s1")
        self.assertTrue(rule.matches("s1", "m"))
        self.assertFalse(rule.matches("s2", "m"))
        with self.assertRaises(RuleConfigError):
            ThresholdRule("r", "m", "eq", D("1"))


class ConsistencyTest(unittest.TestCase):
    RULE = ConsistencyRule("qty", ("a", "b", "c"), "done", D("2"), labels={"a": "甲", "b": "乙", "c": "丙", "done": "成品"})

    def test_consistent_values_pass(self):
        self.assertEqual(self.RULE.evaluate({"a": D("12"), "b": D("12"), "c": D("12"), "done": D("10")}).state, OK)

    def test_any_mismatch_is_a_violation_with_all_values_shown(self):
        out = self.RULE.evaluate({"a": D("12"), "b": D("11"), "c": D("12"), "done": D("10")})
        self.assertEqual(out.state, VIOLATED)
        self.assertEqual(out.message, "甲／乙／丙需一致且等於成品+2（甲12／乙11／丙12／成品10）")

    def test_incomplete_data_makes_no_judgement(self):
        self.assertEqual(self.RULE.evaluate({"a": D("12"), "b": None, "c": D("12"), "done": D("10")}).state, INCOMPLETE)

    def test_matches_any_involved_metric(self):
        self.assertTrue(self.RULE.matches("x", "done"))
        self.assertFalse(self.RULE.matches("x", "other"))


class ReconcileTest(unittest.TestCase):
    A1, A2 = ActiveAlarm(1, 10, "r", "舊訊息"), ActiveAlarm(2, 11, "r", "另一個")

    def test_ok_resolves_every_active_alarm(self):
        self.assertEqual(reconcile(Outcome(OK), [self.A1, self.A2], scope="group").resolve, (1, 2))

    def test_violation_without_alarm_creates_one(self):
        self.assertEqual(reconcile(Outcome(VIOLATED, "新"), [], scope="measurement").create, "新")

    def test_violation_with_same_message_changes_nothing_but_keeps_the_alarm(self):
        a = reconcile(Outcome(VIOLATED, "舊訊息"), [self.A1], scope="measurement")
        self.assertEqual((a.create, a.update, a.resolve, a.active_id), (None, (), (), 1))

    def test_violation_with_new_value_refreshes_the_message(self):
        self.assertEqual(reconcile(Outcome(VIOLATED, "新值"), [self.A1], scope="measurement").update, ((1, "新值"),))

    def test_group_scope_keeps_one_and_resolves_the_rest(self):
        a = reconcile(Outcome(VIOLATED, "新值"), [self.A1, self.A2], scope="group")
        self.assertEqual((a.update, a.resolve), (((1, "新值"),), (2,)))

    def test_incomplete_leaves_alarms_alone(self):
        a = reconcile(Outcome(INCOMPLETE), [self.A1], scope="group")
        self.assertEqual((a.create, a.update, a.resolve, a.active_id), (None, (), (), 1))


class ExceptionGateTest(unittest.TestCase):
    def test_release_requires_verification(self):
        validate_decision("release_approved", True)
        with self.assertRaises(DecisionError):
            validate_decision("release_approved", False)
        with self.assertRaises(DecisionError):
            validate_decision("pending", False)

    def test_blocked_state_table(self):
        lo, hi = D("1"), D("5")
        self.assertFalse(is_blocked("release_approved", D("9"), lo, hi, True))
        self.assertTrue(is_blocked("pending", D("3"), lo, hi, True))
        self.assertTrue(is_blocked("rejected", D("3"), lo, hi, True))
        self.assertTrue(is_blocked("rework_approved", None, lo, hi, False))
        self.assertFalse(is_blocked("rework_approved", D("3"), lo, hi, True))
        self.assertTrue(is_blocked("rework_approved", D("9"), lo, hi, True))
        self.assertFalse(is_blocked(None, None, lo, hi, False))
        self.assertTrue(is_blocked(None, D("9"), lo, hi, True))
        self.assertTrue(is_blocked(None, D("3"), None, None, True))

    def test_write_blocking_reasons(self):
        kw = dict(is_gating_station=False, is_later_station=False, latest_status=None, batch_blocked=False, batch_completed=False)
        self.assertIsNone(blocks_write(**kw))
        self.assertIn("後續站點", blocks_write(**{**kw, "is_later_station": True, "batch_blocked": True}))
        self.assertIsNone(blocks_write(**{**kw, "is_later_station": True}))
        self.assertIn("核准重工", blocks_write(**{**kw, "is_gating_station": True, "latest_status": "pending"}))
        self.assertIsNone(blocks_write(**{**kw, "is_gating_station": True, "latest_status": "rework_approved"}))
        self.assertIn("已完成", blocks_write(**{**kw, "is_gating_station": True, "batch_completed": True}))

    def test_gating_value_must_be_a_finite_number_with_a_spec(self):
        self.assertIsNone(validate_gating_value(D("3"), D("1"), D("5")))
        self.assertIsNotNone(validate_gating_value(None, D("1"), D("5")))
        self.assertIsNotNone(validate_gating_value(D("3"), None, None))


class SettingsTest(unittest.TestCase):
    def test_defaults_only_use_spec_range(self):
        s = load_alarm_settings({})
        self.assertTrue(s.spec_range_enabled)
        self.assertEqual((s.threshold_rules, s.consistency_rules, s.gating), ((), (), None))

    def test_full_example(self):
        s = load_alarm_settings({
            "thresholdRules": [{"key": "bulk", "metricKey": "bulk", "op": "lt", "limit": 0.5}],
            "consistencyRules": [{"key": "qty", "keys": ["a", "b"], "expectKey": "done", "offset": 2}],
            "gating": {"stationCode": "qc1", "metricKey": "first", "verificationLabel": "物性加驗"}, "severity": "critical"})
        self.assertEqual(s.gating.verification_label, "物性加驗")
        self.assertTrue(s.covered_by_dedicated_rule("any", "bulk"))
        self.assertTrue(s.covered_by_dedicated_rule("any", "done"))
        self.assertFalse(s.covered_by_dedicated_rule("any", "other"))

    def test_block_completion_defaults_on_and_can_be_turned_off(self):
        self.assertTrue(load_alarm_settings({}).block_completion)
        self.assertFalse(load_alarm_settings({"blockCompletion": False}).block_completion)

    def test_bad_configuration_is_rejected(self):
        for raw in ({"nope": 1}, {"severity": "fatal"},
                    {"thresholdRules": [{"key": "spec_range", "metricKey": "m", "op": "lt", "limit": 1}]},
                    {"thresholdRules": [{"key": "r", "metricKey": "m", "op": "lt", "limit": 1}, {"key": "r", "metricKey": "n", "op": "lt", "limit": 1}]}):
            with self.subTest(raw=raw), self.assertRaises(RuleConfigError):
                load_alarm_settings(raw)


if __name__ == "__main__":
    unittest.main()
