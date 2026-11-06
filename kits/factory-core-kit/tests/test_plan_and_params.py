"""factory-core-kit: which plans the factory accepts, and which parameter sets it allows.

The factory runs work from a plan it did not write, so a plan is accepted only if it is exactly what was signed off (its id is
the hash of its content), well formed, and coherent; a work order may be created only when everything the plan relies on is
present. A parameter set may change only what the plan declares tunable and only within the declared range. The fixture is a
copy of fixtures/executable-plan/valid.json so that the Kit's tests stand alone. No database is used.
"""
from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest

from app.factory_core.params import validate_content
from app.factory_core.plan import PlanRejected, plan_id_of, receive_plan, work_order_blockers

VALID = json.loads((Path(__file__).parent / "fixtures" / "valid-plan.json").read_text(encoding="utf-8"))


def plan():
    return copy.deepcopy(VALID)


def sealed(document):
    """The plan with its id recomputed, i.e. an intact plan whose content was changed on purpose."""
    document["planId"] = plan_id_of(document)
    return document


def codes(error):
    return [e["code"] for e in error.value.errors]


# ---- receiving a plan -------------------------------------------------------------------------------------------------

def test_an_intact_plan_is_accepted_and_keeps_its_id():
    received = receive_plan(plan())
    assert received.plan_id == VALID["planId"] == plan_id_of(VALID)
    assert received.executable is True and received.blockers == ()


def test_a_plan_can_be_received_as_text_too():
    assert receive_plan(json.dumps(VALID)).plan_id == VALID["planId"]


def test_a_plan_whose_content_was_changed_after_signing_is_rejected():
    tampered = plan()
    tampered["params"][0]["default"] = 999
    with pytest.raises(PlanRejected) as caught:
        receive_plan(tampered)
    assert "plan-id-mismatch" in codes(caught)


@pytest.mark.parametrize("text", ["not json", "[]", "42"])
def test_text_that_is_not_a_plan_object_is_rejected(text):
    with pytest.raises(PlanRejected) as caught:
        receive_plan(text)
    assert codes(caught) == ["broken-structure"]


def test_another_format_or_an_unsupported_version_is_refused_without_guessing():
    other = plan()
    other["format"] = "something-else"
    with pytest.raises(PlanRejected) as caught:
        receive_plan(other)
    assert codes(caught) == ["unknown-format"]
    future = plan()
    future["formatVersion"] = 2
    with pytest.raises(PlanRejected) as caught:
        receive_plan(future)
    assert codes(caught) == ["unknown-version"]


def test_every_missing_required_section_is_reported_at_once():
    broken = plan()
    del broken["flows"], broken["order"]
    with pytest.raises(PlanRejected) as caught:
        receive_plan(broken)
    assert sorted(e["path"] for e in caught.value.errors) == ["/flows", "/order"]


def test_a_flow_that_points_at_a_missing_port_is_rejected():
    broken = plan()
    broken["flows"][0]["to"]["port"] = "nowhere"
    with pytest.raises(PlanRejected) as caught:
        receive_plan(sealed(broken))
    assert "dangling-flow" in codes(caught)


def test_an_execution_order_that_runs_a_flow_backwards_is_rejected():
    broken = plan()
    broken["order"] = list(reversed(broken["order"]))
    with pytest.raises(PlanRejected) as caught:
        receive_plan(sealed(broken))
    assert "order-violation" in codes(caught)


def test_an_order_that_forgets_a_node_is_rejected():
    broken = plan()
    broken["order"] = broken["order"][:-1]
    with pytest.raises(PlanRejected) as caught:
        receive_plan(sealed(broken))
    assert "order-mismatch" in codes(caught)


def test_an_executable_node_must_say_who_runs_it_and_what_it_calls():
    broken = plan()
    broken["nodes"][0]["executor"] = "robot"
    with pytest.raises(PlanRejected):
        receive_plan(sealed(broken))
    broken = plan()
    del broken["nodes"][0]["binding"]
    with pytest.raises(PlanRejected):
        receive_plan(sealed(broken))


def test_a_node_that_cannot_run_must_explain_why_and_blocks_work_orders_but_not_viewing():
    blocked = plan()
    node = blocked["nodes"][1]
    node.update({"executable": False, "reason": "no kit provides this action"})
    for key in ("binding", "executor"):
        node.pop(key, None)
    received = receive_plan(sealed(blocked))
    assert received.executable is False
    assert received.blockers[0]["nodeId"] == node["nodeId"]
    problems = work_order_blockers(received, active_kits={"factory-core-kit"}, registered_forms=set(), evaluator_commit=None)
    assert "not-executable" in [p["code"] for p in problems]


def test_a_parameter_without_a_default_is_rejected():
    broken = plan()
    del broken["params"][0]["default"]
    with pytest.raises(PlanRejected) as caught:
        receive_plan(sealed(broken))
    assert "default" in str(caught.value) and "/params/0" in str(caught.value)


