"""登錄到參數設定中心的行為測試（需要同時載入 runtime-settings-kit，沒有時略過）。

執行：
  PYTHONPATH=kits/production-dashboard-kit/src/backend:kits/runtime-settings-kit/src/backend python -m unittest discover -s kits/production-dashboard-kit/tests
"""

import unittest
from importlib.util import find_spec
from unittest.mock import patch

HAVE = find_spec("app.core.runtime_params") is not None


@unittest.skipUnless(HAVE, "未載入參數設定中心")
class RuntimeParamsTest(unittest.TestCase):
    def setUp(self):
        from app.core.registry import ParamRegistry
        from app.core import dashboard_settings as cfg
        self.cfg, self.reg = cfg, ParamRegistry()
        self.before = cfg.get_settings()

    def tearDown(self):
        self.cfg.configure(self.before)

    def register(self):
        from app.core import dashboard_params
        with patch("app.core.runtime_params.registry", self.reg):
            dashboard_params.register()

    def test_registers_the_expected_keys_with_valid_definitions(self):
        self.register()
        self.assertEqual([d.key for d in self.reg.all()], sorted(["dashboard.activity_retention_days", "dashboard.list_limit"]))

    def test_a_runtime_change_reaches_the_kit_settings(self):
        from decimal import Decimal
        self.register()
        self.reg.notify("dashboard.activity_retention_days", Decimal("90"), "runtime")
        self.reg.notify("dashboard.list_limit", Decimal("25"), "runtime")
        s = self.cfg.get_settings()
        self.assertEqual((s.activity_retention_days, s.list_limit), (90, 25))
        self.assertIsInstance(s.list_limit, int)

    def test_system_value_is_reported_when_it_differs_from_the_default(self):
        self.cfg.configure(self.cfg.DashboardSettings(list_limit=20))
        self.register()
        d = self.reg.get("dashboard.list_limit")
        self.assertEqual(d.system, __import__("decimal").Decimal(20))


if __name__ == "__main__":
    unittest.main()
