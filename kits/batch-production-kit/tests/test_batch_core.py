"""批次生產 Kit 的純邏輯測試：事件、閘門、批號、進度、完成條件、用料、指派、量測規則。

執行（不需第三方套件）：
  PYTHONPATH=kits/batch-production-kit/src/backend python -m unittest discover -s kits/batch-production-kit/tests
"""

import unittest
from datetime import date
from decimal import Decimal as D

from app.core.batch_settings import BatchSettingsError, load_batch_settings
from app.core.assignment import AssignmentError, validate_assignment
from app.core.completion import missing_before_completion
from app.core.events import BatchChanged, EventBus, MeasurementRecorded
from app.core.gates import BatchContext, GateBase, GateRegistry
from app.core.lot_number import LotNumberError, LotNumberFormat, counter_period, format_lot_no
from app.core.material_rules import MaterialRow, operator_may_write
from app.core.measurement_rules import MeasurementRuleError, check_filler_role, resolve_step
from app.core.progress import MetricSpec, StationSpec, StepSpec, first_incomplete_station


def _event():
    return MeasurementRecorded(1, 2, "line_a", "M1", "process", "k", "K", None, 0, D("1"), None, None, D("0"), D("2"), 9)


def _recorder(seen, tag=None):
    async def handler(db, e):
        seen.append(e if tag is None else (tag, db, e.metric_key))
    return handler


class EventBusTest(unittest.IsolatedAsyncioTestCase):
    async def test_no_subscriber_is_a_no_op(self):
        await EventBus().publish(object(), _event())

    async def test_handlers_receive_db_and_event_in_order(self):
        bus, seen = EventBus(), []
        bus.subscribe(MeasurementRecorded, _recorder(seen, "a"))
        bus.subscribe(MeasurementRecorded, _recorder(seen, "b"))
        await bus.publish("DB", _event())
        self.assertEqual(seen, [("a", "DB", "k"), ("b", "DB", "k")])

    async def test_handler_error_propagates_so_the_whole_request_rolls_back(self):
        bus = EventBus()
        async def boom(db, e): raise RuntimeError("alarm write failed")
        bus.subscribe(MeasurementRecorded, boom)
        with self.assertRaises(RuntimeError):
            await bus.publish(None, _event())

    async def test_events_only_reach_their_own_type_and_double_subscribe_is_rejected(self):
        bus, seen = EventBus(), []
        h = _recorder(seen)
        bus.subscribe(BatchChanged, h)
        await bus.publish(None, _event())
        self.assertEqual(seen, [])
        with self.assertRaises(ValueError):
            bus.subscribe(BatchChanged, h)


class _Gate(GateBase):
    def __init__(self, key, order, reason=None, blocked=(), completion=()):
        self.key, self.order, self._r, self._b, self._c = key, order, reason, set(blocked), list(completion)
    async def write_blocker(self, ctx, station_code): return self._r
    async def validate_value(self, ctx, station_code, metric_key, value_num, lo, hi): return self._v if hasattr(self, "_v") else None
    async def station_blocked(self, ctx, station_code): return station_code in self._b
    async def completion_blockers(self, ctx): return self._c


CTX = BatchContext(None, 1, "line_a", "M1", None, "in_progress")


class GateTest(unittest.IsolatedAsyncioTestCase):
    async def test_empty_registry_allows_everything(self):
        g = GateRegistry()
        self.assertIsNone(await g.write_blocker(CTX, "x"))
        self.assertFalse(await g.station_blocked(CTX, "x"))
        self.assertEqual(await g.completion_blockers(CTX), [])
        self.assertEqual(await GateBase().completion_blockers(CTX), [])

    async def test_lower_order_gate_speaks_first_so_the_specific_reason_wins(self):
        g = GateRegistry()
        g.register(_Gate("global", 100, "尚有設備未點檢"))
        g.register(_Gate("specific", 10, "第 3 台設備未點檢"))
        self.assertEqual(await g.write_blocker(CTX, "x"), "第 3 台設備未點檢")

    async def test_station_block_and_completion_reasons_accumulate(self):
        g = GateRegistry()
        g.register(_Gate("a", 1, blocked={"s2"}, completion=["尚有未結案報警"]))
        g.register(_Gate("b", 2, completion=["另一原因"]))
        self.assertTrue(await g.station_blocked(CTX, "s2"))
        self.assertFalse(await g.station_blocked(CTX, "s1"))
        self.assertEqual(await g.completion_blockers(CTX), ["尚有未結案報警", "另一原因"])

    async def test_value_validation_runs_through_the_same_ordered_gates(self):
        g = GateRegistry()
        late, early = _Gate("late", 50), _Gate("early", 5)
        late._v, early._v = "較晚的原因", "數值必須是有效數字"
        g.register(late)
        g.register(early)
        self.assertEqual(await g.validate_value(CTX, "s", "k", None, None, None), "數值必須是有效數字")
        self.assertIsNone(await GateRegistry().validate_value(CTX, "s", "k", None, None, None))

    async def test_duplicate_or_blank_key_is_rejected(self):
        g = GateRegistry()
        g.register(_Gate("a", 1))
        with self.assertRaises(ValueError):
            g.register(_Gate("a", 2))
        with self.assertRaises(ValueError):
            g.register(_Gate("", 2))


