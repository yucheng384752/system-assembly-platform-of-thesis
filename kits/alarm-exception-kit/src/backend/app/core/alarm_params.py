"""把報警設定中願意開放上線後調整的項目登錄到參數設定中心（只有同時安裝時才載入本檔）。"""

from dataclasses import replace

from app.core.param_defs import ParamDef
from app.core.runtime_params import register_param

from app.core import alarm_settings as cfg

KIT = "alarm-exception-kit"


def _system(value, default):
    return None if value == default else value  # 與預設相同就不標成「系統設定」


def register() -> None:
    cur, base = cfg.get_settings(), cfg.AlarmSettings()
    register_param(ParamDef("alarm.severity", KIT, "報警嚴重度", "choice", base.severity, category="alarm", choices=("warning", "critical"),
                            risk="medium", system=_system(cur.severity, base.severity), description="新產生的報警標示的嚴重度。", impact="之後新產生的報警"),
                   apply=lambda v: cfg.configure(replace(cfg.get_settings(), severity=v)))
    register_param(ParamDef("alarm.block_completion", KIT, "未解除報警時擋結案", "bool", base.block_completion, category="alarm",
                            risk="medium", system=_system(cur.block_completion, base.block_completion), description="開啟時，批次尚有未解除報警就不能完成工單。", impact="完成工單"),
                   apply=lambda v: cfg.configure(replace(cfg.get_settings(), block_completion=v)))
    register_param(ParamDef("alarm.spec_range_enabled", KIT, "啟用規格範圍報警", "bool", base.spec_range_enabled, category="alarm",
                            risk="high", edit_roles=("admin",), system=_system(cur.spec_range_enabled, base.spec_range_enabled),
                            description="關閉後，量測超出規格範圍不再自動報警（門檻與一致性規則不受影響）。", impact="所有量測的規格範圍判斷"),
                   apply=lambda v: cfg.configure(replace(cfg.get_settings(), spec_range_enabled=v)))
