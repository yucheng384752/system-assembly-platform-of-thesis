"""Kit settings and the readiness check for each analysis layer (docs/analytical-four-kit.md, sections 2 and 3).

Everything an operator can change lives in `settings.json` inside the Kit data directory. The analysis configuration the
engine reads is a separate file in the original Analytical-Four format; the Kit never edits it, it only derives a copy with
absolute paths (all confined to the data directory), the chosen mode and the LLM address.
"""
from __future__ import annotations

import json
import os
import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

DEFAULT_DATA_DIR = '/system/data/analytical-four'
SETTINGS_FILE = 'settings.json'
LAYERS = ('a', 'b', 'c')
# data_source keys that hold a path: (section, key). Every one is resolved inside the data directory.
PATH_FIELDS = (
    ('current_data', 'descriptive'),
    ('baseline_data', 'descriptive'), ('baseline_data', 'diagnostic'), ('baseline_data', 'prescriptive'),
    ('baseline_data', 'topology'), ('baseline_data', 'rag_knowledge'), ('baseline_data', 'prompts'), ('baseline_data', 'ng_code'),
    ('case_data', 'llm_records'), ('case_data', 'llm_error_records'),
    ('rag_setting', 'db_path'),
)


class SettingsError(Exception):
    """The settings or the analysis configuration cannot be used. The message is for the operator."""


def atomic_replace(source: Path, target: Path) -> None:
    """os.replace that waits out a reader. On Windows the target cannot be replaced while another thread has it open
    (a status poll reading the file), which is a moment, not an error; elsewhere the first attempt succeeds."""
    for attempt in range(40):
        try:
            os.replace(source, target)
            return
        except PermissionError:
            if attempt == 39:
                raise
            time.sleep(0.05)


def data_dir() -> Path:
    return Path(os.environ.get('ANALYTICAL_FOUR_DATA_DIR') or DEFAULT_DATA_DIR)


class Layers(BaseModel):
    model_config = ConfigDict(extra='forbid')
    a: bool = True
    b: bool = True
    c: bool = False


class Llm(BaseModel):
    model_config = ConfigDict(extra='forbid')
    # Empty means "not set". The address receives event data, so it must be a service the operator trusts.
    endpoint: str = Field(default='', max_length=500)
    timeoutSeconds: int = Field(default=120, ge=1, le=900)
    # Name of an environment variable that holds a bearer token. The token itself is never stored (secret_ref).
    apiKeyEnv: str = Field(default='', max_length=64, pattern=r'^([A-Z][A-Z0-9_]*)?$')

    @model_validator(mode='after')
    def endpoint_is_plain_http(self):
        if not self.endpoint:
            return self
        if re.search(r'[\s\x00-\x1f]', self.endpoint):
            raise ValueError('LLM 位址不可含空白或控制字元')
        parts = urlsplit(self.endpoint)
        if parts.scheme not in ('http', 'https') or not parts.hostname:
            raise ValueError('LLM 位址必須是 http 或 https 網址')
        if parts.username or parts.password:
            raise ValueError('LLM 位址不可內含帳號或密碼；請改用 apiKeyEnv 指定存放金鑰的環境變數')
        return self


class Settings(BaseModel):
    model_config = ConfigDict(extra='forbid')
    schemaVersion: Literal[1] = 1
    layers: Layers = Field(default_factory=Layers)
    mode: Literal['daily', 'complain'] = 'daily'
    analysisConfig: str = Field(default='config/analysis_config.json', min_length=1, max_length=200)
    llm: Llm = Field(default_factory=Llm)
    # Site column name -> the name the analysis configuration and the engine use. Applied to every CSV right after it is read.
    columnMapping: Dict[str, str] = Field(default_factory=dict)

    @model_validator(mode='after')
    def mapping_is_one_to_one(self):
        if len(self.columnMapping) > 200:
            raise ValueError('欄位對照最多 200 筆')
        for site, engine in self.columnMapping.items():
            for name in (site, engine):
                if not name.strip() or name != name.strip() or len(name) > 100:
                    raise ValueError('欄位對照的欄名不可空白、不可前後有空白、最長 100 字')
        targets = list(self.columnMapping.values())
        duplicated = sorted({x for x in targets if targets.count(x) > 1})
        if duplicated:
            raise ValueError(f'欄位對照有多個欄位對到同一個名稱：{"、".join(duplicated)}')
        return self

    @model_validator(mode='after')
    def layers_are_consistent(self):
        on = self.layers
        if on.b and not on.a:
            raise ValueError('B 層（不良類型診斷）需要先啟用 A 層')
        if on.c and not on.a:
            raise ValueError('C 層（完整 AI 診斷）需要先啟用 A 層')
        if on.c and self.mode == 'complain' and not on.b:
            raise ValueError('客訴分析模式的 C 層需要 B 層的不良類型結果，請一併啟用 B 層')
        return self

    def enabled(self) -> List[str]:
        return [name for name in LAYERS if getattr(self.layers, name)]


def resolve_inside(root: Path, relative: str, label: str) -> Path:
    """A path from settings or from the analysis configuration, forced to stay inside the data directory."""
    if not isinstance(relative, str) or not relative.strip():
        raise SettingsError(f'{label} 沒有填寫')
    candidate = Path(relative)
    if candidate.is_absolute() or candidate.drive or '..' in candidate.parts:
        raise SettingsError(f'{label} 必須是資料目錄內的相對路徑')
    resolved = (root / candidate).resolve()
    if root.resolve() != resolved and root.resolve() not in resolved.parents:
        raise SettingsError(f'{label} 超出資料目錄')
    return resolved


