from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class WarehouseEntryWrite(BaseModel):
    quantity: float | None = Field(None, allow_inf_nan=False)
    unit: str | None = Field(None, max_length=16)
    location: str | None = Field(None, max_length=64)
    lines: list[dict] = Field(default_factory=list, max_length=200)
    note: str | None = Field(None, max_length=2000)


class WarehouseEntryRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    batch_id: int
    quantity: float | None
    unit: str | None
    location: str | None
    lines: list
    note: str | None
    status: str
    updated_by: int
    updated_at: datetime
    submitted_by: int | None
    submitted_at: datetime | None


class ReworkCreate(BaseModel):
    quantity: float = Field(allow_inf_nan=False)
    unit: str | None = Field(None, max_length=16)
    station_code: str | None = Field(None, max_length=32)
    reason: str = Field(min_length=1, max_length=2000)


class ReworkRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    batch_id: int
    station_code: str | None
    quantity: float
    unit: str | None
    reason: str
    status: str
    created_by: int
    created_at: datetime
    confirmed_by: int | None
    confirmed_at: datetime | None


class NoteCreate(BaseModel):
    text: str = Field(max_length=1000)
    station_code: str | None = Field(None, max_length=32)
    step_seq: int = Field(0, ge=0)


class NoteRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    batch_id: int
    station_code: str | None
    step_seq: int
    text: str
    author_id: int
    created_at: datetime


class AttachmentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    attachment_key: str
    filename: str
    content_type: str
    size: int
    uploaded_by: int
    uploaded_at: datetime
    url: str | None = None
