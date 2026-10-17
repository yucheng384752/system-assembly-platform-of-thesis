from pydantic import BaseModel, Field

from app.core.roles import Role


class LoginRequest(BaseModel):
    username: str
    password: str


class UserRead(BaseModel):
    id: int
    username: str
    display_name: str
    employee_no: str | None
    role: Role
    must_change_password: bool
    is_active: bool
    # 範圍類型 key → 綁定的鍵；空陣列代表不限制。
    scopes: dict[str, list[str]] = {}
    # 入口 key → 覆寫值；None 表示依角色預設。
    entry_point_overrides: dict[str, bool | None] = {}

    model_config = {"from_attributes": True}


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    must_change_password: bool
    user: UserRead


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(min_length=1)


class UpdateMeRequest(BaseModel):
    """本人只能修改顯示名稱；工號、角色、啟用狀態由帳號管理處理。"""

    display_name: str = Field(min_length=1, max_length=128)
