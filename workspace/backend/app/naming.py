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

from sqlalchemy import select

MAX_DISPLAY_NAME_LENGTH = 64
MAX_AGENT_NAME_LENGTH = 64

# Cc = control chars (covers \n, \r, \t, \x85, DEL and the \x1c-\x1e file
# separators), Zl/Zp = Unicode line/paragraph separators (U+2028, U+2029).
# Together these cover everything str.splitlines() treats as a line break, so
# a display name can never span lines in the router prompt. Cf (format chars)
# stays allowed so emoji ZWJ sequences keep working — except the bidi
# controls, which can visually reorder surrounding text.
_BANNED_CATEGORIES = {"Cc", "Zl", "Zp"}
# The full Unicode Bidi_Control set.
_BIDI_CONTROLS = frozenset(
    "\u061c"                            # ALM
    "\u200e\u200f"                      # LRM RLM
    "\u202a\u202b\u202c\u202d\u202e"  # LRE RLE PDF LRO RLO
    "\u2066\u2067\u2068\u2069"          # LRI RLI FSI PDI
)


def _unsafe(ch: str) -> bool:
    return unicodedata.category(ch) in _BANNED_CATEGORIES or ch in _BIDI_CONTROLS


def has_unsafe_chars(text: str) -> bool:
    """True if text contains control/line-separator/bidi-control characters."""
    return any(_unsafe(c) for c in text)


# Roles an agent may claim on join; anything else downgrades to "member".
ALLOWED_ROLES = frozenset({"master", "member", "observer"})


def agent_name_problem(name: str) -> Optional[str]:
    """Reason an agent name can't enter the shared namespace, or None if fine.

    agent_name is inserted verbatim into router prompts and participant
    lists, so it gets the same character policy as display names. Called from
    every post-auth entry point that can mint a member (join handler,
    workspace creation).
    """
    if not isinstance(name, str):
        # Raw /v1/events payloads are unvalidated JSON — a number or list
        # here must be a clean rejection, not an AttributeError 500.
        return "agent name must be a string"
    if not name or not name.strip():
        return "empty agent name"
    if name != name.strip():
        return "leading or trailing whitespace in agent name"
    if len(name) > MAX_AGENT_NAME_LENGTH:
        return f"agent name longer than {MAX_AGENT_NAME_LENGTH} characters"
    if has_unsafe_chars(name):
        return "agent name contains control or line-separator characters"
    return None


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


def fold_alias(text: str) -> str:
    """Canonical form for namespace comparison.

    NFKC collapses compatibility forms — fullwidth ｙｕｍｉ becomes yumi — and
    casefold() handles the case pairs lower() misses (ẞ → ss, İ). Plain SQL
    lower() does neither, which let visually identical aliases coexist. Both
    sides of every namespace comparison must go through this.
    """
    return unicodedata.normalize("NFKC", text).casefold()


def find_alias_clash(db, workspace_id, name: str, exclude_agent: Optional[str] = None) -> Optional[str]:
    """Return the agent_name of a member whose agent_name OR display_name
    equals `name` under fold_alias(), or None. `exclude_agent` skips the
    member being edited / re-joining itself.

    Comparison happens in Python rather than SQL: the databases' lower() has
    no NFKC/casefold, and every caller already holds lock_member_namespace()
    over a member list that is small by construction.
    """
    from app.models import WorkspaceMember
    target = fold_alias(name)
    rows = db.execute(
        select(WorkspaceMember.agent_name, WorkspaceMember.display_name).where(
            WorkspaceMember.workspace_id == workspace_id,
        )
    ).all()
    for agent_name, display_name in rows:
        if exclude_agent is not None and agent_name == exclude_agent:
            continue
        if fold_alias(agent_name) == target:
            return agent_name
        if display_name and fold_alias(display_name) == target:
            return agent_name
    return None
