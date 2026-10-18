"""批次進度（純函式）：找出第一個尚未填完的站點。

與來源系統相同的規則，但不碰資料庫、也不認得任何站點代碼：
- 沒有必填項目的站點略過。
- 站點若以「用料秤重」代替量測項目判斷完成（`material_station_codes`），
  則只看是否已有任何一筆實際重量。
- 有必填的「步驟層」項目時，先看步驟：沒有規格文字的步驟（瞬間動作）不要求填。
- 外部閘門可宣告某站點為未完成（`blocked`），例如初始量測異常尚未放行。
"""

from collections.abc import Callable, Iterable
from dataclasses import dataclass, field


@dataclass(frozen=True)
class MetricSpec:
    key: str
    scope: str  # batch | station | step
    required: bool = False


@dataclass(frozen=True)
class StepSpec:
    seq: int
    spec_text: str | None = None


@dataclass(frozen=True)
class StationSpec:
    code: str
    name: str
    sequence: int
    metrics: tuple[MetricSpec, ...] = ()
    steps: tuple[StepSpec, ...] = ()


@dataclass(frozen=True)
class Filled:
    """已填的格子：(metric_key, step_seq)，不屬於步驟的 step_seq 為 0。"""

    cells: frozenset[tuple[str, int]] = field(default_factory=frozenset)


def first_incomplete_station(
    stations: Iterable[StationSpec],
    filled_by_station: dict[str, frozenset[tuple[str, int]]],
    *,
    exclude: frozenset[str] = frozenset(),
    material_station_codes: frozenset[str] = frozenset(),
    has_actual_weight: bool = False,
    blocked: Callable[[str], bool] = lambda code: False,
) -> str | None:
    for st in sorted(stations, key=lambda s: s.sequence):
        if st.code in exclude:
            continue
        if blocked(st.code):
            return st.name
        if st.code in material_station_codes:
            if not has_actual_weight:
                return st.name
            continue
        required = [m for m in st.metrics if m.required]
        if not required:
            continue
        filled = filled_by_station.get(st.code, frozenset())
        step_required = [m for m in required if m.scope == "step"]
        if step_required and st.steps:
            for step in st.steps:
                if step.spec_text is None:
                    continue
                if any((m.key, step.seq) not in filled for m in step_required):
                    return f"{st.name}（步驟 {step.seq}/{len(st.steps)}）"
        if any((m.key, 0) not in filled for m in required if m.scope != "step"):
            return st.name
    return None
