"""Preview-only compatibility boundaries; never imported by the original kits."""
import os

from fastapi import HTTPException
from sqlalchemy import Column, Table, select
from sqlalchemy.dialects.postgresql import UUID

from app.core.database import Base


def require_preview():
    if os.environ.get("COMPOSER_PREVIEW") != "1":
        raise RuntimeError("此入口僅能由預覽 docker compose 啟動")
    if os.environ.get("DATABASE_URL") != "postgresql+asyncpg://preview:preview-local-only@postgres:5432/preview":
        raise RuntimeError("預覽只允許 compose 專用 PostgreSQL")
    if os.environ.get("MOD_API_BASE_URL") != "http://127.0.0.1:8000/_preview/mod":
        raise RuntimeError("預覽訂閱只允許容器內假服務")
    if os.environ.get("PDF_SERVER_URL") or os.environ.get("MONITOR_SERVER_URL"):
        raise RuntimeError("預覽不允許外部 PDF 或監控服務")


# shortcut: only a nullable audit FK target, replace when real identity is approved.
Table("tenant_api_keys", Base.metadata, Column("id", UUID(as_uuid=True), primary_key=True))


def reject_table_code(code):
    if (code or "").strip().upper() in {"P1", "P2", "P3"}:
        raise HTTPException(501, "預覽不支援 P1/P2/P3 舊模型；等待使用者決定 T1")


async def reject_job(db, job_id, tenant_id=None):
    from app.models.core.schema_registry import TableRegistry
    from app.models.import_job import ImportJob

    statement = select(TableRegistry.table_code).join(
        ImportJob, ImportJob.table_id == TableRegistry.id
    ).where(ImportJob.id == job_id)
    if tenant_id is not None:
        statement = statement.where(ImportJob.tenant_id == tenant_id)
    reject_table_code((await db.execute(statement)).scalar_one_or_none())
