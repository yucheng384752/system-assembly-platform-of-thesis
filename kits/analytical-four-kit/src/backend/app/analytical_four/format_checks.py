"""Format checks for the files a site supplies besides the measurement CSVs: the analysis configuration, the defect code
definitions, the process topology, the SOP knowledge, and the case files (docs/analytical-four-kit.md, section 12).

Each check reads one file and returns findings; none writes. They exist because the engine meets a malformed file in one of
three bad ways: a KeyError deep inside a run, a row skipped without a word, or a result that is simply wrong. An error here is
what would crash or corrupt the run; a warning is what would be skipped or weakened.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
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
    # Which input the finding is about (current, baseline, ng-code, topology, knowledge, cases, config, known-base), so an
    # upload can be judged by the problems of its own file and not by those of the files around it.
    source: str = ''
    # `message` stays the Chinese sentence. `key` and `params` let a page say the same thing in its own language: the page looks
    # the key up in its own table and fills in the params; a key it does not know falls back to `message`.
    key: str = ''
    params: Dict[str, Any] = field(default_factory=dict)

    def as_json(self) -> Dict[str, Any]:
        body: Dict[str, Any] = {'layer': self.layer, 'code': self.code, 'message': self.message, 'source': self.source}
        if self.key:
            body['key'] = self.key
            body['params'] = {name: plain(value) for name, value in self.params.items()}
        return body


class Term(str):
    """A fixed noun phrase of the reports. The text is Chinese; the key lets a page name it in its own language."""
    key: str

    def __new__(cls, key: str, text: str):
        item = super().__new__(cls, text)
        item.key = key
        return item


class Problem(str):
    """The first thing wrong with a case record: the Chinese sentence plus which problem it is."""
    key: str
    params: Dict[str, Any]

    def __new__(cls, text: str, key: str, params: Optional[Dict[str, Any]] = None):
        item = super().__new__(cls, text)
        item.key = key
        item.params = params or {}
        return item


def plain(value: Any) -> Any:
    """A param as JSON: terms and problems by key, numpy numbers as numbers, anything else odd as text."""
    if isinstance(value, Term):
        return {'term': value.key}
    if isinstance(value, Problem):
        return {'key': value.key, 'params': {name: plain(item) for name, item in value.params.items()}}
    if isinstance(value, dict):
        return {str(name): plain(item) for name, item in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [plain(item) for item in value]
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    if hasattr(value, 'item'):
        return plain(value.item())
    return str(value)


def names_param(values, limit: int = EXAMPLES) -> Dict[str, Any]:
    """The structured form of names(): the first few values and how many there are in all."""
    values = [str(v) for v in values]
    return {'items': values[:limit], 'total': len(values)}


def names(values, limit: int = EXAMPLES) -> str:
    values = [str(v) for v in values]
    return '、'.join(values[:limit]) + (f' 等 {len(values)} 個' if len(values) > limit else '')


def _load_json(path: Path, label: str, layer: str, code: str) -> tuple:
    try:
        return json.loads(path.read_text(encoding='utf-8-sig')), []
    except (OSError, ValueError) as error:
        return None, [Finding('error', layer, code, f'{label}不是有效的 JSON：{error}', key='json-invalid.1', params={'label': label, 'error': error})]


def _text(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


# ---- analysis configuration ----------------------------------------------------------------------------------------------

def check_analysis_config(config: Dict[str, Any]) -> List[Finding]:
    found: List[Finding] = []
    features = config.get('feature')
    if not isinstance(features, dict) or not features:
        return [Finding('error', 'a', 'config-feature', 'feature 必須是非空的物件，每個鍵是一個站點或群組', key='config-feature.1')]
    for group, value in features.items():
        where = f'feature.{group}'
        if not isinstance(value, dict):
            found.append(Finding('error', 'a', 'config-feature', f'{where} 必須是物件', key='config-feature.2', params={'where': where}))
            continue
        numerical = value.get('numerical', [])
        if not isinstance(numerical, list) or not all(_text(x) for x in numerical):
            found.append(Finding('error', 'a', 'config-feature', f'{where}.numerical 必須是欄名的文字清單', key='config-feature.3', params={'where': where}))
        elif len(set(numerical)) != len(numerical):
            repeated = sorted({x for x in numerical if numerical.count(x) > 1})
            found.append(Finding('warning', 'a', 'config-duplicate', f'{where}.numerical 有重複的欄名：{names(repeated)}', key='config-duplicate.1', params={'where': where, 'repeated': names_param(repeated)}))
        categorical = value.get('categorical', {})
        if not isinstance(categorical, dict) or not all(isinstance(v, list) and all(_text(x) for x in v) for v in categorical.values()):
            found.append(Finding('error', 'a', 'config-feature', f'{where}.categorical 必須是物件，每個值是欄名的文字清單', key='config-feature.4', params={'where': where}))
        for key in ('target', 'id'):
            if not isinstance(value.get(key, ''), str):
                found.append(Finding('error', 'a', 'config-feature', f'{where}.{key} 必須是文字', key='config-feature.5', params={'where': where, 'key': key}))
    source = config.get('data_source', {})
    for section, key in (('baseline_data', 'prescriptive'), ('rag_setting', 'db_path'), ('current_data', 'descriptive')):
        value = source.get(section, {}).get(key, '') if isinstance(source.get(section), dict) else ''
        if not isinstance(value, str):
            found.append(Finding('error', 'a', 'config-path', f'data_source.{section}.{key} 必須是文字', key='config-path.1', params={'section': section, 'key': key}))
    return found


# ---- defect code definitions ---------------------------------------------------------------------------------------------

def check_ng_code(path: Path) -> List[Finding]:
    data, found = _load_json(path, Term('ng-code-file', '不良代碼定義'), 'b', 'ng-format')
    if found:
        return found
    if not isinstance(data, list) or not data:
        return [Finding('error', 'b', 'ng-format', '不良代碼定義必須是非空的陣列，每筆有 category 與 details', key='ng-format.1')]
    seen: Dict[str, int] = {}
    for index, item in enumerate(data, 1):
        if not isinstance(item, dict) or not _text(item.get('category')):
            found.append(Finding('error', 'b', 'ng-format', f'第 {index} 筆沒有 category', key='ng-format.2', params={'index': index}))
            continue
        seen[item['category']] = seen.get(item['category'], 0) + 1
        details = item.get('details')
        if not isinstance(details, list) or not details or not all(isinstance(d, dict) for d in details):
            found.append(Finding('error', 'b', 'ng-format', f'{item["category"]} 的 details 必須是非空的陣列，每筆是物件', key='ng-format.3', params={'category': item["category"]}))
            continue
        gaps = [k for k in NG_DETAIL_KEYS if not _text(details[0].get(k))]
        if gaps:
            found.append(Finding('warning', 'b', 'ng-detail', f'{item["category"]} 的第一筆 details 沒有填：{names(gaps)}；診斷結果的原因與處置建議會是空的', key='ng-detail.1', params={'category': item["category"], 'gaps': names_param(gaps)}))
    repeated = [c for c, n in seen.items() if n > 1]
    if repeated:
        found.append(Finding('error', 'b', 'ng-duplicate', f'不良代碼重複定義：{names(repeated)}；只有第一筆會被使用', key='ng-duplicate.1', params={'repeated': names_param(repeated)}))
    return found


def ng_categories(path: Path) -> List[str]:
    try:
        return [item['category'] for item in json.loads(path.read_text(encoding='utf-8-sig')) if isinstance(item, dict) and _text(item.get('category'))]
    except (OSError, ValueError, TypeError):
        return []


# ---- process topology ----------------------------------------------------------------------------------------------------

def check_topology(path: Path) -> List[Finding]:
    data, found = _load_json(path, Term('topology-file', '製程拓樸'), 'c', 'topology-format')
    if found:
        return found
    if not isinstance(data, dict) or not isinstance(data.get('process'), dict) or not isinstance(data.get('topology'), dict):
        return [Finding('error', 'c', 'topology-format', '製程拓樸需要 process.stations、roles 與 topology', key='topology-format.1')]
    stations = data['process'].get('stations')
    if not isinstance(stations, list) or not stations or not all(isinstance(s, dict) and _text(s.get('id')) and _text(s.get('name')) and isinstance(s.get('order'), int) for s in stations):
        return [Finding('error', 'c', 'topology-format', 'process.stations 必須是非空的陣列，每筆有 id、name 與整數 order', key='topology-format.2')]
    ids = [s['id'] for s in stations]
    if len(set(ids)) != len(ids):
        found.append(Finding('error', 'c', 'topology-format', f'站點識別碼重複：{names(sorted({i for i in ids if ids.count(i) > 1}))}', key='topology-format.3', params={'items': names_param(sorted({i for i in ids if ids.count(i) > 1}))}))
    roles = data.get('roles', {})
    if not isinstance(roles, dict):
        found.append(Finding('error', 'c', 'topology-format', 'roles 必須是物件', key='topology-format.4'))
        roles = {}
    feature_ids: List[str] = []
    feature_names: List[str] = []
    for station, content in data['topology'].items():
        if station not in ids:
            found.append(Finding('warning', 'c', 'topology-station', f'topology 的站點「{station}」不在 process.stations 中，整個站點會被略過', key='topology-station.1', params={'station': station}))
            continue
        features = content.get('feature') if isinstance(content, dict) else None
        if not isinstance(features, list):
            found.append(Finding('error', 'c', 'topology-format', f'站點「{station}」需要 feature 陣列', key='topology-format.5', params={'station': station}))
            continue
        for number, feature in enumerate(features, 1):
            if not isinstance(feature, dict) or not all(k in feature for k in ('id', 'name', 'role', 'level')):
                found.append(Finding('error', 'c', 'topology-format', f'站點「{station}」第 {number} 個特徵需要 id、name、role、level，缺少時引擎會直接失敗', key='topology-format.6', params={'station': station, 'number': number}))
                continue
            if not isinstance(feature['level'], int):
                found.append(Finding('error', 'c', 'topology-format', f'特徵「{feature["id"]}」的 level 必須是整數', key='topology-format.7', params={'id': feature["id"]}))
            if roles and feature['role'] not in roles:
                found.append(Finding('warning', 'c', 'topology-role', f'特徵「{feature["id"]}」的角色「{feature["role"]}」不在 roles 中，排序時會排在最後', key='topology-role.1', params={'id': feature["id"], 'role': feature["role"]}))
            feature_ids.append(str(feature['id']))
            feature_names.append(str(feature['name']))
    repeated = sorted({i for i in feature_ids if feature_ids.count(i) > 1})
    if repeated:
        found.append(Finding('error', 'c', 'topology-duplicate', f'特徵識別碼重複：{names(repeated)}；後面的會覆蓋前面的', key='topology-duplicate.1', params={'repeated': names_param(repeated)}))
    repeated_names = sorted({n for n in feature_names if feature_names.count(n) > 1})
    if repeated_names:
        found.append(Finding('warning', 'c', 'topology-duplicate', f'特徵名稱重複：{names(repeated_names)}；以名稱對應欄位時只有最後一個有效', key='topology-duplicate.2', params={'repeated_names': names_param(repeated_names)}))
    if not feature_ids:
        found.append(Finding('error', 'c', 'topology-format', '製程拓樸沒有任何特徵', key='topology-format.8'))
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
        return [Finding('error', 'c', 'sop-format', f'SOP 知識檔無法讀取：{error}', key='sop-format.1', params={'error': error})]
    if len(lines) < 2:
        return [Finding('error', 'c', 'sop-format', 'SOP 知識檔沒有任何知識列（只有標題列或是空的），檢索不會找到任何東西', key='sop-format.2')]
    found: List[Finding] = []
    header = lines[0].split(',')
    if header != list(SOP_COLUMNS):
        found.append(Finding('warning', 'c', 'sop-header', f'SOP 知識檔的標題列不是預期的七個欄位（{"、".join(SOP_COLUMNS)}）；欄位順序決定事件的 SOP 說明取哪一欄', key='sop-header.1', params={'sop_columns': list(SOP_COLUMNS)}))
    odd = [n for n, line in enumerate(lines[1:], 2) if len(line.split(',')) != len(header)]
    if odd:
        found.append(Finding('warning', 'c', 'sop-fields', f'SOP 知識檔有 {len(odd)} 列的欄位數與標題列（{len(header)} 欄）不同，常見原因是欄位內含逗號；'
                             f'少於 {len(SOP_COLUMNS)} 欄的列不會出現在事件的 SOP 清單，其餘會錯位；第 {names(odd, 3)} 列', key='sop-fields.1', params={'count_odd': len(odd), 'count_header': len(header), 'count_expected': len(SOP_COLUMNS), 'odd': names_param(odd, 3)}))
    rows = [line.split(',') for line in lines[1:]]
    first = [r[0] for r in rows if r]
    repeated = sorted({i for i in first if first.count(i) > 1})
    if repeated:
        found.append(Finding('warning', 'c', 'sop-duplicate', f'Knowledge_ID 重複：{names(repeated)}；事件的 SOP 清單只會留第一筆', key='sop-duplicate.1', params={'repeated': names_param(repeated)}))
    empty = [n for n, r in enumerate(rows, 2) if len(r) > 2 and not r[2].strip()]
    if empty:
        found.append(Finding('warning', 'c', 'sop-target', f'第 {names(empty, 3)} 列沒有填適用特徵（Feature_Target），檢索時用不到', key='sop-target.1', params={'empty': names_param(empty, 3)}))
    return found


# ---- case files ----------------------------------------------------------------------------------------------------------

def validate_case_record(record: Any, where: str) -> Optional[Problem]:
    """The fields the similar-case search reads. Returns the first problem, or None."""
    def need(ok: bool, what: str, key: str) -> Optional[Problem]:
        return None if ok else Problem(f'{where}：{what}', key)
    if not isinstance(record, dict):
        return Problem(f'{where}：必須是物件', 'not-object')
    if len(json.dumps(record, ensure_ascii=False)) > MAX_RECORD_BYTES:
        return Problem(f'{where}：超過 {MAX_RECORD_BYTES} 位元組', 'too-big', {'bytes': MAX_RECORD_BYTES})
    summary, diag = record.get('summary'), record.get('diagnosis_results')
    feedback, conclusion = record.get('feedback'), record.get('conclusion')
    checks = [
        need(isinstance(record.get('event_id'), str) and bool(EVENT_ID.match(record['event_id'])), 'event_id 不合法', 'event-id'),
        need(isinstance(summary, dict), '缺少 summary', 'no-summary'),
        need(isinstance(summary, dict) and isinstance(summary.get('anomaly_features'), list)
             and all(isinstance(x, str) for x in summary['anomaly_features']), 'summary.anomaly_features 必須是文字清單', 'anomaly-features'),
        need(isinstance(summary, dict) and isinstance(summary.get('sop_keys'), list)
             and all(isinstance(x, str) for x in summary['sop_keys']), 'summary.sop_keys 必須是文字清單', 'sop-keys'),
        need(isinstance(summary, dict) and isinstance(summary.get('categorical'), dict), 'summary.categorical 必須是物件', 'categorical'),
        need(isinstance(diag, dict) and isinstance(diag.get('score_breakdown'), dict)
             and all(isinstance(diag['score_breakdown'].get(k), (int, float)) for k in ('anomaly', 'metrics', 'env')),
             'diagnosis_results.score_breakdown 需有數值的 anomaly、metrics、env', 'score-breakdown'),
        need(isinstance(feedback, dict), '缺少 feedback', 'no-feedback'),
        need(isinstance(conclusion, dict), '缺少 conclusion', 'no-conclusion'),
    ]
    return next((c for c in checks if c), None)


def check_case_records(path: Path, label: str) -> List[Finding]:
    """JSON Lines of confirmed cases. A record the similar-case search cannot read would stop the run there, so it is an error."""
    try:
        lines = path.read_text(encoding='utf-8').splitlines()
    except OSError as error:
        return [Finding('error', 'c', 'case-json', f'{label}無法讀取：{error}', key='case-json.1', params={'label': label, 'error': error})]
    found: List[Finding] = []
    for number, line in enumerate(lines, 1):
        if not line.strip():
            continue
        try:
            record = json.loads(line)
        except ValueError:
            found.append(Finding('error', 'c', 'case-json', f'{label}第 {number} 行不是有效的 JSON', key='case-json.2', params={'label': label, 'number': number}))
            break
        problem = validate_case_record(record, f'{label}第 {number} 行')
        if problem:
            found.append(Finding('error', 'c', 'case-record', f'{problem}；相似案例搜尋會在這筆失敗', key='case-record.1', params={'label': label, 'number': number, 'problem': problem}))
            break
    return found
