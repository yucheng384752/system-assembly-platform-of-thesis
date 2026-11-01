"""Analysis runs: one directory per run holding `status.json` and the result files (docs/analytical-four-kit.md, section 3).

A run executes in a background thread of the API process, one at a time. Its state lives in files, so a restart cannot
leave a run looking alive: runs found `queued` or `running` that this process does not own are marked `failed`.
"""
from __future__ import annotations

import json
import logging
import os
import re
import secrets
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from app.analytical_four.pipeline import Analytical_Four_System, PipelineError
from app.analytical_four.settings import (
    Problem, Settings, SettingsError, atomic_replace, data_dir, derive_config, readiness,
)

log = logging.getLogger(__name__)
RUN_ID = re.compile(r'^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}$')
# (stage id, layer, display name). The order is the execution order and is what the AoV of this Kit describes.
STAGES = (
    ('read-data', 'a', '讀取並整理資料'),
    ('descriptive', 'a', '描述性分析'),
    ('diagnostic', 'a', '診斷性分析'),
    ('ng-code', 'b', '不良代碼診斷'),
    ('topology', 'c', '製程拓樸對應'),
    ('rag', 'c', 'SOP 檢索'),
    ('compile', 'c', '彙整事件'),
    ('search-key', 'c', '擷取搜尋關鍵'),
    ('similarity', 'c', '相似案例搜尋'),
    ('llm', 'c', 'LLM 綜合診斷'),
)
COMPLAIN_ONLY = {'compile', 'search-key', 'similarity', 'llm'}


class RunError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status, self.message = status, message


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


def _write_json(path: Path, value: Any) -> None:
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')
    atomic_replace(temporary, path)


