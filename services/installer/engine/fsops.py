"""Fixed privileged filesystem operations; input is private stdin, never argv."""
import json
import os
from pathlib import Path
import shutil
import sys


def execute(body):
    path = Path(body['path'])
    if not path.is_absolute() or path == Path(path.anchor):
        raise ValueError('Unsafe filesystem target')
    for parent in (path, *path.parents):
        if parent.is_symlink():
            raise ValueError('Symbolic link in filesystem target')
    action = body['action']
    if action == 'mkdir':
        path.mkdir(mode=body.get('mode', 0o755), parents=True, exist_ok=False)
    elif action == 'write':
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, body.get('mode', 0o644))
        with os.fdopen(fd, 'wb') as stream:
            stream.write(body['text'].encode('utf-8'))
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(path, body.get('mode', 0o644))
    elif action == 'copy':
        source = Path(body['source'])
        if source.is_symlink() or any(p.is_symlink() for p in source.rglob('*')):
            raise ValueError('Symbolic link in copy source')
        shutil.copytree(source, path)
        os.chmod(path, 0o755)
    elif action == 'remove':
        if path.is_dir():
            shutil.rmtree(path)
        else:
            path.unlink(missing_ok=True)
    else:
        raise ValueError('Unknown filesystem operation')
    if action != 'remove' and 'owner' in body:
        os.chown(path, body['owner'][0], body['owner'][1])


if __name__ == '__main__':
    try:
        execute(json.load(sys.stdin))
    except Exception:
        print('Privileged filesystem operation failed', file=sys.stderr)
        sys.exit(1)
