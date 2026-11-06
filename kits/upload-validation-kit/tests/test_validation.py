"""upload-validation-kit: which uploaded rows are accepted.

A lot number is how every later record is traced, so a row with a missing or malformed lot number must be reported by row
and column, and a suffix such as the winder number must not make a good lot number fail. These tests also guard the rule
that one upload's errors never leak into the next upload (the service used to be a shared object). No database is used.
"""
from __future__ import annotations

from datetime import datetime

import pandas as pd
import pytest

from app.services.validation import FileValidationService, ValidationError, file_validation_service


def service():
    return FileValidationService()


@pytest.mark.parametrize("name,ok", [("a.csv", True), ("A.CSV", True), ("b.xlsx", True), ("c.xls", True),
                                      ("d.txt", False), ("e.exe", False), ("csv", False), ("", False)])
def test_only_csv_and_excel_files_are_accepted(name, ok):
    assert service().validate_file_format(name) is ok


@pytest.mark.parametrize("raw,expected", [
    ("2507173_02", "2507173_02"),
    ("2507173_02_17", "2507173_02"),        # the winder suffix is dropped
    ("2507173-2-17", "2507173_02"),         # a dash and a one-digit machine number are normalized
    ("2507173_2", "2507173_02"),
    ("  2507173_02  ", "2507173_02"),
    ("abc", "abc"),                          # not a lot number: returned as is so the validation reports it
])
def test_lot_numbers_are_normalized_to_seven_digits_and_two_digits(raw, expected):
    assert service().normalize_lot_no(raw) == expected


def test_a_missing_lot_number_normalizes_to_empty_not_to_the_text_nan():
    assert service().normalize_lot_no(None) == ""
    assert service().normalize_lot_no(float("nan")) == ""


@pytest.mark.parametrize("value", ["2507173_02", "2507173_02_17", "2507173-2"])
def test_good_lot_numbers_pass_without_errors(value):
    s = service()
    assert s.validate_lot_no(value, 0) is True
    assert s.errors == []


@pytest.mark.parametrize("value,code", [(None, "REQUIRED_FIELD"), ("", "REQUIRED_FIELD"), ("   ", "REQUIRED_FIELD"),
                                         ("12345_02", "INVALID_FORMAT"), ("ABCDEFG_02", "INVALID_FORMAT")])
def test_bad_lot_numbers_are_reported_with_the_row_and_column(value, code):
    s = service()
    assert s.validate_lot_no(value, 4) is False
    assert s.errors[0]["row_index"] == 4 and s.errors[0]["field"] == "lot_no" and s.errors[0]["error_code"] == code


def test_the_lot_number_comes_from_the_p3_number_column_for_old_p3_files():
    assert service().extract_lot_no_from_p3_field("2411012_04_31_302") == "2411012_04"
    assert service().extract_lot_no_from_p3_field("garbage") == ""
    assert service().extract_lot_no_from_p3_field(None) == ""


@pytest.mark.parametrize("value", ["10", "10.0", 0, 7.0])
def test_quantities_that_are_whole_numbers_pass_even_when_written_with_a_decimal_point(value):
    assert service().validate_quantity(value, 0) is True


@pytest.mark.parametrize("value,code", [("abc", "INVALID_FORMAT"), (-1, "INVALID_RANGE"), (None, "REQUIRED_FIELD")])
def test_bad_quantities_are_reported(value, code):
    s = service()
    assert s.validate_quantity(value, 2) is False
    assert s.errors[0]["error_code"] == code


def test_production_dates_must_be_year_month_day_unless_already_a_date():
    s = service()
    assert s.validate_production_date("2026-11-06", 0) is True
    assert s.validate_production_date(datetime(2026, 11, 6), 0) is True
    assert s.validate_production_date(pd.Timestamp("2026-11-06"), 0) is True
    assert s.errors == []
    assert s.validate_production_date("06/11/2026", 1) is False
    assert s.errors[-1]["error_code"] == "INVALID_FORMAT"


