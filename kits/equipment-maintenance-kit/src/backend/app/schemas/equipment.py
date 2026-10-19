from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class EquipmentWrite(BaseModel):
    code: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_.-]+$")
    name: str = Field(min_length=1, max_length=128)
    category: str | None = Field(None, max_length=64)
    product_line_code: str | None = Field(None, max_length=32)
    note: str | None = Field(None, max_length=2000)


class EquipmentUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=128)
    category: str | None = Field(None, max_length=64)
    product_line_code: str | None = Field(None, max_length=32)
    active: bool | None = None
    note: str | None = Field(None, max_length=2000)


class EquipmentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    code: str
    name: str
    category: str | None
    product_line_code: str | None
    active: bool
    note: str | None


class EquipmentStatus(EquipmentRead):
    open_repair: bool
    checks: dict[str, str]  # 頻率 → missing | submitted | reviewed
    abnormal: list[str]  # 有異常的頻率
    blocker: str | None  # 閘門目前的阻擋原因（沿用設定）


class ChecklistItemWrite(BaseModel):
    frequency: str
    key: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_.-]+$")
    label: str = Field(min_length=1, max_length=128)
    kind: str = "bool"
    unit: str | None = Field(None, max_length=16)
    low: float | None = Field(None, allow_inf_nan=False)
    high: float | None = Field(None, allow_inf_nan=False)
    required: bool = True


class ChecklistItemRead(ChecklistItemWrite):
    model_config = ConfigDict(from_attributes=True)


class CheckSubmit(BaseModel):
    frequency: str
    results: dict = {}
    note: str | None = Field(None, max_length=2000)


class CheckRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    equipment_code: str
    frequency: str
    period_key: str
    status: str
    results: dict
    abnormal: list
    note: str | None
    performed_by: int
    performed_at: datetime
    reviewed_by: int | None
    reviewed_at: datetime | None


class RepairCreate(BaseModel):
    description: str = Field(min_length=1, max_length=2000)


class RepairClose(BaseModel):
    resolution: str = Field(min_length=1, max_length=2000)


class RepairRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    equipment_code: str
    description: str
    status: str
    reported_by: int
    opened_at: datetime
    closed_by: int | None
    closed_at: datetime | None
    resolution: str | None