class LotNumberTest(unittest.TestCase):
    FMT = LotNumberFormat(pattern="P{variant}{region}{yy}{mm}{serial:03d}", region_code="01", variant_codes={"v1": "91", "v2": "92"})

    def test_format(self):
        self.assertEqual(format_lot_no(self.FMT, "v2", date(2026, 7, 3), 5), "P92012607005")

    def test_unknown_variant_gives_empty_code(self):
        self.assertEqual(format_lot_no(self.FMT, None, date(2026, 12, 31), 12), "P012612012")

    def test_pattern_must_contain_serial_and_only_known_fields(self):
        for bad in ("P{yy}{mm}", "{serial}{oops}"):
            with self.assertRaises(LotNumberError):
                LotNumberFormat(pattern=bad).validate()
        with self.assertRaises(LotNumberError):
            LotNumberFormat(serial_reset="weekly").validate()

    def test_serial_must_start_at_one(self):
        with self.assertRaises(LotNumberError):
            format_lot_no(self.FMT, "v1", date(2026, 1, 1), 0)

    def test_counter_period_only_changes_when_reset_is_configured(self):
        d1, d2 = date(2026, 1, 31), date(2026, 2, 1)
        never = LotNumberFormat()
        self.assertEqual(counter_period(never, d1), counter_period(never, d2))
        monthly = LotNumberFormat(serial_reset="monthly")
        self.assertNotEqual(counter_period(monthly, d1), counter_period(monthly, d2))


def _stations():
    return [
        StationSpec("load", "下料", 1),
        StationSpec("proc", "加工", 2, metrics=(MetricSpec("a", "station", True), MetricSpec("t", "step", True)),
                    steps=(StepSpec(1, "規格"), StepSpec(2, None), StepSpec(3, "規格"))),
        StationSpec("qc", "檢驗", 3, metrics=(MetricSpec("q", "station", True), MetricSpec("note", "station", False))),
    ]


class ProgressTest(unittest.TestCase):
    def run_(self, filled=None, **kw):
        return first_incomplete_station(_stations(), filled or {}, material_station_codes=frozenset({"load"}), **kw)

    def test_material_station_needs_any_actual_weight(self):
        self.assertEqual(self.run_(has_actual_weight=False), "下料")

    def test_step_granularity_skips_steps_without_spec(self):
        self.assertEqual(self.run_(has_actual_weight=True), "加工（步驟 1/3）")
        f = {"proc": frozenset({("t", 1)})}
        self.assertEqual(self.run_(f, has_actual_weight=True), "加工（步驟 3/3）")  # 第 2 步沒有規格文字，不要求

    def test_station_level_required_after_steps(self):
        f = {"proc": frozenset({("t", 1), ("t", 3)})}
        self.assertEqual(self.run_(f, has_actual_weight=True), "加工")

    def test_all_done_returns_none_and_optional_metrics_never_block(self):
        f = {"proc": frozenset({("t", 1), ("t", 3), ("a", 0)}), "qc": frozenset({("q", 0)})}
        self.assertIsNone(self.run_(f, has_actual_weight=True))

    def test_exclude_lets_signing_ignore_later_stations(self):
        self.assertEqual(self.run_(has_actual_weight=True, exclude=frozenset({"proc"})), "檢驗")
        f = {"proc": frozenset({("t", 1), ("t", 3), ("a", 0)})}
        self.assertIsNone(self.run_(f, has_actual_weight=True, exclude=frozenset({"qc"})))

    def test_external_gate_can_hold_a_station_open(self):
        f = {"proc": frozenset({("t", 1), ("t", 3), ("a", 0)}), "qc": frozenset({("q", 0)})}
        self.assertEqual(self.run_(f, has_actual_weight=True, blocked=lambda c: c == "proc"), "加工")


