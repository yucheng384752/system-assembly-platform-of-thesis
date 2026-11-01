"""Looks at the client's files before a run and says what is wrong with them (docs/analytical-four-kit.md, section 10).

The engine tolerates a lot silently: a row with an empty cell is dropped, a repeated ID is merged, an unknown observer becomes
`All`, a renamed column becomes an empty field. Every case that changes a result without saying so is reported here, as an
error when the result would be wrong or the engine would fail anyway, and as a warning when the run can go on but means less.
Nothing in this module writes anything.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import pandas as pd

from app.analytical_four.engine.config_manager import FeatureConfig
from app.analytical_four.settings import Settings, SettingsError, derive_config

VALID_OBSERVERS = ('P1', 'P2', 'P3', 'All')
VALID_METHODS = ('IQR Thresholds', '3sigma', 'min_max')
VALID_SERIALIZERS = ('UT',)
# Columns the UT serializer and the defect diagnosis read by name for the event context and the environment score.
CONTEXT_COLUMNS = ('P1.Machine_No.', 'P1.Material', 'Slitting machine', 'Winder number', 'Quality inspection', 'Quality control', 'P3.Machine_No.')
NG_CODE_COLUMNS = {'P2': 'P2.NG_code'}  # every other observer, All included, reads P3.NG_code
SOP_FIELDS = 7
EXAMPLES = 5


@dataclass(frozen=True)
class Finding:
    severity: str  # 'error' blocks a run; 'warning' is shown with the run
    layer: str
    code: str
    message: str

    def as_json(self) -> Dict[str, str]:
        return {'layer': self.layer, 'code': self.code, 'message': self.message}


@dataclass
class Report:
    errors: List[Finding]
    warnings: List[Finding]
    summary: Dict[str, Any]

    def as_json(self) -> Dict[str, Any]:
        return {'ok': not self.errors, 'errors': [f.as_json() for f in self.errors], 'warnings': [f.as_json() for f in self.warnings], 'summary': self.summary}


def _names(values, limit: int = EXAMPLES) -> str:
    values = [str(v) for v in values]
    return '、'.join(values[:limit]) + (f' 等 {len(values)} 個' if len(values) > limit else '')


def ng_code_column(observer: str) -> str:
    return NG_CODE_COLUMNS.get(observer, 'P3.NG_code')


def active_features(config: Dict[str, Any]) -> FeatureConfig:
    """The feature group the engine will use: one station's, or all of them merged the way the engine merges them."""
    groups = {name: FeatureConfig(numerical=list(v.get('numerical', [])), categorical={k: list(x) for k, x in v.get('categorical', {}).items()},
                                  target=v.get('target', ''), id=v.get('id', '')) for name, v in config['feature'].items()}
    if config.get('observer', 'All') in groups:
        return groups[config['observer']]
    merged = FeatureConfig(numerical=[], categorical={'Man': [], 'Machine': [], 'Material': [], 'Method': [], 'Environment': [], 'Measurement': []}, target='', id='')
    for group in groups.values():
        merged = merged.merge(group)
    return merged


def load_table(path: str, mapping: Dict[str, str]) -> Tuple[pd.DataFrame, List[Finding]]:
    """Reads a CSV and renames site columns to the engine's names. Collisions are reported, not resolved."""
    frame = pd.read_csv(path)
    findings: List[Finding] = []
    unused = [site for site in mapping if site not in frame.columns]
    if unused:
        findings.append(Finding('warning', 'a', 'mapping-unused', f'{Path(path).name} 沒有欄位對照中的這些欄位：{_names(unused)}'))
    active = {site: engine for site, engine in mapping.items() if site in frame.columns and site != engine}
    collisions = [engine for engine in active.values() if engine in frame.columns and engine not in active]
    if collisions:
        findings.append(Finding('error', 'a', 'mapping-collision', f'{Path(path).name} 已經有名為 {_names(collisions)} 的欄位，欄位對照會造成重複欄名'))
        return frame, findings
    return frame.rename(columns=active), findings


def apply_mapping(frame: pd.DataFrame, mapping: Dict[str, str]) -> pd.DataFrame:
    return frame.rename(columns={site: engine for site, engine in mapping.items() if site in frame.columns and site != engine})