def load_settings(root: Path | None = None) -> Settings:
    root = root or data_dir()
    path = root / SETTINGS_FILE
    if not path.exists():
        return Settings()
    try:
        return Settings.model_validate_json(path.read_text(encoding='utf-8'))
    except (ValidationError, ValueError, OSError) as error:
        raise SettingsError(f'settings.json 無法使用：{error}') from error


def save_settings(settings: Settings, root: Path | None = None) -> None:
    root = root or data_dir()
    root.mkdir(parents=True, exist_ok=True)
    target = root / SETTINGS_FILE
    temporary = root / f'{SETTINGS_FILE}.tmp'
    temporary.write_text(settings.model_dump_json(indent=2), encoding='utf-8')
    atomic_replace(temporary, target)


def read_analysis_config(settings: Settings, root: Path | None = None) -> Dict[str, Any]:
    """The analysis configuration exactly as stored, checked for the sections the engine cannot start without."""
    root = root or data_dir()
    path = resolve_inside(root, settings.analysisConfig, '分析設定檔')
    if not path.is_file():
        raise SettingsError(f'找不到分析設定檔：{settings.analysisConfig}')
    try:
        config = json.loads(path.read_text(encoding='utf-8-sig'))
    except (ValueError, OSError) as error:
        raise SettingsError(f'分析設定檔不是有效的 JSON：{error}') from error
    if not isinstance(config, dict):
        raise SettingsError('分析設定檔最上層必須是物件')
    source = config.get('data_source')
    if not isinstance(source, dict):
        raise SettingsError('分析設定檔缺少 data_source')
    for section in ('current_data', 'baseline_data', 'case_data', 'rag_setting'):
        if not isinstance(source.get(section), dict):
            raise SettingsError(f'分析設定檔缺少 data_source.{section}')
    for field in ('rag_setting',):
        missing = [key for key in ('builder_type', 'db_path', 'collection_name') if not source[field].get(key)]
        if missing:
            raise SettingsError(f'分析設定檔的 data_source.rag_setting 缺少 {"、".join(missing)}')
    if not isinstance(config.get('feature'), dict) or not config['feature']:
        raise SettingsError('分析設定檔缺少 feature')
    return config


def derive_config(settings: Settings, root: Path | None = None) -> Dict[str, Any]:
    """The configuration handed to the engine: absolute paths inside the data directory, the Kit's mode and LLM address."""
    root = root or data_dir()
    config = read_analysis_config(settings, root)
    source = config['data_source']
    for section, key in PATH_FIELDS:
        value = source[section].get(key)
        if value:  # an empty path means "not used"; a layer that needs it reports that in readiness()
            source[section][key] = str(resolve_inside(root, value, f'data_source.{section}.{key}'))
    config['mode'] = settings.mode
    source.setdefault('llm_setting', {})['api_endpoint'] = settings.llm.endpoint
    return config


@dataclass(frozen=True)
class Problem:
    layer: str
    code: str
    message: str


def _needs_file(problems: List[Problem], layer: str, path: str, label: str, code: str) -> None:
    if not path:
        problems.append(Problem(layer, code, f'{label} 沒有設定'))
    elif not Path(path).is_file():
        problems.append(Problem(layer, code, f'找不到{label}'))


def readiness(settings: Settings, root: Path | None = None) -> Dict[str, List[Problem]]:
    """For every enabled layer, what is missing before a run can start. An empty list means the layer is ready."""
    root = root or data_dir()
    result: Dict[str, List[Problem]] = {name: [] for name in settings.enabled()}
    try:
        config = derive_config(settings, root)
    except SettingsError as error:
        for name in result:
            result[name].append(Problem(name, 'config', str(error)))
        return result
    source = config['data_source']
    complain = settings.mode == 'complain'
    if 'a' in result:
        _needs_file(result['a'], 'a', source['current_data'].get('descriptive', ''), '待分析資料', 'current-data')
        if complain:
            _needs_file(result['a'], 'a', source['baseline_data'].get('descriptive', ''), '正常基準資料', 'baseline-data')
    if 'b' in result:
        _needs_file(result['b'], 'b', source['baseline_data'].get('ng_code', ''), '不良代碼定義', 'ng-code')
        if complain:
            _needs_file(result['b'], 'b', source['baseline_data'].get('prescriptive', ''), '不良特徵分布庫（known_base.json）', 'known-base')
        elif not source['baseline_data'].get('prescriptive'):
            result['b'].append(Problem('b', 'known-base', '每日模式需要指定要寫入的不良特徵分布庫路徑'))
    if 'c' in result:
        from app.analytical_four import offline_vectors  # noqa: F401  (registers the builtin-hash builder)
        from app.analytical_four.engine.analysis.prescriptive.RAG.vector_builder import VectorBuilderFactory
        _needs_file(result['c'], 'c', source['baseline_data'].get('topology', ''), '製程拓樸', 'topology')
        _needs_file(result['c'], 'c', source['baseline_data'].get('rag_knowledge', ''), 'SOP 知識', 'knowledge')
        builder = str(source['rag_setting'].get('builder_type', '')).lower()
        if builder not in VectorBuilderFactory.get_available_builders():
            result['c'].append(Problem('c', 'rag-builder', f'不支援的向量模型：{builder or "未填寫"}'))
        if complain:
            _needs_file(result['c'], 'c', source['case_data'].get('llm_records', ''), '歷史案例檔', 'cases')
            _needs_file(result['c'], 'c', source['case_data'].get('llm_error_records', ''), '誤判案例檔', 'error-cases')
            if not settings.llm.endpoint:
                result['c'].append(Problem('c', 'llm-endpoint', '尚未填寫 LLM 服務位址'))
            if settings.llm.apiKeyEnv and not os.environ.get(settings.llm.apiKeyEnv):
                result['c'].append(Problem('c', 'llm-key', f'環境變數 {settings.llm.apiKeyEnv} 沒有值'))
    return result
