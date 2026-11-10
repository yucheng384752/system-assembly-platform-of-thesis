"""Looks at the client's files before a run and says what is wrong with them (docs/analytical-four-kit.md, section 10).

The engine tolerates a lot silently: a row with an empty cell is dropped, a repeated ID is merged, an unknown observer becomes
`All`, a renamed column becomes an empty field. Every case that changes a result without saying so is reported here, as an
error when the result would be wrong or the engine would fail anyway, and as a warning when the run can go on but means less.
Nothing in this module writes anything.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import pandas as pd

from app.analytical_four.engine.config_manager import FeatureConfig
from app.analytical_four.format_checks import (
    Finding, Term, check_analysis_config, check_case_records, check_knowledge, check_ng_code, check_topology, names, names_param, ng_categories,
    topology_features,
)
from app.analytical_four.settings import Settings, SettingsError, derive_config

VALID_OBSERVERS = ('P1', 'P2', 'P3', 'All')
VALID_METHODS = ('IQR Thresholds', '3sigma', 'min_max')
VALID_SERIALIZERS = ('UT',)
# Columns the UT serializer and the defect diagnosis read by name for the event context and the environment score.
CONTEXT_COLUMNS = ('P1.Machine_No.', 'P1.Material', 'Slitting machine', 'Winder number', 'Quality inspection', 'Quality control', 'P3.Machine_No.')
NG_CODE_COLUMNS = {'P2': 'P2.NG_code'}  # every other observer, All included, reads P3.NG_code
SOP_FIELDS = 7
EXAMPLES = 5


# upload kind -> (data_source section, key, source tag). The analysis configuration itself has no data_source entry.
KIND_TARGETS = {
    'current-data': ('current_data', 'descriptive', 'current'),
    'baseline-data': ('baseline_data', 'descriptive', 'baseline'),
    'ng-code': ('baseline_data', 'ng_code', 'ng-code'),
    'topology': ('baseline_data', 'topology', 'topology'),
    'knowledge': ('baseline_data', 'rag_knowledge', 'knowledge'),
    'case-records': ('case_data', 'llm_records', 'cases'),
    'case-errors': ('case_data', 'llm_error_records', 'cases'),
    'analysis-config': (None, None, 'config'),
}


class _Tagger:
    """Gives every finding added since the last call the name of the input it came from."""

    def __init__(self, errors: List[Finding], warnings: List[Finding]):
        self.lists, self.seen = (errors, warnings), [0, 0]

    def close(self, source: str) -> None:
        for number, items in enumerate(self.lists):
            for index in range(self.seen[number], len(items)):
                if not items[index].source:
                    items[index] = replace(items[index], source=source)
            self.seen[number] = len(items)


@dataclass
class Report:
    errors: List[Finding]
    warnings: List[Finding]
    summary: Dict[str, Any]

    def own(self, source: str) -> 'Report':
        """Only the findings about one input; the summary stays whole."""
        return Report([f for f in self.errors if f.source == source], [f for f in self.warnings if f.source == source], self.summary)

    def as_json(self) -> Dict[str, Any]:
        return {'ok': not self.errors, 'errors': [f.as_json() for f in self.errors], 'warnings': [f.as_json() for f in self.warnings], 'summary': self.summary}


_names = names


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
        findings.append(Finding('warning', 'a', 'mapping-unused', f'{Path(path).name} 沒有欄位對照中的這些欄位：{_names(unused)}', key='mapping-unused.1', params={'name': Path(path).name, 'unused': names_param(unused)}))
    active = {site: engine for site, engine in mapping.items() if site in frame.columns and site != engine}
    collisions = [engine for engine in active.values() if engine in frame.columns and engine not in active]
    if collisions:
        findings.append(Finding('error', 'a', 'mapping-collision', f'{Path(path).name} 已經有名為 {_names(collisions)} 的欄位，欄位對照會造成重複欄名', key='mapping-collision.1', params={'name': Path(path).name, 'collisions': names_param(collisions)}))
        return frame, findings
    return frame.rename(columns=active), findings


def apply_mapping(frame: pd.DataFrame, mapping: Dict[str, str]) -> pd.DataFrame:
    return frame.rename(columns={site: engine for site, engine in mapping.items() if site in frame.columns and site != engine})


def _config_problems(config: Dict[str, Any]) -> List[Finding]:
    found = []
    observer, method, serializer = config.get('observer', 'All'), config.get('method', 'IQR Thresholds'), config.get('serializer', 'UT')
    if observer not in VALID_OBSERVERS:
        found.append(Finding('error', 'a', 'observer', f'observer「{observer}」不支援（{"、".join(VALID_OBSERVERS)}）；引擎遇到不認得的值會悄悄改用 All', key='observer.1', params={'observer': observer, 'valid_observers': list(VALID_OBSERVERS)}))
    elif observer != 'All' and observer not in config['feature']:
        found.append(Finding('error', 'a', 'observer-group', f'observer 是 {observer}，但 feature 沒有 {observer} 這一組', key='observer-group.1', params={'observer': observer, 'observer_group': observer}))
    if method not in VALID_METHODS:
        found.append(Finding('error', 'a', 'method', f'method「{method}」不支援（{"、".join(VALID_METHODS)}）；引擎遇到不認得的值會悄悄改用 IQR Thresholds', key='method.1', params={'method': method, 'valid_methods': list(VALID_METHODS)}))
    if serializer not in VALID_SERIALIZERS:
        found.append(Finding('error', 'a', 'serializer', f'serializer「{serializer}」不支援（目前只有 {"、".join(VALID_SERIALIZERS)}）', key='serializer.1', params={'serializer': serializer, 'valid_serializers': list(VALID_SERIALIZERS)}))
    return found


def _numeric_problems(frame: pd.DataFrame, columns: List[str], label: str, summary: Dict[str, Any]) -> Tuple[List[Finding], pd.DataFrame]:
    found, converted = [], frame.copy()
    for column in columns:
        if column in frame.columns and frame[column].dtype == object:
            numbers = pd.to_numeric(frame[column], errors='coerce')
            text = frame[column][numbers.isna() & frame[column].notna()]
            if len(text):
                found.append(Finding('error', 'a', 'not-numeric', f'{label}的數值欄位「{column}」有 {len(text)} 筆不是數字（例：{_names(text.unique(), 3)}）', key='not-numeric.1', params={'label': label, 'column': column, 'count_text': len(text), 'items': names_param(text.unique(), 3)}))
            converted[column] = numbers
    return found, converted


def _duplicate_ids(frame: pd.DataFrame, id_column: str) -> List[Finding]:
    if not id_column or id_column not in frame.columns:
        return []
    repeated = frame[id_column][frame[id_column].duplicated(keep=False)]
    if not len(repeated):
        return []
    return [Finding('error', 'a', 'id-duplicate', f'ID 欄位「{id_column}」有 {repeated.nunique()} 個值重複（例：{_names(repeated.unique(), 3)}）；重複的列會被合併成同一個事件', key='id-duplicate.1', params={'id_column': id_column, 'count_repeated': repeated.nunique(), 'items': names_param(repeated.unique(), 3)})]


def _clean(frame: pd.DataFrame, columns: List[str]) -> pd.DataFrame:
    """What the engine's cleaning step keeps: the configured columns, minus all-empty columns, minus rows with any empty cell."""
    kept = frame[[c for c in columns if c in frame.columns]]
    return kept.dropna(axis=1, how='all').dropna(axis=0, how='any')


