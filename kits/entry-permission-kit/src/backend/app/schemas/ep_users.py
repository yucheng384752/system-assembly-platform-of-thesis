from uuid import UUID

from pydantic import Field, SecretStr, field_validator, model_validator

from app.entry_permission.passwords import validate_password
from .ep_auth import Input


class UserCreate(Input):
    username: str = Field(min_length=1, max_length=100)
    password: SecretStr
    display_name: str = Field(min_length=1, max_length=100)
    employee_no: str | None = Field(default=None, max_length=100)
    role_id: UUID

    @field_validator("password")
    @classmethod
    def strong(cls, value):
        validate_password(value.get_secret_value())
        return value


class UserUpdate(Input):
    display_name: str | None = Field(default=None, min_length=1, max_length=100)
    employee_no: str | None = Field(default=None, max_length=100)
    role_id: UUID | None = None
    is_active: bool | None = None

    @model_validator(mode="after")
    def nonnull(self):
        if any(getattr(self, key) is None for key in self.model_fields_set - {"employee_no"}):
            raise ValueError("Only employee_no may be null")
        return self
