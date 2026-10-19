"""照片佐證的檢查（純函式）。

不信任用戶端宣稱的內容類型：以檔案開頭的位元組判斷真正格式，再與允許清單比對。
檔名只保留安全字元，避免路徑穿越與控制字元。
"""

import re

DEFAULT_TYPES = ("image/jpeg", "image/png", "image/webp")
DEFAULT_MAX_BYTES = 10 * 1024 * 1024


class AttachmentError(ValueError):
    pass


def sniff(data: bytes) -> str | None:
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


def sanitize_filename(name: str | None) -> str:
    base = (name or "").replace("\\", "/").split("/")[-1]
    base = re.sub(r"[\x00-\x1f\x7f]", "", base)
    base = re.sub(r"[^\w.\-]", "_", base, flags=re.UNICODE).lstrip(".")
    return base[:100] or "file"


def validate_upload(key: str, allowed_keys: set[str], data: bytes, max_bytes: int = DEFAULT_MAX_BYTES,
                    allowed_types: tuple[str, ...] = DEFAULT_TYPES) -> str:
    """回傳偵測到的內容類型；不合法就丟 AttachmentError。"""
    if key not in allowed_keys:
        raise AttachmentError("不允許的附件欄位")
    if not data:
        raise AttachmentError("檔案是空的")
    if len(data) > max_bytes:
        raise AttachmentError(f"檔案超過 {max_bytes // (1024 * 1024)} MB 上限")
    detected = sniff(data)
    if detected is None or detected not in allowed_types:
        raise AttachmentError("只接受 JPEG、PNG、WebP 圖片")
    return detected
