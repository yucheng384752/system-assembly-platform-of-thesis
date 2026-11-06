"""analytics-kit: the numbers a manager reads from the trend page.

A trend is only trustworthy if a week or month adds up the same rows as the days it is made of, the averages are not diluted by
empty days, and a bad date range is refused rather than answered with a misleading chart. No database is used.
"""
from __future__ import annotations

from datetime import date, timedelta

import pytest
from fastapi import HTTPException

from app.api import routes_analytics as analytics


def day(start, count, total=None, values=0):
    return {"bucket_start": start, "count": count, "sum": total, "avg": None, "value_count": values}


@pytest.mark.parametrize("value,granularity,expected", [
    ("2026-11-04", "day", "2026-11-04"),
    ("2026-11-04", "week", "2026-11-02"),      # Wednesday goes back to Monday
    ("2026-11-02", "week", "2026-11-02"),      # Monday stays
    ("2026-11-08", "week", "2026-11-02"),      # Sunday belongs to the week that started on Monday
    ("2026-11-20", "month", "2026-11-01"),
])
def test_a_day_is_filed_under_the_start_of_its_week_or_month(value, granularity, expected):
    assert analytics._bucket_start(value, granularity) == expected


def test_a_week_has_the_same_row_count_and_sum_as_its_days():
    daily = [day("2026-11-02", 2, 10.0, 2), day("2026-11-03", 3, 20.0, 3), day("2026-11-09", 1, 5.0, 1)]
    weeks = analytics._rebucket(daily, "week")
    assert [w["bucket_start"] for w in weeks] == ["2026-11-02", "2026-11-09"]
    assert (weeks[0]["count"], weeks[0]["sum"]) == (5, 30.0)
    assert sum(w["count"] for w in weeks) == sum(d["count"] for d in daily)


def test_the_average_uses_only_the_rows_that_had_a_number_not_all_rows():
    # three rows were counted but only two of them carried a number: 30 / 2, not 30 / 3
    weeks = analytics._rebucket([day("2026-11-02", 2, 10.0, 1), day("2026-11-03", 1, 20.0, 1), day("2026-11-04", 5, None, 0)], "week")
    assert weeks[0]["count"] == 8 and weeks[0]["avg"] == 15.0


def test_a_period_with_no_numbers_has_no_average_rather_than_zero():
    weeks = analytics._rebucket([day("2026-11-02", 4, None, 0)], "week")
    assert weeks[0]["sum"] is None and weeks[0]["avg"] is None and weeks[0]["count"] == 4


def test_the_helper_columns_are_not_leaked_to_the_caller():
    assert "value_count" not in analytics._rebucket([day("2026-11-02", 1, 1.0, 1)], "month")[0]


@pytest.mark.parametrize("value,expected", [("12", 12.0), (" 1,234.5 ", 1234.5), (3, 3.0), (2.5, 2.5), ("-4", -4.0)])
def test_numbers_are_read_even_with_thousands_separators(value, expected):
    assert analytics._number_value(value) == expected


@pytest.mark.parametrize("value", [None, True, False, "abc", "", "1-2"])
def test_things_that_are_not_numbers_are_ignored_and_a_boolean_is_never_a_one(value):
    assert analytics._number_value(value) is None


def test_the_default_range_is_the_last_thirty_days_ending_today():
    start, end = analytics._date_range(None, None)
    assert end == date.today().isoformat()
    assert date.fromisoformat(end) - date.fromisoformat(start) == timedelta(days=29)


def test_an_explicit_range_is_returned_as_given():
    assert analytics._date_range("2026-01-01", "2026-01-31") == ("2026-01-01", "2026-01-31")


@pytest.mark.parametrize("date_from,date_to,needle", [
    ("2026-02-01", "2026-01-01", "must not be after"),
    ("2026-01-01", "2027-06-01", "366"),
    ("01/02/2026", None, "YYYY-MM-DD"),
    (None, "yesterday", "YYYY-MM-DD"),
])
def test_a_bad_range_is_refused_with_the_reason(date_from, date_to, needle):
    with pytest.raises(HTTPException) as caught:
        analytics._date_range(date_from, date_to)
    assert caught.value.status_code == 422 and needle in caught.value.detail


def test_a_range_of_exactly_366_days_is_the_longest_allowed():
    start = date(2026, 1, 1)
    assert analytics._date_range(start.isoformat(), (start + timedelta(days=366)).isoformat())[0] == "2026-01-01"
    with pytest.raises(HTTPException):
        analytics._date_range(start.isoformat(), (start + timedelta(days=367)).isoformat())


def test_the_optional_range_used_by_upload_history_may_be_open_ended_but_not_reversed():
    assert analytics._optional_dates(None, None) == (None, None)
    assert analytics._optional_dates("2026-01-01", None) == ("2026-01-01", None)
    with pytest.raises(HTTPException):
        analytics._optional_dates("2026-02-01", "2026-01-01")
    with pytest.raises(HTTPException):
        analytics._optional_dates("x", None)


def test_the_export_limit_and_the_numeric_field_types_are_the_documented_ones():
    assert analytics.EXPORT_LIMIT == 5000
    assert analytics.NUMERIC_TYPES == {"integer", "decimal", "float", "number"}
