"""組出完整 UserRead（含範圍與入口覆寫）的單一位置。"""

from sqlalchemy.orm import Session

from app.core.entry_point_overrides import entry_point_overrides_read
from app.core.user_scopes import scopes_read
from app.models.user import User
from app.schemas.auth import UserRead


def user_read(user: User, db: Session) -> UserRead:
    data = UserRead.model_validate(user).model_dump()
    data["scopes"] = scopes_read(user, db)
    data["entry_point_overrides"] = entry_point_overrides_read(user, db)
    return UserRead(**data)
