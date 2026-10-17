"""密碼原則：登入、變更、建立帳號共用同一套檢查。"""

from app.core.config import settings


class WeakPasswordError(ValueError):
    pass


def validate_password_strength(password: str) -> None:
    """目前原則：長度需大於 password_min_length。複雜度屬政策調整，另行決議。"""
    if len(password) <= settings.password_min_length:
        raise WeakPasswordError(f"密碼長度需大於 {settings.password_min_length} 碼")
