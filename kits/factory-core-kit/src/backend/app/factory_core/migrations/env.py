"""Alembic environment: migrations run on a connection handed in by factory_core.migrate or built from the CLI url."""
from alembic import context
from sqlalchemy import create_engine

from app.factory_core.sql_schema import metadata

connection = context.config.attributes.get('connection')
if connection is None:
    connection = create_engine(context.config.get_main_option('sqlalchemy.url')).connect()
context.configure(connection=connection, target_metadata=metadata, transactional_ddl=True)
with context.begin_transaction():
    context.run_migrations()
