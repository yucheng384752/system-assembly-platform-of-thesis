"""子表格備註的規則（純函式）：只增不改，留下完整紀錄。"""

MAX_LENGTH = 1000


class NoteError(ValueError):
    pass


def clean_note(text: str) -> str:
    cleaned = (text or "").strip()
    if not cleaned:
        raise NoteError("備註不可空白")
    if len(cleaned) > MAX_LENGTH:
        raise NoteError(f"備註最多 {MAX_LENGTH} 字")
    return cleaned
