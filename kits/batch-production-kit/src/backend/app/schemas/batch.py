"""批次、量測、用料與簽核的輸入輸出格式。"""

from datetime import date, datetime

from pydantic import BaseModel, Field


class BatchCreate(BaseModel):
    product_model_id: int
    target_weight: float | None = Field(None, gt=0, allow_inf_nan=False)
    order_no: str | None = Field(None, max_length=64)
    customer: str | None = Field(None, max_length=128)
    equipment_ref: str | None = Field(None, max_length=64)
    container_no: str | None = Field(None, max_length=64)
    mfg_date: date | None = None
    env_temp_c: float | None = Field(None, allow_inf_nan=False)
    env_rh_pct: float | None = Field(None, ge=0, le=100, allow_inf_nan=False)
    extra: dict = {}
    assigned_operator1_id: int | None = None
    assigned_operator2_id: int | None = None
    assigned_qc_id: int | None = None


class BatchHeaderUpdate(BaseModel):
    order_no: str | None = Field(None, max_length=64)
    customer: str | None = Field(None, max_length=128)
    equipment_ref: str | None = Field(None, max_length=64)
    container_no: str | None = Field(None, max_length=64)
    mfg_date: date | None = None
    env_temp_c: float | None = Field(None, allow_inf_nan=False)
    env_rh_pct: float | None = Field(None, ge=0, le=100, allow_inf_nan=False)
    extra: dict | None = None


class BatchRead(BaseModel):
    id: int
    product_line_code: str
    product_model_code: str
    process_variant: str | None
    lot_no: str
    order_no: str | None
    customer: str | None
    equipment_ref: str | None
    container_no: str | None
    mfg_date: date | None
    env_temp_c: float | None
    env_rh_pct: float | None
    target_weight: float | None
    extra: dict
    status: str
    started_at: datetime | None
    finished_at: datetime | None
    dispatched_at: datetime | None
    assigned_operator1_id: int | None
    assigned_operator2_id: int | None
    assigned_qc_id: int | None
    operator_signed_at: datetime | None
    inspector_signed_at: datetime | None
    model_config = {"from_attributes": True}


class BatchDetail(BatchRead):
    current_station: str | None = None


class BatchDeleteRequest(BaseModel):
    reason: str = Field(..., min_length=1, max_length=255)


class MeasurementSubmit(BaseModel):
    station_code: str = Field(..., max_length=32)
    metric_key: str = Field(..., max_length=64)
    step_seq: int | None = Field(None, ge=1)
    value_num: float | None = Field(None, allow_inf_nan=False)
    value_text: str | None = Field(None, max_length=255)
    value_bool: bool | None = None
    is_done: bool = False


class MeasurementRead(BaseModel):
    id: int
    batch_id: int
    station_code: str
    metric_key: str
    step_seq: int
    value_num: float | None
    value_text: str | None
    value_bool: bool | None
    is_done: bool
    operator_id: int
    recorded_at: datetime
    model_config = {"from_attributes": True}


class MaterialWrite(BaseModel):
    kind: str = Field(..., max_length=32)
    item_no: str | None = Field(None, max_length=64)
    lot_no: str | None = Field(None, max_length=64)
    supplier: str | None = Field(None, max_length=128)
    theoretical_qty: float | None = Field(None, ge=0, allow_inf_nan=False)
    actual_qty: float | None = Field(None, ge=0, allow_inf_nan=False)


class MaterialRead(MaterialWrite):
    id: int
    batch_id: int
    updated_by: int | None
    updated_at: datetime | None
    model_config = {"from_attributes": True}


class SignRequest(BaseModel):
    role: str = Field(..., pattern="^(operator|inspector)$")


class SignResult(BaseModel):
    role: str
    signed_by: int
    signed_by_name: str
    signed_at: datetime