class CompletionTest(unittest.TestCase):
    def test_everything_missing_is_listed_in_order(self):
        out = missing_before_completion(operator_signed=False, inspector_signed=False, incomplete_station="加工",
                                        gate_blockers=["尚有未結案報警"], required_attachments={"p1": "照片一"},
                                        uploaded_attachment_keys=[], require_warehouse_entry=True)
        self.assertEqual(out, ["操作員簽名", "檢驗員簽名", "加工尚有必填欄位未填", "尚有未結案報警", "照片一未上傳", "入庫單未送出"])

    def test_nothing_required_by_default_and_all_satisfied(self):
        self.assertEqual(missing_before_completion(operator_signed=True, inspector_signed=True, incomplete_station=None,
                         gate_blockers=[], required_attachments={}, uploaded_attachment_keys=[]), [])
        self.assertEqual(missing_before_completion(operator_signed=True, inspector_signed=True, incomplete_station=None,
                         gate_blockers=[], required_attachments={"p": "P"}, uploaded_attachment_keys=["p"],
                         require_warehouse_entry=True, has_warehouse_entry=True), [])


class MaterialRulesTest(unittest.TestCase):
    OLD = [MaterialRow("main", "ITEM", "L1", "S", D("10.0")), MaterialRow("aux", None, None, None, D("2"))]

    def test_operator_may_change_only_actual_weight(self):
        new = [MaterialRow("main", "ITEM", "L1", "S", D("10"), D("9.9")), MaterialRow("aux", None, None, None, D("2"), D("2.1"))]
        self.assertTrue(operator_may_write(self.OLD, new))

    def test_changing_item_number_or_theoretical_weight_is_refused(self):
        self.assertFalse(operator_may_write(self.OLD, [MaterialRow("main", "OTHER", "L1", "S", D("10")), self.OLD[1]]))
        self.assertFalse(operator_may_write(self.OLD, [MaterialRow("main", "ITEM", "L1", "S", D("11")), self.OLD[1]]))

    def test_operator_cannot_drop_rows_but_can_add_a_blank_identity_row(self):
        self.assertFalse(operator_may_write(self.OLD, [self.OLD[0]]))
        self.assertFalse(operator_may_write(self.OLD, [self.OLD[1]]))  # 整個 kind 消失
        self.assertFalse(operator_may_write(self.OLD, self.OLD + [MaterialRow("main", "NEW", actual_kg=D("1"))]))
        self.assertTrue(operator_may_write(self.OLD, self.OLD + [MaterialRow("main", actual_kg=D("1"))]))
        self.assertTrue(operator_may_write([], [MaterialRow("main", actual_kg=D("1"))]))


class AssignmentTest(unittest.TestCase):
    def test_valid_and_invalid(self):
        roles = {1: "operator", 2: "operator", 3: "qc", 4: "manager"}
        validate_assignment(roles, 1, 2, 3)
        for args in ((1, 1, 3), (1, 4, 3), (1, 2, 4), (1, 9, 3)):
            with self.subTest(args=args), self.assertRaises(AssignmentError):
                validate_assignment(roles, *args)


class MeasurementRulesTest(unittest.TestCase):
    def test_step_scope_needs_a_step_of_the_same_station(self):
        self.assertEqual(resolve_step("station", "s", None, {}), 0)
        self.assertEqual(resolve_step("step", "s", 2, {2: "s"}), 2)
        for seq in (None, 0, 3):
            with self.subTest(seq=seq), self.assertRaises(MeasurementRuleError):
                resolve_step("step", "s", seq, {2: "s"})

    def test_manager_only_field_is_closed_to_operators(self):
        check_filler_role("operator", "operator")
        check_filler_role("manager", "manager")
        with self.assertRaises(MeasurementRuleError) as cm:
            check_filler_role("manager", "operator")
        self.assertEqual(cm.exception.status, 403)


class SettingsTest(unittest.TestCase):
    def test_defaults_are_neutral(self):
        s = load_batch_settings({})
        self.assertEqual(s.required_attachments, {})
        self.assertEqual(s.material_station_codes, frozenset())
        self.assertTrue(s.require_assignment)

    def test_full_example_loads_and_validates_the_lot_pattern(self):
        s = load_batch_settings({"lotFormat": {"pattern": "X{variant}{yy}{serial:04d}", "variantCodes": {"v": "9"}, "serialReset": "yearly"},
                                 "requiredAttachments": {"p1": "照片一"}, "materialStationCodes": ["load"], "headerPrefill": {"grade": "grade"}})
        self.assertEqual(format_lot_no(s.lot_format, "v", date(2026, 3, 1), 7), "X9260007")
        self.assertEqual(s.required_attachments, {"p1": "照片一"})
        self.assertEqual(s.header_prefill, {"grade": "grade"})

    def test_unknown_key_and_bad_pattern_are_rejected(self):
        with self.assertRaises(BatchSettingsError):
            load_batch_settings({"nope": 1})
        with self.assertRaises(LotNumberError):
            load_batch_settings({"lotFormat": {"pattern": "{yy}"}})


if __name__ == "__main__":
    unittest.main()