def inspect(settings: Settings, root: Optional[Path] = None, overrides: Optional[Dict[str, Path]] = None) -> Report:
    """`overrides` maps an upload kind to a file that is not in place yet, so it is judged as if it were."""
    errors: List[Finding] = []
    warnings: List[Finding] = []
    summary: Dict[str, Any] = {}
    tags = _Tagger(errors, warnings)
    overrides = overrides or {}
    try:
        config = derive_config(settings, root, overrides.get('analysis-config'))
    except SettingsError as error:
        return Report([Finding('error', 'a', 'config', str(error), 'config')], [], {})
    for kind, path in overrides.items():
        section, key, _ = KIND_TARGETS[kind]
        if section:
            config['data_source'][section][key] = str(path)
    errors += [f for f in check_analysis_config(config) if f.severity == 'error']
    warnings += [f for f in check_analysis_config(config) if f.severity == 'warning']
    if not errors:
        errors += _config_problems(config)
    tags.close('config')
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
        return Report(errors + [Finding('error', 'a', 'csv', f'待分析資料無法讀取：{error}', key='csv.1', params={'error': error})], warnings, summary)
    errors += [f for f in found if f.severity == 'error']
    warnings += [f for f in found if f.severity == 'warning']
    if any(f.code == 'mapping-collision' for f in found):
        return Report(errors, warnings, summary)
    summary['currentRows'] = len(current)

    if target not in current.columns:
        errors.append(Finding('error', 'a', 'target', f'待分析資料沒有目標欄位「{target}」', key='target.1', params={'target': target}))
    missing_categorical = [c for c in categorical if c not in current.columns]
    if missing_categorical:
        errors.append(Finding('error', 'a', 'categorical', f'待分析資料缺少設定的類別欄位：{_names(missing_categorical, 10)}', key='categorical.1', params={'missing_categorical': names_param(missing_categorical, 10)}))
    missing_numeric = [c for c in numeric if c not in current.columns]
    if len(missing_numeric) == len(numeric):
        errors.append(Finding('error', 'a', 'numeric', '設定的數值特徵在待分析資料中一個也找不到', key='numeric.1'))
    elif missing_numeric:
        warnings.append(Finding('warning', 'a', 'numeric-missing', f'設定的數值特徵有 {len(missing_numeric)} 個不在待分析資料中，會被略過：{_names(missing_numeric)}', key='numeric-missing.1', params={'count_missing_numeric': len(missing_numeric), 'missing_numeric': names_param(missing_numeric)}))
    problems, current = _numeric_problems(current, numeric, Term('current-data', '待分析資料'), summary)
    errors += problems
    if id_column and id_column not in current.columns:
        warnings.append(Finding('warning', 'a', 'id-missing', f'待分析資料沒有 ID 欄位「{id_column}」，事件會以列號識別', key='id-missing.1', params={'id_column': id_column}))
    elif complain:
        errors += _duplicate_ids(current, id_column)

    cleaned = _clean(current, numeric + categorical + [target] + ([id_column] if id_column else []))
    dropped = len(current) - len(cleaned)
    summary['cleanedRows'] = len(cleaned)
    if len(cleaned) == 0 and len(current):
        errors.append(Finding('error', 'a', 'cleaning', '清理後（刪除有空值的列）沒有剩下任何資料列', key='cleaning.1'))
    elif dropped:
        empty = [c for c in current.columns if c in numeric + categorical + [target] and current[c].isna().any()]
        warnings.append(Finding('warning', 'a', 'rows-dropped', f'待分析資料有 {dropped} 列因含空值被引擎刪除；有空值的欄位：{_names(empty)}', key='rows-dropped.1', params={'dropped': dropped, 'empty': names_param(empty)}))

    tags.close('current')
    baseline = None
    if complain:
        baseline_path = source['baseline_data'].get('descriptive', '')
        if baseline_path and Path(baseline_path).is_file():
            try:
                baseline, found = load_table(baseline_path, mapping)
            except (OSError, ValueError, pd.errors.ParserError) as error:
                errors.append(Finding('error', 'a', 'csv', f'正常基準資料無法讀取：{error}', key='csv.2', params={'error': error}))
            else:
                errors += [f for f in found if f.severity == 'error']
                warnings += [f for f in found if f.severity == 'warning']
                shared = [c for c in numeric if c in current.columns]
                absent = [c for c in shared if c not in baseline.columns]
                if absent:
                    errors.append(Finding('error', 'a', 'baseline-missing-feature', f'正常基準資料缺少待分析資料有的數值特徵：{_names(absent, 10)}', key='baseline-missing-feature.1', params={'absent': names_param(absent, 10)}))
                holes = {c: int(baseline[c].isna().sum()) for c in shared if c in baseline.columns and baseline[c].isna().any()}  # before text is coerced, so text is not counted twice
                problems, baseline = _numeric_problems(baseline, numeric, Term('baseline-data', '正常基準資料'), summary)
                errors += problems
                if holes:
                    # complaint mode does not clean the baseline, so an empty cell reaches the principal component analysis
                    errors.append(Finding('error', 'a', 'baseline-empty-cells', '正常基準資料有空值，引擎不會清理基準：' + '；'.join(f'{c} {n} 筆' for c, n in list(holes.items())[:EXAMPLES]), key='baseline-empty-cells.1',
                                  params={'columns': [f'{c} ({n})' for c, n in list(holes.items())[:EXAMPLES]]}))
        tags.close('baseline')
    elif target in current.columns and len(cleaned):
        groups = sorted(cleaned[target].unique().tolist()) if target in cleaned.columns else []
        if len(groups) < 2:
            errors.append(Finding('error', 'a', 'target-groups', f'每日模式要用目標欄位「{target}」把資料分成待查與基準兩組，但清理後只有 {len(groups)} 種值', key='target-groups.1', params={'target': target, 'count_groups': len(groups)}))
        else:
            sample = cleaned[cleaned[target] == groups[0]]
            sample_rows = len(sample)
            if id_column in sample.columns:
                errors += _duplicate_ids(sample, id_column)  # only the rows that become events need unique IDs
            baseline = cleaned[cleaned[target] == groups[1]]
            summary.update({'sampleGroup': groups[0], 'sampleRows': sample_rows, 'baselineGroup': groups[1],
                            'otherGroups': groups[2:]})
            if len(groups) > 2:
                warnings.append(Finding('warning', 'a', 'target-extra-groups', f'目標欄位有 {len(groups)} 種值，引擎只用最小的兩組（待查 {groups[0]}、基準 {groups[1]}），其餘 {_names(groups[2:])} 不會被分析', key='target-extra-groups.1', params={'count_groups': len(groups), 'candidate': groups[0], 'baseline': groups[1], 'items': names_param(groups[2:])}))
        tags.close('current')
    if baseline is not None:
        usable = [c for c in numeric if c in baseline.columns]
        summary['baselineRows'] = len(baseline)
        if len(baseline) < 2:
            errors.append(Finding('error', 'a', 'baseline-rows', f'正常基準只有 {len(baseline)} 列，無法算標準差與控制界線', key='baseline-rows.1', params={'count_baseline': len(baseline)}))
        elif len(baseline) <= len(usable):
            warnings.append(Finding('warning', 'a', 'baseline-small', f'正常基準 {len(baseline)} 列不多於數值特徵 {len(usable)} 個，主成分與控制界線不可靠', key='baseline-small.1', params={'count_baseline': len(baseline), 'count_usable': len(usable)}))
        flat = [c for c in usable if baseline[c].nunique(dropna=True) <= 1]
        if flat:
            warnings.append(Finding('warning', 'a', 'baseline-constant', f'正常基準中這些特徵的值全部相同，無法判斷偏離：{_names(flat)}', key='baseline-constant.1', params={'flat': names_param(flat)}))
        tags.close('baseline' if complain else 'current')

    if 'b' in layers or 'c' in layers:
        absent = [c for c in CONTEXT_COLUMNS if c not in current.columns or c not in categorical]
        if absent:
            warnings.append(Finding('warning', 'b' if 'b' in layers else 'c', 'context-missing',
                                    f'這些情境欄位不在資料中，或沒有列入設定的類別欄位：{_names(absent, 10)}。事件的這些欄位會是空的，不良類型的環境分數與相似案例的比對會退化；欄名不同時，請在設定的欄位對照中對到這些名稱', key='context-missing.1', params={'absent': names_param(absent, 10)}))
    tags.close('current')
    if 'b' in layers:
        ng_path = source['baseline_data'].get('ng_code', '')
        if ng_path and Path(ng_path).is_file():
            found = check_ng_code(Path(ng_path))
            errors += [f for f in found if f.severity == 'error']
            warnings += [f for f in found if f.severity == 'warning']
            defined = set(ng_categories(Path(ng_path)))
        else:
            defined = set()
        tags.close('ng-code')
        ng_column = ng_code_column(config.get('observer', 'All'))
        if not complain:
            if ng_column not in categorical or ng_column not in current.columns:
                errors.append(Finding('error', 'b', 'ng-column', f'每日模式的不良類型診斷用「{ng_column}」建立不良特徵分布庫，但這個欄位不在資料中，或沒有列入設定的類別欄位', key='ng-column.1', params={'ng_column': ng_column}))
            elif len(cleaned) and ng_column in cleaned.columns:
                rows = cleaned[cleaned[target] == summary['sampleGroup']] if 'sampleGroup' in summary else cleaned
                labelled = int((~rows[ng_column].astype(str).str.strip().str.lower().isin(['0', '', 'nan', 'none', 'null'])).sum())
                summary['labelledSamples'] = labelled
                used = set(rows[ng_column].astype(str).str.strip()) - {'0', '', 'nan', 'None', 'none', 'null'}
                undefined = sorted(used - defined) if defined else []
                if undefined:
                    warnings.append(Finding('warning', 'b', 'ng-undefined', f'資料裡的不良代碼不在不良代碼定義中，診斷結果不會有原因與處置：{names(undefined)}', 'ng-code', key='ng-undefined.1', params={'undefined': names_param(undefined)}))
                if labelled == 0:
                    warnings.append(Finding('warning', 'b', 'ng-labels', f'待查樣本的「{ng_column}」沒有任何有效的不良代碼，分布庫會是空的', key='ng-labels.1', params={'ng_column': ng_column}))
        else:
            known_base = source['baseline_data'].get('prescriptive', '')
            try:
                library = json.loads(Path(known_base).read_text(encoding='utf-8')) if known_base and Path(known_base).is_file() else None
            except (OSError, ValueError):
                library = None
            if not library or not isinstance(library, dict):
                errors.append(Finding('error', 'b', 'known-base', '不良特徵分布庫不存在、無法讀取或是空的；請先用每日模式與已標註的樣本建立', 'known-base', key='known-base.1'))
            else:
                summary['knownDefectCodes'] = len(library)
    tags.close('current')
    if 'c' in layers:
        topology_path = source['baseline_data'].get('topology', '')
        if topology_path and Path(topology_path).is_file():
            found = check_topology(Path(topology_path))
            errors += [f for f in found if f.severity == 'error']
            warnings += [f for f in found if f.severity == 'warning']
            if not any(f.severity == 'error' for f in found):
                warnings += _topology_matches(Path(topology_path), set(current.columns), numeric)
        tags.close('topology')
        sop_path = source['baseline_data'].get('rag_knowledge', '')
        if sop_path and Path(sop_path).is_file():
            found = check_knowledge(Path(sop_path))
            errors += [f for f in found if f.severity == 'error']
            warnings += [f for f in found if f.severity == 'warning']
        tags.close('knowledge')
        if complain:
            for key, label in (('llm_records', Term('case-records', '歷史案例檔')), ('llm_error_records', Term('error-case-records', '誤判案例檔'))):
                path = source['case_data'].get(key, '')
                if path and Path(path).is_file():
                    errors += check_case_records(Path(path), label)
        tags.close('cases')
    return Report(errors, warnings, summary)


def _topology_matches(path: Path, columns: set, numeric: List[str]) -> List[Finding]:
    """Topology features are matched to data columns by name; the ones that do not match are skipped by the engine."""
    features = topology_features(path)
    found = []
    unknown = [n for n in features['names'] if n not in columns]
    if unknown:
        found.append(Finding('warning', 'c', 'topology-unmatched', f'拓樸有 {len(unknown)} 個特徵的名稱不是資料的欄名，事件裡的對應特徵會被略過：{_names(unknown)}', key='topology-unmatched.1', params={'count_unknown': len(unknown), 'unknown': names_param(unknown)}))
    unplaced = [c for c in numeric if c not in features['names'] and c not in features['ids']]
    if unplaced:
        found.append(Finding('warning', 'c', 'topology-uncovered', f'有 {len(unplaced)} 個數值特徵不在拓樸中，異常時無法對應到製程位置：{_names(unplaced)}', key='topology-uncovered.1', params={'count_unplaced': len(unplaced), 'unplaced': names_param(unplaced)}))
    return found
