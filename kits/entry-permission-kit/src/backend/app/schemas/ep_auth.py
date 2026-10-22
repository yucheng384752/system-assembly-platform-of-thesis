from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, SecretStr, field_validator

from app.entry_permission.passwords import validate_password


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Login(Input):
    username: str = Field(min_length=1, max_length=100)
    password: SecretStr


class NewPassword(Input):
    new_password: SecretStr

    @field_validator("new_password")
    @classmethod
    def strong(cls, value):
        validate_password(value.get_secret_value())
        return value


class ChangePassword(NewPassword):
    current_password: SecretStr


class UpdateMe(Input):
    display_name: str = Field(min_length=1, max_length=100)


class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    username: str
    display_name: str
    employee_no: str | None
    role_id: UUID
    must_change_password: bool
    is_active: bool


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    must_change_password: bool
    user: UserRead
