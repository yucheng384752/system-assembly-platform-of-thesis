"""產線的整份表單定義：站點依序排列，各含製程步驟與可填寫項目。

隱藏規則在這裡實作（後端過濾），不依賴前端遮蔽。
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import require_password_changed
from app.core.database import get_db
from app.core.entry_points_registration import PRODUCT_LINE_SCOPE
from app.core.form_resolver import MetricDef, ModelSpecDef, StepDef, effective_metrics, steps_for, with_model_specs
from app.core.user_scopes import scoped_keys
from app.models.metric import Metric
from app.models.model_spec import ModelSpec
from app.models.product_line import ProductLine
from app.models.product_model import ProductModel
from app.models.station import Station
from app.models.station_step import StationStep
from app.models.user import User
from app.schemas.product import FormRead, MetricRead, StationFormRead, StepRead

router = APIRouter(prefix="/forms", tags=["forms"])


def _metric_def(m: Metric) -> MetricDef:
    return MetricDef(id=m.id, station_id=m.station_id, key=m.key, label=m.label, product_model_id=m.product_model_id,
                     spec_source=m.spec_source, display_order=m.display_order, spec_min=m.spec_min, spec_max=m.spec_max, spec_text=m.spec_text)


@router.get("/{product_line_code}", response_model=FormRead)
def get_form(product_line_code: str, model_id: int | None = None, user: User = Depends(require_password_changed), db: Session = Depends(get_db)) -> FormRead:
    line = db.scalar(select(ProductLine).where(ProductLine.code == product_line_code))
    allowed = scoped_keys(user, PRODUCT_LINE_SCOPE, db)
    if line is None or (allowed is not None and line.code not in allowed):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="產線不存在")
    if line.status != "defined":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="此產線尚未提供定義")
    model = db.get(ProductModel, model_id) if model_id is not None else None
    if model_id is not None and (model is None or model.product_line_id != line.id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="型號不存在")
    variant = model.process_variant if model else None
    specs = {} if model is None else {s.metric_key: ModelSpecDef(s.metric_key, s.spec_min, s.spec_max, s.spec_text)
                                      for s in db.scalars(select(ModelSpec).where(ModelSpec.product_model_id == model.id))}
    stations = list(db.scalars(select(Station).where(Station.product_line_id == line.id).order_by(Station.sequence)))
    ids = [s.id for s in stations]
    metric_rows = {m.id: m for m in db.scalars(select(Metric).where(Metric.station_id.in_(ids)))} if ids else {}
    metric_defs = [_metric_def(m) for m in metric_rows.values()]
    step_rows = list(db.scalars(select(StationStep).where(StationStep.station_id.in_(ids)))) if ids else []
    step_defs = [StepDef(s.station_id, s.seq, s.instruction, s.variant) for s in step_rows]
    out: list[StationFormRead] = []
    for st in stations:
        chosen = {(s.seq): s for s in steps_for(step_defs, st.id, variant)}
        steps = [r for r in step_rows if r.station_id == st.id and (r.seq in chosen) and r.variant == chosen[r.seq].variant]
        metrics: list[MetricRead] = []
        for d in effective_metrics(metric_defs, st.id, model.id if model else None):
            row = metric_rows[d.id]
            if user.role.value in (row.hidden_from_roles or []):
                continue
            resolved = with_model_specs(d, specs)
            read = MetricRead.model_validate(row).model_copy(update={
                "model_spec_min": resolved.model_spec_min, "model_spec_max": resolved.model_spec_max, "model_spec_text": resolved.model_spec_text})
            metrics.append(read)
        out.append(StationFormRead(id=st.id, code=st.code, name=st.name, sequence=st.sequence,
                                   steps=[StepRead.model_validate(r) for r in sorted(steps, key=lambda r: r.seq)], metrics=metrics))
    return FormRead(product_line_code=line.code, stations=out)
