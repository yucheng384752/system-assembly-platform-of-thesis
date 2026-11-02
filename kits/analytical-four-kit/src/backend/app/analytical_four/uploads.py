"""Files a site hands over: staged, checked, and only then put where the analysis reads them (docs/analytical-four-kit.md, section 13).

An upload never lands in the data directory until someone accepts it, and it cannot be accepted while its own file has errors.
Accepting never silently overwrites: replacing an existing file needs an explicit `replace`, and the file it replaces is kept
under `uploads/replaced/`. Nothing is deleted except an upload that was discarded before it was accepted.
"""
from __future__ import annotations

import hashlib
import json
import re
import secrets
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from app.analytical_four.data_checks import KIND_TARGETS, inspect
from app.analytical_four.runs import RunStore
from app.analytical_four.settings import Layers, Settings, SettingsError, atomic_replace, derive_config, resolve_inside

KINDS = tuple(KIND_TARGETS)
UPLOAD_ID = re.compile(r'^[0-9a-f]{16}$')
MAX_BYTES = 100_000_000
CASE_KINDS = ('case-records', 'case-errors')


class UploadError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status, self.message = status, message


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec='microseconds')  # uploads are listed newest first, and several can arrive in one second


def clean_name(name: str) -> str:
    leaf = re.split(r'[\\/]', name or '')[-1]
    return re.sub(r'[\x00-\x1f]', '', leaf).strip()[:100]


class Writer:
    """Receives the bytes of one upload into its staging folder and refuses to grow past the size limit."""

    def __init__(self, directory: Path):
        directory.mkdir(parents=True)
        self.directory, self.bytes, self.sha = directory, 0, hashlib.sha256()
        self.handle = (directory / 'content').open('wb')

    def write(self, chunk: bytes) -> None:
        self.bytes += len(chunk)
        if self.bytes > MAX_BYTES:
            self.abort()
            raise UploadError(413, f'檔案超過 {MAX_BYTES // 1_000_000} MB 上限')
        self.sha.update(chunk)
        self.handle.write(chunk)

    def close(self) -> None:
        self.handle.close()

    def abort(self) -> None:
        self.handle.close()
        shutil.rmtree(self.directory, ignore_errors=True)


