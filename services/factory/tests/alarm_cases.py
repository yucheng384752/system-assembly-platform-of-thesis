"""Alarm behavior, written once as a mixin so the memory store and the SQL stores are held to the same rules."""
from fixtures import EVALUATOR, KITS, NOW, load, register_forms
from factory_core.alarms import ACK_ROLES, DEFAULT_REPEAT_MINUTES, AlarmError, AlarmService, parse_time
from factory_core.workorder import FactoryState

RULE = 'temp-out-of-range'
NODE = 'qc'


def at(minutes: int) -> str:
    return f'2026-10-28T{12 + minutes // 60:02d}:{minutes % 60:02d}:00Z'


class AlarmCases:
    """Mixed into a TestCase that provides make_store()."""

    def setUp(self):
        self.state = FactoryState(self.make_store())
        self.plan_id = self.state.store_plan(load('valid.json')).plan_id
        register_forms(self.state)
        self.alarms = AlarmService(self.state)

    def start(self, order_id='wo-1', set_values=None, intervals=None):
        if set_values is not None or intervals is not None:
            record = self.state.params.propose(self.plan_id, values=set_values or {}, alarm_intervals=intervals, proposed_by='alice', reason='r', now=NOW)
            self.state.params.decide(self.plan_id, record.set_version, approve=True, by='bob', role='manager', now=NOW)
        self.state.create_order(order_id, self.plan_id, created_by='alice', now=NOW, active_kits=KITS, evaluator_commit=EVALUATOR)
        self.state.start_order(order_id, now=at(0))
        return order_id

    def failed(self, call, code):
        with self.assertRaises(AlarmError) as caught:
            call()
        self.assertIn(code, {e['code'] for e in caught.exception.errors})

    def test_an_alarm_holds_its_node_until_someone_acknowledges(self):
        order = self.start()
        self.assertFalse(self.alarms.is_held(order, NODE))
        alarm = self.alarms.raise_alarm(order, RULE, now=at(1), detail='temperature 31')
        self.assertEqual((alarm.node_id, self.alarms.status(alarm.alarm_id)), (NODE, 'open'))
        self.assertTrue(self.alarms.is_held(order, NODE))
        self.assertEqual(self.alarms.held_nodes(order), {NODE})
        self.alarms.acknowledge(alarm.alarm_id, by='bob', role='manager', now=at(5), note='checked the chiller')
        self.assertFalse(self.alarms.is_held(order, NODE))
        self.assertEqual(self.alarms.status(alarm.alarm_id), 'acknowledged')

    def test_raising_again_while_open_returns_the_same_alarm(self):
        order = self.start()
        first = self.alarms.raise_alarm(order, RULE, now=at(1))
        self.assertEqual(self.alarms.raise_alarm(order, RULE, now=at(2)), first)
        self.assertEqual(len(self.alarms.open_alarms(order)), 1)

    def test_after_acknowledgement_a_new_alarm_is_a_new_episode_and_holds_again(self):
        order = self.start()
        first = self.alarms.raise_alarm(order, RULE, now=at(1))
        self.alarms.acknowledge(first.alarm_id, by='bob', role='manager', now=at(2))
        second = self.alarms.raise_alarm(order, RULE, now=at(3))
        self.assertEqual((first.episode, second.episode), (1, 2))
        self.assertNotEqual(first.alarm_id, second.alarm_id)
        self.assertTrue(self.alarms.is_held(order, NODE))
        self.assertEqual(self.alarms.status(first.alarm_id), 'acknowledged')

    def test_only_manager_or_admin_may_acknowledge_and_a_refusal_changes_nothing(self):
        order = self.start()
        alarm = self.alarms.raise_alarm(order, RULE, now=at(1))
        for role in ('operator', 'audit', ''):
            self.failed(lambda role=role: self.alarms.acknowledge(alarm.alarm_id, by='carol', role=role, now=at(2)), 'role')
        self.assertTrue(self.alarms.is_held(order, NODE))
        self.assertEqual(ACK_ROLES, ('manager', 'admin'))
        self.alarms.acknowledge(alarm.alarm_id, by='root', role='admin', now=at(3))

    def test_an_alarm_is_acknowledged_once(self):
        order = self.start()
        alarm = self.alarms.raise_alarm(order, RULE, now=at(1))
        self.alarms.acknowledge(alarm.alarm_id, by='bob', role='manager', now=at(2))
        self.failed(lambda: self.alarms.acknowledge(alarm.alarm_id, by='carol', role='manager', now=at(3)), 'already-acknowledged')

    def test_alarms_need_a_started_order_and_a_rule_the_plan_declares(self):
        self.failed(lambda: self.alarms.raise_alarm('ghost', RULE, now=at(1)), 'unknown-order')
        self.state.create_order('wo-2', self.plan_id, created_by='alice', now=NOW, active_kits=KITS, evaluator_commit=EVALUATOR)
        self.failed(lambda: self.alarms.raise_alarm('wo-2', RULE, now=at(1)), 'not-started')
        order = self.start()
        self.failed(lambda: self.alarms.raise_alarm(order, 'no-such-rule', now=at(1)), 'unknown-rule')
        self.failed(lambda: self.alarms.acknowledge('nope', by='bob', role='manager', now=at(1)), 'unknown-alarm')
        self.assertEqual(self.alarms.open_alarms(), [])

    def test_the_hold_is_per_order(self):
        first, second = self.start('wo-1'), self.start('wo-2')
        self.alarms.raise_alarm(first, RULE, now=at(1))
        self.assertTrue(self.alarms.is_held(first, NODE))
        self.assertFalse(self.alarms.is_held(second, NODE))

    def test_reminders_repeat_at_the_default_interval_and_only_while_open(self):
        order = self.start()
        alarm = self.alarms.raise_alarm(order, RULE, now=at(0))
        self.assertEqual(self.alarms.collect_due(at(DEFAULT_REPEAT_MINUTES - 1)), [])
        self.assertEqual(self.alarms.collect_due(at(DEFAULT_REPEAT_MINUTES)), [alarm])
        self.assertEqual(self.alarms.collect_due(at(DEFAULT_REPEAT_MINUTES + 1)), [])  # already reminded for this interval
        self.assertEqual(self.alarms.collect_due(at(2 * DEFAULT_REPEAT_MINUTES)), [alarm])
        self.alarms.acknowledge(alarm.alarm_id, by='bob', role='manager', now=at(2 * DEFAULT_REPEAT_MINUTES))
        self.assertEqual(self.alarms.collect_due(at(10 * DEFAULT_REPEAT_MINUTES)), [])
        self.assertEqual(len(self.state.store.notices(alarm.alarm_id)), 3)

    def test_the_interval_comes_from_the_parameter_set_the_order_was_pinned_to(self):
        order = self.start(intervals={RULE: 10})
        self.assertEqual(self.alarms.repeat_minutes(order, RULE), 10)
        alarm = self.alarms.raise_alarm(order, RULE, now=at(0))
        self.assertEqual(self.alarms.collect_due(at(9)), [])
        self.assertEqual(self.alarms.collect_due(at(10)), [alarm])

    def test_a_set_approved_after_start_does_not_change_the_interval_of_a_running_order(self):
        order = self.start(intervals={RULE: 10})
        record = self.state.params.propose(self.plan_id, values={}, alarm_intervals={RULE: 2}, proposed_by='alice', reason='r', now=NOW)
        self.state.params.decide(self.plan_id, record.set_version, approve=True, by='bob', role='manager', now=NOW)
        self.assertEqual(self.alarms.repeat_minutes(order, RULE), 10)
        later = self.start('wo-late')
        self.assertEqual(self.alarms.repeat_minutes(later, RULE), 2)

    def test_a_set_without_an_interval_for_the_rule_falls_back_to_the_default(self):
        order = self.start(set_values={'mix_minutes': 12})
        self.assertEqual(self.alarms.repeat_minutes(order, RULE), DEFAULT_REPEAT_MINUTES)

    def test_times_without_a_zone_are_refused_rather_than_guessed(self):
        order = self.start()
        with self.assertRaises(ValueError):
            self.alarms.raise_alarm(order, RULE, now='2026-10-28T12:00:00')
        self.assertEqual(parse_time('2026-10-28T12:00:00Z').utcoffset().total_seconds(), 0)
