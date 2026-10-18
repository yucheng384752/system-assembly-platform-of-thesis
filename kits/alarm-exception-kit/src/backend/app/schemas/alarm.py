from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class AlarmRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    batch_id: int
    batch_label: str | None = None
    measurement_id: int | None
    rule_key: str
    station_code: str
    metric_key: str
    severity: str
    message: str
    status: str
    created_at: datetime
    acknowledged_by: int | None
    acknowledged_at: datetime | None
    resolved_at: datetime | None


class ExceptionCreate(BaseModel):
    reason: str = Field(min_length=1, max_length=2000)


class ExceptionDecision(BaseModel):
    status: str
    verification_passed: bool = False
    comment: str | None = Field(None, max_length=2000)


class ExceptionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    batch_id: int
    station_code: str
    metric_key: str
    measured_value: float | None
    reason: str
    status: str
    requested_by: int
    created_at: datetime
    decided_by: int | None
    decided_at: datetime | None
    verification_passed: bool
    decision_comment: str | None
