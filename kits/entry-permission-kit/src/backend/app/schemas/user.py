from pydantic import BaseModel, Field

from app.core.roles import Role


class UserCreate(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    display_name: str = Field(min_length=1, max_length=128)
    employee_no: str | None = Field(default=None, max_length=32)
    password: str
    role: Role


class UserUpdate(BaseModel):
    """部分更新；未帶的欄位不變。"""

    display_name: str | None = Field(default=None, min_length=1, max_length=128)
    employee_no: str | None = None
    is_active: bool | None = None
    role: Role | None = None


class ResetPasswordRequest(BaseModel):
    """重設他人密碼後，對方下次登入須自行變更。"""

    new_password: str = Field(min_length=1)


class UserScopesUpdate(BaseModel):
    """整批取代某範圍類型的綁定；空陣列清除綁定，回到不限制。"""

    keys: list[str] = Field(default_factory=list)


class EntryPointOverridesUpdate(BaseModel):
    """只更新帶到的 key：True 強制允許、False 強制拒絕、None 清除覆寫。"""

    overrides: dict[str, bool | None] = Field(default_factory=dict)
