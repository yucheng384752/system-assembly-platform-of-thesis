"""What a deployed system supplies to the factory routes: a database, and a statement of what this deployment has.

Nothing here is read from a request. Anything the deployment cannot yet supply is reported as absent, which makes plans
that need it refuse to start work orders (see factory_core.plan.work_order_blockers), never pass them silently.
"""
from __future__ import annotations

import logging
from pathlib import Path
import re
import shutil

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine

from factory_core.evaluator import Evaluator, EvaluatorError
from factory_core.migrate import upgrade
from factory_core.sql_store import SqlStore
from factory_core.workorder import FactoryState

from .support import Environment

log = logging.getLogger(__name__)
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


def active_kits(package_root: Path) -> frozenset[str]:
    """The kits shipped in this system package (`<root>/kits/<kit>/kit.contract.json`)."""
    kits = package_root / 'kits'
    return frozenset(p.name for p in kits.iterdir() if (p / 'kit.contract.json').is_file()) if kits.is_dir() else frozenset()


def evaluator_for(package_root: Path) -> Evaluator | None:
    """The evaluator sidecar of this package: the node binary on the path and `<root>/evaluator/evaluator.cjs`; None when either is missing."""
    bundle, node = package_root / 'evaluator' / 'evaluator.cjs', shutil.which('node')
    if node is None or not bundle.is_file():
        log.warning('no evaluator (node: %s, bundle: %s): plans with guards or judge nodes cannot create work orders', node, bundle.is_file())
        return None
    return Evaluator([node, str(bundle)])


def deployed_environment(package_root: Path, evaluator: Evaluator | None = None) -> Environment:
    """What this deployment has. Forms come from the form registry in the database, not from here.

    The evaluator's commit is what the running sidecar reports, asked on every call: an evaluator that is missing or has died and
    cannot restart gives None, so plans that need it are refused (never passed) until it is back.
    """
    commit = None
    if evaluator is not None:
        try:
            commit = evaluator.commit()
        except EvaluatorError as error:
            log.error('the evaluator is unavailable: %s', error)
    return Environment(active_kits(package_root), commit)
