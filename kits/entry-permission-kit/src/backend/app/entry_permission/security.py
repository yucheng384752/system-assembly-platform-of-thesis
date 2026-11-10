"""Validate configuration without importing crypto packages or reading .env."""
import hashlib
import hmac
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


def password_binding(password_hash, secret):
    """Ties a token to the password it was issued under, without putting the hash in the token.

    Changing or resetting the password changes the stored hash, so every earlier token stops matching. No column or
    token list is needed, which also means there is no logout: a token otherwise lives until it expires.
    """
    return hmac.new(secret.encode("utf-8"), str(password_hash).encode("utf-8"), hashlib.sha256).hexdigest()[:32]


def issue_token(user_id, secret, password_hash):
    import jwt
    now = datetime.now(timezone.utc)
    return jwt.encode({"sub": str(UUID(str(user_id))), "iat": now, "exp": now + timedelta(hours=8),
                       "pwd": password_binding(password_hash, secret)}, secret, algorithm="HS256")


def token_claims(token, secret):
    """(subject, password binding) of a valid token, otherwise None."""
    import jwt
    try:
        claims = jwt.decode(token, secret, algorithms=["HS256"],
                            options={"require": ["sub", "iat", "exp", "pwd"]})
        if not isinstance(claims["pwd"], str):
            return None
        return UUID(claims["sub"]), claims["pwd"]
    except (jwt.InvalidTokenError, ValueError, TypeError, AttributeError):
        return None


def binding_matches(binding, password_hash, secret):
    return hmac.compare_digest(binding.encode("utf-8"), password_binding(password_hash, secret).encode("utf-8"))
