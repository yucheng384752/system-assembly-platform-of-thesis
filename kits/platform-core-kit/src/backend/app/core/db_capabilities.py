from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession


async def list_forms(db: AsyncSession, tenant_id: Any | None = None, **_: Any) -> list[dict[str, Any]]:
    try:
        from app.models.station import Station, StationSchema
    except Exception as exc:  # pragma: no cover - optional kit source
        raise HTTPException(status_code=501, detail="forms DB capability is not installed") from exc

    stmt = select(Station).order_by(Station.sort_order, Station.code)
    if tenant_id is not None and hasattr(Station, "tenant_id"):
        stmt = stmt.where(Station.tenant_id == tenant_id)
    stations = (await db.execute(stmt)).scalars().all()
    result: list[dict[str, Any]] = []
    for station in stations:
        schema = (
            await db.execute(
                select(StationSchema)
                .where(StationSchema.station_id == station.id, StationSchema.is_active == True)
                .order_by(StationSchema.version.desc())
                .limit(1)
            )
        ).scalar_one_or_none()
        result.append(
            {
                "id": str(station.id),
                "code": station.code,
                "name": station.name,
                "sort_order": station.sort_order,
                "schema_version": schema.version if schema else None,
                "fields": schema.record_fields if schema else None,
            }
        )
    return result