def _config_problems(config: Dict[str, Any]) -> List[Finding]:
    found = []
    observer, method, serializer = config.get('observer', 'All'), config.get('method', 'IQR Thresholds'), config.get('serializer', 'UT')
    if observer not in VALID_OBSERVERS:
        found.append(Finding('error', 'a', 'observer', f'observer「{observer}」不支援（{"、".join(VALID_OBSERVERS)}）；引擎遇到不認得的值會悄悄改用 All'))
    elif observer != 'All' and observer not in config['feature']:
        found.append(Finding('error', 'a', 'observer-group', f'observer 是 {observer}，但 feature 沒有 {observer} 這一組'))
    if method not in VALID_METHODS:
        found.append(Finding('error', 'a', 'method', f'method「{method}」不支援（{"、".join(VALID_METHODS)}）；引擎遇到不認得的值會悄悄改用 IQR Thresholds'))
    if serializer not in VALID_SERIALIZERS:
        found.append(Finding('error', 'a', 'serializer', f'serializer「{serializer}」不支援（目前只有 {"、".join(VALID_SERIALIZERS)}）'))
    return found


def _numeric_problems(frame: pd.DataFrame, columns: List[str], label: str, summary: Dict[str, Any]) -> Tuple[List[Finding], pd.DataFrame]:
    found, converted = [], frame.copy()
    for column in columns:
        if column in frame.columns and frame[column].dtype == object:
            numbers = pd.to_numeric(frame[column], errors='coerce')
            text = frame[column][numbers.isna() & frame[column].notna()]
            if len(text):
                found.append(Finding('error', 'a', 'not-numeric', f'{label}的數值欄位「{column}」有 {len(text)} 筆不是數字（例：{_names(text.unique(), 3)}）'))
            converted[column] = numbers
    return found, converted


def _duplicate_ids(frame: pd.DataFrame, id_column: str) -> List[Finding]:
    if not id_column or id_column not in frame.columns:
        return []
    repeated = frame[id_column][frame[id_column].duplicated(keep=False)]
    if not len(repeated):
        return []
    return [Finding('error', 'a', 'id-duplicate', f'ID 欄位「{id_column}」有 {repeated.nunique()} 個值重複（例：{_names(repeated.unique(), 3)}）；重複的列會被合併成同一個事件')]


def _clean(frame: pd.DataFrame, columns: List[str]) -> pd.DataFrame:
    """What the engine's cleaning step keeps: the configured columns, minus all-empty columns, minus rows with any empty cell."""
    kept = frame[[c for c in columns if c in frame.columns]]
    return kept.dropna(axis=1, how='all').dropna(axis=0, how='any')


