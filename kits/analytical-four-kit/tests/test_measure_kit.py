"""Run directly with Python to bypass conftest's heavy Kit imports, or collect with the Kit pytest suite."""
import importlib.util
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from contextlib import nullcontext
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.dont_write_bytecode = True
TOOL = Path(__file__).resolve().parents[1] / 'tools' / 'measure_kit.py'
spec = importlib.util.spec_from_file_location('measure_kit', TOOL)
measure = importlib.util.module_from_spec(spec)
spec.loader.exec_module(measure)


class MeasureTests(unittest.TestCase):
    def test_demo_cleanup_error_keeps_completed_measurement(self):
        app = MagicMock()
        routes = app.api.routes_analytical_four
        routes.store.return_value.active = None
        modules = {'fastapi': MagicMock(), 'fastapi.testclient': MagicMock(), 'requests': MagicMock(),
                   'app': app, 'app.api': app.api, 'app.analytical_four': app.analytical_four,
                   'app.analytical_four.pipeline': app.analytical_four.pipeline}
        directories = []

        def locked_rmtree(path, *, onerror):
            directories.append(path)
            try:
                raise NotADirectoryError(267, 'vector store still holds the file open', str(Path(path) / 'chroma.sqlite3'))
            except NotADirectoryError:
                onerror(shutil.rmtree, path, sys.exc_info())

        def completed():
            with measure.demo_client():
                return {'G.complain.total': .5}

        book = measure.Measurements(1)
        try:
            with patch.dict(sys.modules, modules), patch.object(shutil, 'rmtree', side_effect=locked_rmtree):
                book.attempt('G.complain', 1, completed)
            self.assertEqual(len(directories), 1)
            self.assertEqual(book.failures, [])
            self.assertEqual(book.samples, {'G.complain.total': [.5]})
            self.assertTrue(any('Windows' in note and '系統暫存' in note and '可能殘留' in note
                                for note in book.report()['notes']))
        finally:
            for directory in directories:
                shutil.rmtree(directory)

    def test_statistics_use_nearest_rank_and_keep_raw_order(self):
        samples = [20., *map(float, range(1, 20))]
        result = measure.summarize('x', samples)
        self.assertEqual((result['min'], result['median'], result['p95'], result['max']), (1, 10.5, 19, 20))
        self.assertEqual(result['samples'], samples)
        self.assertTrue(result['p95Reliable'])
        self.assertFalse(measure.summarize('x', [3., 1., 2.])['p95Reliable'])
        for invalid in ([], [-1.], [float('nan')], [float('inf')]):
            with self.assertRaises(ValueError):
                measure.summarize('x', invalid)

    def test_stage_times_keep_first_observations_and_skip_skipped(self):
        stages = measure.StageTimes(0.)
        stages.observe([{'id': 'a', 'state': 'running'}, {'id': 'b', 'state': 'skipped'}], 1.)
        stages.observe([{'id': 'a', 'state': 'running'}], 2.)
        stages.observe([{'id': 'a', 'state': 'done'}, {'id': 'c', 'state': 'done'}], 4.)
        stages.observe([{'id': 'a', 'state': 'done'}, {'id': 'd', 'state': 'failed'}], 9.)
        self.assertEqual(stages.running, {'a': 1.})
        self.assertEqual(stages.finished, {'b': 1., 'a': 4., 'c': 4., 'd': 9.})
        self.assertEqual(stages.durations, {'a': 3., 'c': 2.})
        self.assertEqual(stages.upper_bounds, ['c'])

    def test_failed_analysis_is_recorded_excluded_and_exits_nonzero(self):
        records = [
            {'runId': 'r', 'state': 'running', 'stages': [{'id': 'read', 'state': 'running'}]},
            {'runId': 'r', 'state': 'failed', 'stages': [{'id': 'read', 'state': 'failed'}], 'error': {'message': 'broken'}},
        ]
        book = measure.Measurements(1)
        with patch.object(measure, 'request', side_effect=records), patch.object(measure.time, 'sleep'):
            book.attempt('G.daily', 1, lambda: measure.generation(None, 'G.daily', book.notes))
        self.assertEqual(book.samples, {})
        self.assertEqual(book.failures[0]['id'], 'G.daily')
        self.assertEqual(book.failures[0]['repeat'], 1)
        self.assertIn('broken', book.failures[0]['reason'])
        with tempfile.TemporaryDirectory() as temporary:
            self.assertEqual(measure.write_reports(Path(temporary), book.report()), 1)
            markdown = next(Path(temporary).glob('*.md')).read_text(encoding='utf-8')
            self.assertTrue(markdown.startswith('失敗數：1'))

    def test_output_contract_and_git_unavailable(self):
        book = measure.Measurements(1)
        book.attempt('A.1', 1, lambda: {'A.1': .25})
        with patch.object(measure.subprocess, 'run', side_effect=FileNotFoundError('git')):
            report = book.report()
        self.assertEqual(set(report), {'format', 'version', 'environment', 'repeats', 'results', 'failures', 'notes'})
        self.assertEqual(report['format'], 'composer-measure')
        self.assertEqual(report['version'], 1)
        self.assertIsNone(report['environment']['git'])
        self.assertEqual(set(report['environment']), {'os', 'python', 'cpuCount', 'kit', 'version', 'git', 'utc'})
        with tempfile.TemporaryDirectory() as temporary:
            out = Path(temporary)
            self.assertEqual(measure.write_reports(out, report), 0)
            self.assertEqual(len(list(out.iterdir())), 2)
            self.assertEqual(json.loads(next(out.glob('*.json')).read_text(encoding='utf-8')), report)
            self.assertIn('不含人的操作時間', next(out.glob('*.md')).read_text(encoding='utf-8'))

    def test_output_inside_repo_is_refused_before_measurement(self):
        with patch.object(measure, 'measure') as work, patch('sys.stderr'):
            with self.assertRaises(SystemExit) as error:
                measure.main(['--out', str(measure.REPO / 'forbidden')])
        self.assertEqual(error.exception.code, 2)
        work.assert_not_called()
        for path in (measure.REPO, measure.KIT / 'tools' / '..'):
            with self.assertRaisesRegex(ValueError, 'outside the repository'):
                measure.outside_repo(path)

    def test_adjustments_reset_same_base_in_fixed_order(self):
        sent = []

        def request(client, method, route, **kwargs):
            sent.append(kwargs['json'])
            return {}

        with patch.object(measure, 'request', side_effect=request), patch.object(measure, 'check_ready'):
            for index in range(4):
                self.assertEqual(list(measure.adjustment(None, index)), [f'A.{index + 1}'])
        self.assertTrue(all(base == measure.starting_settings() for base in sent[::2]))
        self.assertFalse(sent[1]['layers']['c'])
        self.assertEqual(sent[3]['mode'], 'complain')
        self.assertEqual(sent[5]['llm']['timeoutSeconds'], 60)
        self.assertEqual(sent[7]['columnMapping'], {'timestamp': 'measurement_timestamp'})

    def test_failed_data_check_is_not_a_successful_adjustment(self):
        book = measure.Measurements(1)
        responses = [{}, {}, {'readiness': {'a': {'ready': True}}}, {'ok': False, 'errors': ['missing column']}]
        with patch.object(measure, 'request', side_effect=responses):
            book.attempt('A.4', 1, lambda: measure.adjustment(None, 3))
        self.assertEqual(book.samples, {})
        self.assertIn('檢查未通過', book.failures[0]['reason'])

    def test_generation_polls_and_measures_total_and_stage(self):
        records = [
            {'runId': 'r', 'state': 'queued', 'stages': [{'id': 'read', 'state': 'pending'}]},
            {'runId': 'r', 'state': 'running', 'stages': [{'id': 'read', 'state': 'running'}]},
            {'runId': 'r', 'state': 'succeeded', 'stages': [{'id': 'read', 'state': 'done'}]},
        ]
        with patch.object(measure, 'request', side_effect=records) as request, \
                patch.object(measure.time, 'perf_counter', side_effect=[0., 1., 2., 5.]), \
                patch.object(measure.time, 'sleep') as sleep:
            result = measure.generation(None, 'G.daily', [])
        self.assertEqual(result, {'G.daily.total': 5., 'G.daily.read': 3.})
        self.assertEqual([call.args[1:3] for call in request.call_args_list],
                         [('POST', '/runs'), ('GET', '/runs/r'), ('GET', '/runs/r')])
        self.assertEqual([call.args for call in sleep.call_args_list], [(.02,), (.02,)])

    def test_upload_calls_all_steps_and_rejects_unsupported_file(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'current_daily.csv'
            path.write_text('x\n1\n', encoding='utf-8')
            responses = [{'uploadId': 'u'}, {'report': {'ok': True}}, {'status': 'accepted'}, {'ok': True}]
            with patch.object(measure, 'request', side_effect=responses) as request, \
                    patch.object(measure.time, 'perf_counter', side_effect=range(8)):
                result = measure.import_file(None, path, 'I.current_daily.csv')
            self.assertEqual(result, {f'I.current_daily.csv.{step}': 1 for step in ('upload', 'report', 'accept', 'data-check')})
            self.assertEqual([call.args[1:3] for call in request.call_args_list],
                             [('POST', '/uploads'), ('GET', '/uploads/u'), ('POST', '/uploads/u/accept'), ('GET', '/data-check')])
            with self.assertRaisesRegex(ValueError, 'no upload kind for known_base.json'):
                measure.import_file(None, Path(temporary) / 'known_base.json', 'I.known_base.json')
            path.write_bytes(b'')
            with patch.object(measure, 'request') as request:
                with self.assertRaisesRegex(ValueError, 'cannot upload empty file'):
                    measure.import_file(None, path, 'I.current_daily.csv')
                request.assert_not_called()

    def test_poll_retries_keep_sample_and_elapsed_time(self):
        queued = {'runId': 'r', 'state': 'queued', 'stages': []}
        done = {'runId': 'r', 'state': 'succeeded', 'stages': []}
        server_error = RuntimeError('HTTP 503')
        server_error.response = MagicMock(status_code=503)
        book = measure.Measurements(1)
        elapsed = [0.]

        def sleep(seconds):
            elapsed[0] += seconds

        with patch.object(measure, 'request', side_effect=[queued, PermissionError('status.json'), server_error, done]) as request, \
                patch.object(measure.time, 'perf_counter', side_effect=lambda: elapsed[0]), \
                patch.object(measure.time, 'sleep', side_effect=sleep) as pause:
            book.attempt('G.complain', 1, lambda: measure.generation(None, 'G.complain', book.notes))
        self.assertEqual(book.failures, [])
        self.assertAlmostEqual(book.samples['G.complain.total'][0], .04)
        self.assertIn('G.complain: 2 polling reads were retried', '\n'.join(book.notes))
        self.assertEqual([call.args for call in pause.call_args_list], [(.02,), (.01,), (.01,)])
        self.assertEqual([call.args[1:3] for call in request.call_args_list],
                         [('POST', '/runs')] + [('GET', '/runs/r')] * 3)

    def test_four_failed_poll_reads_are_recorded_as_failure(self):
        queued = {'runId': 'r', 'state': 'queued', 'stages': []}
        book = measure.Measurements(1)
        with patch.object(measure, 'request', side_effect=[queued] + [PermissionError('status.json')] * 4) as request, \
                patch.object(measure.time, 'sleep') as pause:
            book.attempt('G.complain', 1, lambda: measure.generation(None, 'G.complain', book.notes))
        self.assertEqual(request.call_count, 5)
        self.assertEqual([call.args for call in pause.call_args_list], [(.02,), (.01,), (.01,), (.01,)])
        self.assertEqual(book.samples, {})
        self.assertEqual(len(book.failures), 1)
        self.assertIn('PermissionError: status.json', book.failures[0]['reason'])
        self.assertIn('G.complain: 3 polling reads were retried', '\n'.join(book.notes))

    def test_generation_does_not_retry_post_or_http_4xx(self):
        queued = {'runId': 'r', 'state': 'queued', 'stages': []}
        client_error = RuntimeError('HTTP 404')
        client_error.response = MagicMock(status_code=404)
        for responses in ([PermissionError('POST failed')], [queued, client_error]):
            with self.subTest(responses=responses), patch.object(measure, 'request', side_effect=responses) as request, \
                    patch.object(measure.time, 'sleep'):
                book = measure.Measurements(1)
                book.attempt('G.complain', 1, lambda: measure.generation(None, 'G.complain', book.notes))
                self.assertEqual(request.call_count, len(responses))
                self.assertEqual(len(book.failures), 1)
                self.assertFalse(any('polling reads were retried' in note for note in book.notes))

    def test_i_excludes_generated_and_empty_files_without_failures(self):
        expected = {'analysis_config.json', 'analysis_config_complaint.json', 'baseline.csv', 'current_daily.csv',
                    'complaint.csv', 'knowledge.csv', 'ng_code.json', 'topology.json'}
        demo_relative = Path('src/backend/app/analytical_four/demo_data')
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            demo = root / demo_relative
            shutil.copytree(measure.KIT / demo_relative, demo)
            for empty_topology in (False, True):
                with self.subTest(empty_topology=empty_topology):
                    if empty_topology:
                        (demo / 'config/topology.json').write_bytes(b'')
                    uploaded = []

                    def request(client, method, route, **kwargs):
                        if route == '/uploads':
                            self.assertNotEqual(kwargs['params']['filename'], 'known_base.json')
                            self.assertTrue(kwargs['content'], 'an empty file reached POST uploads')
                            uploaded.append(kwargs['params']['filename'])
                            return {'uploadId': 'u'}
                        if route == '/uploads/u':
                            return {'report': {'ok': True}}
                        if route == '/uploads/u/accept':
                            return {'status': 'accepted'}
                        if route == '/data-check':
                            return {'ok': True}
                        self.assertEqual(route, '/settings')
                        return {}

                    book = measure.Measurements(2)
                    with patch.object(measure, 'KIT', root), \
                            patch.object(measure, 'demo_client', side_effect=lambda: nullcontext((None, root))), \
                            patch.object(measure, 'request', side_effect=request):
                        measure.measure(book, ['I'])
                    wanted = expected - ({'topology.json'} if empty_topology else set())
                    self.assertCountEqual(uploaded, list(wanted) * 2)
                    self.assertEqual(book.failures, [])
                    report = book.report()
                    self.assertEqual(len(report['results']), len(wanted) * 4)
                    self.assertTrue(all(row['n'] == 2 for row in report['results']))
                    self.assertEqual(measure.write_reports(root / 'reports', report), 0)
                    notes = '\n'.join(report['notes'])
                    self.assertIn('known_base.json', notes)
                    self.assertIn('每日模式產生', notes)
                    self.assertIn('0 位元組', notes)
                    self.assertIn('拒絕空檔', notes)

    def test_a_smoke_writes_both_reports(self):
        self.check_smoke('A', ['A.1', 'A.2', 'A.3', 'A.4'])

    def test_i_smoke_writes_both_reports(self):
        names = ('analysis_config.json', 'analysis_config_complaint.json', 'baseline.csv', 'current_daily.csv',
                 'complaint.csv', 'knowledge.csv', 'ng_code.json', 'topology.json')
        self.check_smoke('I', [f'I.{name}.{step}' for name in names for step in ('upload', 'report', 'accept', 'data-check')])

    def check_smoke(self, group, expected):
        missing = [name for name in ('pandas', 'chromadb', 'sentence_transformers', 'fastapi', 'httpx')
                   if importlib.util.find_spec(name) is None]
        if missing:
            self.skipTest('Kit dependencies unavailable: ' + ', '.join(missing))
        with tempfile.TemporaryDirectory() as temporary:
            result = subprocess.run([sys.executable, '-B', str(TOOL), '--out', temporary, '--repeats', '1', '--only', group],
                                    capture_output=True, text=True, timeout=180)
            files = list(Path(temporary).glob('measure-*'))
            reports = [p.read_text(encoding='utf-8') for p in files if p.suffix == '.json']
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr + '\n'.join(reports))
            self.assertEqual(len(files), 2)
            report = json.loads(reports[0])
            self.assertCountEqual([r['id'] for r in report['results']], expected)
            self.assertEqual(report['failures'], [])


if __name__ == '__main__':
    unittest.main()
