"""登錄到參數設定中心的行為測試（需要同時載入 runtime-settings-kit，沒有時略過）。

執行：
  PYTHONPATH=kits/batch-production-kit/src/backend:kits/runtime-settings-kit/src/backend python -m unittest discover -s kits/batch-production-kit/tests
"""

import unittest
from importlib.util import find_spec
from unittest.mock import patch

HAVE = find_spec("app.core.runtime_params") is not None


@unittest.skipUnless(HAVE, "未載入參數設定中心")
class RuntimeParamsTest(unittest.TestCase):
    def setUp(self):
        from app.core.registry import ParamRegistry
        from app.core import batch_settings as cfg
        self.cfg, self.reg = cfg, ParamRegistry()
        self.before = cfg.get_settings()

    def tearDown(self):
        self.cfg.configure(self.before)

    def register(self):
        from app.core import batch_params
        with patch("app.core.runtime_params.registry", self.reg):
            batch_params.register()

    def test_registers_the_expected_keys_with_valid_definitions(self):
        self.register()
        self.assertEqual([d.key for d in self.reg.all()], sorted(["batch.require_assignment"]))

    def test_a_runtime_change_reaches_the_kit_settings(self):
        self.register()
        self.reg.notify("batch.require_assignment", False, "runtime")
        self.assertFalse(self.cfg.get_settings().require_assignment)

    def test_system_value_is_reported_when_it_differs_from_the_default(self):
        self.cfg.configure(self.cfg.BatchSettings(require_assignment=False))
        self.register()
        d = self.reg.get("batch.require_assignment")
        self.assertEqual(d.system, False)


if __name__ == "__main__":
    unittest.main()
