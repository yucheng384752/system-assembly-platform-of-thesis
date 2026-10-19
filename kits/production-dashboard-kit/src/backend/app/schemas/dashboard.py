from datetime import datetime

from pydantic import BaseModel


class SectionRead(BaseModel):
    key: str
    title: str
    counts: dict[str, int]
    rows: list[dict]
    error: str | None = None


class OverviewRead(BaseModel):
    batches: dict[str, int]
    sections: list[SectionRead]


class ActivityRead(BaseModel):
    id: int
    batch_id: int
    batch_label: str | None
    text: str
    actor_id: int | None
    created_at: datetime


class BatchSummaryRead(BaseModel):
    id: int
    lot_no: str
    status: str
    product_line_code: str
    product_model_code: str
    equipment_ref: str | None
    created_at: datetime
    finished_at: datetime | None


class TraceRead(BaseModel):
    station_code: str
    metric_key: str
    step_seq: int
    value_num: float | None
    value_text: str | None
    value_bool: bool | None
    operator_id: int
    recorded_at: datetime
