"""Plans, parameter sets and decisions, work orders, alarms, with the append-only guards.

Revision ID: 0001
Revises:
"""
from alembic import op
import sqlalchemy as sa

from factory_core.sql_schema import install_guards

revision = '0001'
down_revision = None


def upgrade() -> None:
    op.create_table(
        'plans',
        sa.Column('plan_id', sa.String(64), primary_key=True),
        sa.Column('document', sa.Text, nullable=False),
        sa.CheckConstraint('length(plan_id) = 64', name='plans_id_is_sha256'),
    )
    op.create_table(
        'parameter_sets',
        sa.Column('plan_id', sa.String(64), sa.ForeignKey('plans.plan_id'), nullable=False),
        sa.Column('set_version', sa.Integer, nullable=False),
        sa.Column('content_sha256', sa.String(64), nullable=False),
        sa.Column('values_json', sa.Text, nullable=False),
        sa.Column('tables_json', sa.Text, nullable=False),
        sa.Column('alarm_intervals_json', sa.Text, nullable=False),
        sa.Column('source', sa.String(16), nullable=False),
        sa.Column('source_sha256', sa.String(64)),
        sa.Column('proposed_by', sa.Text, nullable=False),
        sa.Column('proposed_at', sa.String(40), nullable=False),
        sa.Column('reason', sa.Text, nullable=False),
        sa.PrimaryKeyConstraint('plan_id', 'set_version'),
        sa.CheckConstraint('set_version >= 1', name='parameter_sets_version_positive'),
        sa.CheckConstraint("source IN ('manual', 'upload')", name='parameter_sets_source'),
    )
    op.create_table(
        'parameter_decisions',
        sa.Column('plan_id', sa.String(64), nullable=False),
        sa.Column('set_version', sa.Integer, nullable=False),
        sa.Column('status', sa.String(16), nullable=False),
        sa.Column('decided_by', sa.Text, nullable=False),
        sa.Column('decided_at', sa.String(40), nullable=False),
        sa.Column('note', sa.Text, nullable=False),
        sa.PrimaryKeyConstraint('plan_id', 'set_version'),
        sa.ForeignKeyConstraint(['plan_id', 'set_version'], ['parameter_sets.plan_id', 'parameter_sets.set_version']),
        sa.CheckConstraint("status IN ('approved', 'rejected')", name='parameter_decisions_status'),
    )
    op.create_table(
        'work_orders',
        sa.Column('order_id', sa.String(200), primary_key=True),
        sa.Column('plan_id', sa.String(64), sa.ForeignKey('plans.plan_id'), nullable=False),
        sa.Column('created_by', sa.Text, nullable=False),
        sa.Column('created_at', sa.String(40), nullable=False),
        sa.Column('started_at', sa.String(40)),
        sa.Column('set_version', sa.Integer),
        sa.Column('using_defaults', sa.Boolean, nullable=False, server_default='0'),
        sa.ForeignKeyConstraint(['plan_id', 'set_version'], ['parameter_sets.plan_id', 'parameter_sets.set_version']),
        sa.CheckConstraint('started_at IS NOT NULL OR (set_version IS NULL AND using_defaults = false)', name='work_orders_pin_only_when_started'),
    )
    op.create_table(
        'alarms',
        sa.Column('alarm_id', sa.String(600), primary_key=True),
        sa.Column('order_id', sa.String(200), sa.ForeignKey('work_orders.order_id'), nullable=False),
        sa.Column('rule_id', sa.String(200), nullable=False),
        sa.Column('node_id', sa.String(400), nullable=False),
        sa.Column('episode', sa.Integer, nullable=False),
        sa.Column('raised_at', sa.String(40), nullable=False),
        sa.Column('detail', sa.Text, nullable=False),
        sa.UniqueConstraint('order_id', 'rule_id', 'episode', name='alarms_one_per_episode'),
        sa.CheckConstraint('episode >= 1', name='alarms_episode_positive'),
    )
    op.create_table(
        'alarm_acks',
        sa.Column('alarm_id', sa.String(600), sa.ForeignKey('alarms.alarm_id'), primary_key=True),
        sa.Column('acknowledged_by', sa.Text, nullable=False),
        sa.Column('role', sa.String(16), nullable=False),
        sa.Column('acknowledged_at', sa.String(40), nullable=False),
        sa.Column('note', sa.Text, nullable=False),
        sa.CheckConstraint("role IN ('manager', 'admin')", name='alarm_acks_role'),
    )
    op.create_table(
        'alarm_notices',
        sa.Column('alarm_id', sa.String(600), sa.ForeignKey('alarms.alarm_id'), nullable=False),
        sa.Column('seq', sa.Integer, nullable=False),
        sa.Column('sent_at', sa.String(40), nullable=False),
        sa.PrimaryKeyConstraint('alarm_id', 'seq'),
    )
    # Guards are part of this revision. A later change to them needs its own revision with its own SQL.
    install_guards(op.get_bind(), tables=('plans', 'parameter_sets', 'parameter_decisions', 'alarms', 'alarm_acks', 'alarm_notices'))
