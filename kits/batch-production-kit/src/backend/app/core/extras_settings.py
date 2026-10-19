"""第二階段子功能的設定。預設全部關閉。

鍵：
- enabled：啟用的子功能，可含 warehouse-entry、rework-record、batch-notes、attachments。
- requireWarehouseEntry：完成工單前須已送出入庫單，預設 false。
- reworkConfirmerMustDiffer：回鍋單確認者不可是填單者，預設 true。
- blockOnPendingRework：有待確認回鍋單時擋完成，預設 true。
- attachmentExtraKeys：除了「必附清單」之外允許的附件欄位。
- attachmentMaxBytes：單檔大小上限，預設 10 MB。
"""

from dataclasses import dataclass

from app.core.attachment_rules import DEFAULT_MAX_BYTES

FEATURES = ("warehouse-entry", "rework-record", "batch-notes", "attachments")
_KNOWN = {"enabled", "requireWarehouseEntry", "reworkConfirmerMustDiffer", "blockOnPendingRework", "attachmentExtraKeys", "attachmentMaxBytes"}


class ExtrasSettingsError(ValueError):
    pass


@dataclass(frozen=True)
class ExtrasSettings:
    enabled: frozenset[str] = frozenset()
    require_warehouse_entry: bool = False
    rework_confirmer_must_differ: bool = True
    block_on_pending_rework: bool = True
    attachment_extra_keys: frozenset[str] = frozenset()
    attachment_max_bytes: int = DEFAULT_MAX_BYTES


def load_extras_settings(raw: dict) -> ExtrasSettings:
    unknown = set(raw) - _KNOWN
    if unknown:
        raise ExtrasSettingsError(f"未知的設定：{', '.join(sorted(unknown))}")
    enabled = set(raw.get("enabled", []))
    if enabled - set(FEATURES):
        raise ExtrasSettingsError(f"enabled 只能包含 {list(FEATURES)}")
    max_bytes = int(raw.get("attachmentMaxBytes", DEFAULT_MAX_BYTES))
    if not 1 <= max_bytes <= 100 * 1024 * 1024:
        raise ExtrasSettingsError("attachmentMaxBytes 需在 1 B 到 100 MB 之間")
    return ExtrasSettings(frozenset(enabled), bool(raw.get("requireWarehouseEntry", False)), bool(raw.get("reworkConfirmerMustDiffer", True)),
                          bool(raw.get("blockOnPendingRework", True)), frozenset(raw.get("attachmentExtraKeys", [])), max_bytes)


_current = ExtrasSettings()


def configure(settings: ExtrasSettings) -> None:
    global _current
    _current = settings


def get_extras() -> ExtrasSettings:
    return _current
