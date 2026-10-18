from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class ProductLine(Base):
    """產線。status=reserved 代表預留，尚未提供定義（沒有站點），畫面標示並擋下表單讀取。"""

    __tablename__ = "product_lines"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(32), unique=True)
    name: Mapped[str] = mapped_column(String(64), unique=True)
    status: Mapped[str] = mapped_column(String(16), default="reserved")  # defined | reserved