class RunStore:
    def __init__(self, root: Optional[Path] = None):
        self.root = (root or data_dir()) / 'runs'
        self.lock = threading.Lock()
        self.active: Optional[str] = None
        self._swept = False

    def _dir(self, run_id: str) -> Path:
        if not RUN_ID.match(run_id):
            raise RunError(404, '找不到這次分析')
        return self.root / run_id

    def _sweep(self) -> None:
        """Runs left queued or running by a process that no longer exists can never finish."""
        if self._swept:
            return
        self._swept = True
        if not self.root.is_dir():
            return
        for path in self.root.glob('*/status.json'):
            record = json.loads(path.read_text(encoding='utf-8'))
            if record.get('state') in ('queued', 'running') and record.get('runId') != self.active:
                record['state'], record['finishedAt'] = 'failed', _now()
                record['error'] = {'stage': None, 'message': '服務重新啟動，這次分析被中斷'}
                for stage in record['stages']:
                    if stage['state'] in ('pending', 'running'):
                        stage['state'] = 'interrupted'
                _write_json(path, record)

    def get(self, run_id: str) -> Dict[str, Any]:
        path = self._dir(run_id) / 'status.json'
        if not path.is_file():
            raise RunError(404, '找不到這次分析')
        return json.loads(path.read_text(encoding='utf-8'))

    def list(self, limit: int = 50) -> List[Dict[str, Any]]:
        self._sweep()
        if not self.root.is_dir():
            return []
        found = sorted((p for p in self.root.iterdir() if RUN_ID.match(p.name) and (p / 'status.json').is_file()), reverse=True)
        return [json.loads((p / 'status.json').read_text(encoding='utf-8')) for p in found[:limit]]

    def result_names(self, run_id: str) -> List[str]:
        results = self._dir(run_id) / 'results'
        if not results.is_dir():
            return []
        return sorted(p.relative_to(results).as_posix() for p in results.rglob('*.json'))

    def result(self, run_id: str, name: str) -> Any:
        if name not in self.result_names(run_id):  # only names that exist; this also rules out any path trick
            raise RunError(404, '找不到這個結果檔')
        return json.loads((self._dir(run_id) / 'results' / name).read_text(encoding='utf-8'))

    def create(self, settings: Settings, actor: str) -> Dict[str, Any]:
        self._sweep()
        problems = readiness(settings)
        blocked = [p for layer in problems.values() for p in layer]
        if blocked:
            raise RunError(409, '尚有項目未就緒：' + '；'.join(p.message for p in blocked))
        with self.lock:
            if self.active is not None:
                raise RunError(409, f'分析 {self.active} 仍在執行，請等它結束')
            run_id = f'{datetime.now(timezone.utc):%Y%m%dT%H%M%SZ}-{secrets.token_hex(4)}'
            enabled = settings.enabled()
            stages = []
            for stage_id, layer, name in STAGES:
                if layer not in enabled:
                    continue
                skipped = settings.mode == 'daily' and stage_id in COMPLAIN_ONLY
                stages.append({'id': stage_id, 'layer': layer, 'name': name, 'state': 'skipped' if skipped else 'pending',
                               'detail': '每日模式不產生客訴診斷' if skipped else ''})
            record = {
                'runId': run_id, 'state': 'queued', 'createdAt': _now(), 'startedAt': None, 'finishedAt': None,
                'createdBy': actor, 'mode': settings.mode, 'layers': settings.layers.model_dump(), 'stages': stages, 'error': None,
                # What the run used, without the secret: whether an address was set and which variable holds the key.
                'llm': {'endpointSet': bool(settings.llm.endpoint), 'apiKeyEnv': settings.llm.apiKeyEnv},
            }
            directory = self._dir(run_id)
            (directory / 'results').mkdir(parents=True)
            _write_json(directory / 'status.json', record)
            _write_json(directory / 'settings.snapshot.json', settings.model_dump())
            self.active = run_id
        threading.Thread(target=self._execute, args=(run_id, settings), name=f'analytical-four-{run_id}', daemon=True).start()
        return record

    # ---- execution --------------------------------------------------------------------------------------------------

    def _update(self, run_id: str, mutate) -> None:
        record = self.get(run_id)
        mutate(record)
        _write_json(self._dir(run_id) / 'status.json', record)

    def _stage(self, run_id: str, stage_id: str, state: str, detail: str = '') -> None:
        def change(record):
            for stage in record['stages']:
                if stage['id'] == stage_id:
                    stage['state'], stage['detail'] = state, detail
        self._update(run_id, change)

    def _execute(self, run_id: str, settings: Settings) -> None:
        current = {'stage': None}
        try:
            self._update(run_id, lambda r: r.update(state='running', startedAt=_now()))
            directory = self._dir(run_id)
            derived = derive_config(settings)
            derived_path = directory / 'analysis_config.derived.json'
            _write_json(derived_path, derived)
            from app.analytical_four.engine.config_manager import ConfigManager
            manager = ConfigManager(str(derived_path))
            if manager.load_config() is None:
                raise PipelineError('分析設定檔無法載入')
            system = Analytical_Four_System(manager)
            system.llm_timeout = settings.llm.timeoutSeconds
            system.llm_api_key = os.environ.get(settings.llm.apiKeyEnv) if settings.llm.apiKeyEnv else None
            out = (directory / 'results').as_posix() + '/'

            def stage(stage_id: str, work, describe=lambda value: ''):
                current['stage'] = stage_id
                self._stage(run_id, stage_id, 'running')
                value = work()
                self._stage(run_id, stage_id, 'done', describe(value))
                return value

            enabled = settings.enabled()
            complain = settings.mode == 'complain'
            events: List[Dict[str, Any]] = []
            if 'a' in enabled:
                current_data, sample, baseline = stage(
                    'read-data', system.prepare_data,
                    lambda v: f'待分析 {len(v[1])} 筆，基準 {len(v[2])} 筆'
                              + (f'；{len(system.missing_features)} 個設定的數值特徵在資料中找不到' if system.missing_features else ''))
                compare = stage('descriptive', lambda: system.descriptive_stage(current_data, sample, baseline, out))
                events = stage('diagnostic', lambda: system.diagnostic_stage(sample, baseline, compare, out), lambda v: f'事件 {len(v)} 件')
            ng_results: Dict[str, Any] = {}
            if 'b' in enabled:
                def ng():
                    found = system.ng_code_analysis(mode=system.mode, observer=system.observer, serialization_results=events,
                                                    output_path=f'{out}ng_code_analysis.json')
                    if complain:
                        if any('error' in item for item in found.values()):
                            raise PipelineError('不良特徵分布庫是空的，請先用每日模式累積')
                        return found
                    system.output_data(system.json_data_manager.load(input_path=system.prescriptive_baseline_path)['data'],
                                       f'{out}known_base.json')
                    return {}
                ng_results = stage('ng-code', ng, lambda v: f'預測 {len(v)} 件' if v else '已更新不良特徵分布庫')
            if 'c' in enabled:
                stage('topology', lambda: system.topology_analysis(events, output_path=f'{out}topology/'))
                rag = stage('rag', lambda: system.rag_analysis(events, output_path=f'{out}rag_analysis.json'))
                if complain:
                    compiled = stage('compile', lambda: system.compilation_events(
                        serialization_results=events, ng_code_events=ng_results, rag_events=rag,
                        output_path=f'{out}compilation_events.json', topology_folder=f'{out}topology/'))
                    keys = stage('search-key', lambda: [system.extract_search_key(item) for item in compiled])
                    system.output_data(keys, f'{out}search_key_results.json')
                    similar = stage('similarity', lambda: system.similarity_search(result_schema=keys, output_path=f'{out}similarity_search_results.json'))
                    stage('llm', lambda: system.analyze_with_llm(result_schema=keys, all_similar_results=similar,
                                                                output_path=f'{out}LLM_responses.json'), lambda v: f'回應 {len(v)} 件')
            self._update(run_id, lambda r: r.update(state='succeeded', finishedAt=_now()))
        except Exception as error:  # noqa: BLE001 - the run must end in a recorded state whatever went wrong
            if isinstance(error, (PipelineError, SettingsError)):
                message = str(error)
            else:
                log.exception('analytical-four run %s failed', run_id)
                message = f'{type(error).__name__}: {error}'[:300]
            stage_id = current['stage']
            if stage_id:
                self._stage(run_id, stage_id, 'failed', message)
            self._update(run_id, lambda r: r.update(state='failed', finishedAt=_now(), error={'stage': stage_id, 'message': message}))
        finally:
            with self.lock:
                self.active = None


def problems_as_json(problems: Dict[str, List[Problem]]) -> Dict[str, Any]:
    return {layer: {'ready': not items, 'problems': [{'code': p.code, 'message': p.message} for p in items]}
            for layer, items in problems.items()}
