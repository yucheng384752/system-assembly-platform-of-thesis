"""應用程式啟動時呼叫一次，請放在所有其他 Kit 的啟動函式之後：

    from app.core.startup import enable_runtime_settings_kit
    enable_runtime_settings_kit(raw_settings_dict)        # 套用設定、驗證場域鎖定
    ...資料表建立後...
    from app.core.settings_service import apply_all
    apply_all(db)                                          # 把有效值同步到各 Kit

場域鎖定若指到沒有登錄的參數會直接報錯：打錯字會讓安全限制默默失效，不如啟動就失敗。
"""

from app.core.layers import validate_site_lock
from app.core.registry import registry
from app.core.runtime_config import RuntimeConfig, RuntimeConfigError, configure, load_runtime_config


def enable_runtime_settings_kit(raw: dict | None = None) -> RuntimeConfig:
    config = load_runtime_config(raw or {})
    for key, lock in config.site_locks.items():
        defn = registry.get(key)
        if defn is None:
            raise RuntimeConfigError(f"場域鎖定指到未登錄的參數：{key}")
        if defn.kind != "value":
            raise RuntimeConfigError(f"{key}：這類參數不能設定場域鎖定")
        validate_site_lock(defn, lock)
    configure(config)
    return config