def inspect(settings: Settings, root: Optional[Path] = None) -> Report:
    errors: List[Finding] = []
    warnings: List[Finding] = []
    summary: Dict[str, Any] = {}
    try:
        config = derive_config(settings, root)
    except SettingsError as error:
        return Report([Finding('error', 'a', 'config', str(error))], [], {})
    errors += _config_problems(config)
    if errors:
        return Report(errors, warnings, summary)
    layers = settings.enabled()
    features = active_features(config)
    source = config['data_source']
    mapping = settings.columnMapping
    categorical = sorted({c for group in features.categorical.values() for c in group})
    numeric, target, id_column = list(features.numerical), features.target, features.id
    complain = settings.mode == 'complain'
    summary.update({'numericFeatures': len(numeric), 'categoricalColumns': len(categorical), 'target': target, 'id': id_column})

    current_path = source['current_data'].get('descriptive', '')
    if not current_path or not Path(current_path).is_file():
        return Report(errors, warnings, summary)  # the readiness check reports a missing file
    try:
        current, found = load_table(current_path, mapping)
    except (OSError, ValueError, pd.errors.ParserError) as error:
        return Report(errors + [Finding('error', 'a', 'csv', f'待分析資料無法讀取：{error}')], warnings, summary)
    errors += [f for f in found if f.severity == 'error']
    warnings += [f for f in found if f.severity == 'warning']
    if any(f.code == 'mapping-collision' for f in found):
        return Report(errors, warnings, summary)
    summary['currentRows'] = len(current)

    if target not in current.columns:
        errors.append(Finding('error', 'a', 'target', f'待分析資料沒有目標欄位「{target}」'))
    missing_categorical = [c for c in categorical if c not in current.columns]
    if missing_categorical:
        errors.append(Finding('error', 'a', 'categorical', f'待分析資料缺少設定的類別欄位：{_names(missing_categorical, 10)}'))
    missing_numeric = [c for c in numeric if c not in current.columns]
    if len(missing_numeric) == len(numeric):
        errors.append(Finding('error', 'a', 'numeric', '設定的數值特徵在待分析資料中一個也找不到'))
    elif missing_numeric:
        warnings.append(Finding('warning', 'a', 'numeric-missing', f'設定的數值特徵有 {len(missing_numeric)} 個不在待分析資料中，會被略過：{_names(missing_numeric)}'))
    problems, current = _numeric_problems(current, numeric, '待分析資料', summary)
    errors += problems
    if id_column and id_column not in current.columns:
        warnings.append(Finding('warning', 'a', 'id-missing', f'待分析資料沒有 ID 欄位「{id_column}」，事件會以列號識別'))
    elif complain:
        errors += _duplicate_ids(current, id_column)

    cleaned = _clean(current, numeric + categorical + [target] + ([id_column] if id_column else []))
    dropped = len(current) - len(cleaned)
    summary['cleanedRows'] = len(cleaned)
    if len(cleaned) == 0 and len(current):
        errors.append(Finding('error', 'a', 'cleaning', '清理後（刪除有空值的列）沒有剩下任何資料列'))
    elif dropped:
        empty = [c for c in current.columns if c in numeric + categorical + [target] and current[c].isna().any()]
        warnings.append(Finding('warning', 'a', 'rows-dropped', f'待分析資料有 {dropped} 列因含空值被引擎刪除；有空值的欄位：{_names(empty)}'))

    baseline = None
    if complain:
        baseline_path = source['baseline_data'].get('descriptive', '')
        if baseline_path and Path(baseline_path).is_file():
            try:
                baseline, found = load_table(baseline_path, mapping)
            except (OSError, ValueError, pd.errors.ParserError) as error:
                errors.append(Finding('error', 'a', 'csv', f'正常基準資料無法讀取：{error}'))
            else:
                errors += [f for f in found if f.severity == 'error']
                warnings += [f for f in found if f.severity == 'warning']
                shared = [c for c in numeric if c in current.columns]
                absent = [c for c in shared if c not in baseline.columns]
                if absent:
                    errors.append(Finding('error', 'a', 'baseline-missing-feature', f'正常基準資料缺少待分析資料有的數值特徵：{_names(absent, 10)}'))
                holes = {c: int(baseline[c].isna().sum()) for c in shared if c in baseline.columns and baseline[c].isna().any()}  # before text is coerced, so text is not counted twice
                problems, baseline = _numeric_problems(baseline, numeric, '正常基準資料', summary)
                errors += problems
                if holes:
                    # complaint mode does not clean the baseline, so an empty cell reaches the principal component analysis
                    errors.append(Finding('error', 'a', 'baseline-empty-cells', '正常基準資料有空值，引擎不會清理基準：' + '；'.join(f'{c} {n} 筆' for c, n in list(holes.items())[:EXAMPLES])))
    elif target in current.columns and len(cleaned):
        groups = sorted(cleaned[target].unique().tolist()) if target in cleaned.columns else []
        if len(groups) < 2:
            errors.append(Finding('error', 'a', 'target-groups', f'每日模式要用目標欄位「{target}」把資料分成待查與基準兩組，但清理後只有 {len(groups)} 種值'))
        else:
            sample = cleaned[cleaned[target] == groups[0]]
            sample_rows = len(sample)
            if id_column in sample.columns:
                errors += _duplicate_ids(sample, id_column)  # only the rows that become events need unique IDs
            baseline = cleaned[cleaned[target] == groups[1]]
            summary.update({'sampleGroup': groups[0], 'sampleRows': sample_rows, 'baselineGroup': groups[1],
                            'otherGroups': groups[2:]})
            if len(groups) > 2:
                warnings.append(Finding('warning', 'a', 'target-extra-groups', f'目標欄位有 {len(groups)} 種值，引擎只用最小的兩組（待查 {groups[0]}、基準 {groups[1]}），其餘 {_names(groups[2:])} 不會被分析'))
    if baseline is not None:
        usable = [c for c in numeric if c in baseline.columns]
        summary['baselineRows'] = len(baseline)
        if len(baseline) < 2:
            errors.append(Finding('error', 'a', 'baseline-rows', f'正常基準只有 {len(baseline)} 列，無法算標準差與控制界線'))
        elif len(baseline) <= len(usable):
            warnings.append(Finding('warning', 'a', 'baseline-small', f'正常基準 {len(baseline)} 列不多於數值特徵 {len(usable)} 個，主成分與控制界線不可靠'))
        flat = [c for c in usable if baseline[c].nunique(dropna=True) <= 1]
        if flat:
            warnings.append(Finding('warning', 'a', 'baseline-constant', f'正常基準中這些特徵的值全部相同，無法判斷偏離：{_names(flat)}'))

    if 'b' in layers or 'c' in layers:
        absent = [c for c in CONTEXT_COLUMNS if c not in current.columns or c not in categorical]
        if absent:
            warnings.append(Finding('warning', 'b' if 'b' in layers else 'c', 'context-missing',
                                    f'這些情境欄位不在資料中，或沒有列入設定的類別欄位：{_names(absent, 10)}。事件的這些欄位會是空的，不良類型的環境分數與相似案例的比對會退化；欄名不同時，請在設定的欄位對照中對到這些名稱'))
    if 'b' in layers:
        ng_column = ng_code_column(config.get('observer', 'All'))
        if not complain:
            if ng_column not in categorical or ng_column not in current.columns:
                errors.append(Finding('error', 'b', 'ng-column', f'每日模式的不良類型診斷用「{ng_column}」建立不良特徵分布庫，但這個欄位不在資料中，或沒有列入設定的類別欄位'))
            elif len(cleaned) and ng_column in cleaned.columns:
                rows = cleaned[cleaned[target] == summary['sampleGroup']] if 'sampleGroup' in summary else cleaned
                labelled = int((~rows[ng_column].astype(str).str.strip().str.lower().isin(['0', '', 'nan', 'none', 'null'])).sum())
                summary['labelledSamples'] = labelled
                if labelled == 0:
                    warnings.append(Finding('warning', 'b', 'ng-labels', f'待查樣本的「{ng_column}」沒有任何有效的不良代碼，分布庫會是空的'))
        else:
            known_base = source['baseline_data'].get('prescriptive', '')
            try:
                library = json.loads(Path(known_base).read_text(encoding='utf-8')) if known_base and Path(known_base).is_file() else None
            except (OSError, ValueError):
                library = None
            if not library or not isinstance(library, dict):
                errors.append(Finding('error', 'b', 'known-base', '不良特徵分布庫不存在、無法讀取或是空的；請先用每日模式與已標註的樣本建立'))
            else:
                summary['knownDefectCodes'] = len(library)
    if 'c' in layers:
        warnings += _topology_findings(source, set(current.columns), numeric)
        warnings += _sop_findings(source)
        if complain:
            errors += _case_file_errors(source)
    return Report(errors, warnings, summary)


