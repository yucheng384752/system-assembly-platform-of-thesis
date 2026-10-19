"""參數定義、有效值四層、權限與風險、登錄與設定的行為測試。

執行（不需第三方套件）：
  PYTHONPATH=kits/runtime-settings-kit/src/backend python -m unittest discover -s kits/runtime-settings-kit/tests
"""

import unittest
from decimal import Decimal as D

from app.core.layers import DEFAULT, RUNTIME, SITE, SYSTEM, SiteLock, bounds, resolve, validate_site_lock
from app.core.param_defs import ParamDef, ParamError, check_value, to_storage
from app.core.policy import PolicyError, can_edit, check_reason, check_version
from app.core.registry import ParamRegistry
from app.core.runtime_config import RuntimeConfigError, load_runtime_config


def num(**kw):
    base = dict(key="demo.limit", kit_id="demo", label="上限", type="num", default=D("10"), unit="kg", min=D("1"), max=D("20"))
    return ParamDef(**{**base, **kw})


class CheckValueTest(unittest.TestCase):
    def test_number_range_is_inclusive(self):
        d = num()
        self.assertEqual(check_value(d, 1), D("1"))
        self.assertEqual(check_value(d, "20"), D("20"))
        for bad in (0.99, 20.01, "abc", True, float("nan"), float("inf")):
            with self.subTest(bad=bad), self.assertRaises(ParamError):
                check_value(d, bad)

    def test_site_bounds_narrow_but_never_widen(self):
        d = num()
        self.assertEqual(check_value(d, 5, D("3"), D("8")), D("5"))
        with self.assertRaisesRegex(ParamError, "3kg – 8kg"):
            check_value(d, 9, D("3"), D("8"))
        with self.assertRaises(ParamError):
            check_value(d, 25, D("0"), D("100"))  # 場域放寬也不能超過定義本身的範圍

    def test_integer_flag(self):
        d = num(integer=True, default=D("5"))
        check_value(d, 3)
        with self.assertRaisesRegex(ParamError, "整數"):
            check_value(d, 3.5)

    def test_bool_is_strict(self):
        d = ParamDef("demo.flag", "demo", "旗標", "bool", True)
        self.assertIs(check_value(d, False), False)
        for bad in (1, "true", None):
            with self.subTest(bad=bad), self.assertRaises(ParamError):
                check_value(d, bad)

    def test_choice_and_text(self):
        c = ParamDef("demo.mode", "demo", "模式", "choice", "a", choices=("a", "b"))
        self.assertEqual(check_value(c, "b"), "b")
        with self.assertRaises(ParamError):
            check_value(c, "c")
        t = ParamDef("demo.name", "demo", "名稱", "text", "批號")
        self.assertEqual(check_value(t, "  新名稱 "), "新名稱")
        for bad in ("", "  ", "x" * 201, "a\x00b", 5):
            with self.subTest(bad=bad), self.assertRaises(ParamError):
                check_value(t, bad)

    def test_storage_keeps_decimal_precision(self):
        self.assertEqual(to_storage(D("0.10")), "0.10")
        self.assertIs(to_storage(True), True)


class DefinitionTest(unittest.TestCase):
    def test_key_format(self):
        for bad in ("nodots", "Demo.limit", "demo.Limit", "demo..x", "1demo.x"):
            with self.subTest(key=bad), self.assertRaises(ParamError):
                ParamDef(bad, "demo", "x", "bool", True)

    def test_default_must_be_valid(self):
        with self.assertRaises(ParamError):
            num(default=D("99"))
        with self.assertRaises(ParamError):
            num(system=D("99"))

    def test_role_rules(self):
        with self.assertRaises(ParamError):
            num(edit_roles=("operator",))
        with self.assertRaises(ParamError):
            num(edit_roles=("audit",))
        with self.assertRaises(ParamError):
            num(risk="medium", edit_roles=("qc",))
        with self.assertRaises(ParamError):
            num(risk="high", edit_roles=("manager", "admin"))
        num(risk="low", edit_roles=("qc", "manager", "admin"))
        num(risk="high", edit_roles=("admin",))

    def test_non_value_kinds_cannot_be_runtime_editable(self):
        with self.assertRaises(ParamError):
            ParamDef("demo.col", "demo", "欄位型別", "text", "decimal", kind="migration")
        ParamDef("demo.col", "demo", "欄位型別", "text", "decimal", kind="migration", runtime_editable=False)

    def test_choice_needs_choices_and_min_le_max(self):
        with self.assertRaises(ParamError):
            ParamDef("demo.mode", "demo", "模式", "choice", "a")
        with self.assertRaises(ParamError):
            num(min=D("5"), max=D("1"))


