"""把設備點檢設定中願意開放上線後調整的項目登錄到參數設定中心（只有同時安裝時才載入本檔）。"""

from dataclasses import replace

from app.core.param_defs import ParamDef
from app.core.runtime_params import register_param

from app.core import equipment_settings as cfg

KIT = "equipment-maintenance-kit"


def _system(value, default):
    return None if value == default else value


def register() -> None:
    cur, base = cfg.get_settings(), cfg.EquipmentSettings()
    register_param(ParamDef("equipment.require_review", KIT, "點檢須複核才算完成", "bool", base.require_review, category="perm",
                            risk="medium", system=_system(cur.require_review, base.require_review), description="開啟時，點檢送出後要有人複核，生產閘門才放行。", impact="生產閘門"),
                   apply=lambda v: cfg.configure(replace(cfg.get_settings(), require_review=v)))
    register_param(ParamDef("equipment.block_on_abnormal", KIT, "異常點檢複核前擋生產", "bool", base.block_on_abnormal, category="alarm",
                            risk="medium", system=_system(cur.block_on_abnormal, base.block_on_abnormal), description="有異常項目的點檢，複核前不放行生產。", impact="生產閘門"),
                   apply=lambda v: cfg.configure(replace(cfg.get_settings(), block_on_abnormal=v)))
    register_param(ParamDef("equipment.reviewer_must_differ", KIT, "複核者不可是點檢者", "bool", base.reviewer_must_differ, category="perm",
                            risk="high", edit_roles=("admin",), system=_system(cur.reviewer_must_differ, base.reviewer_must_differ),
                            description="關閉後，同一人可以點檢並自己複核。", impact="點檢複核的權責分離"),
                   apply=lambda v: cfg.configure(replace(cfg.get_settings(), reviewer_must_differ=v)))
