# EP2 verification handoff

All execution and results: **由 Claude 執行**. Codex did not run Python, Docker,
dependency installation, HTTP requests or these tests.

Pure tests, from repository root, need only Python's standard library:

```sh
python -m unittest discover -s kits/entry-permission-kit/tests -p test_logic.py -v
```

The middleware suite needs an assembled backend (EP files merged into `app/`,
including the unchanged platform-core files) and its dependencies. Set
`PYTHONPATH` to that backend; inside Claude's Docker environment run:

```sh
python -m unittest discover -s kits/entry-permission-kit/tests -p test_middleware_integration.py -v
```

It calls the real entry and legacy middleware with fake database reads; it is
**not** PostgreSQL, cross-worker or deployed HTTP verification. Tests cover a
user override allowing an operator while the unchanged old layer still denies
the manager-only endpoint, both layers allowing, entry denial, tenant rejection
including an admin, exact/absent tenant, inactive/readonly/forced-password users,
and expired/wrong-signature/missing-claim JWTs.

## EP4 / EP5 integration contract

- Import all four `app.models.ep_*` modules before migrations/table setup.
- Register the four `app.api.routes_ep_*` routers; their prefixes already include
  `/api`. Do not add another `/api` prefix.
- During startup call `configure_entry_permission(app, directory_path=...,
  default_tenant_id=DEFAULT_TENANT_ID, machine_auth=original_api_key_middleware)`.
  Read `DEFAULT_TENANT_ID` from deployment configuration; no fallback tenant is
  invented. It must identify the existing default tenant. This call validates
  the dedicated environment JWT secret and directory before requests start.
- Replace the outer end-user API-key gate with `entry_permission_middleware`.
  Keep the original machine middleware callable and the unchanged
  `endpoint_permission_middleware` downstream. Merely adding EP inside the old
  API-key gate will reject Bearer users. Do not disable the machine validator:
  it must still execute its baseline `AUTH_MODE=api_key` checks.
- An `X-Admin-API-Key` request without Authorization uses that original validator;
  its downstream continuation requires validated `is_admin`, then checks tenant
  headers, then continues into the old endpoint gate. Bearer requests always use
  the user path even if a machine header is also supplied.
- `GET /api/entry-points/me` returns an array of entry keys, **entry layer only**.
  Actual access is the intersection with the old endpoint gate and endpoint's
  own checks. Emit the specified assembly warning for a nonempty legacy config.
- User and role grant PUT bodies use `{"entries":{"domain.action":true}}`.
  False explicitly denies; null removes that key's stored decision; omitted
  keys remain unchanged. Role names are stable; PATCH changes display name and
  readonly status. Users expose role_id, never password_hash or lockout state.
- Create initial admin after schema installation with
  `python -m app.entry_permission.create_admin`, stdin JSON containing exactly
  `username`, `password`, `display_name`. No command-line secrets; no input echoed.
  Builtins are seeded transactionally; the command refuses an existing builtin
  administrator. PostgreSQL advisory lock serializes simultaneous bootstraps.
- Unknown API routes require active builtin admin; known entry routes use the
  specified override > role > defaults policy even for admin. Duplicate tenant
  headers are rejected. Path matches are anchored and parameter segments cannot
  span slashes. When route declarations overlap, all matching entries must allow.
- Login locks the user row with PostgreSQL `FOR UPDATE OF ep_users`, including
  failed attempts. Five failures lock for 15 minutes; expiry resets the count.
  Unknown users, bad passwords, locked and inactive users return the same 401.
  Unknown usernames have no row to persist counters in; no new tracking table
  or in-memory substitute was added. Existing-account lockout is shared in DB.
- No token revocation: password changes/resets do not invalidate old JWTs.
  Every request reloads active/role/must-change state from the database.

## Remaining real PostgreSQL / HTTP checks — 由 Claude 執行

1. Create all four tables, confirm PK/FK/unique/readonly constraints and deletion
   of an assigned role returns 409; builtin role deletion and admin readonly / audit
   writable changes return 403. Validate generated OpenAPI and response serialization.
2. Bootstrap from stdin, repeat and race two commands: exactly one initial admin,
   must_change_password true, no plaintext/password hash in output or SQL logging.
3. Login succeeds; nonexistent username/wrong password/inactive/locked return
   identical 401 bodies. Five failed logins across independent worker sessions
   persist the lock; correct password while locked fails; exact expiry succeeds.
4. Force-change gate blocks business endpoints and profile PATCH; GET me and
   change-password remain usable. Reset reinstates the gate, and old tokens
   observe current state. Validate bcrypt ASCII/Unicode 72-byte limits.
5. Manager list/create/update/reset cannot reach admin/manager or assign those
   roles; test admin and custom user-manage grantees as well. Non-admin override
   and role-management routes fail even if their entry is explicitly allowed.
6. Set/remove true/false/null grants and overrides; verify effective visibility
   and requests; readonly target override assignment fails. Unknown keys fail.
7. For admin and ordinary user, missing/exact tenant succeeds and alternate,
   empty or duplicate tenant headers return generic 403 without reaching the
   tenant resolver. Existing machine API-key behavior, including invalid key
   rejection and baseline tenant-key validation, remains effective.
8. Nonempty old endpoint config denies an EP-allowed request; `/me` continues to
   show entry-layer visibility. Test real existing Kit endpoints such as audit
   edits. No role promotion or bypass. Test startup missing/short JWT secret,
   missing/malformed directory, and incorrect integration middleware order.

## Mutation checks — 由 Claude 執行, not run

In a disposable copy, one change at a time, restore after each:

- Remove readonly write rejection: `PolicyTests.test_readonly_before_every_allow`
  and the readonly middleware case must fail.
- Swap override and role precedence: bidirectional precedence test must fail.
- Allow unknown routes for ordinary roles: default-deny test must fail.
- Replace exact path matching with prefix matching: segment matching must fail.
- Remove duplicate entry/JSON member rejection: their directory tests must fail.
- Change the password byte ceiling or lockout fifth-attempt / expiry boundary:
  the corresponding boundary tests must fail.
- Accept a 31-character JWT key: configuration boundary test must fail.
- Skip tenant validation or accept arbitrary headers: tenant pure and middleware
  tests must fail, including builtin admin.
- Promote the user to admin or bypass call_next after EP allow: old-role-veto
  middleware test must fail. Do not modify platform-core for production.

No mutation or security rejection path is claimed to have passed.
