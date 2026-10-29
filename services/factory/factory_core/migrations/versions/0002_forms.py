"""The form registry: form definitions addressed by their content hash, append-only.

Revision ID: 0002
Revises: 0001
"""
from alembic import op
import sqlalchemy as sa

from factory_core.sql_schema import install_guards

revision = '0002'
down_revision = '0001'


def upgrade() -> None:
    op.create_table(
        'forms',
        sa.Column('content_sha256', sa.String(64), primary_key=True),
        sa.Column('form_id', sa.String(200), nullable=False),
        sa.Column('definition', sa.Text, nullable=False),
        sa.Column('uploaded_by', sa.Text, nullable=False),
        sa.Column('uploaded_at', sa.String(40), nullable=False),
        sa.CheckConstraint('length(content_sha256) = 64', name='forms_hash_is_sha256'),
    )
    install_guards(op.get_bind(), tables=('forms',), shared=False)
