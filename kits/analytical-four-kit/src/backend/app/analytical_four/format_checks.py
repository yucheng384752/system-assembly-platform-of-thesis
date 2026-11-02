"""Format checks for the files a site supplies besides the measurement CSVs: the analysis configuration, the defect code
definitions, the process topology, the SOP knowledge, and the case files (docs/analytical-four-kit.md, section 12).

Each check reads one file and returns findings; none writes. They exist because the engine meets a malformed file in one of
three bad ways: a KeyError deep inside a run, a row skipped without a word, or a result that is simply wrong. An error here is
what would crash or corrupt the run; a warning is what would be skipped or weakened.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional

EXAMPLES = 5
NG_DETAIL_KEYS = ('machine', 'process', 'phenomenon', 'cause', 'action')
SOP_COLUMNS = ('Knowledge_ID', 'Station_ID', 'Feature_Target', 'Issue_Category', 'Root_Cause_Description', 'Recommended_Action', 'Source_Ref')
EVENT_ID = re.compile(r'^[A-Za-z0-9._:-]{1,100}$')
MAX_RECORD_BYTES = 100_000


@dataclass(frozen=True)
class Finding:
    severity: str  # 'error' blocks a run; 'warning' is shown with the run
    layer: str
    code: str
    message: str

    def as_json(self) -> Dict[str, str]:
        return {'layer': self.layer, 'code': self.code, 'message': self.message}


def names(values, limit: int = EXAMPLES) -> str:
    values = [str(v) for v in values]
    return '、'.join(values[:limit]) + (f' 等 {len(values)} 個' if len(values) > limit else '')


def _load_json(path: Path, label: str, layer: str, code: str) -> tuple:
    try:
        return json.loads(path.read_text(encoding='utf-8-sig')), []
    except (OSError, ValueError) as error:
        return None, [Finding('error', layer, code, f'{label}不是有效的 JSON：{error}')]


def _text(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


# ---- analysis configuration ----------------------------------------------------------------------------------------------

def check_analysis_config(config: Dict[str, Any]) -> List[Finding]:
    found: List[Finding] = []
    features = config.get('feature')
    if not isinstance(features, dict) or not features:
        return [Finding('error', 'a', 'config-feature', 'feature 必須是非空的物件，每個鍵是一個站點或群組')]
    for group, value in features.items():
        where = f'feature.{group}'
        if not isinstance(value, dict):
            found.append(Finding('error', 'a', 'config-feature', f'{where} 必須是物件'))
            continue
        numerical = value.get('numerical', [])
        if not isinstance(numerical, list) or not all(_text(x) for x in numerical):
            found.append(Finding('error', 'a', 'config-feature', f'{where}.numerical 必須是欄名的文字清單'))
        elif len(set(numerical)) != len(numerical):
            repeated = sorted({x for x in numerical if numerical.count(x) > 1})
            found.append(Finding('warning', 'a', 'config-duplicate', f'{where}.numerical 有重複的欄名：{names(repeated)}'))
        categorical = value.get('categorical', {})
        if not isinstance(categorical, dict) or not all(isinstance(v, list) and all(_text(x) for x in v) for v in categorical.values()):
            found.append(Finding('error', 'a', 'config-feature', f'{where}.categorical 必須是物件，每個值是欄名的文字清單'))
        for key in ('target', 'id'):
            if not isinstance(value.get(key, ''), str):
                found.append(Finding('error', 'a', 'config-feature', f'{where}.{key} 必須是文字'))
    source = config.get('data_source', {})
    for section, key in (('baseline_data', 'prescriptive'), ('rag_setting', 'db_path'), ('current_data', 'descriptive')):
        value = source.get(section, {}).get(key, '') if isinstance(source.get(section), dict) else ''
        if not isinstance(value, str):
            found.append(Finding('error', 'a', 'config-path', f'data_source.{section}.{key} 必須是文字'))
    return found


# ---- defect code definitions ---------------------------------------------------------------------------------------------

def check_ng_code(path: Path) -> List[Finding]:
    data, found = _load_json(path, '不良代碼定義', 'b', 'ng-format')
    if found:
        return found
    if not isinstance(data, list) or not data:
        return [Finding('error', 'b', 'ng-format', '不良代碼定義必須是非空的陣列，每筆有 category 與 details')]
    seen: Dict[str, int] = {}
    for index, item in enumerate(data, 1):
        if not isinstance(item, dict) or not _text(item.get('category')):
            found.append(Finding('error', 'b', 'ng-format', f'第 {index} 筆沒有 category'))
            continue
        seen[item['category']] = seen.get(item['category'], 0) + 1
        details = item.get('details')
        if not isinstance(details, list) or not details or not all(isinstance(d, dict) for d in details):
            found.append(Finding('error', 'b', 'ng-format', f'{item["category"]} 的 details 必須是非空的陣列，每筆是物件'))
            continue
        gaps = [k for k in NG_DETAIL_KEYS if not _text(details[0].get(k))]
        if gaps:
            found.append(Finding('warning', 'b', 'ng-detail', f'{item["category"]} 的第一筆 details 沒有填：{names(gaps)}；診斷結果的原因與處置建議會是空的'))
    repeated = [c for c, n in seen.items() if n > 1]
    if repeated:
        found.append(Finding('error', 'b', 'ng-duplicate', f'不良代碼重複定義：{names(repeated)}；只有第一筆會被使用'))
    return found


def ng_categories(path: Path) -> List[str]:
    try:
        return [item['category'] for item in json.loads(path.read_text(encoding='utf-8-sig')) if isinstance(item, dict) and _text(item.get('category'))]
    except (OSError, ValueError, TypeError):
        return []


# ---- process topology ----------------------------------------------------------------------------------------------------

def check_topology(path: Path) -> List[Finding]:
    data, found = _load_json(path, '製程拓樸', 'c', 'topology-format')
    if found:
        return found
    if not isinstance(data, dict) or not isinstance(data.get('process'), dict) or not isinstance(data.get('topology'), dict):
        return [Finding('error', 'c', 'topology-format', '製程拓樸需要 process.stations、roles 與 topology')]
    stations = data['process'].get('stations')
    if not isinstance(stations, list) or not stations or not all(isinstance(s, dict) and _text(s.get('id')) and _text(s.get('name')) and isinstance(s.get('order'), int) for s in stations):
        return [Finding('error', 'c', 'topology-format', 'process.stations 必須是非空的陣列，每筆有 id、name 與整數 order')]
    ids = [s['id'] for s in stations]
    if len(set(ids)) != len(ids):
        found.append(Finding('error', 'c', 'topology-format', f'站點識別碼重複：{names(sorted({i for i in ids if ids.count(i) > 1}))}'))
    roles = data.get('roles', {})
    if not isinstance(roles, dict):
        found.append(Finding('error', 'c', 'topology-format', 'roles 必須是物件'))
        roles = {}
    feature_ids: List[str] = []
    feature_names: List[str] = []
    for station, content in data['topology'].items():
        if station not in ids:
            found.append(Finding('warning', 'c', 'topology-station', f'topology 的站點「{station}」不在 process.stations 中，整個站點會被略過'))
            continue
        features = content.get('feature') if isinstance(content, dict) else None
        if not isinstance(features, list):
            found.append(Finding('error', 'c', 'topology-format', f'站點「{station}」需要 feature 陣列'))
            continue
        for number, feature in enumerate(features, 1):
            if not isinstance(feature, dict) or not all(k in feature for k in ('id', 'name', 'role', 'level')):
                found.append(Finding('error', 'c', 'topology-format', f'站點「{station}」第 {number} 個特徵需要 id、name、role、level，缺少時引擎會直接失敗'))
                continue
            if not isinstance(feature['level'], int):
                found.append(Finding('error', 'c', 'topology-format', f'特徵「{feature["id"]}」的 level 必須是整數'))
            if roles and feature['role'] not in roles:
                found.append(Finding('warning', 'c', 'topology-role', f'特徵「{feature["id"]}」的角色「{feature["role"]}」不在 roles 中，排序時會排在最後'))
            feature_ids.append(str(feature['id']))
            feature_names.append(str(feature['name']))
    repeated = sorted({i for i in feature_ids if feature_ids.count(i) > 1})
    if repeated:
        found.append(Finding('error', 'c', 'topology-duplicate', f'特徵識別碼重複：{names(repeated)}；後面的會覆蓋前面的'))
    repeated_names = sorted({n for n in feature_names if feature_names.count(n) > 1})
    if repeated_names:
        found.append(Finding('warning', 'c', 'topology-duplicate', f'特徵名稱重複：{names(repeated_names)}；以名稱對應欄位時只有最後一個有效'))
    if not feature_ids:
        found.append(Finding('error', 'c', 'topology-format', '製程拓樸沒有任何特徵'))
    return found


def topology_features(path: Path) -> Dict[str, List[str]]:
    """{'names': [...], 'ids': [...]} of a topology that passed its format check; empty lists otherwise."""
    try:
        data = json.loads(path.read_text(encoding='utf-8-sig'))
        features = [f for s in data['topology'].values() for f in s.get('feature', []) if isinstance(f, dict) and 'name' in f and 'id' in f]
        return {'names': [str(f['name']) for f in features], 'ids': [str(f['id']) for f in features]}
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        return {'names': [], 'ids': []}


# ---- SOP knowledge -------------------------------------------------------------------------------------------------------

def check_knowledge(path: Path) -> List[Finding]:
    try:
        lines = [x for x in path.read_text(encoding='utf-8-sig').splitlines() if x.strip()]
    except OSError as error:
        return [Finding('error', 'c', 'sop-format', f'SOP 知識檔無法讀取：{error}')]
    if len(lines) < 2:
        return [Finding('error', 'c', 'sop-format', 'SOP 知識檔沒有任何知識列（只有標題列或是空的），檢索不會找到任何東西')]
    found: List[Finding] = []
    header = lines[0].split(',')
    if header != list(SOP_COLUMNS):
        found.append(Finding('warning', 'c', 'sop-header', f'SOP 知識檔的標題列不是預期的七個欄位（{"、".join(SOP_COLUMNS)}）；欄位順序決定事件的 SOP 說明取哪一欄'))
    odd = [n for n, line in enumerate(lines[1:], 2) if len(line.split(',')) != len(header)]
    if odd:
        found.append(Finding('warning', 'c', 'sop-fields', f'SOP 知識檔有 {len(odd)} 列的欄位數與標題列（{len(header)} 欄）不同，常見原因是欄位內含逗號；'
                             f'少於 {len(SOP_COLUMNS)} 欄的列不會出現在事件的 SOP 清單，其餘會錯位；第 {names(odd, 3)} 列'))
    rows = [line.split(',') for line in lines[1:]]
    first = [r[0] for r in rows if r]
    repeated = sorted({i for i in first if first.count(i) > 1})
    if repeated:
        found.append(Finding('warning', 'c', 'sop-duplicate', f'Knowledge_ID 重複：{names(repeated)}；事件的 SOP 清單只會留第一筆'))
    empty = [n for n, r in enumerate(rows, 2) if len(r) > 2 and not r[2].strip()]
    if empty:
        found.append(Finding('warning', 'c', 'sop-target', f'第 {names(empty, 3)} 列沒有填適用特徵（Feature_Target），檢索時用不到'))
    return found


# ---- case files ----------------------------------------------------------------------------------------------------------

def validate_case_record(record: Any, where: str) -> Optional[str]:
    """The fields the similar-case search reads. Returns the first problem, or None."""
    def need(ok: bool, what: str) -> Optional[str]:
        return None if ok else f'{where}：{what}'
    if not isinstance(record, dict):
        return f'{where}：必須是物件'
    if len(json.dumps(record, ensure_ascii=False)) > MAX_RECORD_BYTES:
        return f'{where}：超過 {MAX_RECORD_BYTES} 位元組'
    summary, diag = record.get('summary'), record.get('diagnosis_results')
    feedback, conclusion = record.get('feedback'), record.get('conclusion')
    checks = [
        need(isinstance(record.get('event_id'), str) and bool(EVENT_ID.match(record['event_id'])), 'event_id 不合法'),
        need(isinstance(summary, dict), '缺少 summary'),
        need(isinstance(summary, dict) and isinstance(summary.get('anomaly_features'), list)
             and all(isinstance(x, str) for x in summary['anomaly_features']), 'summary.anomaly_features 必須是文字清單'),
        need(isinstance(summary, dict) and isinstance(summary.get('sop_keys'), list)
             and all(isinstance(x, str) for x in summary['sop_keys']), 'summary.sop_keys 必須是文字清單'),
        need(isinstance(summary, dict) and isinstance(summary.get('categorical'), dict), 'summary.categorical 必須是物件'),
        need(isinstance(diag, dict) and isinstance(diag.get('score_breakdown'), dict)
             and all(isinstance(diag['score_breakdown'].get(k), (int, float)) for k in ('anomaly', 'metrics', 'env')),
             'diagnosis_results.score_breakdown 需有數值的 anomaly、metrics、env'),
        need(isinstance(feedback, dict), '缺少 feedback'),
        need(isinstance(conclusion, dict), '缺少 conclusion'),
    ]
    return next((c for c in checks if c), None)


def check_case_records(path: Path, label: str) -> List[Finding]:
    """JSON Lines of confirmed cases. A record the similar-case search cannot read would stop the run there, so it is an error."""
    try:
        lines = path.read_text(encoding='utf-8').splitlines()
    except OSError as error:
        return [Finding('error', 'c', 'case-json', f'{label}無法讀取：{error}')]
    found: List[Finding] = []
    for number, line in enumerate(lines, 1):
        if not line.strip():
            continue
        try:
            record = json.loads(line)
        except ValueError:
            found.append(Finding('error', 'c', 'case-json', f'{label}第 {number} 行不是有效的 JSON'))
            break
        problem = validate_case_record(record, f'{label}第 {number} 行')
        if problem:
            found.append(Finding('error', 'c', 'case-record', f'{problem}；相似案例搜尋會在這筆失敗'))
            break
    return found
