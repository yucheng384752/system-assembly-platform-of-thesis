"""把批次設定中願意開放上線後調整的項目登錄到參數設定中心。

批次 Kit 沒有自己的啟動函式：平台在 `configure(load_batch_settings(raw))` 之後，
若有安裝參數設定中心就呼叫一次 `register()`。
"""

from dataclasses import replace

from app.core.param_defs import ParamDef
from app.core.runtime_params import register_param

from app.core import batch_settings as cfg

KIT = "batch-production-kit"


def register() -> None:
    cur, base = cfg.get_settings(), cfg.BatchSettings()
    register_param(ParamDef("batch.require_assignment", KIT, "開單必須指派負責人", "bool", base.require_assignment, category="prefill",
                            risk="medium", system=None if cur.require_assignment == base.require_assignment else cur.require_assignment,
                            description="開啟時，開單必須指派兩位操作員與一位品管。", impact="之後開立的批次"),
                   apply=lambda v: cfg.configure(replace(cfg.get_settings(), require_assignment=v)))
