"""登錄到參數設定中心的行為測試（需要同時載入 runtime-settings-kit，沒有時略過）。

執行：
  PYTHONPATH=kits/equipment-maintenance-kit/src/backend:kits/runtime-settings-kit/src/backend python -m unittest discover -s kits/equipment-maintenance-kit/tests
"""

import unittest
from importlib.util import find_spec
from unittest.mock import patch

HAVE = find_spec("app.core.runtime_params") is not None


@unittest.skipUnless(HAVE, "未載入參數設定中心")
class RuntimeParamsTest(unittest.TestCase):
    def setUp(self):
        from app.core.registry import ParamRegistry
        from app.core import equipment_settings as cfg
        self.cfg, self.reg = cfg, ParamRegistry()
        self.before = cfg.get_settings()

    def tearDown(self):
        self.cfg.configure(self.before)

    def register(self):
        from app.core import equipment_params
        with patch("app.core.runtime_params.registry", self.reg):
            equipment_params.register()

    def test_registers_the_expected_keys_with_valid_definitions(self):
        self.register()
        self.assertEqual([d.key for d in self.reg.all()], sorted(["equipment.block_on_abnormal", "equipment.require_review", "equipment.reviewer_must_differ"]))

    def test_a_runtime_change_reaches_the_kit_settings(self):
        self.register()
        self.reg.notify("equipment.require_review", True, "runtime")
        self.reg.notify("equipment.reviewer_must_differ", False, "runtime")
        s = self.cfg.get_settings()
        self.assertEqual((s.require_review, s.reviewer_must_differ), (True, False))

    def test_system_value_is_reported_when_it_differs_from_the_default(self):
        self.cfg.configure(self.cfg.EquipmentSettings(require_review=True))
        self.register()
        d = self.reg.get("equipment.require_review")
        self.assertEqual(d.system, True)


if __name__ == "__main__":
    unittest.main()
