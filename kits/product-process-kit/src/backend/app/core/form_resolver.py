"""表單定義的解析規則（純函式）。

保留來源系統已驗證的行為，但把行業專屬的兩組製程區分改為通用的製程變體：
- 量測項目：站點的共用項目（model_id 為空）適用所有型號；某型號若有專屬項目，
  專屬項目整組取代共用項目（不是逐項覆蓋）。
- 製程步驟：每個 seq 優先取與型號製程變體相同的步驟，沒有就退回不分變體的步驟。
- 規格：項目的規格來源為 `model` 時，依型號到型號規格表查值，僅用於顯示，
  不改動項目本身的常數規格。
"""

from dataclasses import dataclass, replace
from decimal import Decimal

SPEC_CONSTANT = "constant"
SPEC_MODEL = "model"


@dataclass(frozen=True)
class MetricDef:
    id: int
    station_id: int
    key: str
    label: str
    product_model_id: int | None = None
    spec_source: str = SPEC_CONSTANT
    display_order: int = 0
    spec_min: Decimal | None = None
    spec_max: Decimal | None = None
    spec_text: str | None = None
    model_spec_min: Decimal | None = None
    model_spec_max: Decimal | None = None
    model_spec_text: str | None = None


@dataclass(frozen=True)
class StepDef:
    station_id: int
    seq: int
    instruction: str
    variant: str | None = None


@dataclass(frozen=True)
class ModelSpecDef:
    metric_key: str
    spec_min: Decimal | None = None
    spec_max: Decimal | None = None
    spec_text: str | None = None


def effective_metrics(metrics: list[MetricDef], station_id: int, model_id: int | None) -> list[MetricDef]:
    rows = [m for m in metrics if m.station_id == station_id and (
        m.product_model_id is None or (model_id is not None and m.product_model_id == model_id)
    )]
    rows.sort(key=lambda m: m.display_order)
    if model_id is not None:
        own = [m for m in rows if m.product_model_id == model_id]
        if own:
            return own
    return [m for m in rows if m.product_model_id is None]


def steps_for(steps: list[StepDef], station_id: int, variant: str | None) -> list[StepDef]:
    chosen: dict[int, StepDef] = {}
    for step in sorted((s for s in steps if s.station_id == station_id), key=lambda s: s.seq):
        if step.variant == variant and variant is not None:
            chosen[step.seq] = step
        elif step.variant is None:
            chosen.setdefault(step.seq, step)
    return [chosen[seq] for seq in sorted(chosen)]


def with_model_specs(metric: MetricDef, specs: dict[str, ModelSpecDef]) -> MetricDef:
    if metric.spec_source != SPEC_MODEL:
        return metric
    spec = specs.get(metric.key)
    if spec is None:
        return metric  # 還沒有型號規格：維持空值，由畫面顯示「無」
    return replace(metric, model_spec_min=spec.spec_min, model_spec_max=spec.spec_max,
                   model_spec_text=spec.spec_text)
