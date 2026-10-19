"""把儀表板設定中願意開放上線後調整的項目登錄到參數設定中心（只有同時安裝時才載入本檔）。"""

from decimal import Decimal

from dataclasses import replace

from app.core.param_defs import ParamDef
from app.core.runtime_params import register_param

from app.core import dashboard_settings as cfg

KIT = "production-dashboard-kit"


def _system(value, default):
    return None if value == default else Decimal(value)


def register() -> None:
    cur, base = cfg.get_settings(), cfg.DashboardSettings()
    register_param(ParamDef("dashboard.activity_retention_days", KIT, "操作紀錄保留天數", "num", Decimal(base.activity_retention_days), category="other",
                            unit="天", min=Decimal(0), max=Decimal(3650), integer=True, risk="medium", system=_system(cur.activity_retention_days, base.activity_retention_days),
                            description="超過天數的操作紀錄可被清除；0 為永久保留。", impact="操作紀錄清除"),
                   apply=lambda v: cfg.configure(replace(cfg.get_settings(), activity_retention_days=int(v))))
    register_param(ParamDef("dashboard.list_limit", KIT, "清單預設筆數", "num", Decimal(base.list_limit), category="table",
                            unit="筆", min=Decimal(1), max=Decimal(200), integer=True, risk="low", edit_roles=("qc", "manager", "admin"),
                            system=_system(cur.list_limit, base.list_limit), description="操作紀錄與製程查詢一次顯示的筆數。", impact="儀表板清單"),
                   apply=lambda v: cfg.configure(replace(cfg.get_settings(), list_limit=int(v))))
