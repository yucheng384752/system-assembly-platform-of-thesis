"""import-pipeline-kit: how repeated and partial uploads are merged, and when a trace chain counts as complete.

Two business rules matter here. The same row uploaded twice must be counted once, and two rows for the same lot that differ
only in blanks must merge into one more complete row (a real disagreement is counted, never silently overwritten). And a
trace chain is complete only when the required first step is done; the fingerprints that detect changed CSV layouts must not
depend on column order. No database is used.
"""
from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest

from app.services import dataflow_hash as flow_hash
from app.services.dataflow_orchestrator import DataflowOrchestrator, get_step_definition
from app.services.import_v2 import ImportService


def importer():
    return ImportService(None)


# ---- fingerprints -------------------------------------------------------------------------------------------------

def test_schema_fingerprints_do_not_change_when_the_csv_exports_its_columns_in_another_order():
    a = flow_hash.compute_schema_fingerprints(["批號", "數量", "總重量"], ["str", "int", "float"])
    b = flow_hash.compute_schema_fingerprints(["總重量", "批號", "數量"], ["float", "str", "int"])
    assert a == b


def test_a_changed_column_type_changes_only_the_exact_fingerprint():
    a = flow_hash.compute_schema_fingerprints(["批號"], ["int"])
    b = flow_hash.compute_schema_fingerprints(["批號"], ["str"])
    assert a["col_set_hash"] == b["col_set_hash"]
    assert a["schema_hash"] != b["schema_hash"]


def test_a_renamed_column_changes_both_fingerprints():
    a = flow_hash.compute_schema_fingerprints(["批號"], ["str"])
    b = flow_hash.compute_schema_fingerprints(["批次"], ["str"])
    assert a["col_set_hash"] != b["col_set_hash"] and a["schema_hash"] != b["schema_hash"]


def test_step_hash_ignores_row_order_and_row_hash_treats_missing_as_empty():
    assert flow_hash.compute_step_hash(["b", "a", "c"]) == flow_hash.compute_step_hash(["c", "a", "b"])
    assert flow_hash.compute_row_hash(["x", None]) == flow_hash.compute_row_hash(["x", ""])
    assert flow_hash.compute_row_hash(["x", "y"]) != flow_hash.compute_row_hash(["y", "x"])


def test_chain_hash_follows_step_order_skips_steps_not_yet_uploaded_and_is_empty_for_no_steps():
    step = lambda order, value: SimpleNamespace(step_order=order, step_hash=value)  # noqa: E731
    assert flow_hash.compute_chain_hash([step(2, "p001"), step(5, "e001")]) == flow_hash.compute_chain_hash([step(5, "e001"), step(2, "p001")])
    assert flow_hash.compute_chain_hash([step(1, "a"), step(2, None)]) == flow_hash.compute_chain_hash([step(1, "a")])
    assert flow_hash.compute_chain_hash([step(1, None)]) is None
    assert flow_hash.compute_chain_hash([]) is None


# ---- trace chain --------------------------------------------------------------------------------------------------

def test_the_first_step_is_the_required_anchor_and_unknown_steps_are_skipped():
    entry = get_step_definition("daihui_entry")
    assert entry.is_anchor and entry.required and entry.step_order == 1
    assert get_step_definition("P1") is None


def chain_of(*completed):
    steps = [SimpleNamespace(step_name=name, status="completed", step_order=i, step_hash=f"h{i}") for i, name in enumerate(completed, 1)]
    return SimpleNamespace(steps=steps, chain_hash=None, status="partial"), SimpleNamespace(status="partial", completed_at=None)


def test_a_chain_is_complete_only_when_the_required_step_is_done():
    orchestrator = DataflowOrchestrator(None)
    chain, run = chain_of("daihui_entry", "daihui_inspection")
    asyncio.run(orchestrator._recompute_and_status(chain, run))
    assert chain.status == "completed" and run.status == "completed" and run.completed_at is not None
    assert chain.chain_hash is not None

    chain, run = chain_of("daihui_inspection", "daihui_material")
    asyncio.run(orchestrator._recompute_and_status(chain, run))
    assert chain.status == "partial" and run.status == "partial" and run.completed_at is None


# ---- merging and de-duplicating uploaded rows ------------------------------------------------------------------

@pytest.mark.parametrize("raw,expected", [("2507173_02", "2507173_02"), ("2507173-2", "2507173_02"), ("2507173_02_17", "2507173_02"),
                                           ("12345_02", None), ("", None), (None, None), ("abc", None)])
def test_lot_numbers_are_reduced_to_seven_digits_and_two_digits_or_rejected(raw, expected):
    assert importer()._canonicalize_lot_no_raw(raw) == expected


@pytest.mark.parametrize("lot,winder,expected", [("2507173", 3, "2507173_03"), ("2507173", "12", "2507173_12"), ("2507173", 0, None),
                                                  ("2507173", -1, None), ("2507173", "x", None), (None, 3, None), ("2507173", None, None), ("  ", 3, None)])
def test_a_p2_trace_lot_needs_a_lot_and_a_positive_winder_number(lot, winder, expected):
    assert importer()._compose_p2_trace_lot_no(lot, winder) == expected


def test_the_same_row_uploaded_twice_is_counted_once_even_with_extra_spaces_or_another_key_order():
    rows = [{"lot_no": "2507173_02", "qty": "5"}, {"qty": " 5 ", "lot_no": "2507173_02 "}, {"lot_no": "2507173_02", "qty": "6"}]
    assert importer()._dedupe_rows_exact(rows) == [rows[0], rows[2]]


def test_rows_that_are_not_rows_are_dropped_instead_of_failing_the_import():
    assert importer()._dedupe_rows_exact([None, "x", {"a": "1"}]) == [{"a": "1"}]
    assert importer()._dedupe_rows_exact(None) == []


def test_blank_rows_are_recognised_and_completeness_counts_only_filled_fields():
    s = importer()
    assert s._is_blank_row_dict({"a": "", "b": None, "c": "  "}) is True
    assert s._is_blank_row_dict(None) is True
    assert s._is_blank_row_dict({"a": "0"}) is False
    assert s._row_completeness_score({"a": "1", "b": "", "c": None, "d": "x"}) == 2


def test_two_rows_for_the_same_lot_merge_into_the_most_complete_one_and_fill_the_blanks():
    merged, conflicts = importer()._merge_rows_prefer_complete([{"lot": "L1", "qty": "", "note": "a"}, {"lot": "L1", "qty": "9", "note": "a", "line": "2"}])
    assert merged == {"lot": "L1", "qty": "9", "note": "a", "line": "2"}
    assert conflicts == 0


def test_a_real_disagreement_keeps_the_more_complete_row_and_is_counted_not_overwritten():
    merged, conflicts = importer()._merge_rows_prefer_complete([{"lot": "L1", "qty": "5", "note": "a"}, {"lot": "L1", "qty": "6", "note": ""}])
    assert merged["qty"] == "5"
    assert conflicts == 1


def test_nothing_to_merge_gives_nothing():
    assert importer()._merge_rows_prefer_complete([]) == (None, 0)
    assert importer()._merge_rows_prefer_complete([None, "x"]) == (None, 0)


def test_the_lot_number_is_taken_from_the_first_known_lot_column_that_has_a_value():
    s = importer()
    assert s._extract_lot_no_from_row_dict({"lot_no": " 2507173_02 "}) == "2507173_02"
    assert s._extract_lot_no_from_row_dict({"lot_no": "", "qty": "1"}) is None
    assert s._extract_lot_no_from_row_dict({}) is None
    assert s._extract_lot_no_from_row_dict(None) is None
