"""Run once: python -m app.entry_permission.create_admin < private-input.json.

Only stdin JSON supplies username/password/display_name. No command-line secrets,
no password defaults, no secret-bearing exception output. Schema must exist first.
"""
import asyncio
import json
import sys

from .passwords import validate_password


def read_input(stream):
    raw = stream.read(16385)
    if len(raw) > 16384:
        raise ValueError("Input too large")
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError("Duplicate input key")
            result[key] = value
        return result
    body = json.loads(raw, object_pairs_hook=unique)
    if not isinstance(body, dict) or set(body) != {"username", "password", "display_name"}:
        raise ValueError("Invalid input")
    for key in ("username", "display_name"):
        if not isinstance(body[key], str) or not 1 <= len(body[key]) <= 100:
            raise ValueError("Invalid input")
    validate_password(body["password"])
    return body


async def create(body):
    from sqlalchemy import select, text
    from app.core import database
    from app.models.ep_role import EpRole
    from app.models.ep_user import EpUser
    from .security import hash_password

    await database.init_db()
    # init_db may enable SQL echo; never print even a password hash.
    database.engine.echo = False
    database.engine.sync_engine.hide_parameters = True
    try:
        async with database.get_db_context() as db:
            # Serialize one-time bootstrap even across installer processes.
            await db.execute(text("SELECT pg_advisory_xact_lock(12720261022)"))
            if await db.scalar(select(EpUser.id).join(EpRole).where(EpRole.name == "admin", EpRole.is_builtin.is_(True)).limit(1)):
                raise ValueError("Administrator already exists")
            roles = {role.name: role for role in (await db.scalars(select(EpRole))).all()}
            for name in ("admin", "audit", "manager", "operator"):
                if name in roles:
                    if not roles[name].is_builtin or roles[name].is_readonly != (name == "audit"):
                        raise ValueError("Builtin role conflicts")
                else:
                    role = EpRole(name=name, display_name=name, is_builtin=True, is_readonly=name == "audit")
                    db.add(role)
                    roles[name] = role
            await db.flush()
            db.add(EpUser(username=body["username"], display_name=body["display_name"],
                          password_hash=await asyncio.to_thread(hash_password, body["password"]),
                          role_id=roles["admin"].id, must_change_password=True, is_active=True))
    finally:
        await database.close_db()


def main():
    try:
        if len(sys.argv) != 1:
            raise ValueError("Command arguments are not accepted")
        body = read_input(sys.stdin)
        asyncio.run(create(body))
    except Exception:
        print("Administrator creation failed; verify input and database setup.", file=sys.stderr)
        return 1
    print("Administrator created; password change required.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