async def resolve_table(db: AsyncSession, table_code: str | None = None, **_: Any) -> dict[str, Any] | None:
    if not table_code:
        raise HTTPException(status_code=422, detail="table_code is required")
    try:
        from app.models.core.schema_registry import SchemaVersion, TableRegistry
    except Exception as exc:  # pragma: no cover - optional kit source
        raise HTTPException(status_code=501, detail="table registry DB capability is not installed") from exc

    table = (
        await db.execute(select(TableRegistry).where(TableRegistry.table_code == table_code))
    ).scalar_one_or_none()
    if not table:
        return None
    schema = (
        await db.execute(
            select(SchemaVersion)
            .where(SchemaVersion.table_id == table.id)
            .order_by(SchemaVersion.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    return {
        "id": str(table.id),
        "table_code": table.table_code,
        "display_name": table.display_name,
        "schema": schema.schema_json if schema else None,
    }


async def search_records(
    db: AsyncSession,
    tenant_id: Any | None = None,
    station_id: str | None = None,
    limit: int = 50,
    date_from: str | None = None,
    date_to: str | None = None,
    **_: Any,
) -> list[dict[str, Any]]:
    try:
        from app.models.generic_record import GenericRecord
        from app.models.station import Station
        from app.models.core.schema_registry import TableRegistry
    except Exception as exc:  # pragma: no cover - optional kit source
        raise HTTPException(status_code=501, detail="generic record DB capability is not installed") from exc

    limit = int(limit)
    if not 1 <= limit <= 5000:
        raise HTTPException(status_code=422, detail="limit must be between 1 and 5000")

    # Domain-backed stations (registered in table_registry, e.g. daihui_*) store their
    # rows in a physical table, not generic_records — read from there instead. Without
    # this branch these forms always looked empty here regardless of how much data was
    # actually imported.
    table_code = None
    if station_id:
        station_code = (
            await db.execute(select(Station.code).where(Station.id == station_id))
        ).scalar_one_or_none()
        if station_code:
            table_code = (
                await db.execute(
                    select(TableRegistry.table_code).where(TableRegistry.table_code == station_code)
                )
            ).scalar_one_or_none()

    if table_code:
        from sqlalchemy import text as _text

        conditions = ['"_tenant_id" = :tid']
        params: dict[str, Any] = {"tid": str(tenant_id), "lim": limit + 1}
        if date_from:
            conditions.append('"_imported_at" >= :dfrom')
            params["dfrom"] = datetime.fromisoformat(date_from).replace(tzinfo=timezone.utc)
        if date_to:
            conditions.append('"_imported_at" < :dto')
            params["dto"] = datetime.fromisoformat(date_to).replace(tzinfo=timezone.utc) + timedelta(days=1)
        where_sql = " AND ".join(conditions)
        rows = (
            await db.execute(
                _text(
                    f'SELECT * FROM "{table_code}" WHERE {where_sql} '
                    f'ORDER BY "_imported_at" DESC LIMIT :lim'
                ),
                params,
            )
        ).mappings().all()
        if len(rows) > limit:
            raise HTTPException(status_code=422, detail="Too many records; narrow the date range")
        meta_cols = {"_tenant_id", "_import_job_id", "_row_index", "_imported_at"}
        result: list[dict[str, Any]] = []
        for row in rows:
            row = dict(row)
            imported_at = row.get("_imported_at")
            result.append(
                {
                    "id": f'{row.get("_import_job_id", "")}_{row.get("_row_index", "")}',
                    "tenant_id": str(row.get("_tenant_id") or ""),
                    "station_id": str(station_id),
                    "lot_no_raw": None,
                    "data": {k: v for k, v in row.items() if k not in meta_cols},
                    "created_at": imported_at.isoformat() if hasattr(imported_at, "isoformat") else (str(imported_at) if imported_at else None),
                }
            )
        return result

    stmt = select(GenericRecord).order_by(GenericRecord.created_at.desc())
    if tenant_id is not None:
        stmt = stmt.where(GenericRecord.tenant_id == tenant_id)
    if station_id:
        stmt = stmt.where(GenericRecord.station_id == station_id)
    if date_from:
        stmt = stmt.where(GenericRecord.created_at >= datetime.fromisoformat(date_from).replace(tzinfo=timezone.utc))
    if date_to:
        stmt = stmt.where(
            GenericRecord.created_at
            < datetime.fromisoformat(date_to).replace(tzinfo=timezone.utc) + timedelta(days=1)
        )
    records = (await db.execute(stmt.limit(limit + 1))).scalars().all()
    if len(records) > limit:
        raise HTTPException(status_code=422, detail="Too many records; narrow the date range")
    return [
        {
            "id": str(record.id),
            "tenant_id": str(record.tenant_id),
            "station_id": str(record.station_id),
            "lot_no_raw": record.lot_no_raw,
            "data": record.data,
            "created_at": record.created_at.isoformat() if record.created_at else None,
        }
        for record in records
    ]


async def validate_edit_reason(
    db: AsyncSession,
    tenant_id: Any | None = None,
    reason_id: Any | None = None,
    **_: Any,
) -> dict[str, Any]:
    if tenant_id is None or reason_id is None:
        raise HTTPException(status_code=422, detail="tenant_id and reason_id are required")
    try:
        from app.models.core.edit_reason import EditReason
    except Exception as exc:  # pragma: no cover - optional kit source
        raise HTTPException(status_code=501, detail="edit reason DB capability is not installed") from exc

    reason = (
        await db.execute(
            select(EditReason).where(
                EditReason.id == reason_id,
                EditReason.tenant_id == tenant_id,
                EditReason.is_active == True,
            )
        )
    ).scalar_one_or_none()
    if not reason:
        raise HTTPException(status_code=422, detail="reason_id must reference an active edit reason")
    return {"id": str(reason.id), "code": reason.code, "label": reason.label}


async def records_trend(
    db: AsyncSession,
    *,
    tenant_id: Any,
    station_code: str,
    date_from: str,
    date_to: str,
    **_: Any,
) -> list[dict[str, Any]]:
    try:
        from app.models.generic_record import GenericRecord
        from app.models.station import Station
        from app.models.core.schema_registry import TableRegistry
    except Exception as exc:  # pragma: no cover - optional kit source
        raise HTTPException(status_code=501, detail="record trend DB capability is not installed") from exc

    # Domain-backed stations (e.g. daihui_*) store rows in a physical table, not
    # generic_records — see search_records() above for the same distinction.
    is_domain = (
        await db.execute(select(TableRegistry.id).where(TableRegistry.table_code == station_code))
    ).scalar_one_or_none() is not None

    if is_domain:
        from sqlalchemy import text as _text

        rows = (
            await db.execute(
                _text(
                    f'SELECT date("_imported_at") AS bucket_date, count(*) AS cnt FROM "{station_code}" '
                    f'WHERE "_tenant_id" = :tid AND "_imported_at" >= :dfrom AND "_imported_at" < :dto '
                    f'GROUP BY date("_imported_at") ORDER BY date("_imported_at")'
                ),
                {
                    "tid": str(tenant_id),
                    "dfrom": datetime.fromisoformat(date_from).replace(tzinfo=timezone.utc),
                    "dto": datetime.fromisoformat(date_to).replace(tzinfo=timezone.utc) + timedelta(days=1),
                },
            )
        ).all()
        return [
            {"bucket_date": value.isoformat() if hasattr(value, "isoformat") else str(value), "count": count}
            for value, count in rows
        ]

    bucket_date = func.date(GenericRecord.created_at).label("bucket_date")
    rows = (
        await db.execute(
            select(bucket_date, func.count(GenericRecord.id))
            .join(Station, Station.id == GenericRecord.station_id)
            .where(
                GenericRecord.tenant_id == tenant_id,
                Station.code == station_code,
                GenericRecord.created_at >= datetime.fromisoformat(date_from).replace(tzinfo=timezone.utc),
                GenericRecord.created_at
                < datetime.fromisoformat(date_to).replace(tzinfo=timezone.utc) + timedelta(days=1),
            )
            .group_by(bucket_date)
            .order_by(bucket_date)
        )
    ).all()
    return [
        {"bucket_date": value.isoformat() if hasattr(value, "isoformat") else str(value), "count": count}
        for value, count in rows
    ]


def _import_job_dict(job: Any, filename: str | None, table_code: str | None) -> dict[str, Any]:
    total_rows = job.total_rows or 0
    error_count = job.error_count or 0
    return {
        "process_id": str(job.id),
        "filename": filename,
        "table_code": table_code,
        "status": job.status,
        "total_rows": total_rows,
        "valid_rows": max(total_rows - error_count, 0),
        "invalid_rows": error_count,
        "created_at": job.created_at.isoformat() if job.created_at else None,
        "actor": job.actor_label_snapshot,
    }


async def list_upload_jobs(
    db: AsyncSession,
    *,
    tenant_id: Any,
    date_from: str | None = None,
    date_to: str | None = None,
    status: str | None = None,
    page: int = 1,
    page_size: int = 50,
    **_: Any,
) -> dict[str, Any]:
    # This deployment's actual upload path is the v2 import pipeline (ImportJob /
    # POST /api/v2/import/jobs). The legacy UploadJob model belongs to the v1
    # /api/upload endpoint, which is disabled in multi-tenant mode (returns 410) — so
    # reading UploadJob here always returned an empty history regardless of how many
    # v2 imports had actually run. Read ImportJob instead; status values differ from
    # the old PENDING/VALIDATED/IMPORTED set (see ImportJobStatus), so an old-style
    # `status` filter value will simply match nothing rather than raise.
    try:
        from app.models.import_job import ImportFile, ImportJob
        from app.models.core.schema_registry import TableRegistry
    except Exception as exc:  # pragma: no cover - optional kit source
        raise HTTPException(status_code=501, detail="upload jobs DB capability is not installed") from exc

    page = max(int(page), 1)
    page_size = min(max(int(page_size), 1), 5000)
    filters = [ImportJob.tenant_id == tenant_id]
    if status:
        filters.append(ImportJob.status == status)
    if date_from:
        filters.append(ImportJob.created_at >= datetime.fromisoformat(date_from).replace(tzinfo=timezone.utc))
    if date_to:
        filters.append(
            ImportJob.created_at
            < datetime.fromisoformat(date_to).replace(tzinfo=timezone.utc) + timedelta(days=1)
        )
    total = (await db.execute(select(func.count(ImportJob.id)).where(*filters))).scalar() or 0
    jobs = (
        await db.execute(
            select(ImportJob)
            .where(*filters)
            .order_by(ImportJob.created_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    ).scalars().all()

    items: list[dict[str, Any]] = []
    for job in jobs:
        table_code = (
            await db.execute(select(TableRegistry.table_code).where(TableRegistry.id == job.table_id))
        ).scalar_one_or_none()
        filenames = (
            await db.execute(select(ImportFile.filename).where(ImportFile.job_id == job.id))
        ).scalars().all()
        filename = filenames[0] if len(filenames) == 1 else (", ".join(filenames) if filenames else None)
        items.append(_import_job_dict(job, filename, table_code))
    return {"total": total, "page": page, "page_size": page_size, "items": items}


DB_CAPABILITIES = {
    "db.forms.list": list_forms,
    "db.tables.resolve": resolve_table,
    "db.records.search": search_records,
    "db.records.trend": records_trend,
    "db.edit-reasons.validate": validate_edit_reason,
    "db.upload.jobs.list": list_upload_jobs,
}
