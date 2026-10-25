"""Shared boundaries, canonical JSON, events and exclusive mutation lock."""
import json
import hashlib
import os
from pathlib import Path
import subprocess
import time


class Failure(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False, allow_nan=False).encode('utf-8')


def digest(data):
    return hashlib.sha256(data).hexdigest()


def file_digest(path):
    result = hashlib.sha256()
    with open(path, 'rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            result.update(chunk)
    return result.hexdigest()


def plan_hash(plan):
    return digest(canonical({k: v for k, v in plan.items() if k != 'planSha256'}))


def seal(plan):
    return {**plan, 'planSha256': plan_hash(plan)}


def check_plan(plan, confirmation):
    if not confirmation or plan.get('planSha256') != confirmation or plan_hash(plan) != confirmation:
        raise Failure(12, '計畫雜湊不符')


def read_json(path):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError('Duplicate JSON key')
            result[key] = value
        return result
    return json.loads(Path(path).read_text(encoding='utf-8'), object_pairs_hook=unique)


def write_json(path, value):
    path = Path(path)
    temporary = path.with_name(path.name + '.tmp-' + str(os.getpid()))
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o644)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(canonical(value) + b'\n')
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


class Runner:
    def __init__(self):
        self.commands = []

    def run(self, args, *, privileged=False, data=None, check=True):
        command = list(args)
        if privileged and os.geteuid() != 0:
            # CLI uses sudo's terminal prompt; child stdin remains available for secrets.
            command = ['sudo', '--'] + command
        self.commands.append(command)
        try:
            result = subprocess.run(command, input=data, stdout=subprocess.PIPE,
                                    stderr=subprocess.PIPE, check=False, timeout=1800)
        except (OSError, subprocess.TimeoutExpired):
            raise Failure(10, '外部命令無法執行：' + args[0]) from None
        if check and result.returncode:
            # Child output can contain credentials; never persist it or echo it.
            raise Failure(13, '外部命令失敗：' + args[0])
        return result

    def fs(self, action, path, **kwargs):
        return self.run(['python3', '-B', str(Path(__file__).with_name('fsops.py'))],
                        privileged=True, data=canonical({'action': action, 'path': str(path), **kwargs}))


class Journal:
    def __init__(self, directory, output=None, secrets=()):
        self.directory = Path(directory)
        self.output = output or (lambda value: None)
        self.secrets = sorted({str(s) for s in secrets if s}, key=len, reverse=True)
        events = self.directory / 'events.jsonl'
        self.seq = 0
        if events.exists():
            for line in events.read_text(encoding='utf-8').splitlines():
                self.seq = max(self.seq, json.loads(line)['seq'])

    def redact(self, value):
        if isinstance(value, str):
            for secret in self.secrets:
                value = value.replace(secret, '[REDACTED]')
            return value
        if isinstance(value, dict):
            return {k: self.redact(v) for k, v in value.items()}
        if isinstance(value, list):
            return [self.redact(v) for v in value]
        return value

    def event(self, step, status, message, undoable=False):
        self.seq += 1
        event = self.redact(dict(seq=self.seq, ts=time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
                                 step=step, status=status, message=message, undoable=undoable))
        with open(self.directory / 'events.jsonl', 'ab') as stream:
            stream.write(canonical(event) + b'\n')
            stream.flush()
            os.fsync(stream.fileno())
        self.output(event)

    def save(self, state):
        write_json(self.directory / 'state.json', self.redact(state))


class Lock:
    def __init__(self, path, owner):
        self.path, self.owner = Path(path), owner

    def __enter__(self):
        import fcntl
        try:
            self.fd = os.open(self.path, os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o666)
            os.fchmod(self.fd, 0o666)
        except FileExistsError:
            self.fd = os.open(self.path, os.O_RDWR | os.O_NOFOLLOW)
        try:
            fcntl.flock(self.fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            holder = os.read(self.fd, 4096).decode('utf-8', errors='replace')
            os.close(self.fd)
            raise Failure(16, '另一個命令正在執行：' + holder) from None
        os.ftruncate(self.fd, 0)
        os.write(self.fd, canonical({'pid': os.getpid(), 'command': self.owner}))
        return self

    def __exit__(self, *args):
        os.close(self.fd)
        # Never unlink a flock inode: a waiting process may already have opened it.
