"""第二階段端點：入庫單、回鍋確認單、子表格備註、照片佐證。

每組端點各自一個 router，啟動時只掛上有啟用的（見 core/extras_startup.py）。
可見性一律走 batch_read.get_visible_batch；已完成批次不可再修改。
"""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_entry_point, require_password_changed, require_write_access
from app.core import extension_points
from app.core.attachment_rules import AttachmentError, sanitize_filename, validate_upload
from app.core.batch_read import get_visible_batch
from app.core.batch_settings import get_settings
from app.core.database import get_db
from app.core.batch_entry_points import REWORK_CONFIRM
from app.core.events import BatchChanged, bus
from app.core.extras_settings import get_extras
from app.core.note_rules import NoteError, clean_note
from app.core.rework_rules import ReworkError, validate_confirm, validate_create
from app.core.warehouse_rules import WarehouseError, can_edit, normalize_lines, validate_for_submit
from app.models.extras import BatchAttachment, BatchNote, ReworkRecord, WarehouseEntry
from app.models.user import User
from app.schemas.extras import (
    AttachmentRead, NoteCreate, NoteRead, ReworkCreate, ReworkRead, WarehouseEntryRead, WarehouseEntryWrite,
)

warehouse_router = APIRouter(prefix="/batches/{batch_id}/warehouse-entry", tags=["batch-warehouse"])
rework_router = APIRouter(tags=["batch-rework"])
notes_router = APIRouter(prefix="/batches/{batch_id}/notes", tags=["batch-notes"])
attachments_router = APIRouter(prefix="/batches/{batch_id}/attachments", tags=["batch-attachments"])

ROUTERS = {"warehouse-entry": warehouse_router, "rework-record": rework_router, "batch-notes": notes_router, "attachments": attachments_router}


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def _writable_batch(db: AsyncSession, batch_id: int, actor: User):
    batch = await get_visible_batch(db, batch_id, actor)
    if batch.status == "completed":
        raise HTTPException(409, "已完成批次不可修改")
    return batch


# ---- 入庫單 ----
@warehouse_router.get("", response_model=WarehouseEntryRead)
async def get_entry(batch_id: int, actor: User = Depends(require_password_changed), db: AsyncSession = Depends(get_db)) -> WarehouseEntry:
    await get_visible_batch(db, batch_id, actor)
    entry = await db.scalar(select(WarehouseEntry).where(WarehouseEntry.batch_id == batch_id))
    if entry is None:
        raise HTTPException(404, "尚未建立入庫單")
    return entry


@warehouse_router.put("", response_model=WarehouseEntryRead)
async def save_entry(batch_id: int, body: WarehouseEntryWrite, actor: User = Depends(require_write_access), db: AsyncSession = Depends(get_db)) -> WarehouseEntry:
    batch = await _writable_batch(db, batch_id, actor)
    entry = await db.scalar(select(WarehouseEntry).where(WarehouseEntry.batch_id == batch_id))
    if not can_edit(entry.status if entry else None, batch.status):
        raise HTTPException(409, "入庫單已送出，不可修改")
    try:
        lines = normalize_lines(body.lines)
    except WarehouseError as exc:
        raise HTTPException(422, str(exc)) from exc
    if entry is None:
        entry = WarehouseEntry(batch_id=batch_id, updated_by=actor.id)
        db.add(entry)
    entry.quantity, entry.unit, entry.location, entry.lines, entry.note = body.quantity, body.unit, body.location, lines, body.note
    entry.updated_by, entry.updated_at = actor.id, _now()
    await bus.publish(db, BatchChanged(batch_id, "warehouse_saved", actor.id))
    await db.commit()
    return entry


@warehouse_router.post("/submit", response_model=WarehouseEntryRead)
async def submit_entry(batch_id: int, actor: User = Depends(require_write_access), db: AsyncSession = Depends(get_db)) -> WarehouseEntry:
    await _writable_batch(db, batch_id, actor)
    entry = await db.scalar(select(WarehouseEntry).where(WarehouseEntry.batch_id == batch_id))
    if entry is None:
        raise HTTPException(409, "請先儲存入庫單")
    if entry.status == "submitted":
        raise HTTPException(409, "入庫單已送出")
    try:
        entry.lines = validate_for_submit(entry.quantity, entry.unit, entry.lines)
    except WarehouseError as exc:
        raise HTTPException(422, str(exc)) from exc
    entry.status, entry.submitted_by, entry.submitted_at = "submitted", actor.id, _now()
    await bus.publish(db, BatchChanged(batch_id, "warehouse_submitted", actor.id))
    await db.commit()
    return entry


# ---- 回鍋確認單 ----
@rework_router.get("/batches/{batch_id}/rework-records", response_model=list[ReworkRead])
async def list_rework(batch_id: int, actor: User = Depends(require_password_changed), db: AsyncSession = Depends(get_db)) -> list[ReworkRecord]:
    await get_visible_batch(db, batch_id, actor)
    return list(await db.scalars(select(ReworkRecord).where(ReworkRecord.batch_id == batch_id).order_by(ReworkRecord.id)))


@rework_router.post("/batches/{batch_id}/rework-records", response_model=ReworkRead, status_code=201)
async def create_rework(batch_id: int, body: ReworkCreate, actor: User = Depends(require_write_access), db: AsyncSession = Depends(get_db)) -> ReworkRecord:
    await _writable_batch(db, batch_id, actor)
    try:
        qty = validate_create(body.quantity, body.reason)
    except ReworkError as exc:
        raise HTTPException(422, str(exc)) from exc
    rec = ReworkRecord(batch_id=batch_id, station_code=body.station_code, quantity=float(qty), unit=body.unit, reason=body.reason.strip(), created_by=actor.id)
    db.add(rec)
    await db.flush()
    await bus.publish(db, BatchChanged(batch_id, "rework_created", actor.id))
    await db.commit()
    return rec


