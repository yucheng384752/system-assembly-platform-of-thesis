"""供其他 Kit 在同一程序內查詢的唯讀介面。

其他 Kit 不應直接匯入本 Kit 的資料表模型；它們呼叫這裡的函式，拿到不含 ORM 物件的
資料類別。這樣本 Kit 日後調整資料表，只要這幾個函式的回傳不變，呼叫方就不受影響。
"""

from dataclasses import dataclass
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.form_resolver import MetricDef, ModelSpecDef, StepDef, effective_metrics, steps_for
from app.core.recipe import RecipeLine as RecipeLineVO
from app.models.metric import Metric
from app.models.model_spec import ModelSpec
from app.models.product_line import ProductLine
from app.models.product_model import ProductModel
from app.models.recipe_line import RecipeLine
from app.models.station import Station
from app.models.station_step import StationStep


@dataclass(frozen=True)
class ModelSnapshot:
    id: int
    product_line_code: str
    code: str
    process_variant: str | None
    attributes: dict
    recipe_lines: tuple[RecipeLineVO, ...]
    is_active: bool


@dataclass(frozen=True)
class MetricInfo:
    key: str
    label: str
    unit: str | None
    scope: str
    required: bool
    filler_role: str
    spec_low: Decimal | None
    spec_high: Decimal | None


@dataclass(frozen=True)
class StepInfo:
    seq: int
    spec_text: str | None


@dataclass(frozen=True)
class StationInfo:
    code: str
    name: str
    sequence: int
    steps: tuple[StepInfo, ...]
    metrics: tuple[MetricInfo, ...]


def get_model_snapshot(db: Session, model_id: int) -> ModelSnapshot | None:
    model = db.get(ProductModel, model_id)
    if model is None:
        return None
    line = db.get(ProductLine, model.product_line_id)
    rows = db.scalars(select(RecipeLine).where(RecipeLine.product_model_id == model.id).order_by(RecipeLine.display_order, RecipeLine.id))
    lines = tuple(RecipeLineVO(r.key, r.label, r.item_no, None if r.ratio_pct is None else Decimal(str(r.ratio_pct)), r.ratio_base, r.is_remainder) for r in rows)
    return ModelSnapshot(model.id, line.code, model.code, model.process_variant, dict(model.attributes or {}), lines, model.is_active)


def load_stations(db: Session, product_line_code: str, model_id: int | None) -> list[StationInfo]:
    """某產線依型號解析後的站點、步驟與項目（含規格上下限，型號規格優先於常數規格）。"""
    line = db.scalar(select(ProductLine).where(ProductLine.code == product_line_code))
    if line is None:
        return []
    variant = None
    specs: dict[str, ModelSpecDef] = {}
    if model_id is not None:
        model = db.get(ProductModel, model_id)
        variant = model.process_variant if model else None
        specs = {s.metric_key: ModelSpecDef(s.metric_key, s.spec_min, s.spec_max, s.spec_text)
                 for s in db.scalars(select(ModelSpec).where(ModelSpec.product_model_id == model_id))}
    stations = list(db.scalars(select(Station).where(Station.product_line_id == line.id).order_by(Station.sequence)))
    ids = [s.id for s in stations]
    metrics = list(db.scalars(select(Metric).where(Metric.station_id.in_(ids)))) if ids else []
    by_id = {m.id: m for m in metrics}
    defs = [MetricDef(m.id, m.station_id, m.key, m.label, m.product_model_id, m.spec_source, m.display_order, m.spec_min, m.spec_max, m.spec_text) for m in metrics]
    step_defs = [StepDef(s.station_id, s.seq, s.instruction, s.variant) for s in db.scalars(select(StationStep).where(StationStep.station_id.in_(ids)))] if ids else []
    spec_text_by_key = {(s.station_id, s.seq, s.variant): s.spec_text for s in db.scalars(select(StationStep).where(StationStep.station_id.in_(ids)))} if ids else {}
    out: list[StationInfo] = []
    for st in stations:
        infos: list[MetricInfo] = []
        for d in effective_metrics(defs, st.id, model_id):
            m = by_id[d.id]
            if m.spec_source == "model":
                spec = specs.get(m.key)
                low, high = (spec.spec_min, spec.spec_max) if spec else (None, None)
            else:
                low, high = m.spec_min, m.spec_max
            infos.append(MetricInfo(m.key, m.label, m.unit, m.scope, m.required, m.filler_role,
                                    None if low is None else Decimal(str(low)), None if high is None else Decimal(str(high))))
        steps = tuple(StepInfo(s.seq, spec_text_by_key.get((s.station_id, s.seq, s.variant))) for s in steps_for(step_defs, st.id, variant))
        out.append(StationInfo(st.code, st.name, st.sequence, steps, tuple(infos)))
    return out


def find_model_id(db: Session, product_line_code: str, model_code: str) -> int | None:
    """以業務鍵（產線代碼、型號代碼）找型號編號；批次只存業務鍵，需要時才在這裡解析。"""
    line = db.scalar(select(ProductLine).where(ProductLine.code == product_line_code))
    if line is None:
        return None
    return db.scalar(select(ProductModel.id).where(ProductModel.product_line_id == line.id, ProductModel.code == model_code))
