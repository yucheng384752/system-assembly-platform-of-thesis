"""Measure the Kit against isolated synthetic data; write reports outside the repository."""
from __future__ import annotations

import argparse
import csv
import json
from json import dumps
import math
import os
import platform
import statistics
import subprocess
import sys
import tempfile
import time
from contextlib import contextmanager
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

KIT = Path(__file__).resolve().parents[1]
REPO = KIT.parents[1]
API = '/api/analytical-four'
ENDPOINT = 'http://measure.invalid/diagnose'
NOTES = [
    '系統回應時間，不含人的操作時間。示範資料為合成，規模很小，不代表真實場域。',
    '程序內 TestClient 不含網路與瀏覽器時間；LLM 使用程序內固定假回應，不代表真實模型耗時。',
    '輪詢間隔 20 毫秒；未觀察到 running 的短階段只報上限，包含輪詢與請求開銷。',
    'Windows 上向量資料庫可能持續開啟檔案，系統暫存資料夾下的 measure-kit- 暫存資料目錄可能殘留。',
]


def summarize(point: str, samples: list[float]) -> dict:
    if not samples or any(not math.isfinite(x) or x < 0 for x in samples):
        raise ValueError('samples must contain finite, non-negative durations')
    ordered = sorted(samples)
    n = len(samples)
    return {'id': point, 'unit': 'seconds', 'n': n, 'min': ordered[0], 'median': statistics.median(ordered),
            'p95': ordered[math.ceil(.95 * n) - 1], 'max': ordered[-1], 'samples': list(samples), 'p95Reliable': n >= 20}


class StageTimes:
    def __init__(self, started: float):
        self.previous = started
        self.running: dict[str, float] = {}
        self.finished: dict[str, float] = {}
        self.durations: dict[str, float] = {}
        self.upper_bounds: list[str] = []

    def observe(self, stages: list[dict], now: float) -> None:
        for stage in stages:
            name, state = stage['id'], stage['state']
            if state == 'running':
                self.running.setdefault(name, now)
            elif state in ('done', 'failed', 'skipped') and name not in self.finished:
                self.finished[name] = now
                if state == 'done':
                    self.durations[name] = now - self.running.get(name, self.previous)
                    if name not in self.running:
                        self.upper_bounds.append(name)
        self.previous = now


def outside_repo(path: Path) -> Path:
    resolved = path.resolve()
    if resolved == REPO or REPO in resolved.parents:
        raise ValueError('measurement output must be outside the repository')
    return resolved


def environment() -> dict:
    manifest = json.loads((KIT / 'manifest.json').read_text(encoding='utf-8'))
    try:
        git = subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=REPO, capture_output=True, text=True, check=True).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        git = None
    return {'os': platform.platform(), 'python': platform.python_version(), 'cpuCount': os.cpu_count(),
            'kit': manifest['kit'], 'version': manifest.get('version'), 'git': git,
            'utc': datetime.now(timezone.utc).isoformat()}


class Measurements:
    def __init__(self, repeats: int):
        self.repeats = repeats
        self.samples: dict[str, list[float]] = {}
        self.failures: list[dict] = []
        self.notes = list(NOTES)
        self.details: dict[str, dict] = {}

    def attempt(self, point: str, repeat: int, work) -> None:
        try:
            values = work()
            for name, duration in values.items():
                summarize(name, [duration])
        except Exception as error:  # a failed measurement must survive in both reports and the exit code
            self.failures.append({'id': point, 'repeat': repeat, 'reason': f'{type(error).__name__}: {error}'})
        else:
            for name, duration in values.items():
                self.samples.setdefault(name, []).append(duration)

    def report(self) -> dict:
        env = environment()
        notes = list(self.notes)
        if env['version'] is None:
            notes.append('manifest.json 未提供版本；environment.version 為 null。')
        return {'format': 'composer-measure', 'version': 1, 'environment': env, 'repeats': self.repeats,
                'results': [summarize(k, v) | self.details.get(k, {}) for k, v in self.samples.items()],
                'failures': self.failures, 'notes': notes}


def write_reports(out: Path, report: dict) -> int:
    out = outside_repo(out)
    out.mkdir(parents=True, exist_ok=True)
    stem = 'measure-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    (out / (stem + '.json')).write_text(json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False), encoding='utf-8')
    lines = [f'失敗數：{len(report["failures"])}', '', *report['notes'], '',
             '| 量測點 | n | 中位數 (s) | p95 (s) | 最大 (s) | 備註 |', '| --- | ---: | ---: | ---: | ---: | --- |']
    for row in report['results']:
        note = [] if row['p95Reliable'] else ['n < 20，p95 不可靠']
        if 'file' in row:
            note.append(json.dumps(row['file'], ensure_ascii=False))
        lines.append(f'| {row["id"]} | {row["n"]} | {row["median"]:.6f} | {row["p95"]:.6f} | {row["max"]:.6f} | {"; ".join(note)} |')
    for failure in report['failures']:
        reason = failure['reason'].replace('\n', ' ')
        lines.append(f'\n失敗：{failure["id"]}，第 {failure["repeat"]} 次：{reason}')
    (out / (stem + '.md')).write_text('\n'.join(lines) + '\n', encoding='utf-8')
    return int(bool(report['failures']))


