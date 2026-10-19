from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class SettingRead(BaseModel):
    key: str
    kit_id: str
    label: str
    category: str
    type: str
    unit: str | None
    min: float | None
    max: float | None
    integer: bool
    choices: list[str]
    risk: str
    kind: str
    description: str
    impact: str
    default: Any
    value: Any  # 目前有效值
    source: str  # site | runtime | system | default
    source_label: str
    version: int
    can_edit: bool
    why_not: str


class SettingWrite(BaseModel):
    value: Any
    expected_version: int | None = Field(None, ge=0)
    reason: str | None = Field(None, max_length=500)


class SettingReset(BaseModel):
    expected_version: int | None = Field(None, ge=0)
    reason: str | None = Field(None, max_length=500)


class ChangeRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    key: str
    action: str
    old_value: Any
    new_value: Any
    version: int
    actor_id: int
    reason: str | None
    created_at: datetime