class LayerTest(unittest.TestCase):
    def test_priority_order(self):
        d = num(system=D("8"))
        self.assertEqual(resolve(d, None, None), (D("8"), SYSTEM))
        self.assertEqual(resolve(num(), None, None), (D("10"), DEFAULT))
        self.assertEqual(resolve(d, D("12"), None), (D("12"), RUNTIME))
        self.assertEqual(resolve(d, D("12"), SiteLock(fixed=D("15"))), (D("15"), SITE))

    def test_invalid_lower_layer_falls_through(self):
        d = num(system=D("8"))
        lock = SiteLock(min=D("9"), max=D("14"))
        # 上線後調整 12 在範圍內；組裝期 8 低於場域下限，被略過
        self.assertEqual(resolve(d, D("12"), lock), (D("12"), RUNTIME))
        self.assertEqual(resolve(d, None, lock), (D("10"), DEFAULT))
        # 連預設都不在場域範圍內時，仍以預設為最後防線（不丟錯、不中斷運作）
        self.assertEqual(resolve(num(), None, SiteLock(min=D("15"), max=D("18"))), (D("10"), DEFAULT))

    def test_bounds_is_the_intersection(self):
        d = num()
        self.assertEqual(bounds(d, None), (D("1"), D("20")))
        self.assertEqual(bounds(d, SiteLock(min=D("5"), max=D("30"))), (D("5"), D("20")))

    def test_site_lock_validation(self):
        d = num()
        validate_site_lock(d, SiteLock(fixed=D("5")))
        for bad in (SiteLock(fixed=D("99")), SiteLock(min=D("9"), max=D("2"))):
            with self.subTest(lock=bad), self.assertRaises(ParamError):
                validate_site_lock(d, bad)
        with self.assertRaises(ParamError):
            validate_site_lock(ParamDef("demo.flag", "demo", "旗標", "bool", True), SiteLock(min=D("1")))


class PolicyTest(unittest.TestCase):
    def test_can_edit(self):
        d = num()
        self.assertEqual(can_edit(d, "manager", None), (True, ""))
        self.assertFalse(can_edit(d, "qc", None)[0])
        self.assertFalse(can_edit(d, "operator", None)[0])
        self.assertIn("場域鎖定", can_edit(d, "admin", SiteLock(fixed=D("5")))[1])
        self.assertTrue(can_edit(d, "admin", SiteLock(min=D("2")))[0])
        self.assertIn("組裝時", can_edit(num(runtime_editable=False), "admin", None)[1])
        mig = ParamDef("demo.col", "demo", "型別", "text", "x", kind="migration", runtime_editable=False)
        self.assertIn("遷移", can_edit(mig, "admin", None)[1])

    def test_reason_requirement_by_risk(self):
        low, med, high = num(), num(risk="medium"), num(risk="high", edit_roles=("admin",))
        self.assertIsNone(check_reason(low, None, "medium"))
        with self.assertRaises(PolicyError):
            check_reason(med, " ", "medium")
        self.assertEqual(check_reason(high, " 調整 ", "medium"), "調整")
        self.assertIsNone(check_reason(med, None, "high"))
        with self.assertRaises(PolicyError):
            check_reason(low, None, "all")
        self.assertIsNone(check_reason(high, None, "never"))
        with self.assertRaises(PolicyError):
            check_reason(low, "x" * 501, "never")
        with self.assertRaises(PolicyError):
            check_reason(low, None, "sometimes")

    def test_version_check(self):
        check_version(3, None)
        check_version(3, 3)
        with self.assertRaisesRegex(PolicyError, "重新載入"):
            check_version(3, 2)


class RegistryTest(unittest.TestCase):
    def test_register_get_and_duplicate(self):
        reg = ParamRegistry()
        reg.register(num())
        self.assertEqual(reg.get("demo.limit").label, "上限")
        with self.assertRaises(ValueError):
            reg.register(num())

    def test_listeners_receive_changes_and_unknown_keys_are_rejected(self):
        reg, seen = ParamRegistry(), []
        reg.register(num())
        fn = lambda k, v, s: seen.append((k, v, s))
        reg.subscribe("demo.limit", fn)
        reg.notify("demo.limit", D("7"), RUNTIME)
        reg.notify("other.key", 1, RUNTIME)
        self.assertEqual(seen, [("demo.limit", D("7"), RUNTIME)])
        with self.assertRaises(KeyError):
            reg.subscribe("ghost.key", fn)
        with self.assertRaises(ValueError):
            reg.subscribe("demo.limit", fn)

    def test_all_is_sorted_by_category_kit_key(self):
        reg = ParamRegistry()
        reg.register(ParamDef("b.x", "b", "x", "bool", True, category="table"))
        reg.register(ParamDef("a.y", "a", "y", "bool", True, category="alarm"))
        reg.register(ParamDef("a.x", "a", "x", "bool", True, category="alarm"))
        self.assertEqual([d.key for d in reg.all()], ["a.x", "a.y", "b.x"])


class ConfigTest(unittest.TestCase):
    def test_defaults(self):
        c = load_runtime_config({})
        self.assertEqual((c.site_locks, c.require_reason_from), ({}, "medium"))

    def test_locks(self):
        c = load_runtime_config({"siteLocks": {"demo.limit": {"min": 2, "max": 9}, "demo.flag": {"fixed": True}}})
        self.assertEqual(c.site_locks["demo.limit"], SiteLock(None, D("2"), D("9")))
        self.assertEqual(c.site_locks["demo.flag"].fixed, True)

    def test_bad_config(self):
        for raw in ({"x": 1}, {"requireReasonFrom": "sometimes"}, {"siteLocks": {"a.b": {}}},
                    {"siteLocks": {"a.b": {"fixed": 1, "min": 0}}}, {"siteLocks": {"a.b": {"min": "x"}}},
                    {"siteLocks": {"a.b": {"other": 1}}}):
            with self.subTest(raw=raw), self.assertRaises(RuntimeConfigError):
                load_runtime_config(raw)


if __name__ == "__main__":
    unittest.main()
