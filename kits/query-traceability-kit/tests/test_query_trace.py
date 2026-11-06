"""query-traceability-kit: following one lot across stations.

A person searching a lot expects every station that touched it, each record shown once, and a chain that ends even when the
configured links loop back on themselves. These tests feed the routes a scripted session, so no database is used.
"""
from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timezone
from types import SimpleNamespace

from app.api import routes_query_v2 as query

TENANT = SimpleNamespace(id=uuid.uuid4())


class Rows:
    def __init__(self, items):
        self.items = items

    def scalars(self):
        return self

    def all(self):
        return list(self.items)


class Session:
    """Answers the route's queries in the order it asks them: stations, then records, then (for a trace) links."""

    def __init__(self, *answers):
        self.answers = list(answers)

    async def execute(self, _statement):
        return Rows(self.answers.pop(0))


def station(code, name=None):
    return SimpleNamespace(id=uuid.uuid4(), code=code, name=name or code.upper())


def record(st, lot="2507173_02", order=0):
    return SimpleNamespace(id=uuid.uuid4(), station_id=st.id, lot_no_raw=lot, data={"qty": order},
                           created_at=datetime(2026, 11, 1, 8, order, tzinfo=timezone.utc))


def link(a, b, flows=None):
    return SimpleNamespace(tenant_id=TENANT.id, from_station_id=a.id, to_station_id=b.id, link_config={} if flows is None else {"flowCodes": flows})


def search(session, lot="2507173_02"):
    return asyncio.run(query.search_lot(lot, tenant=TENANT, db=session))


def trace(session, lot="2507173_02", flow="default"):
    return asyncio.run(query.trace_lot(lot, flow_code=flow, tenant=TENANT, db=session))


def test_search_lists_each_station_that_has_the_lot_and_skips_the_others():
    a, b, c = station("p1"), station("p2"), station("p3")
    ra = record(a)
    result = search(Session([a, b, c], [ra]))
    assert [r["station_code"] for r in result] == ["p1"]
    assert result[0]["records"][0]["id"] == str(ra.id) and result[0]["records"][0]["lot_no_raw"] == "2507173_02"


def test_search_for_a_lot_nobody_recorded_is_an_empty_list_not_an_error():
    assert search(Session([station("p1")], [])) == []


def test_search_ignores_spaces_around_the_lot_number():
    a = station("p1")
    assert len(search(Session([a], [record(a)]), lot="  2507173_02  ")) == 1


def test_a_record_is_described_with_its_data_and_time():
    a = station("p1")
    rec = record(a, order=3)
    described = query._record_dict(rec)
    assert described["data"] == {"qty": 3} and described["created_at"].startswith("2026-11-01T08:03")
    rec.created_at = None
    assert query._record_dict(rec)["created_at"] is None


def test_a_lot_with_no_records_traces_to_an_empty_graph_without_reading_links():
    assert trace(Session([station("p1")], [])) == {"nodes": [], "edges": []}


def test_a_linear_flow_connects_every_record_of_one_station_to_every_record_of_the_next():
    a, b = station("p1"), station("p2")
    ra, rb1, rb2 = record(a), record(b, order=1), record(b, order=2)
    graph = trace(Session([a, b], [ra, rb1, rb2], [link(a, b)]))
    assert {n["station_code"] for n in graph["nodes"]} == {"p1", "p2"}
    assert len(graph["nodes"]) == 3
    assert len(graph["edges"]) == 2
    assert {e["from"] for e in graph["edges"]} == {f"{a.id}:{ra.id}"}
    depths = {n["station_code"]: n["depth"] for n in graph["nodes"]}
    assert depths == {"p1": 0, "p2": 1}


def test_each_record_is_emitted_once_even_when_two_paths_reach_it():
    a, b, c = station("p1"), station("p2"), station("p3")
    ra, rb, rc = record(a), record(b), record(c)
    graph = trace(Session([a, b, c], [ra, rb, rc], [link(a, b), link(a, c), link(b, c)]))
    assert len(graph["nodes"]) == 3
    assert len({n["key"] for n in graph["nodes"]}) == 3


def test_links_that_loop_back_do_not_hang_and_still_return_the_records():
    a, b = station("p1"), station("p2")
    graph = trace(Session([a, b], [record(a), record(b)], [link(a, b), link(b, a)]))
    assert len(graph["nodes"]) == 2
    # with no station that nothing links into, every station is a starting point, so each direction is reported once
    assert len(graph["edges"]) == 2


def test_a_chain_longer_than_the_depth_limit_stops_at_the_limit():
    stations = [station(f"p{i}") for i in range(9)]
    records = [record(s) for s in stations]
    links = [link(stations[i], stations[i + 1]) for i in range(8)]
    graph = trace(Session(stations, records, links))
    assert max(n["depth"] for n in graph["nodes"]) == query.MAX_TRACE_DEPTH
    assert len(graph["nodes"]) == query.MAX_TRACE_DEPTH + 1


def test_a_link_belonging_to_another_flow_is_not_followed():
    a, b = station("p1"), station("p2")
    only_other_flow = link(a, b, flows=["repair"])
    assert len(trace(Session([a, b], [record(a), record(b)], [only_other_flow]))["edges"]) == 0
    assert len(trace(Session([a, b], [record(a), record(b)], [only_other_flow]), flow="repair")["edges"]) == 1


def test_a_link_with_no_flow_list_belongs_to_the_default_flow_only():
    a, b = station("p1"), station("p2")
    plain = link(a, b)
    assert len(trace(Session([a, b], [record(a), record(b)], [plain]))["edges"]) == 1
    assert len(trace(Session([a, b], [record(a), record(b)], [plain]), flow="repair")["edges"]) == 0
