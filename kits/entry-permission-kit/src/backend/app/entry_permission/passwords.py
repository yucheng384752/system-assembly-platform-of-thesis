"""Password validation has no third-party imports."""

def validate_password(password):
    if not isinstance(password, str) or len(password) <= 8:
        raise ValueError("Password must contain more than 8 characters")
    try:
        encoded = password.encode("utf-8")
    except UnicodeError as exc:
        raise ValueError("Invalid password encoding") from exc
    if len(encoded) > 72:
        raise ValueError("Password must not exceed 72 UTF-8 bytes")
    return encoded