def request(client, method: str, route: str, **kwargs) -> dict:
    response = client.request(method, API + route, **kwargs)
    response.raise_for_status()
    return response.json()


def starting_settings() -> dict:
    return {'schemaVersion': 1, 'layers': {'a': True, 'b': True, 'c': True}, 'mode': 'daily',
            'analysisConfig': 'config/analysis_config.json', 'columnMapping': {},
            'llm': {'endpoint': ENDPOINT, 'timeoutSeconds': 30, 'apiKeyEnv': ''}}


def check_ready(client) -> None:
    status = request(client, 'GET', '/status')
    report = request(client, 'GET', '/data-check')
    if not all(layer['ready'] for layer in status['readiness'].values()) or not report['ok']:
        raise RuntimeError('檢查未通過: ' + json.dumps({'readiness': status['readiness'], 'dataCheck': report}, ensure_ascii=False))


@contextmanager
def demo_client():
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from requests import Response

    sys.path.insert(0, str(KIT / 'src' / 'backend'))
    from app.analytical_four import seed_demo
    from app.api import routes_analytical_four as routes

    def fake_post(url, *, json, headers, timeout):
        if url != ENDPOINT:
            raise ValueError(f'unexpected diagnosis endpoint: {url}')
        response = Response()
        response.status_code = 200
        response._content = dumps({'event_id': json['new_event']['event_id'],
                                   'llm_analysis': {'similar_cases': len(json['top3_cases'])}}).encode()
        return response

    try:
        with tempfile.TemporaryDirectory(prefix='measure-kit-', ignore_cleanup_errors=True) as temporary:
            root = outside_repo(Path(temporary))
            with patch.dict(os.environ, {'ANALYTICAL_FOUR_DATA_DIR': str(root)}), \
                    patch('app.analytical_four.pipeline.requests.post', side_effect=fake_post):
                seed_demo.seed(root)
                app = FastAPI()

                @app.middleware('http')
                async def actor(request, call_next):
                    request.state.actor_user_id = 'measurement'
                    request.state.actor_role = 'operator'
                    return await call_next(request)

                app.include_router(routes.router)
                with TestClient(app) as client:
                    try:
                        yield client, root
                    finally:
                        # The worker clears active just after writing its terminal status; keep its files until then.
                        while routes.store().active is not None:
                            time.sleep(.02)
    finally:
        routes._uploads.cache_clear()
        routes._feedback.cache_clear()
        routes._store.cache_clear()
        sys.path.remove(str(KIT / 'src' / 'backend'))


def generation(client, point: str, notes: list[str]) -> dict[str, float]:
    started = time.perf_counter()
    record = request(client, 'POST', '/runs')
    stages = StageTimes(started)
    retries = 0
    try:
        while True:
            now = time.perf_counter()
            stages.observe(record['stages'], now)
            if record['state'] == 'failed':
                raise RuntimeError(json.dumps(record['error'], ensure_ascii=False))
            if record['state'] == 'succeeded':
                break
            time.sleep(.02)
            for attempt in range(4):
                try:
                    record = request(client, 'GET', '/runs/' + record['runId'])
                    break
                except Exception as error:  # Windows may briefly deny reads while the worker replaces status.json.
                    response = getattr(error, 'response', None)
                    if attempt == 3 or (response is not None and not 500 <= response.status_code < 600):
                        raise
                    time.sleep(.01)
                    retries += 1
    finally:
        if retries:
            notes.append(f'{point}: {retries} polling reads were retried because the run status file was being replaced (Windows)')
    if stages.upper_bounds:
        notes.append(f'{point} 上限樣本：' + ', '.join(stages.upper_bounds))
    return {point + '.total': now - started, **{point + '.' + k: v for k, v in stages.durations.items()}}


def adjustment(client, index: int) -> dict[str, float]:
    base = starting_settings()
    request(client, 'PUT', '/settings', json=base)
    changed = deepcopy(base)
    if index == 0:
        changed['layers']['c'] = False
    elif index == 1:
        changed['mode'] = 'complain'
    elif index == 2:
        changed['llm']['timeoutSeconds'] = 60
    elif index == 3:
        changed['columnMapping'] = {'timestamp': 'measurement_timestamp'}
    else:
        raise ValueError('unknown adjustment')
    started = time.perf_counter()
    request(client, 'PUT', '/settings', json=changed)
    check_ready(client)
    return {f'A.{index + 1}': time.perf_counter() - started}


