"""產線、型號、配方與表單定義的輸入輸出格式。"""

from datetime import datetime

from pydantic import BaseModel, Field

_KEY = r"^[a-z0-9_]+$"


class ProductLineRead(BaseModel):
    id: int
    code: str
    name: str
    status: str
    model_config = {"from_attributes": True}


class RecipeLineIO(BaseModel):
    key: str = Field(..., pattern=_KEY, max_length=32)
    label: str = Field(..., min_length=1, max_length=64)
    item_no: str | None = Field(None, max_length=64)
    ratio_pct: float | None = Field(None, ge=0, le=100, allow_inf_nan=False)
    ratio_base: str = Field("total", max_length=32)
    is_remainder: bool = False


class ProductModelRead(BaseModel):
    id: int
    product_line_id: int
    code: str
    display_name: str | None
    is_active: bool
    process_variant: str | None
    attributes: dict
    recipe_lines: list[RecipeLineIO] = []


class ProductModelCreate(BaseModel):
    product_line_code: str
    code: str = Field(..., min_length=1, max_length=64)
    display_name: str | None = Field(None, max_length=128)
    process_variant: str | None = Field(None, max_length=32)
    attributes: dict = {}
    recipe_lines: list[RecipeLineIO] = []
    reason: str = Field(..., min_length=1, max_length=500)


class ProductModelUpdate(BaseModel):
    display_name: str | None = Field(None, max_length=128)
    is_active: bool | None = None
    process_variant: str | None = Field(None, max_length=32)
    attributes: dict | None = None
    recipe_lines: list[RecipeLineIO] | None = None
    # 只有內容真的變動時才必填，由路由比對現值後驗證。
    reason: str | None = Field(None, min_length=1, max_length=500)


class ChangeLogRead(BaseModel):
    id: int
    summary: str
    reason: str
    changed_by_name: str
    changed_at: datetime


class TheoreticalLineRead(BaseModel):
    key: str
    label: str
    item_no: str | None
    weight: float


class StepRead(BaseModel):
    seq: int
    instruction: str
    spec_text: str | None
    expected: dict
    variant: str | None
    model_config = {"from_attributes": True}


class MetricRead(BaseModel):
    id: int
    key: str
    section: str
    scope: str
    label: str
    unit: str | None
    data_type: str
    spec_min: float | None
    spec_max: float | None
    spec_text: str | None
    spec_source: str
    filler_role: str
    required: bool
    model_spec_min: float | None = None
    model_spec_max: float | None = None
    model_spec_text: str | None = None
    model_config = {"from_attributes": True}


class StationFormRead(BaseModel):
    id: int
    code: str
    name: str
    sequence: int
    steps: list[StepRead]
    metrics: list[MetricRead]


class FormRead(BaseModel):
    product_line_code: str
    stations: list[StationFormRead]