def test_product_names_are_required_and_capped_at_100_characters():
    s = service()
    assert s.validate_product_name("膠膜", 0) is True
    assert s.validate_product_name("", 1) is False
    assert s.validate_product_name("x" * 101, 2) is False
    assert [e["error_code"] for e in s.errors] == ["REQUIRED_FIELD", "TOO_LONG"]


@pytest.mark.parametrize("lot,expected", [("2507173_02_17", 17), ("2507173_02_5", 5), ("2507173_02", None), ("2507173_02_x", None), ("", None)])
def test_the_source_winder_is_the_third_part_of_a_p3_lot_number(lot, expected):
    assert service().extract_source_winder(lot) == expected


def test_material_and_machine_are_optional_but_must_be_valid_when_given():
    s = service()
    assert s.validate_material_code(None, 0) is True
    assert s.validate_slitting_machine_number(None, 0) is True
    assert s.validate_material_code("NOT-A-MATERIAL", 1) is False
    assert s.validate_slitting_machine_number("abc", 2) is False
    assert [e["field"] for e in s.errors] == ["material_code", "slitting_machine_number"]


def csv(text):
    return text.encode("utf-8-sig")


def test_a_clean_file_reports_every_row_valid_and_blank_trailing_rows_do_not_count():
    result = service().validate_file(csv("lot_no,qty\n2507173_02,5\n2507174_01,6\n,\n   ,   \n"), "p1_data.csv")
    assert (result["total_rows"], result["valid_rows"], result["invalid_rows"]) == (2, 2, 0)
    assert result["errors"] == []


def test_a_file_with_one_bad_lot_number_reports_that_row_and_keeps_the_others_valid():
    result = service().validate_file(csv("lot_no,qty\n2507173_02,5\nBAD,6\n2507175_03,7\n"), "p1_data.csv")
    assert (result["total_rows"], result["valid_rows"], result["invalid_rows"]) == (3, 2, 1)
    assert result["errors"][0]["row_index"] == 1 and result["errors"][0]["error_code"] == "INVALID_FORMAT"


def test_a_p1_file_without_a_lot_column_takes_the_lot_number_from_the_file_name():
    result = service().validate_file(csv("qty\n5\n6\n"), "P1_2507173_02.csv")
    assert result["invalid_rows"] == 0


def test_a_p1_file_with_no_lot_number_anywhere_fails_every_row():
    result = service().validate_file(csv("qty\n5\n6\n"), "report.csv")
    assert result["invalid_rows"] == 2 and result["errors"][0]["error_code"] == "REQUIRED_FIELD"


def test_the_file_type_is_detected_from_the_name():
    assert service().validate_file(csv("lot no\n2507173_02\n"), "P3_x.csv")["detected_data_type"] == "P3"
    assert service().validate_file(csv("lot_no\n2507173_02\n"), "P2_x.csv")["detected_data_type"] == "P2"


def test_unsupported_and_empty_files_are_refused_with_a_message():
    with pytest.raises(ValidationError, match="不支援"):
        service().validate_file(b"x", "notes.txt")
    with pytest.raises(ValidationError, match="內容為空"):
        service().validate_file(csv("lot_no,qty\n,\n"), "p1.csv")


def test_one_upload_never_sees_the_errors_of_the_previous_upload():
    bad = file_validation_service.validate_file(csv("lot_no\nBAD\n"), "p1.csv")
    good = file_validation_service.validate_file(csv("lot_no\n2507173_02\n"), "p1.csv")
    assert bad["invalid_rows"] == 1
    assert good["invalid_rows"] == 0 and good["errors"] == []


def test_sample_errors_are_capped():
    s = service()
    for row in range(30):
        s.add_error(row, "lot_no", "REQUIRED_FIELD", "x")
    assert len(s.get_sample_errors(10)) == 10 and len(s.errors) == 30
