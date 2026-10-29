"""What a deployed system supplies to the factory routes: a database, and a statement of what this deployment has.

Nothing here is read from a request. Anything the deployment cannot yet supply is reported as absent, which makes plans
that need it refuse to start work orders (see factory_core.plan.work_order_blockers), never pass them silently.
"""
from __future__ import annotations

from pathlib import Path
import re

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine

from app.factory_core.migrate import upgrade
from app.factory_core.sql_store import SqlStore
from app.factory_core.workorder import FactoryState

from .support import Environment

_POSTGRES = re.compile(r'^postgresql(?:\+(?:asyncpg|psycopg|psycopg2))?://')


def sync_database_url(url: str) -> str:
    """The backend's DATABASE_URL is an async asyncpg URL; the factory store is synchronous and uses psycopg."""
    match = _POSTGRES.match(url or '')
    if match is None:
        raise ValueError('the factory needs a PostgreSQL DATABASE_URL (postgresql://, postgresql+asyncpg://, postgresql+psycopg://)')
    return 'postgresql+psycopg://' + url[match.end():]


def make_engine(database_url: str) -> Engine:
    return create_engine(sync_database_url(database_url), pool_pre_ping=True)


def init_schema(engine: Engine) -> None:
    """First-install step: create or upgrade the factory tables and their append-only guards."""
    upgrade(engine)


def open_state(engine: Engine) -> FactoryState:
    return FactoryState(SqlStore(engine))


def deployed_environment(package_root: Path) -> Environment:
    """Active kits are the kits shipped in this system package (`<root>/kits/<kit>/kit.contract.json`).

    Forms come from the form registry in the database, not from here. No evaluator is provided yet, so a plan that needs one
    cannot create work orders on this deployment; that is the honest state until the evaluator sidecar exists.
    """
    kits = package_root / 'kits'
    active = frozenset(p.name for p in kits.iterdir() if (p / 'kit.contract.json').is_file()) if kits.is_dir() else frozenset()
    return Environment(active, None)
