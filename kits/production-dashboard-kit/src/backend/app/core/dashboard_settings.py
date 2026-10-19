"""儀表板設定。

鍵：
- activityEnabled：是否記錄活動紀錄，預設 true。
- activityRetentionDays：活動紀錄保留天數，0 為永久，預設 0。
- reasonLabels：覆寫或擴充異動說法 {reason: 顯示文字}。
- listLimit：清單預設筆數，1–200，預設 50。
"""

from dataclasses import dataclass, field

from app.core.retention import cutoff

_KNOWN = {"activityEnabled", "activityRetentionDays", "reasonLabels", "listLimit"}


class DashboardSettingsError(ValueError):
    pass


@dataclass(frozen=True)
class DashboardSettings:
    activity_enabled: bool = True
    activity_retention_days: int = 0
    reason_labels: dict[str, str] = field(default_factory=dict)
    list_limit: int = 50


def load_dashboard_settings(raw: dict) -> DashboardSettings:
    unknown = set(raw) - _KNOWN
    if unknown:
        raise DashboardSettingsError(f"未知的設定：{', '.join(sorted(unknown))}")
    days = int(raw.get("activityRetentionDays", 0))
    limit = int(raw.get("listLimit", 50))
    try:
        from datetime import datetime
        cutoff(datetime.now(), days)
    except ValueError as exc:
        raise DashboardSettingsError(str(exc)) from exc
    if not 1 <= limit <= 200:
        raise DashboardSettingsError("listLimit 需在 1 到 200 之間")
    labels = {str(k): str(v) for k, v in dict(raw.get("reasonLabels", {})).items()}
    return DashboardSettings(bool(raw.get("activityEnabled", True)), days, labels, limit)


_current = DashboardSettings()


def configure(settings: DashboardSettings) -> None:
    global _current
    _current = settings


def get_settings() -> DashboardSettings:
    return _current
