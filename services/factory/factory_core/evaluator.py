"""Client of the evaluator sidecar (contract 8.1 item 16): a node child process speaking one JSON line per request over stdio.

The child is the fixed aov-core evaluator, so a guard means at run time what it meant when Composer checked it. This client
never decides anything itself: every failure to get an answer (no process, crash, timeout, garbage) is an `EvaluatorError`,
which callers must treat as "cannot evaluate", never as true or false. A timeout kills the child (an expression that does not
finish must not block the factory); the next call starts a fresh one and verifies its version again.
"""
from __future__ import annotations

import json
import logging
import queue
import subprocess
import threading
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

PROTOCOL = 1
MAX_REQUEST_BYTES = 4 * 1024 * 1024
log = logging.getLogger(__name__)


class EvaluatorError(Exception):
    """No trustworthy answer: the process is missing, died, timed out, or spoke out of protocol."""


class EvaluatorRefused(EvaluatorError):
    """The evaluator understood the request and refused it (bad value, bad rules, too large). `code` says why."""

    def __init__(self, code: str, message: str):
        super().__init__(f'{code}: {message}')
        self.code = code


@dataclass(frozen=True)
class GuardResult:
    status: str  # 'true' | 'false' | 'error'
    message: str | None = None


_EOF = object()


class _Child:
    def __init__(self, command: Sequence[str]):
        self.process = subprocess.Popen(list(command), stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=None)  # stderr goes to the service log
        self.lines: queue.Queue = queue.Queue()
        threading.Thread(target=self._read, daemon=True).start()

    def _read(self) -> None:
        for raw in self.process.stdout:  # type: ignore[union-attr]
            self.lines.put(raw)
        self.lines.put(_EOF)

    def alive(self) -> bool:
        return self.process.poll() is None

    def kill(self) -> None:
        try:
            self.process.kill()
        except OSError:
            pass
        try:
            self.process.wait(timeout=5)
        except subprocess.TimeoutExpired:  # pragma: no cover - a killed process that will not die
            log.error('evaluator process did not exit after kill')
        for stream in (self.process.stdin, self.process.stdout):
            try:
                stream.close()  # type: ignore[union-attr]
            except OSError:
                pass


