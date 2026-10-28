"""Run the Alembic migrations against an engine (service start-up, tests). Deployments may also use the alembic CLI."""
from __future__ import annotations

from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy.engine import Engine

MIGRATIONS = Path(__file__).resolve().parents[1] / 'migrations'


def upgrade(engine: Engine, revision: str = 'head') -> None:
    config = Config()
    config.set_main_option('script_location', str(MIGRATIONS))
    with engine.begin() as connection:
        config.attributes['connection'] = connection
        command.upgrade(config, revision)
