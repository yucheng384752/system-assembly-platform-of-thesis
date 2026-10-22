"""Validate configuration without importing crypto packages or reading .env."""
import os
from datetime import datetime, timedelta, timezone
from uuid import UUID

from .passwords import validate_password


def load_secret(environ=None):
    secret = (os.environ if environ is None else environ).get("ENTRY_PERMISSION_JWT_SECRET")
    if not isinstance(secret, str) or len(secret) < 32:
        raise ValueError("ENTRY_PERMISSION_JWT_SECRET must contain at least 32 characters")
    return secret


def hash_password(password):
    import bcrypt
    return bcrypt.hashpw(validate_password(password), bcrypt.gensalt()).decode("ascii")


def verify_password(password, hashed):
    import bcrypt
    try:
        return bcrypt.checkpw(validate_password(password), hashed.encode("ascii"))
    except (ValueError, UnicodeError, TypeError):
        return False


def issue_token(user_id, secret):
    import jwt
    now = datetime.now(timezone.utc)
    return jwt.encode({"sub": str(UUID(str(user_id))), "iat": now,
                       "exp": now + timedelta(hours=8)}, secret, algorithm="HS256")


def token_subject(token, secret):
    import jwt
    try:
        claims = jwt.decode(token, secret, algorithms=["HS256"],
                            options={"require": ["sub", "iat", "exp"]})
        return UUID(claims["sub"])
    except (jwt.InvalidTokenError, ValueError, TypeError, AttributeError):
        return None
