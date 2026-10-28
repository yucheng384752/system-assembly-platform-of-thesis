"""CLI shared by the future wizard; guard remains a separate work package."""
import argparse
import json
import os
from pathlib import Path
import stat
import sys
import tempfile
from common import Failure, Journal, Lock, Runner, canonical, check_plan, read_json, write_json
from detect import detect, fingerprint, current_sources
from license import checked_license, issue_license
from install import Installer, LIMITATIONS, STEPS, deployment_names, make_plan, private_input
from package import verify


class Arguments(argparse.ArgumentParser):
    def error(self, message):
        raise Failure(10, '命令列參數不合法；請使用 --help')


def parser():
    result = Arguments(description='WP3b 首次安裝引擎')
    result.add_argument('command', choices=['detect', 'verify', 'plan', 'apply', 'status', 'cancel', 'rollback',
                                            'issue-license', 'fingerprint', 'license-install', 'guard-up', 'wizard'])
    result.add_argument('--json', action='store_true')
    for name in ('archive', 'signature', 'key', 'confirm-key-prefix', 'plan', 'plan-sha256', 'state-dir',
                 'install-dir', 'trust-dir', 'input-file', 'rollback-plan', 'checkpoint',
                 'subkey', 'certificate', 'out', 'license'):
        result.add_argument('--' + name)
    result.add_argument('--system-id', default='composer')
    result.add_argument('--sys-root', default='/sys')
    result.add_argument('--proc-root', default='/proc')
    result.add_argument('--etc-root', default='/etc')
    result.add_argument('--port', type=int, default=8080)
    result.add_argument('--wizard-port', type=int, default=0)
    result.add_argument('--lock-file', default='/tmp/composer-installer.lock')
    return result


def input_body(args, stream):
    if args.input_file:
        path = Path(args.input_file)
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        try:
            info = os.fstat(fd)
            if not stat.S_ISREG(info.st_mode) or stat.S_IMODE(info.st_mode) != 0o600 or info.st_uid != os.getuid():
                raise Failure(10, '輸入檔必須由目前使用者持有且權限為 0600')
            with os.fdopen(fd, 'r', encoding='utf-8') as source:
                fd = None
                text = source.read(65537)
        finally:
            if fd is not None:
                os.close(fd)
            path.unlink()
    else:
        text = stream.read(65537)
    if len(text) > 65536:
        raise Failure(10, '輸入過大')
    try:
        return json.loads(text)
    except ValueError:
        raise Failure(10, '輸入 JSON 不合法') from None


def prepare_directory(runner, directory):
    if not directory.is_absolute() or any(p.is_symlink() for p in (directory, *directory.parents)):
        raise Failure(10, '狀態目錄路徑不安全')
    if not directory.exists():
        runner.fs('mkdir', directory, owner=[os.getuid(), os.getgid()], mode=0o755)


def source_args(args, trust=None):
    if not args.archive or not args.signature or not args.key:
        raise Failure(10, '需要 --archive、--signature、--key')
    key = Path(args.key).resolve()
    if trust and (trust / 'root.pem').exists():
        key = trust / 'root.pem'
    return dict(archive=str(Path(args.archive).resolve()), signature=str(Path(args.signature).resolve()),
                key=str(key), prefix=args.confirm_key_prefix)