def _topology_findings(source: Dict[str, Any], columns: set, numeric: List[str]) -> List[Finding]:
    path = source['baseline_data'].get('topology', '')
    if not path or not Path(path).is_file():
        return []
    try:
        topology = json.loads(Path(path).read_text(encoding='utf-8'))
        names = [f['name'] for station in topology['topology'].values() for f in station.get('feature', [])]
        ids = [f['id'] for station in topology['topology'].values() for f in station.get('feature', [])]
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        return [Finding('warning', 'c', 'topology-format', '製程拓樸檔的結構不符（需要 topology.<站點>.feature[].{id,name}）')]
    found = []
    unknown = [n for n in names if n not in columns]
    if unknown:
        found.append(Finding('warning', 'c', 'topology-unmatched', f'拓樸有 {len(unknown)} 個特徵的名稱不是資料的欄名，事件裡的對應特徵會被略過：{_names(unknown)}'))
    unplaced = [c for c in numeric if c not in names and c not in ids]
    if unplaced:
        found.append(Finding('warning', 'c', 'topology-uncovered', f'有 {len(unplaced)} 個數值特徵不在拓樸中，異常時無法對應到製程位置：{_names(unplaced)}'))
    return found


def _sop_findings(source: Dict[str, Any]) -> List[Finding]:
    path = source['baseline_data'].get('rag_knowledge', '')
    if not path or not Path(path).is_file():
        return []
    lines = [x for x in Path(path).read_text(encoding='utf-8-sig').splitlines() if x.strip()]
    expected = len(lines[0].split(',')) if lines else SOP_FIELDS
    odd = [n for n, line in enumerate(lines[1:], 2) if len(line.split(',')) != expected]
    if odd:
        return [Finding('warning', 'c', 'sop-fields', f'SOP 知識檔有 {len(odd)} 列的欄位數與標題列（{expected} 欄）不同，常見原因是欄位內含逗號；欄位數少於 {SOP_FIELDS} 的列不會出現在事件的 SOP 清單，其餘會錯位；第 {_names(odd, 3)} 列')]
    return []


def _case_file_errors(source: Dict[str, Any]) -> List[Finding]:
    found = []
    for key, label in (('llm_records', '歷史案例檔'), ('llm_error_records', '誤判案例檔')):
        path = source['case_data'].get(key, '')
        if not path or not Path(path).is_file():
            continue
        for number, line in enumerate(Path(path).read_text(encoding='utf-8').splitlines(), 1):
            if line.strip():
                try:
                    json.loads(line)
                except ValueError:
                    found.append(Finding('error', 'c', 'case-json', f'{label}第 {number} 行不是有效的 JSON'))
                    break
    return found
