"""批次生產的可調設定（預設值皆為中性，不含任何場域資料）。

平台啟動時以 `configure(load_batch_settings(raw))` 套用；上線後由參數設定中心調整。
欄位意義：
- lot_format：批號樣板，見 lot_number.py。
- required_attachments：完成工單前必須上傳的附件欄位 {key: 顯示名稱}，預設空。
- material_station_codes：以用料秤重代替量測項目判斷完成的站點代碼。
- sign_exclude_stations：簽核時暫不要求完成的站點代碼（例如要等入庫單送出才能填的站點）。
- header_prefill：開單時由型號屬性帶入表頭擴充欄位的對照 {表頭欄位: 型號屬性鍵}。
- require_assignment：開單是否必須指派兩位操作員與一位品管。
"""

from dataclasses import dataclass, field

from app.core.lot_number import LotNumberFormat


@dataclass(frozen=True)
class BatchSettings:
    lot_format: LotNumberFormat = field(default_factory=LotNumberFormat)
    required_attachments: dict[str, str] = field(default_factory=dict)
    material_station_codes: frozenset[str] = frozenset()
    sign_exclude_stations: frozenset[str] = frozenset()
    header_prefill: dict[str, str] = field(default_factory=dict)
    require_assignment: bool = True
    timezone: str = "UTC"


class BatchSettingsError(ValueError):
    pass


def load_batch_settings(raw: dict) -> BatchSettings:
    known = {"lotFormat", "requiredAttachments", "materialStationCodes", "signExcludeStations",
             "headerPrefill", "requireAssignment", "timezone"}
    unknown = set(raw) - known
    if unknown:
        raise BatchSettingsError(f"未知的設定：{', '.join(sorted(unknown))}")
    lot = raw.get("lotFormat", {})
    fmt = LotNumberFormat(
        pattern=lot.get("pattern", LotNumberFormat.pattern),
        region_code=lot.get("regionCode", ""),
        variant_codes=dict(lot.get("variantCodes", {})),
        serial_reset=lot.get("serialReset", "never"),
    )
    fmt.validate()
    return BatchSettings(
        lot_format=fmt,
        required_attachments=dict(raw.get("requiredAttachments", {})),
        material_station_codes=frozenset(raw.get("materialStationCodes", [])),
        sign_exclude_stations=frozenset(raw.get("signExcludeStations", [])),
        header_prefill=dict(raw.get("headerPrefill", {})),
        require_assignment=bool(raw.get("requireAssignment", True)),
        timezone=raw.get("timezone", "UTC"),
    )


_current = BatchSettings()


def configure(settings: BatchSettings) -> None:
    global _current
    _current = settings


def get_settings() -> BatchSettings:
    return _current
