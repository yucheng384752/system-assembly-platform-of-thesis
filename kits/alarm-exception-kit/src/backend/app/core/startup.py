"""應用程式啟動時呼叫一次：套用設定、訂閱量測事件、註冊批次閘門。

    from app.core.startup import enable_alarm_kit
    enable_alarm_kit(raw_settings_dict)   # raw 可為空 {}，只啟用規格範圍

不呼叫就等於沒選這個 Kit：批次生產照常運作，沒有報警、沒有異常簽核。
"""

from importlib.util import find_spec

from app.core import alarm_service, exception_service
from app.core.alarm_settings import AlarmSettings, configure, load_alarm_settings


def enable_alarm_kit(raw: dict | None = None) -> AlarmSettings:
    settings = load_alarm_settings(raw or {})
    configure(settings)
    alarm_service.register()
    if settings.gating is not None:
        exception_service.register()
    if find_spec("app.core.dashboard_providers") is not None:
        from app.core import dashboard_provider
        dashboard_provider.register()
    return settings