@rework_router.post("/rework-records/{record_id}/confirm", response_model=ReworkRead)
async def confirm_rework(record_id: int, actor: User = Depends(require_entry_point(REWORK_CONFIRM)), db: AsyncSession = Depends(get_db)) -> ReworkRecord:
    rec = await db.get(ReworkRecord, record_id)
    if rec is None:
        raise HTTPException(404, "回鍋單不存在")
    await get_visible_batch(db, rec.batch_id, actor)
    try:
        validate_confirm(rec.created_by, actor.id, rec.status, get_extras().rework_confirmer_must_differ)
    except ReworkError as exc:
        raise HTTPException(409, str(exc)) from exc
    rec.status, rec.confirmed_by, rec.confirmed_at = "confirmed", actor.id, _now()
    await bus.publish(db, BatchChanged(rec.batch_id, "rework_confirmed", actor.id))
    await db.commit()
    return rec


# ---- 子表格備註 ----
@notes_router.get("", response_model=list[NoteRead])
async def list_notes(batch_id: int, actor: User = Depends(require_password_changed), db: AsyncSession = Depends(get_db)) -> list[BatchNote]:
    await get_visible_batch(db, batch_id, actor)
    return list(await db.scalars(select(BatchNote).where(BatchNote.batch_id == batch_id).order_by(BatchNote.id)))


@notes_router.post("", response_model=NoteRead, status_code=201)
async def add_note(batch_id: int, body: NoteCreate, actor: User = Depends(require_write_access), db: AsyncSession = Depends(get_db)) -> BatchNote:
    await _writable_batch(db, batch_id, actor)
    try:
        text = clean_note(body.text)
    except NoteError as exc:
        raise HTTPException(422, str(exc)) from exc
    note = BatchNote(batch_id=batch_id, station_code=body.station_code, step_seq=body.step_seq, text=text, author_id=actor.id)
    db.add(note)
    await db.flush()
    await bus.publish(db, BatchChanged(batch_id, "note_added", actor.id))
    await db.commit()
    return note


# ---- 照片佐證 ----
def _allowed_keys() -> set[str]:
    return set(get_settings().required_attachments) | set(get_extras().attachment_extra_keys)


def _read(att: BatchAttachment) -> AttachmentRead:
    store = extension_points.object_store
    item = AttachmentRead.model_validate(att)
    item.url = store.url(att.object_ref) if store is not None else None
    return item


@attachments_router.get("", response_model=list[AttachmentRead])
async def list_attachments(batch_id: int, actor: User = Depends(require_password_changed), db: AsyncSession = Depends(get_db)) -> list[AttachmentRead]:
    await get_visible_batch(db, batch_id, actor)
    return [_read(a) for a in await db.scalars(select(BatchAttachment).where(BatchAttachment.batch_id == batch_id).order_by(BatchAttachment.id))]


@attachments_router.post("/{key}", response_model=AttachmentRead)
async def upload_attachment(batch_id: int, key: str, file: UploadFile = File(...), actor: User = Depends(require_write_access), db: AsyncSession = Depends(get_db)) -> AttachmentRead:
    store = extension_points.object_store
    if store is None:
        raise HTTPException(501, "尚未設定物件儲存")
    await _writable_batch(db, batch_id, actor)
    limit = get_extras().attachment_max_bytes
    data = await file.read(limit + 1)
    try:
        content_type = validate_upload(key, _allowed_keys(), data, limit)
    except AttachmentError as exc:
        raise HTTPException(422, str(exc)) from exc
    filename = sanitize_filename(file.filename)
    ref = store.put(batch_id, filename, content_type, data)
    old = await db.scalar(select(BatchAttachment).where(BatchAttachment.batch_id == batch_id, BatchAttachment.attachment_key == key))
    old_ref = old.object_ref if old else None
    if old is None:
        old = BatchAttachment(batch_id=batch_id, attachment_key=key)
        db.add(old)
    old.object_ref, old.filename, old.content_type, old.size = ref, filename, content_type, len(data)
    old.uploaded_by, old.uploaded_at = actor.id, _now()
    try:
        await bus.publish(db, BatchChanged(batch_id, "attachment_uploaded", actor.id))
        await db.commit()
    except Exception:
        await db.rollback()
        store.delete(ref)  # 資料庫失敗時不留下孤兒物件
        raise
    if old_ref:
        store.delete(old_ref)
    return _read(old)


@attachments_router.delete("/{key}", status_code=204)
async def delete_attachment(batch_id: int, key: str, actor: User = Depends(require_write_access), db: AsyncSession = Depends(get_db)) -> Response:
    await _writable_batch(db, batch_id, actor)
    att = await db.scalar(select(BatchAttachment).where(BatchAttachment.batch_id == batch_id, BatchAttachment.attachment_key == key))
    if att is None:
        raise HTTPException(404, "附件不存在")
    ref = att.object_ref
    await db.delete(att)
    await bus.publish(db, BatchChanged(batch_id, "attachment_deleted", actor.id))
    await db.commit()
    if extension_points.object_store is not None:
        extension_points.object_store.delete(ref)
    return Response(status_code=204)
