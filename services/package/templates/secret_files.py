"""Load private values from <NAME>_FILE paths into this process's environment (D138, D142).

Compose mounts the files read-only under /run/secrets, so the values never appear in the container
configuration that `docker inspect` shows; only the file paths do. This must run before any module
that instantiates settings from the environment is imported.
"""
import os
from pathlib import Path

NAMES = ("DATABASE_URL", "SECRET_KEY", "ENTRY_PERMISSION_JWT_SECRET", "MOD_WEBHOOK_SECRET")


def load_secret_files(environ=None):
    env = os.environ if environ is None else environ
    for name in NAMES:
        path = env.get(name + "_FILE", "").strip()
        if not path:
            continue
        if env.get(name, "").strip():
            raise RuntimeError(f"Set either {name} or {name}_FILE, not both")
        try:
            value = Path(path).read_text("utf-8")
        except (OSError, UnicodeError):
            raise RuntimeError(f"Secret file for {name} is unreadable") from None
        value = value[:-1] if value.endswith("\n") else value
        if not value.strip():
            raise RuntimeError(f"Secret file for {name} is empty")
        env[name] = value


if __name__ == "__main__":
    # `python -m app.secret_files <module>` runs a Kit module (for example create_admin) with the secrets loaded.
    import runpy
    import sys

    if len(sys.argv) != 2:
        raise SystemExit("usage: python -m app.secret_files <module>")
    load_secret_files()
    module = sys.argv[1]
    sys.argv = sys.argv[1:]
    runpy.run_module(module, run_name="__main__", alter_sys=True)