def run(args, runner, emit, stream):
    if args.command in ('license-install', 'guard-up'):
        raise Failure(10, 'license-install 僅由 apply 執行；guard 尚未提供，待 WP3e')
    if args.command == 'wizard':
        import re
        from wizard import serve
        if not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,49}', args.system_id):
            raise Failure(10, 'system-id 不合法')
        forwarded = ['--system-id', args.system_id]
        for name in ('state_dir', 'install_dir', 'trust_dir'):
            if getattr(args, name):
                forwarded += ['--' + name.replace('_', '-'), getattr(args, name)]
        return serve(args.system_id, forwarded, port=args.wizard_port)
    if args.command == 'fingerprint':
        if not hasattr(os, 'geteuid') or os.geteuid() != 0:
            raise Failure(11, '指紋內部命令須以 root 執行')
        emit(fingerprint(args.sys_root)['sources'])
        return 0
    if args.command in ('plan', 'apply') and not args.license:
        raise Failure(11, '需要 --license；請先 issue-license')
    if args.command == 'issue-license':
        try:
            import re
            if not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,49}', args.system_id):
                raise Failure(17, 'system-id 不合法')
            body = input_body(args, stream)
            if not args.subkey or not args.certificate or not args.out:
                raise Failure(17, '缺少簽發參數')
            trust = Path(args.trust_dir or '/etc/' + args.system_id + '/trust').absolute()
            source = source_args(args, trust)
            with tempfile.TemporaryDirectory(prefix='composer-issue-package-') as tmp:
                verified = verify(runner, **source, destination=tmp)
                issue_license(runner, args.subkey, args.certificate, args.out, body, verified,
                              current_sources(runner, args.sys_root))
            emit({'command': 'issue-license', 'status': 'ok'})
            return 0
        except (Failure, OSError, ValueError, KeyError, TypeError):
            raise Failure(17, '授權簽發失敗；請檢查來源、輸入、憑證、硬體指紋與輸出路徑') from None
    import re
    if not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,49}', args.system_id):
        raise Failure(10, 'system-id 不合法')
    if not 1 <= args.port <= 65535:
        raise Failure(10, '連接埠必須介於 1 與 65535')
    directory = Path(args.state_dir or '/var/lib/' + args.system_id + '/install').absolute()
    if args.command == 'detect':
        result = detect(runner, sys_root=args.sys_root, proc_root=args.proc_root, etc_root=args.etc_root,
                        port=args.port)
        prepare_directory(runner, directory)
        write_json(directory / 'detect.json', result)
        emit({'command': 'detect', 'status': 'failed' if result['problems'] else 'ok', 'result': result})
        return 10 if result['problems'] else 0
    if args.command in ('verify', 'plan'):
        trust = Path(args.trust_dir or '/etc/' + args.system_id + '/trust').absolute()
        source = source_args(args, trust)
        with tempfile.TemporaryDirectory(prefix='composer-verify-') as tmp:
            result = verify(runner, **source, destination=tmp)
            if result['manifest']['systemId'] != args.system_id:
                raise Failure(11, 'system-id 與 manifest 不符')
            license_info = None
            if args.license:
                _, license_info = checked_license(runner, args.license, result, current_sources(runner, args.sys_root))
            if args.command == 'verify':
                emit({'command': 'verify', 'status': 'ok', 'manifestSha256': result['manifestSha256'],
                      'keyFingerprint': result['keyFingerprint'], 'license': 'ok' if license_info else 'skipped', 'notProvided': LIMITATIONS})
                return 0
            if not args.plan:
                raise Failure(10, '需要 --plan 輸出路徑')
            detection = detect(runner, sys_root=args.sys_root, proc_root=args.proc_root, etc_root=args.etc_root, port=args.port)
            target = Path(args.install_dir or '/opt/' + args.system_id + '-' + result['manifest']['systemVersion']).absolute()
            plan = make_plan(result, tmp, source, detection, target, trust, license_info)
            if directory == target or target in directory.parents:
                raise Failure(10, '狀態目錄不得位於安裝目錄中')
            write_json(args.plan, plan)
            emit(plan)
            return 0
    if args.command == 'status':
        state = read_json(directory / 'state.json')
        events = [json.loads(line) for line in (directory / 'events.jsonl').read_text(encoding='utf-8').splitlines()]
        emit({'state': state, 'events': events})
        return 0
    if args.command == 'cancel':
        state = read_json(directory / 'state.json')
        if state['status'] != 'running':
            raise Failure(10, '沒有正在執行的 apply')
        write_json(directory / 'cancel.request', {'installId': state['installId']})
        emit({'status': 'ok', 'message': '已要求在目前步驟完成後停止'})
        return 0
    if not args.plan:
        raise Failure(10, '需要 --plan')
    plan = read_json(args.plan)
    if plan.get('format') != 'composer-install-plan' or plan.get('version') != 1:
        raise Failure(12, '計畫格式不符')
    if plan['package']['systemId'] != args.system_id:
        raise Failure(12, '計畫 system-id 不符')
    with Lock(args.lock_file, args.command):
        prepare_directory(runner, directory)
        journal = Journal(directory, emit)
        if args.command == 'rollback':
            state = read_json(directory / 'state.json')
            if state['planSha256'] != plan['planSha256']:
                raise Failure(12, '安裝計畫與狀態不符')
            check_plan(plan, state['planSha256'])
            installer = Installer(runner, journal, plan, state)
            if not args.rollback_plan:
                raise Failure(10, '需要 --rollback-plan 路徑（無確認雜湊時產生還原計畫）')
            if not args.plan_sha256:
                result = installer.rollback_plan(args.checkpoint)
                write_json(args.rollback_plan, result)
                emit(result)
                return 0
            return installer.rollback(read_json(args.rollback_plan), args.plan_sha256)
        check_plan(plan, args.plan_sha256)
        if (directory / 'state.json').exists():
            raise Failure(10, '已有安裝狀態；不覆寫或自動重跑，請先檢視 status／rollback')
        if [s['id'] for s in plan['steps']] != STEPS:
            raise Failure(12, '計畫步驟不符')
        body = input_body(args, stream)
        env, _ = private_input(body, plan)
        detection = detect(runner, sys_root=args.sys_root, proc_root=args.proc_root, etc_root=args.etc_root,
                           port=int(env.get('HTTP_PORT', '8080')))
        if detection['problems']:
            raise Failure(10, '環境重新檢查未通過：' + '；'.join(detection['problems']))
        with tempfile.TemporaryDirectory(prefix='composer-apply-') as tmp:
            source = dict(plan['source'])
            trusted = Path(plan['target']['trustDir']) / 'root.pem'
            if trusted.exists():
                source['key'] = str(trusted)
            result = verify(runner, **source, destination=tmp)
            if (result['manifestSha256'] != plan['package']['manifestSha256']
                    or result['archiveSha256'] != plan['package']['archiveSha256']
                    or result['keyFingerprint'] != plan['package']['keyFingerprint']
                    or result['manifest']['images'] != plan['images']
                    or deployment_names(tmp) != plan['names']):
                raise Failure(12, '套件與已確認計畫不符')
            try:
                _, license_info = checked_license(runner, args.license, result, current_sources(runner, args.sys_root))
            except Failure:
                raise Failure(12, '授權或硬體與已確認計畫不符') from None
            expected = make_plan(result, tmp, plan['source'], detection,
                                 plan['target']['installDir'], plan['target']['trustDir'], license_info)
            if expected != plan:
                raise Failure(12, '環境或套件已改變，請重新產生與確認計畫')
            (directory / 'cancel.request').unlink(missing_ok=True)
            return Installer(runner, journal, plan, key_pem=result['keyPem'],
                             license_path=args.license, sys_root=args.sys_root).apply(tmp, body)


def main(argv=None, runner=None, stream=None):
    arguments = sys.argv[1:] if argv is None else argv
    def emit(value):
        try:
            if '--json' in arguments:
                print(canonical(value).decode('utf-8'), flush=True)
            else:
                print(json.dumps(value, ensure_ascii=False, indent=2), flush=True)
        except BrokenPipeError:
            pass  # A disconnected observer must not interrupt the installation journal.
    try:
        args = parser().parse_args(arguments)
        return run(args, runner or Runner(), emit, stream or sys.stdin)
    except Failure as error:
        emit({'status': 'failed', 'code': error.code, 'message': str(error)})
        return error.code
    except (OSError, ValueError, KeyError, TypeError):
        emit({'status': 'failed', 'code': 10, 'message': '輸入、檔案或系統狀態不合法；秘密值不回顯'})
        return 10


if __name__ == '__main__':
    if sys.version_info < (3, 10):
        print('需要 Python 3.10 以上', file=sys.stderr)
        sys.exit(10)
    raise SystemExit(main())
