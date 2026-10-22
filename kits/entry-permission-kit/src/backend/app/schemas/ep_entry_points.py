from pydantic import Field, StrictBool

from .ep_auth import Input


class EntryGrants(Input):
    """Partial update: null removes the stored decision, restoring defaults."""
    entries: dict[str, StrictBool | None] = Field(max_length=300)
