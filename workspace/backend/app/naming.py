# -*- coding: utf-8 -*-
"""Workspace member naming domain.

Agent names and display names share ONE namespace per workspace: display
names are routable aliases (the LLM router and the @mention picker resolve
them), so any writer of either field must go through these helpers — the
member PATCH, the agent-join event handler, cloud-agent creation, the OAuth
callback and the Yumi backfill.
"""

import unicodedata
from typing import Optional

from sqlalchemy import func, select

MAX_DISPLAY_NAME_LENGTH = 64

# Cc = control chars (covers \n, \r, \t, \x85, DEL and the \x1c-\x1e file
# separators), Zl/Zp = Unicode line/paragraph separators (U+2028, U+2029).
# Together these cover everything str.splitlines() treats as a line break, so
# a display name can never span lines in the router prompt. Cf (format chars)
# stays allowed so emoji ZWJ sequences keep working — except the bidi
# controls, which can visually reorder surrounding text.
_BANNED_CATEGORIES = {"Cc", "Zl", "Zp"}
_BIDI_CONTROLS = frozenset(
    "\u202a\u202b\u202c\u202d\u202e"  # LRE RLE PDF LRO RLO
    "\u2066\u2067\u2068\u2069"          # LRI RLI FSI PDI
)


def _unsafe(ch: str) -> bool:
    return unicodedata.category(ch) in _BANNED_CATEGORIES or ch in _BIDI_CONTROLS


def has_unsafe_chars(text: str) -> bool:
    """True if text contains control/line-separator/bidi-control characters."""
    return any(_unsafe(c) for c in text)


def sanitize_inline(text: Optional[str]) -> str:
    """Flatten user-controlled text for single-line prompt use.

    Every unsafe character becomes a space, so a crafted display name or
    description cannot forge extra participant/instruction lines.
    """
    return "".join(" " if _unsafe(c) else c for c in (text or "")).strip()


def lock_member_namespace(db, workspace_id) -> None:
    """Serialize concurrent namespace writers on the workspace row.

    Every check-then-write of agent_name/display_name must take this lock
    first, otherwise two concurrent writers can both pass the clash check and
    commit duplicate aliases. SELECT ... FOR UPDATE on PostgreSQL; a no-op on
    SQLite, whose single-writer model serializes anyway.
    """
    from app.models import Workspace
    db.execute(
        select(Workspace.id).where(Workspace.id == workspace_id).with_for_update()
    ).first()


def find_alias_clash(db, workspace_id, name: str, exclude_agent: Optional[str] = None) -> Optional[str]:
    """Return the agent_name of a member whose agent_name OR display_name
    equals `name` case-insensitively, or None. `exclude_agent` skips the
    member being edited / re-joining itself."""
    from app.models import WorkspaceMember
    query = select(WorkspaceMember.agent_name).where(
        WorkspaceMember.workspace_id == workspace_id,
        (func.lower(WorkspaceMember.agent_name) == name.lower())
        | (func.lower(WorkspaceMember.display_name) == name.lower()),
    )
    if exclude_agent is not None:
        query = query.where(WorkspaceMember.agent_name != exclude_agent)
    row = db.execute(query).first()
    return row[0] if row else None
