# Kit matrix verification (required kits plus one optional kit)

Reproduces the per-kit standalone check recorded in `.codex-claude-mailbox/threads/20261104-kit-standalone-verification.md`.
The paths in `run-config.sh` and `assemble-matrix.mjs` (output folder `Desktop/kv-out`, VM address, Python venv) are this
machine's; change them before use. The VM needs Docker, Python 3, passwordless sudo, and Node under `~/kv/node` with the repo
snapshot under `~/kv/repo` and a test root key and 24-hour subkey under `~/kv/keys` (see `scripts/security/WP3d.md`).

```text
node services/package/e2e/kit-matrix/assemble-matrix.mjs [config ...]   # stage 1: real assembly for every combination
node services/package/bundle-frontend.mjs <kv-out>/<config>             # frontend bundle
bash services/package/e2e/kit-matrix/run-config.sh <config>             # ship, images, sign, license, plan, apply, smoke, func, clean
```

`smoke.py` exercises login and every parameterless GET route the running backend lists; `func.py` runs forms, CSV import, edits,
dataflow links and the checks of each optional kit, choosing sections by the routes that exist. Never run the install steps with a
restrictive `umask`: the engine's extracted files inherit it (finding 2 of the thread).
