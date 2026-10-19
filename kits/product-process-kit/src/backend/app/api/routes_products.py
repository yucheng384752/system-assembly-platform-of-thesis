"""產線、型號、配方與異動紀錄。

寫入入口 `product_model_manage` 由本 Kit 註冊；讀取只需已完成改密碼的帳號，
但受「產線」資源範圍限制（entry-permission-kit 的 user_scopes）。
"""

from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_entry_point, require_password_changed
from app.core.database import get_db
from app.core.definition_changes import ReasonRequiredError, changed_fields, require_reason, summarize
from app.core.product_entry_points import PRODUCT_LINE_SCOPE, PRODUCT_MODEL_MANAGE
from app.core.recipe import RecipeError, RecipeLine as RecipeLineVO, compute_theoretical, validate_lines
from app.core.user_scopes import scoped_keys
from app.models.definition_change_log import DefinitionChangeLog
from app.models.product_line import ProductLine
from app.models.product_model import ProductModel
from app.models.recipe_line import RecipeLine
from app.models.user import User
from app.schemas.product import (
    ChangeLogRead, ProductLineRead, ProductModelCreate, ProductModelRead, ProductModelUpdate,
    RecipeLineIO, TheoreticalLineRead,
)

router = APIRouter(tags=["products"])

_LABELS = {
    "display_name": "品名", "is_active": "啟用", "process_variant": "製程變體",
    "attributes": "屬性", "recipe_lines": "配方明細",
}


async def _line_or_404(db: AsyncSession, code: str, user: User) -> ProductLine:
    line = await db.scalar(select(ProductLine).where(ProductLine.code == code))
    allowed = await scoped_keys(user, PRODUCT_LINE_SCOPE, db)
    if line is None or (allowed is not None and line.code not in allowed):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="產線不存在")
    return line


async def _recipe_rows(db: AsyncSession, model_id: int) -> list[RecipeLine]:
    return list(await db.scalars(select(RecipeLine).where(RecipeLine.product_model_id == model_id).order_by(RecipeLine.display_order, RecipeLine.id)))


def _to_vo(row: RecipeLine | RecipeLineIO) -> RecipeLineVO:
    ratio = None if row.ratio_pct is None else Decimal(str(row.ratio_pct))
    return RecipeLineVO(row.key, row.label, row.item_no, ratio, row.ratio_base, row.is_remainder)


def _read(model: ProductModel, rows: list[RecipeLine]) -> ProductModelRead:
    return ProductModelRead(
        id=model.id, product_line_id=model.product_line_id, code=model.code, display_name=model.display_name,
        is_active=model.is_active, process_variant=model.process_variant, attributes=model.attributes or {},
        recipe_lines=[RecipeLineIO(key=r.key, label=r.label, item_no=r.item_no,
                                   ratio_pct=None if r.ratio_pct is None else float(r.ratio_pct),
                                   ratio_base=r.ratio_base, is_remainder=r.is_remainder) for r in rows],
    )


def _log(db: AsyncSession, model_id: int, summary: str, reason: str, actor: User) -> None:
    db.add(DefinitionChangeLog(entity_type="product_model", entity_id=model_id, summary=summary,
                               reason=reason, changed_by_id=actor.id, changed_by_name=actor.display_name))


async def _replace_recipe(db: AsyncSession, model_id: int, lines: list[RecipeLineIO]) -> None:
    try:
        validate_lines([_to_vo(l) for l in lines])
    except RecipeError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    for old in await _recipe_rows(db, model_id):
        await db.delete(old)
    await db.flush()
    for order, l in enumerate(lines):
        db.add(RecipeLine(product_model_id=model_id, key=l.key, label=l.label, item_no=l.item_no,
                          ratio_pct=l.ratio_pct, ratio_base=l.ratio_base, is_remainder=l.is_remainder, display_order=order))


def _recipe_dump(lines: list[RecipeLineIO | RecipeLine]) -> list[dict]:
    return [{"key": l.key, "label": l.label, "item_no": l.item_no,
             "ratio_pct": None if l.ratio_pct is None else float(l.ratio_pct),
             "ratio_base": l.ratio_base, "is_remainder": l.is_remainder} for l in lines]


@router.get("/product-lines", response_model=list[ProductLineRead])
async def list_product_lines(user: User = Depends(require_password_changed), db: AsyncSession = Depends(get_db)) -> list[ProductLine]:
    lines = list(await db.scalars(select(ProductLine).order_by(ProductLine.id)))
    allowed = await scoped_keys(user, PRODUCT_LINE_SCOPE, db)
    return lines if allowed is None else [l for l in lines if l.code in allowed]


@router.get("/product-models", response_model=list[ProductModelRead])
async def list_product_models(product_line_code: str, user: User = Depends(require_password_changed), db: AsyncSession = Depends(get_db)) -> list[ProductModelRead]:
    line = await _line_or_404(db, product_line_code, user)
    models = await db.scalars(select(ProductModel).where(ProductModel.product_line_id == line.id, ProductModel.is_active.is_(True)).order_by(ProductModel.code))
    return [_read(m, await _recipe_rows(db, m.id)) for m in models]


