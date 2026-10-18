"""產線定義檔（seed/*.json）的結構檢查（純函式）。

產線可以是 `defined`（有站點與項目）或 `reserved`（預留，尚未提供定義）。
預留的產線不得夾帶站點，避免有人誤以為已經可用；顯示時標「尚未提供定義」。
"""

import re

_KEY = re.compile(r"^[a-z0-9_]+$")
STATUSES = {"defined", "reserved"}
DATA_TYPES = {"number", "text", "boolean", "datetime", "enum"}
FILLER_ROLES = {"operator", "manager"}
SPEC_SOURCES = {"constant", "model"}


def check_seed(doc: dict) -> list[str]:
    errors: list[str] = []
    lines = doc.get("productLines")
    if not isinstance(lines, list) or not lines:
        return ["productLines 必須是非空陣列"]
    codes: set[str] = set()
    for line in lines:
        code = str(line.get("code", ""))
        if not _KEY.match(code):
            errors.append(f"產線代碼格式不合法：{code!r}")
        if code in codes:
            errors.append(f"產線代碼重複：{code}")
        codes.add(code)
        status = line.get("status")
        if status not in STATUSES:
            errors.append(f"{code}：status 必須是 {sorted(STATUSES)}")
            continue
        stations = line.get("stations", [])
        if status == "reserved" and stations:
            errors.append(f"{code}：預留的產線不可含站點")
        if status == "defined" and not stations:
            errors.append(f"{code}：已定義的產線至少要有一個站點")
        errors += _check_stations(code, stations)
    return errors


def _check_stations(line_code: str, stations: list[dict]) -> list[str]:
    errors: list[str] = []
    seen_codes: set[str] = set()
    sequences: list[int] = []
    for st in stations:
        scode = str(st.get("code", ""))
        if not _KEY.match(scode):
            errors.append(f"{line_code}/{scode!r}：站點代碼格式不合法")
        if scode in seen_codes:
            errors.append(f"{line_code}/{scode}：站點代碼重複")
        seen_codes.add(scode)
        sequences.append(st.get("sequence", 0))
        keys: set[str] = set()
        for m in st.get("metrics", []):
            key = str(m.get("key", ""))
            if not _KEY.match(key):
                errors.append(f"{line_code}/{scode}：項目 key 格式不合法 {key!r}")
            if key in keys:
                errors.append(f"{line_code}/{scode}：項目 key 重複 {key}")
            keys.add(key)
            if m.get("dataType") not in DATA_TYPES:
                errors.append(f"{line_code}/{scode}/{key}：dataType 不合法")
            if m.get("fillerRole", "operator") not in FILLER_ROLES:
                errors.append(f"{line_code}/{scode}/{key}：fillerRole 不合法")
            if m.get("specSource", "constant") not in SPEC_SOURCES:
                errors.append(f"{line_code}/{scode}/{key}：specSource 不合法")
            lo, hi = m.get("specMin"), m.get("specMax")
            if lo is not None and hi is not None and lo > hi:
                errors.append(f"{line_code}/{scode}/{key}：規格下限大於上限")
    if len(set(sequences)) != len(sequences):
        errors.append(f"{line_code}：站點順序重複")
    return errors