def test_the_plan_id_does_not_depend_on_the_id_field_itself():
    document = plan()
    document["planId"] = "anything"
    assert plan_id_of(document) == VALID["planId"]


# ---- when a work order may be created ----------------------------------------------------------------------------

def kits_of(document):
    return {n["binding"]["kitId"] for n in document["nodes"] if n.get("binding")}


def forms_of(document):
    return {(n["form"]["formId"], n["form"]["contentSha256"]) for n in document["nodes"] if n.get("form")}


def test_a_work_order_is_allowed_when_every_kit_form_and_the_evaluator_are_present():
    received = receive_plan(plan())
    commit = VALID["source"]["aovCoreCommit"]
    assert work_order_blockers(received, active_kits=kits_of(VALID), registered_forms=forms_of(VALID), evaluator_commit=commit) == []


def test_a_node_bound_to_a_kit_that_is_not_selected_blocks_the_work_order_and_names_the_kit():
    received = receive_plan(plan())
    missing = sorted(kits_of(VALID))[0]
    problems = work_order_blockers(received, active_kits=kits_of(VALID) - {missing}, registered_forms=forms_of(VALID), evaluator_commit=VALID["source"]["aovCoreCommit"])
    assert any(p["code"] == "kit-not-active" and missing in p["message"] for p in problems)


def test_a_form_that_was_never_uploaded_blocks_the_work_order():
    received = receive_plan(plan())
    problems = work_order_blockers(received, active_kits=kits_of(VALID), registered_forms=set(), evaluator_commit=VALID["source"]["aovCoreCommit"])
    assert "form-unavailable" in [p["code"] for p in problems]


def test_a_plan_with_guards_needs_the_evaluator_version_it_was_written_against():
    received = receive_plan(plan())
    assert received.needs_evaluator is True
    for commit in (None, "0" * 40):
        problems = work_order_blockers(received, active_kits=kits_of(VALID), registered_forms=forms_of(VALID), evaluator_commit=commit)
        assert "evaluator-mismatch" in [p["code"] for p in problems]


# ---- parameter sets -----------------------------------------------------------------------------------------------

def check(values=None, tables=None, alarms=None):
    return validate_content(VALID, values if values is not None else {}, tables if tables is not None else {}, alarms if alarms is not None else {})


def test_an_empty_set_and_the_plans_own_defaults_are_valid():
    assert check() == []
    assert check(values={"mix_minutes": 10, "temp_min": 15}) == []


@pytest.mark.parametrize("value,code", [(4, "range"), (21, "range"), ("10", "type"), (True, "type"), (float("inf"), "type")])
def test_a_value_outside_the_declared_range_or_of_the_wrong_type_is_refused(value, code):
    assert [e["code"] for e in check(values={"mix_minutes": value})] == [code]


def test_the_range_limits_themselves_are_allowed():
    assert check(values={"mix_minutes": 5}) == [] and check(values={"mix_minutes": 20}) == []


def test_a_parameter_the_plan_fixed_cannot_be_changed_and_an_unknown_one_is_refused():
    assert [e["code"] for e in check(values={"plant_name": "other"})] == ["not-tunable"]
    assert [e["code"] for e in check(values={"nope": 1})] == ["unknown-param"]


def test_every_problem_is_reported_not_just_the_first():
    errors = check(values={"mix_minutes": 99, "temp_min": "x", "nope": 1})
    assert sorted(e["code"] for e in errors) == ["range", "type", "unknown-param"]


def test_table_rows_are_checked_for_required_columns_types_and_unknown_columns():
    good = {"dough_checks": [{"item": "core_temp", "limit": 25}]}
    assert check(tables=good) == []
    assert [e["code"] for e in check(tables={"dough_checks": [{"item": "x"}]})] == ["required"]
    assert [e["code"] for e in check(tables={"dough_checks": [{"item": "x", "limit": "hot"}]})] == ["type"]
    assert [e["code"] for e in check(tables={"dough_checks": [{"item": "x", "limit": 1, "extra": 2}]})] == ["unknown-column"]
    assert [e["code"] for e in check(tables={"dough_checks": ["not a row"]})] == ["type"]
    assert [e["code"] for e in check(tables={"nope": []})] == ["unknown-table"]


def test_alarm_repeat_intervals_must_be_positive_minutes_for_a_rule_that_exists():
    assert check(alarms={"temp-out-of-range": 30}) == []
    assert [e["code"] for e in check(alarms={"temp-out-of-range": 0})] == ["range"]
    assert [e["code"] for e in check(alarms={"temp-out-of-range": True})] == ["range"]
    assert [e["code"] for e in check(alarms={"nope": 5})] == ["unknown-rule"]


def test_a_set_that_is_not_made_of_objects_is_refused_instead_of_crashing():
    errors = validate_content(VALID, [], "x", 3)
    assert sorted(e["path"] for e in errors) == ["/alarmIntervals", "/tables", "/values"]
