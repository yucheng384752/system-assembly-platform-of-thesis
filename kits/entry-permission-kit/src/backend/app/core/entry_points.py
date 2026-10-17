"""入口權限目錄（機制）。

本 Kit 只擁有「註冊、查詢、覆寫」的機制；各業務 Kit 在載入時註冊自己的入口。
不在這裡列出其他 Kit 的入口，避免本 Kit 依賴業務 Kit（低耦合）。

規則：
- key 為 `^[a-z0-9_]+$`，全系統唯一；重複註冊直接報錯，不默默覆蓋。
- 角色清單不可為空，且不可包含唯讀角色。
- `overridable=False` 的入口不列入 admin 覆寫畫面，例如只限 admin 的簽核。
- `tags` 讓其他 Kit 宣告附帶能力，例如 `user-directory` 代表持有者可以讀取
  帳號清單（指派人員時需要），取代直接引用其他 Kit 的入口常數。
"""

import re
from dataclasses import dataclass, field

from app.core.roles import READ_ONLY_ROLES, Role

_KEY_PATTERN = re.compile(r"^[a-z0-9_]+$")

USER_DIRECTORY_TAG = "user-directory"


class EntryPointError(ValueError):
    """入口宣告不合法或查無此入口。"""


@dataclass(frozen=True)
class EntryPoint:
    key: str
    label: str
    roles: tuple[Role, ...]
    owner_kit: str
    tags: frozenset[str] = field(default_factory=frozenset)
    overridable: bool = True


class EntryPointRegistry:
    def __init__(self) -> None:
        self._items: dict[str, EntryPoint] = {}

    def register(self, entry_point: EntryPoint) -> EntryPoint:
        self._validate(entry_point)
        if entry_point.key in self._items:
            owner = self._items[entry_point.key].owner_kit
            raise EntryPointError(
                f"入口 {entry_point.key} 已由 {owner} 註冊，不可重複註冊"
            )
        self._items[entry_point.key] = entry_point
        return entry_point

    def get(self, key: str) -> EntryPoint:
        try:
            return self._items[key]
        except KeyError as exc:
            raise EntryPointError(f"未知的入口：{key}") from exc

    def all(self) -> tuple[EntryPoint, ...]:
        return tuple(self._items.values())

    def overridable(self) -> tuple[EntryPoint, ...]:
        return tuple(ep for ep in self._items.values() if ep.overridable)

    def with_tag(self, tag: str) -> tuple[EntryPoint, ...]:
        return tuple(ep for ep in self._items.values() if tag in ep.tags)

    @staticmethod
    def _validate(entry_point: EntryPoint) -> None:
        if not _KEY_PATTERN.match(entry_point.key):
            raise EntryPointError(f"入口 key 格式不合法：{entry_point.key!r}")
        if not entry_point.label.strip():
            raise EntryPointError(f"入口 {entry_point.key} 缺少顯示名稱")
        if not entry_point.roles:
            raise EntryPointError(f"入口 {entry_point.key} 的角色清單不可為空")
        read_only = READ_ONLY_ROLES.intersection(entry_point.roles)
        if read_only:
            names = ", ".join(sorted(role.value for role in read_only))
            raise EntryPointError(
                f"入口 {entry_point.key} 不可包含唯讀角色：{names}"
            )


registry = EntryPointRegistry()

# 本 Kit 自己的入口。
USER_MANAGE = registry.register(
    EntryPoint(
        key="user_manage",
        label="帳號管理（新增／列表／改資料／重設密碼）",
        roles=(Role.admin, Role.manager),
        owner_kit="entry-permission-kit",
    )
)
