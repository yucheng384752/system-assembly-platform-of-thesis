"""應用程式啟動時呼叫一次：套用設定並訂閱批次異動事件。

    from app.core.dashboard_startup import enable_dashboard_kit
    enable_dashboard_kit(raw_settings_dict)   # 可為空 {}

報警、設備等 Kit 想出現在總覽，要在自己的啟動函式裡呼叫 dashboard_providers.register(...)；
請在本函式之後啟動它們，或讓它們偵測 app.core.dashboard_providers 是否存在。
"""

from importlib.util import find_spec

from app.core import activity_service
from app.core.dashboard_settings import DashboardSettings, configure, load_dashboard_settings


def enable_dashboard_kit(raw: dict | None = None) -> DashboardSettings:
    settings = load_dashboard_settings(raw or {})
    configure(settings)
    activity_service.register()
    if find_spec("app.core.runtime_params") is not None:
        from app.core import dashboard_params
        dashboard_params.register()
    return settings
