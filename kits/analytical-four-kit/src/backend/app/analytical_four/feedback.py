"""Confirmed outcomes of past analyses, and the versioned case library they feed (docs/analytical-four-kit.md, section 8).

Two append-only files hold the record: `feedback/entries.jsonl` (what was submitted) and `feedback/decisions.jsonl` (who approved
or rejected it). Nothing is edited or deleted. Only approved entries reach the case library, and the library is published as
numbered versions; the files the analysis reads are a copy of the newest version, and every older version stays on disk.
"""
from __future__ import annotations

import copy
import hashlib
import json
import os
import re
import secrets
import threading
from collections import OrderedDict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from app.analytical_four.format_checks import validate_case_record
from app.analytical_four.runs import RunError, RunStore
from app.analytical_four.settings import Settings, SettingsError, atomic_replace, derive_config

NG_CODE = re.compile(r'^[A-Za-z0-9][A-Za-z0-9_-]{0,49}$')
FEEDBACK_ID = re.compile(r'^[0-9a-f]{16}$')
AUTO_APPROVE_ROLES = {'admin', 'manager'}
MAX_IMPORT_RECORDS = 500
MAX_TEXT = 500
VERSION_DIR = re.compile(r'^v(\d{4})$')


class FeedbackError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status, self.message = status, message


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _append(path: Path, value: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('a', encoding='utf-8') as handle:
        handle.write(json.dumps(value, ensure_ascii=False) + '\n')
        handle.flush()
        os.fsync(handle.fileno())


def _read_lines(path: Path) -> List[Dict[str, Any]]:
    if not path.is_file():
        return []
    rows = []
    for number, line in enumerate(path.read_text(encoding='utf-8').splitlines(), 1):
        if not line.strip():
            continue
        try:
            rows.append(json.loads(line))
        except ValueError as error:  # a damaged history must stop the work, not be skipped over
            raise FeedbackError(500, f'{path.name} 第 {number} 行不是有效的 JSON') from error
    return rows


def _write_jsonl(path: Path, rows: List[Dict[str, Any]]) -> None:
    path.write_text(''.join(json.dumps(r, ensure_ascii=False) + '\n' for r in rows), encoding='utf-8')


def _replace(path: Path, rows: List[Dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.tmp')
    _write_jsonl(temporary, rows)
    atomic_replace(temporary, path)


def text_field(value: Any, label: str, required: bool = False) -> str:
    if value is None or value == '':
        if required:
            raise FeedbackError(422, f'{label} 沒有填寫')
        return ''
    if not isinstance(value, str) or len(value) > MAX_TEXT:
        raise FeedbackError(422, f'{label} 必須是 {MAX_TEXT} 字以內的文字')
    return value


def ng_code_field(value: Any) -> str:
    if not isinstance(value, str) or not NG_CODE.match(value):
        raise FeedbackError(422, '確認的不良代碼只能含英數字、底線與連字號，最長 50 字')
    return value


class FeedbackStore:
    def __init__(self, root: Path, runs: RunStore):
        self.root, self.runs = root, runs
        self.base = root / 'feedback'
        self.entries_file, self.decisions_file = self.base / 'entries.jsonl', self.base / 'decisions.jsonl'
        self.library = self.base / 'library'
        self.lock = threading.Lock()

    # ---- reading ----------------------------------------------------------------------------------------------------

    def _decisions(self) -> Dict[str, Dict[str, Any]]:
        return {d['feedbackId']: d for d in _read_lines(self.decisions_file)}

    def _view(self, entry: Dict[str, Any], decision: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        status = 'pending' if decision is None else ('approved' if decision['approve'] else 'rejected')
        return {**{k: v for k, v in entry.items() if k != 'record'}, 'status': status, 'decision': decision,
                'eventId': entry['record']['event_id'], 'confirmedNg': entry['record']['feedback']['confirmed_ng'],
                'actualCause': entry['record']['feedback'].get('actual_cause'),
                'published': entry['feedbackId'] in self._published_ids()}

    def _published_ids(self) -> set:
        return {i for m in self.versions() for i in m['addedFeedbackIds']}

    def list(self, status: Optional[str], limit: int) -> List[Dict[str, Any]]:
        decisions = self._decisions()
        views = [self._view(e, decisions.get(e['feedbackId'])) for e in _read_lines(self.entries_file)]
        if status:
            views = [v for v in views if v['status'] == status]
        return list(reversed(views))[:limit]

    def versions(self) -> List[Dict[str, Any]]:
        if not self.library.is_dir():
            return []
        found = sorted((p for p in self.library.iterdir() if VERSION_DIR.match(p.name) and (p / 'manifest.json').is_file()), reverse=True)
        return [json.loads((p / 'manifest.json').read_text(encoding='utf-8')) for p in found]

    # ---- writing ----------------------------------------------------------------------------------------------------

    def _known_codes(self, settings: Settings) -> Optional[set]:
        try:
            path = Path(derive_config(settings, self.root)['data_source']['baseline_data'].get('ng_code', ''))
            return {item['category'] for item in json.loads(path.read_text(encoding='utf-8'))}
        except (SettingsError, OSError, ValueError, KeyError, TypeError):
            return None  # unknown, and said so: the entry records isNewCode as null rather than guessing

    def _store(self, settings: Settings, record: Dict[str, Any], source: str, run_id: Optional[str], note: str, actor: str, role: str) -> Dict[str, Any]:
        confirmed = record['feedback']['confirmed_ng']
        predicted = (record.get('conclusion') or {}).get('final_ng') or (record.get('diagnosis_results') or {}).get('suggested_ng_code')
        was_correct = (predicted == confirmed) if predicted else None
        record['feedback'] = {**record['feedback'], 'confirmed_by': actor, 'confirmed_at': _now(), 'was_correct': was_correct, 'label_source': source}
        record['error_analysis'] = {**(record.get('error_analysis') or {}), 'was_correct': was_correct}
        record['error_analysis'].setdefault('error_reasons', [])
        record['error_analysis'].setdefault('delta', {})
        known = self._known_codes(settings)
        entry = {'feedbackId': secrets.token_hex(8), 'submittedAt': _now(), 'submittedBy': actor, 'submittedRole': role, 'source': source,
                 'runId': run_id, 'note': note, 'isNewCode': None if known is None else confirmed not in known, 'record': record}
        return entry

    def _commit(self, entries: List[Dict[str, Any]], actor: str, role: str) -> List[Dict[str, Any]]:
        """Writes the entries; a manager's or administrator's own submission is approved at once, and says so in the decision."""
        out = []
        for entry in entries:
            _append(self.entries_file, entry)
            decision = None
            if role in AUTO_APPROVE_ROLES:
                decision = {'feedbackId': entry['feedbackId'], 'approve': True, 'decidedBy': actor, 'decidedRole': role,
                            'decidedAt': _now(), 'note': '經理或管理員提交，同時核可'}
                _append(self.decisions_file, decision)
            out.append(self._view(entry, decision))
        return out

    def submit_from_run(self, settings: Settings, run_id: str, event_id: str, confirmed_ng: Any, actual_cause: Any, note: Any,
                        actor: str, role: str) -> Dict[str, Any]:
        confirmed = ng_code_field(confirmed_ng)
        cause, note_text = text_field(actual_cause, '實際原因'), text_field(note, '備註')
        try:
            run = self.runs.get(run_id)
        except RunError as error:
            raise FeedbackError(error.status, error.message) from error
        if run['state'] != 'succeeded':
            raise FeedbackError(409, '這次分析尚未成功完成')
        if 'search_key_results.json' not in self.runs.result_names(run_id):
            raise FeedbackError(409, '這次分析沒有客訴診斷結果，無法對事件回饋')
        keys = self.runs.result(run_id, 'search_key_results.json')
        base = next((k for k in keys if k.get('event_id') == event_id), None)
        if base is None:
            raise FeedbackError(404, '這次分析沒有這個事件')
        record = copy.deepcopy(base)
        if 'LLM_responses.json' in self.runs.result_names(run_id):
            answer = next((r for r in self.runs.result(run_id, 'LLM_responses.json') if isinstance(r, dict) and r.get('event_id') == event_id), None)
            if answer is not None and validate_case_record({**copy.deepcopy(answer), 'feedback': {}}, 'x') is None:
                record = copy.deepcopy(answer)  # the service returned the whole filled-in record, as the original pipeline expects
        record['feedback'] = {'confirmed_ng': confirmed, 'actual_cause': cause or None}
        with self.lock:
            return self._commit([self._store(settings, record, 'run', run_id, note_text, actor, role)], actor, role)[0]

    def import_records(self, settings: Settings, records: Any, actor: str, role: str) -> List[Dict[str, Any]]:
        if not isinstance(records, list) or not records:
            raise FeedbackError(422, 'records 必須是非空的清單')
        if len(records) > MAX_IMPORT_RECORDS:
            raise FeedbackError(422, f'一次最多匯入 {MAX_IMPORT_RECORDS} 筆')
        candidates, seen = [], set()
        for index, record in enumerate(records, 1):  # every record is checked before anything is written
            problem = validate_case_record(record, f'第 {index} 筆')
            if problem:
                raise FeedbackError(422, problem)
            ng_code_field(record['feedback'].get('confirmed_ng'))
            text_field(record['feedback'].get('actual_cause'), f'第 {index} 筆的實際原因')
            if record['event_id'] in seen:
                raise FeedbackError(422, f'第 {index} 筆的 event_id 在這批資料中重複')
            seen.add(record['event_id'])
            candidates.append(copy.deepcopy(record))
        with self.lock:
            entries = [self._store(settings, r, 'import', None, '', actor, role) for r in candidates]
            return self._commit(entries, actor, role)

    def decide(self, feedback_id: str, approve: Any, note: Any, actor: str, role: str) -> Dict[str, Any]:
        if not isinstance(approve, bool):
            raise FeedbackError(422, 'approve 必須是 true 或 false')
        note_text = text_field(note, '備註')
        if not FEEDBACK_ID.match(feedback_id):
            raise FeedbackError(404, '找不到這筆回饋')
        with self.lock:
            entry = next((e for e in _read_lines(self.entries_file) if e['feedbackId'] == feedback_id), None)
            if entry is None:
                raise FeedbackError(404, '找不到這筆回饋')
            if feedback_id in self._decisions():
                raise FeedbackError(409, '這筆回饋已有決定；要更正請重新提交')
            decision = {'feedbackId': feedback_id, 'approve': approve, 'decidedBy': actor, 'decidedRole': role, 'decidedAt': _now(), 'note': note_text}
            _append(self.decisions_file, decision)
            return self._view(entry, decision)

    # ---- the case library -------------------------------------------------------------------------------------------

    def publish(self, settings: Settings, actor: str) -> Dict[str, Any]:
        with self.lock:
            if self.runs.active is not None:
                raise FeedbackError(409, f'分析 {self.runs.active} 仍在執行，請等它結束再發布案例庫')
            try:
                targets = derive_config(settings, self.root)['data_source']['case_data']
                records_path, errors_path = Path(targets['llm_records']), Path(targets['llm_error_records'])
            except (SettingsError, KeyError) as error:
                raise FeedbackError(409, f'分析設定沒有可寫入的案例檔路徑：{error}') from error
            if not targets.get('llm_records') or not targets.get('llm_error_records'):
                raise FeedbackError(409, '分析設定沒有指定案例檔路徑')
            published = self._published_ids()
            decisions = self._decisions()
            pending = [e for e in _read_lines(self.entries_file)
                       if e['feedbackId'] not in published and decisions.get(e['feedbackId'], {}).get('approve') is True]
            if not pending:
                raise FeedbackError(409, '沒有新的已核可回饋可以發布')
            versions = self.versions()
            latest = versions[0] if versions else None
            if latest:
                source = self.library / f"v{latest['version']:04d}" / 'llm_records.jsonl'
                base_rows = _read_lines(source)
            else:
                base_rows = _read_lines(records_path)  # the first version starts from whatever the operator already had
            merged: 'OrderedDict[str, Dict[str, Any]]' = OrderedDict((r['event_id'], r) for r in base_rows if isinstance(r, dict) and 'event_id' in r)
            replaced = [e['record']['event_id'] for e in pending if e['record']['event_id'] in merged]
            for entry in pending:
                merged[entry['record']['event_id']] = entry['record']
            rows = list(merged.values())
            wrong = [r for r in rows if (r.get('error_analysis') or {}).get('was_correct') is False]
            number = (latest['version'] if latest else 0) + 1
            final = self.library / f'v{number:04d}'
            staging = self.library / f'.staging-v{number:04d}'
            if final.exists():
                raise FeedbackError(500, f'案例庫版本 {number} 已存在')
            staging.mkdir(parents=True, exist_ok=True)
            _write_jsonl(staging / 'llm_records.jsonl', rows)
            _write_jsonl(staging / 'llm_error_records.jsonl', wrong)
            manifest = {'version': number, 'createdAt': _now(), 'createdBy': actor, 'baseVersion': latest['version'] if latest else None,
                        'startedFromExistingFile': latest is None, 'addedFeedbackIds': [e['feedbackId'] for e in pending],
                        'replacedEventIds': replaced, 'recordCount': len(rows), 'errorRecordCount': len(wrong),
                        'files': {name: _sha(staging / name) for name in ('llm_records.jsonl', 'llm_error_records.jsonl')}}
            (staging / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
            os.replace(staging, final)
            _replace(records_path, rows)  # the analysis reads these two paths; they now hold the newest version
            _replace(errors_path, wrong)
            return manifest