class UploadStore:
    def __init__(self, root: Path, runs: RunStore, library_versions: Callable[[], List[Dict[str, Any]]]):
        self.root, self.runs, self.library_versions = root, runs, library_versions
        self.base = root / 'uploads'

    # ---- staging ---------------------------------------------------------------------------------------------------

    def begin(self, kind: str) -> tuple:
        if kind not in KINDS:
            raise UploadError(422, f'kind 必須是：{"、".join(KINDS)}')
        upload_id = secrets.token_hex(8)
        return upload_id, Writer(self.base / upload_id)

    def finish(self, settings: Settings, upload_id: str, writer: Writer, kind: str, filename: str, actor: str) -> Dict[str, Any]:
        try:
            return self._finish(settings, upload_id, writer, kind, filename, actor)
        except Exception:
            writer.abort()  # a half-staged upload without a meta file would be invisible and never cleaned up
            raise

    def _finish(self, settings: Settings, upload_id: str, writer: Writer, kind: str, filename: str, actor: str) -> Dict[str, Any]:
        writer.close()
        if writer.bytes == 0:
            writer.abort()
            raise UploadError(422, '檔案是空的')
        meta = {'uploadId': upload_id, 'kind': kind, 'filename': clean_name(filename), 'bytes': writer.bytes, 'sha256': writer.sha.hexdigest(),
                'createdAt': _now(), 'createdBy': actor, 'status': 'staged', 'target': None, 'report': self._report(settings, kind, writer.directory / 'content')}
        try:
            meta['target'] = self._target(settings, kind).relative_to(self.root.resolve()).as_posix()
        except UploadError as error:
            meta['report']['errors'].append({'layer': 'a', 'code': 'target', 'message': error.message, 'source': kind})
            meta['report']['ok'] = False
        self._save(meta)
        return meta

    def _report(self, settings: Settings, kind: str, content: Path) -> Dict[str, Any]:
        # A file is checked for what it is, whether or not the layer that uses it is switched on right now.
        everything = settings.model_copy(update={'layers': Layers(a=True, b=True, c=True)})
        full = inspect(everything, self.root, {kind: content})
        source = KIND_TARGETS[kind][2]
        own = full.own(source)
        return {'ok': not own.errors, 'errors': [f.as_json() for f in own.errors], 'warnings': [f.as_json() for f in own.warnings],
                # What else looks wrong with the data set as a whole once this file is in. It does not block this upload.
                'otherIssues': [f.as_json() for f in full.errors if f.source != source], 'summary': full.summary}

    def _target(self, settings: Settings, kind: str) -> Path:
        section, key, _ = KIND_TARGETS[kind]
        try:
            if section is None:
                return resolve_inside(self.root, settings.analysisConfig, '分析設定檔')
            value = derive_config(settings, self.root)['data_source'][section].get(key, '')
        except SettingsError as error:
            raise UploadError(409, str(error)) from error
        if not value:
            raise UploadError(409, f'分析設定沒有指定這類檔案的路徑（data_source.{section}.{key}）')
        return Path(value).resolve()

    # ---- reading ---------------------------------------------------------------------------------------------------

    def _meta_path(self, upload_id: str) -> Path:
        if not UPLOAD_ID.match(upload_id):
            raise UploadError(404, '找不到這次上傳')
        return self.base / upload_id / 'meta.json'

    def get(self, upload_id: str) -> Dict[str, Any]:
        path = self._meta_path(upload_id)
        if not path.is_file():
            raise UploadError(404, '找不到這次上傳')
        return json.loads(path.read_text(encoding='utf-8'))

    def list(self, limit: int) -> List[Dict[str, Any]]:
        if not self.base.is_dir():
            return []
        found = [json.loads(p.read_text(encoding='utf-8')) for p in self.base.glob('*/meta.json')]
        found.sort(key=lambda m: (m['createdAt'], m['uploadId']), reverse=True)
        return [{k: v for k, v in m.items() if k != 'report'} | {'ok': m['report']['ok'], 'errorCount': len(m['report']['errors']),
                                                                  'warningCount': len(m['report']['warnings'])} for m in found[:limit]]

    def _save(self, meta: Dict[str, Any]) -> None:
        path = self._meta_path(meta['uploadId'])
        temporary = path.with_suffix('.tmp')
        temporary.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding='utf-8')
        atomic_replace(temporary, path)

    # ---- decisions -------------------------------------------------------------------------------------------------

    def accept(self, settings: Settings, upload_id: str, replace: Any, actor: str) -> Dict[str, Any]:
        if not isinstance(replace, bool):
            raise UploadError(422, 'replace 必須是 true 或 false')
        meta = self.get(upload_id)
        if meta['status'] != 'staged':
            raise UploadError(409, f'這次上傳已經是「{meta["status"]}」，不能再接受')
        if self.runs.active is not None:
            raise UploadError(409, f'分析 {self.runs.active} 仍在執行，請等它結束再放入檔案')
        content = self.base / upload_id / 'content'
        report = self._report(settings, meta['kind'], content)  # the data set may have changed since the file was staged
        if not report['ok']:
            meta['report'] = report
            self._save(meta)
            raise UploadError(409, '這個檔案有錯誤，不能放入：' + '；'.join(e['message'] for e in report['errors']))
        if meta['kind'] in CASE_KINDS and self.library_versions():
            raise UploadError(409, '案例庫已經有發布過的版本，直接換案例檔會在下次發布時被蓋掉；請改用「匯入回饋」讓案例經過核可並進入版本')
        target = self._target(settings, meta['kind'])
        backup = None
        if target.exists():
            if not replace:
                raise UploadError(409, f'目標檔已存在（{target.relative_to(self.root.resolve()).as_posix()}）；確認要取代請設定 replace 為 true，原檔會保留在 uploads/replaced/')
            backup_path = self.base / 'replaced' / f'{upload_id}-{target.name}'
            backup_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(target, backup_path)
            backup = backup_path.relative_to(self.root).as_posix()
        target.parent.mkdir(parents=True, exist_ok=True)
        temporary = target.with_name(target.name + '.upload')
        shutil.copyfile(content, temporary)
        atomic_replace(temporary, target)
        meta.update(status='accepted', acceptedAt=_now(), acceptedBy=actor, replacedBackup=backup, report=report)
        self._save(meta)
        return meta

    def discard(self, upload_id: str, actor: str) -> Dict[str, Any]:
        meta = self.get(upload_id)
        if meta['status'] != 'staged':
            raise UploadError(409, f'這次上傳已經是「{meta["status"]}」，不能丟棄')
        (self.base / upload_id / 'content').unlink(missing_ok=True)
        meta.update(status='discarded', discardedAt=_now(), discardedBy=actor)
        self._save(meta)
        return meta