@router.post("/product-models", response_model=ProductModelRead, status_code=status.HTTP_201_CREATED)
async def create_product_model(body: ProductModelCreate, actor: User = Depends(require_entry_point(PRODUCT_MODEL_MANAGE)), db: AsyncSession = Depends(get_db)) -> ProductModelRead:
    line = await _line_or_404(db, body.product_line_code, actor)
    if line.status != "defined":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="此產線尚未提供定義，不能新增型號")
    if await db.scalar(select(ProductModel).where(ProductModel.code == body.code)) is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="型號代碼已存在")
    try:
        reason = require_reason(body.reason)
    except ReasonRequiredError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="新增型號需填寫原因") from exc
    model = ProductModel(product_line_id=line.id, code=body.code, display_name=body.display_name,
                         process_variant=body.process_variant, attributes=body.attributes)
    db.add(model)
    await db.flush()
    await _replace_recipe(db, model.id, body.recipe_lines)
    _log(db, model.id, f"新增型號：{model.code}" + (f"；配方明細 {len(body.recipe_lines)} 行" if body.recipe_lines else ""), reason, actor)
    await db.commit()
    await db.refresh(model)
    return _read(model, await _recipe_rows(db, model.id))


@router.patch("/product-models/{model_id}", response_model=ProductModelRead)
async def update_product_model(model_id: int, body: ProductModelUpdate, actor: User = Depends(require_entry_point(PRODUCT_MODEL_MANAGE)), db: AsyncSession = Depends(get_db)) -> ProductModelRead:
    model = await db.scalar(select(ProductModel).where(ProductModel.id == model_id).with_for_update())
    if model is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="型號不存在")
    line = await db.get(ProductLine, model.product_line_id)
    await _line_or_404(db, line.code, actor)
    incoming = body.model_dump(exclude_unset=True, exclude={"reason"})
    for field in ("recipe_lines", "attributes", "is_active"):  # 這幾項傳 null 視為沒有要改
        if incoming.get(field, ...) is None:
            incoming.pop(field, None)
    current_rows = await _recipe_rows(db, model.id)
    current = {"display_name": model.display_name, "is_active": model.is_active, "process_variant": model.process_variant,
               "attributes": model.attributes or {}, "recipe_lines": _recipe_dump(current_rows)}
    if "recipe_lines" in incoming:
        incoming["recipe_lines"] = _recipe_dump(body.recipe_lines or [])
    changes = changed_fields(current, incoming)
    if not changes:
        return _read(model, current_rows)
    try:
        reason = require_reason(body.reason)
    except ReasonRequiredError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="修改型號資料需填寫修改原因") from exc
    if "recipe_lines" in changes:
        await _replace_recipe(db, model.id, body.recipe_lines or [])
    for field in ("display_name", "is_active", "process_variant", "attributes"):
        if field in changes:
            setattr(model, field, incoming[field])
    summary = summarize({k: (("(略)" if k == "recipe_lines" else v[0]), ("(略)" if k == "recipe_lines" else v[1])) for k, v in changes.items()}, _LABELS)
    _log(db, model.id, summary, reason, actor)
    await db.commit()
    await db.refresh(model)
    return _read(model, await _recipe_rows(db, model.id))


@router.get("/product-models/{model_id}/change-logs", response_model=list[ChangeLogRead])
async def list_change_logs(model_id: int, user: User = Depends(require_entry_point(PRODUCT_MODEL_MANAGE)), db: AsyncSession = Depends(get_db)) -> list[DefinitionChangeLog]:
    if await db.get(ProductModel, model_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="型號不存在")
    return list(await db.scalars(select(DefinitionChangeLog).where(
        DefinitionChangeLog.entity_type == "product_model", DefinitionChangeLog.entity_id == model_id,
    ).order_by(DefinitionChangeLog.changed_at.desc(), DefinitionChangeLog.id.desc())))


@router.get("/product-models/{model_id}/theoretical", response_model=list[TheoreticalLineRead])
async def theoretical_quantities(model_id: int, total: float, user: User = Depends(require_password_changed), db: AsyncSession = Depends(get_db)) -> list[TheoreticalLineRead]:
    """依總重算配方理論用量，供批次生產 Kit 開單時預填。沒有比例資料時回傳空陣列。"""
    model = await db.get(ProductModel, model_id)
    if model is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="型號不存在")
    line = await db.get(ProductLine, model.product_line_id)
    await _line_or_404(db, line.code, user)
    try:
        out = compute_theoretical([_to_vo(r) for r in await _recipe_rows(db, model.id)], Decimal(str(total)))
    except RecipeError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    return [TheoreticalLineRead(key=o.key, label=o.label, item_no=o.item_no, weight=float(o.weight)) for o in out]