UPLOADS = {
    'analysis_config.json': 'analysis-config', 'analysis_config_complaint.json': 'analysis-config',
    'baseline.csv': 'baseline-data', 'current_daily.csv': 'current-data', 'complaint.csv': 'current-data',
    'knowledge.csv': 'knowledge', 'ng_code.json': 'ng-code', 'topology.json': 'topology',
}


def import_file(client, path: Path, point: str) -> dict[str, float]:
    if path.name not in UPLOADS:
        raise ValueError(f'Kit uploads API has no upload kind for {path.name}')
    content = path.read_bytes()
    if not content:
        raise ValueError(f'cannot upload empty file: {path.name}')
    values = {}
    started = time.perf_counter()
    uploaded = request(client, 'POST', '/uploads', params={'kind': UPLOADS[path.name], 'filename': path.name}, content=content)
    values[point + '.upload'] = time.perf_counter() - started
    route = '/uploads/' + uploaded['uploadId']
    started = time.perf_counter()
    report = request(client, 'GET', route)
    if not report['report']['ok']:
        raise RuntimeError('檢查未通過: ' + json.dumps(report['report'], ensure_ascii=False))
    values[point + '.report'] = time.perf_counter() - started
    started = time.perf_counter()
    accepted = request(client, 'POST', route + '/accept', json={'replace': True})
    if accepted['status'] != 'accepted':
        raise RuntimeError('upload was not accepted')
    values[point + '.accept'] = time.perf_counter() - started
    started = time.perf_counter()
    check = request(client, 'GET', '/data-check')
    if not check['ok']:
        raise RuntimeError('檢查未通過: ' + json.dumps(check, ensure_ascii=False))
    values[point + '.data-check'] = time.perf_counter() - started
    return values


def measure(book: Measurements, only: list[str]) -> None:
    if 'I' in only:
        book.notes.extend([
            'I 排除 known_base.json：由每日模式產生，Kit 不允許上傳。',
            'I 排除 0 位元組的案例檔 llm_records.jsonl、llm_error_records.jsonl；上傳 writer 會拒絕空檔。'
            '僅量測契約列出的六種上傳種類，所有空檔均排除。',
        ])
    for repeat in range(1, book.repeats + 1):
        if 'G' in only:
            for mode in ('daily', 'complain'):
                def run(mode=mode):
                    with demo_client() as (client, root):
                        settings = starting_settings()
                        settings['mode'] = mode
                        settings['layers']['c'] = mode == 'complain'
                        if mode == 'complain':
                            settings['analysisConfig'] = 'config/analysis_config_complaint.json'
                        request(client, 'PUT', '/settings', json=settings)
                        return generation(client, 'G.' + mode, book.notes)
                book.attempt('G.' + mode, repeat, run)
        if 'I' in only:
            demo = KIT / 'src/backend/app/analytical_four/demo_data'
            for path in sorted(p for p in demo.rglob('*') if p.is_file() and p.name in UPLOADS and p.stat().st_size > 0):
                point = 'I.' + path.name
                metadata = {'path': path.relative_to(demo).as_posix(), 'bytes': path.stat().st_size}
                if path.suffix == '.csv':
                    with path.open(encoding='utf-8-sig', newline='') as handle:
                        rows = list(csv.reader(handle))
                    metadata.update(rows=len(rows) - 1, columns=len(rows[0]))
                for step in ('upload', 'report', 'accept', 'data-check'):
                    book.details[point + '.' + step] = {'file': metadata}

                def upload():
                    with demo_client() as (client, root):
                        settings = starting_settings()
                        if path.name in ('complaint.csv', 'analysis_config_complaint.json'):
                            settings.update(mode='complain', analysisConfig='config/analysis_config_complaint.json')
                        request(client, 'PUT', '/settings', json=settings)
                        return import_file(client, path, point)
                book.attempt(point, repeat, upload)
                if book.failures and book.failures[-1]['id'] == point and book.failures[-1]['repeat'] == repeat:
                    book.failures[-1]['file'] = metadata
        if 'A' in only:
            for index in range(4):
                def adjust():
                    with demo_client() as (client, root):
                        return adjustment(client, index)
                book.attempt(f'A.{index + 1}', repeat, adjust)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', required=True, type=Path)
    parser.add_argument('--repeats', type=int, default=5)
    parser.add_argument('--only', default='G,I,A')
    args = parser.parse_args(argv)
    if args.repeats < 1:
        parser.error('--repeats must be positive')
    only = args.only.split(',')
    if not only or any(value not in ('G', 'I', 'A') for value in only) or len(set(only)) != len(only):
        parser.error('--only must be a comma-separated subset of G,I,A')
    try:
        out = outside_repo(args.out)
    except ValueError as error:
        parser.error(str(error))
    book = Measurements(args.repeats)
    measure(book, only)
    return write_reports(out, book.report())


if __name__ == '__main__':
    sys.dont_write_bytecode = True
    raise SystemExit(main())
