from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .ep_auth import Input


class RoleCreate(Input):
    name: str = Field(pattern=r"^[a-z][a-z0-9_]*$", max_length=50)
    display_name: str = Field(min_length=1, max_length=100)
    is_readonly: bool = False


class RoleUpdate(Input):
    display_name: str | None = Field(default=None, min_length=1, max_length=100)
    is_readonly: bool | None = None

    @model_validator(mode="after")
    def nonnull(self):
        if any(getattr(self, key) is None for key in self.model_fields_set):
            raise ValueError("Role fields cannot be null")
        return self


class RoleRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    name: str
    display_name: str
    is_builtin: bool
    is_readonly: bool
