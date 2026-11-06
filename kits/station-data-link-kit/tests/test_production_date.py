"""station-data-link-kit: which production date a record gets.

The three stations write dates differently (P1 in western years, P2 and P3 in Republic of China years), and the date drives
every later query by day. A date that cannot be read must come back as nothing, never as a wrong day, so the record is flagged
instead of silently filed under the wrong date. No database is used.
"""
from __future__ import annotations

from datetime import date

import pytest

from app.services.production_date_extractor import ProductionDateExtractor

extractor = ProductionDateExtractor()


def pick(data_type, **fields):
    return extractor.extract_production_date({"additional_data": fields}, data_type)


@pytest.mark.parametrize("text,expected", [
    ("2025-09-02", date(2025, 9, 2)),
    ("2025/09/02", date(2025, 9, 2)),
    ("250902", date(2025, 9, 2)),          # six digits: two-digit year in the 2000s
    ("25-09-02", date(2025, 9, 2)),
    ("  2025-09-02  ", date(2025, 9, 2)),
])
def test_p1_reads_western_dates_in_the_formats_the_line_produces(text, expected):
    assert pick("P1", **{"Production Date": text}) == expected


@pytest.mark.parametrize("text,expected", [
    ("114/09/02", date(2025, 9, 2)),       # Republic of China year 114 is 2025
    ("114-09-02", date(2025, 9, 2)),
    ("1140902", date(2025, 9, 2)),
    ("2025-09-02", date(2025, 9, 2)),      # a western date is still accepted
])
def test_p2_reads_republic_of_china_years_and_converts_them_to_western_years(text, expected):
    assert pick("P2", **{"分條時間": text}) == expected


@pytest.mark.parametrize("text,expected", [
    ("114年09月02日", date(2025, 9, 2)),
    ("114年9月2日", date(2025, 9, 2)),
    ("114/09/02", date(2025, 9, 2)),
    ("114-09-02", date(2025, 9, 2)),
])
def test_p3_reads_the_chinese_date_format(text, expected):
    assert pick("P3", **{"year-month-day": text}) == expected


@pytest.mark.parametrize("data_type,field", [("P1", "Production Date"), ("P2", "分條時間"), ("P3", "year-month-day")])
@pytest.mark.parametrize("text", ["", "   ", "not a date", "114/13/40", "114年13月40日", "2025-02-30", "999999999"])
def test_a_date_that_cannot_be_read_is_nothing_rather_than_a_wrong_day(data_type, field, text):
    assert pick(data_type, **{field: text}) is None


def test_other_known_column_names_are_used_when_the_usual_one_is_missing():
    assert pick("P1", **{"生產日期": "2025-09-02"}) == date(2025, 9, 2)
    assert pick("P2", **{"Slitting Time": "114/09/02"}) == date(2025, 9, 2)
    assert pick("P3", **{"年月日": "114年09月02日"}) == date(2025, 9, 2)


def test_an_empty_column_is_skipped_in_favor_of_the_next_known_column():
    assert pick("P1", **{"Production Date": "", "生產日期": "2025-09-02"}) == date(2025, 9, 2)


def test_a_record_without_any_date_column_has_no_date():
    assert pick("P1", other="x") is None
    assert extractor.extract_production_date({}, "P1") is None


def test_an_unknown_data_type_has_no_date_even_when_a_date_is_present():
    assert pick("P9", **{"Production Date": "2025-09-02"}) is None


def test_the_same_column_means_different_years_for_p1_and_p2():
    # "Date" is a western date for P1, but P2 reads a three-digit year as Republic of China; the types must not be mixed up.
    assert pick("P1", Date="2025-09-02") == date(2025, 9, 2)
    assert pick("P2", **{"日期": "114/09/02"}) == date(2025, 9, 2)
