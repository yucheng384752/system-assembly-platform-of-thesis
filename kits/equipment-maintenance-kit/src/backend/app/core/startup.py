"""應用程式啟動時呼叫一次：套用設定，並在有安裝批次生產 Kit 時註冊生產閘門。

    from app.core.startup import enable_equipment_kit
    enable_equipment_kit(raw_settings_dict)   # 可為空 {}

沒有批次生產 Kit 時，本 Kit 仍可單獨使用（設備、點檢、維修、匯出），只是沒有閘門。
"""

from importlib.util import find_spec

from app.core.equipment_settings import EquipmentSettings, configure, load_equipment_settings


def enable_equipment_kit(raw: dict | None = None) -> EquipmentSettings:
    settings = load_equipment_settings(raw or {})
    configure(settings)
    if find_spec("app.core.gates") is not None:
        from app.core import batch_gate
        batch_gate.register()
    return settings