class Evaluator:
    def __init__(self, command: Sequence[str], *, timeout: float = 10.0, startup_timeout: float = 20.0):
        self._command = list(command)
        self._timeout, self._startup_timeout = timeout, startup_timeout
        self._lock = threading.Lock()
        self._child: _Child | None = None
        self._commit: str | None = None
        self._next_id = 0

    # lifecycle
    def commit(self) -> str:
        """The aov-core commit the running evaluator was built from. Starts the child if needed; raises if it cannot."""
        with self._lock:
            self._ensure()
            assert self._commit is not None
            return self._commit

    def close(self) -> None:
        with self._lock:
            if self._child is not None:
                self._child.kill()
                self._child = None

    def _drop(self) -> None:
        if self._child is not None:
            self._child.kill()
        self._child = None

    def _ensure(self) -> _Child:
        if self._child is not None and self._child.alive():
            return self._child
        self._drop()
        try:
            child = _Child(self._command)
        except OSError as error:
            raise EvaluatorError(f'cannot start the evaluator {self._command!r}: {error}') from error
        self._child = child
        try:
            answer = self._exchange(child, {'op': 'hello'}, self._startup_timeout)
            if answer.get('protocol') != PROTOCOL or not isinstance(answer.get('commit'), str) or not answer['commit']:
                raise EvaluatorError(f'the evaluator speaks protocol {answer.get("protocol")!r} / commit {answer.get("commit")!r}; expected protocol {PROTOCOL}')
        except EvaluatorError:
            self._drop()
            raise
        self._commit = answer['commit']
        return child

    # one exchange
    def _exchange(self, child: _Child, request: dict, timeout: float) -> dict:
        self._next_id += 1
        request = {'id': self._next_id, **request}
        try:
            line = json.dumps(request, ensure_ascii=False, allow_nan=False, separators=(',', ':')).encode('utf-8') + b'\n'
        except (TypeError, ValueError) as error:
            raise EvaluatorRefused('bad-request', f'the request is not JSON: {error}') from error
        if len(line) > MAX_REQUEST_BYTES:
            raise EvaluatorRefused('too-large', f'a request may be at most {MAX_REQUEST_BYTES} bytes')
        try:
            child.process.stdin.write(line)  # type: ignore[union-attr]
            child.process.stdin.flush()  # type: ignore[union-attr]
        except OSError as error:
            raise _Died(f'the evaluator closed its input: {error}') from error
        while True:
            try:
                raw = child.lines.get(timeout=timeout)
            except queue.Empty:
                raise EvaluatorError(f'the evaluator did not answer within {timeout} seconds') from None
            if raw is _EOF:
                raise _Died('the evaluator exited before answering')
            try:
                answer = json.loads(raw)
            except ValueError as error:
                raise EvaluatorError(f'the evaluator answered with something that is not JSON: {raw[:200]!r}') from error
            if not isinstance(answer, dict) or 'ok' not in answer:
                raise EvaluatorError(f'the evaluator answered out of protocol: {raw[:200]!r}')
            if answer.get('id') != request['id']:
                if answer.get('id') is None and answer.get('ok') is False:
                    raise EvaluatorRefused(answer['error']['code'], answer['error']['message'])  # e.g. too-large, answered before the id was known
                raise EvaluatorError(f'the evaluator answered request {answer.get("id")!r} while {request["id"]} was pending')
            if answer['ok'] is not True:
                error = answer.get('error') or {}
                raise EvaluatorRefused(str(error.get('code')), str(error.get('message')))
            return answer

    def _call(self, request: dict) -> dict:
        with self._lock:
            for attempt in (1, 2):
                child = self._ensure()
                try:
                    return self._exchange(child, request, self._timeout)
                except _Died as error:
                    self._drop()
                    if attempt == 2:
                        raise EvaluatorError(str(error)) from error
                    log.warning('evaluator died mid-request (%s); restarting once', error)  # evaluation is pure, so one retry is safe
                except EvaluatorRefused:
                    raise  # the child is fine; the request was not
                except EvaluatorError:
                    self._drop()  # a timeout or garbage: do not trust this child again
                    raise
            raise AssertionError('unreachable')

    # operations
    @staticmethod
    def _context(now: str, params: dict | None, vars: dict | None, artifact_types: list | None, rules: list | None) -> dict:
        context: dict[str, Any] = {'now': now, 'params': params or {}}
        if vars:
            context['vars'] = vars
        if artifact_types:
            context['artifactTypes'] = artifact_types
        if rules:
            context['rules'] = rules
        return context

    def evaluate_guard(self, expr: str, *, now: str, params: dict | None = None, vars: dict | None = None,
                       artifact_types: list | None = None, rules: list | None = None) -> GuardResult:
        answer = self._call({'op': 'evaluate', 'mode': 'guard', 'expr': expr, **self._context(now, params, vars, artifact_types, rules)})
        return GuardResult(answer['status'], answer.get('message'))

    def evaluate_value(self, expr: str, *, now: str, params: dict | None = None, vars: dict | None = None,
                       artifact_types: list | None = None, rules: list | None = None) -> dict:
        """`{'value', 'text'}`, or `{'error'}` when the expression itself does not evaluate."""
        answer = self._call({'op': 'evaluate', 'mode': 'value', 'expr': expr, **self._context(now, params, vars, artifact_types, rules)})
        return {k: v for k, v in answer.items() if k not in ('id', 'ok')}

    def evaluate_guards(self, guard: str | list | None, *, now: str, params: dict | None = None, vars: dict | None = None,
                        artifact_types: list | None = None, rules: list | None = None) -> list[tuple[str, GuardResult]]:
        """A node's guard (a string or a list of `{label, when}`) as one `(label, result)` per condition."""
        request = {'op': 'guards', **self._context(now, params, vars, artifact_types, rules)}
        if guard is not None:
            request['guard'] = guard
        return [(item['label'], GuardResult(item['status'], item.get('message'))) for item in self._call(request)['items']]


class _Died(EvaluatorError):
    """The child went away mid-request (as opposed to answering badly)."""
