"""登錄到參數設定中心的行為測試（需要同時載入 runtime-settings-kit，沒有時略過）。

執行：
  PYTHONPATH=kits/alarm-exception-kit/src/backend:kits/runtime-settings-kit/src/backend python -m unittest discover -s kits/alarm-exception-kit/tests
"""

import unittest
from importlib.util import find_spec
from unittest.mock import patch

HAVE = find_spec("app.core.runtime_params") is not None


@unittest.skipUnless(HAVE, "未載入參數設定中心")
class RuntimeParamsTest(unittest.TestCase):
    def setUp(self):
        from app.core.registry import ParamRegistry
        from app.core import alarm_settings as cfg
        self.cfg, self.reg = cfg, ParamRegistry()
        self.before = cfg.get_settings()

    def tearDown(self):
        self.cfg.configure(self.before)

    def register(self):
        from app.core import alarm_params
        with patch("app.core.runtime_params.registry", self.reg):
            alarm_params.register()

    def test_registers_the_expected_keys_with_valid_definitions(self):
        self.register()
        self.assertEqual([d.key for d in self.reg.all()], sorted(["alarm.block_completion", "alarm.severity", "alarm.spec_range_enabled"]))

    def test_a_runtime_change_reaches_the_kit_settings(self):
        self.register()
        self.reg.notify("alarm.severity", "critical", "runtime")
        self.reg.notify("alarm.block_completion", False, "runtime")
        self.reg.notify("alarm.spec_range_enabled", False, "site")
        s = self.cfg.get_settings()
        self.assertEqual((s.severity, s.block_completion, s.spec_range_enabled), ("critical", False, False))

    def test_system_value_is_reported_when_it_differs_from_the_default(self):
        self.cfg.configure(self.cfg.AlarmSettings(severity="critical"))
        self.register()
        d = self.reg.get("alarm.severity")
        self.assertEqual(d.system, "critical")


if __name__ == "__main__":
    unittest.main()
