# -*- coding: utf-8 -*-
"""
Per-channel context projection — one policy, every read path.

In a multi-role thread every agent used to rebuild its context from the raw
channel stream, so a PM read code review verbatim and an engineer read product
debate verbatim. Roles blur and agents drift out of character.

A projection keeps the SAME turns but spends the bytes differently: turns the
agent has a stake in come back in full, everyone else's come back as a one-line
excerpt naming who spoke and roughly about what.

Reducing rather than dropping is the whole design. The agent still sees that a
turn happened and who took it, and can pull the full text back by id. Filtering
turns out instead would make omissions invisible and unrecoverable — a worse
failure than the pollution it fixes.

That guarantee only holds for a reader that CAN fetch the full text. For one
that cannot, an excerpt is not a reduction, it is silent deletion. So the
policy is gated on the reader's capability (`viewer_can_expand`), not just on
the channel setting — see `should_project`. This module is the single place
that decision is made; every read path (HTTP polling, cloud-agent context
assembly) routes through it so they cannot drift apart.
"""

import logging
from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Channel

logger = logging.getLogger(__name__)

DIGEST_MAX_CHARS = 120

# Only chat traffic is projectable. Everything else on these paths (todos, file
# and system events) is parsed structurally by clients — truncating one would
# corrupt it, not summarize it.
PROJECTABLE_TYPE_PREFIX = "workspace.message."


def digest_text(content: str) -> str:
    """First non-empty line of `content`, clipped to a single short line.

    Deliberately mechanical: this is an EXCERPT, not a summary. Nothing here
    understands the text, and callers must label it as an excerpt so a model
    does not read a clipped first line as the whole turn.
    """
    for line in (content or "").splitlines():
        stripped = line.strip()
        if stripped:
            if len(stripped) > DIGEST_MAX_CHARS:
                return stripped[:DIGEST_MAX_CHARS] + "…"
            return stripped
    return ""


def sees_in_full(event_source: str, metadata: dict, agent: str) -> bool:
    """Whether `agent` gets this event verbatim under a projection.

    Three ways in, deliberately a union:

    - It is the agent's own turn. Its own words are the one thing it must
      never lose — an agent that cannot see what it already said or promised
      is worse off than one reading noise. This is also why the `target_agents`
      delivery filter cannot be reused here: an agent never appears in its own
      messages' target list (the router rejects self-loops, and a final answer
      to a human routes to 'stop'), so that filter would hand every agent a
      history with itself erased.
    - It is from a human. Humans set requirements, and a requirement is still a
      requirement when it was addressed to somebody else. (The delivery filter
      scopes human messages to the untargeted ones — that would hide
      "@rd make it CSV" from the PM that owns the requirement.)
    - It was routed to the agent — the ordinary case.
    """
    if event_source == f"openagents:{agent}":
        return True
    if event_source.startswith("human:"):
        return True
    targets = (metadata or {}).get("target_agents") or []
    return isinstance(targets, list) and agent in targets


def project_event(serialized: dict, agent: str) -> dict:
    """Reduce one serialized event to an excerpt unless `agent` sees it in full.

    Attachments and message_type survive: a shared file is an artifact other
    roles are expected to pick up, not conversation to summarize away.
    """
    if not str(serialized.get("type") or "").startswith(PROJECTABLE_TYPE_PREFIX):
        return serialized
    if sees_in_full(serialized.get("source") or "", serialized.get("metadata") or {}, agent):
        return serialized

    payload = serialized.get("payload") or {}
    excerpt_payload = {
        "content": digest_text(payload.get("content") or ""),
        "message_type": payload.get("message_type") or "chat",
        "truncated": True,
    }
    if payload.get("attachments"):
        excerpt_payload["attachments"] = payload["attachments"]

    projected = dict(serialized)
    projected["payload"] = excerpt_payload
    projected["truncated"] = True
    return projected


def channel_context_mode(db: Session, workspace_id: str, channel_name: str) -> str:
    """Read a channel's context mode, defaulting to 'shared'.

    Anything unexpected — missing channel, unreadable column — resolves to
    'shared'. Context is failed OPEN on purpose: an over-broad context makes an
    agent verbose, a silently missing one makes it wrong, and only the second
    failure is invisible to whoever is watching the thread. (Permission checks
    in this codebase fail closed for the mirrored reason.)
    """
    try:
        mode = db.execute(
            select(Channel.context_mode).where(
                Channel.workspace_id == workspace_id,
                Channel.name == channel_name,
            )
        ).scalar()
    except Exception:
        logger.warning(
            "context_mode lookup failed for channel %s — serving the full stream",
            channel_name, exc_info=True,
        )
        return "shared"
    return (mode or "shared").strip().lower()


# Rate-limits the "reader cannot expand" warning. It fires on a hot path — a
# chatty cloud agent hits it on every single invocation — and a warning that
# repeats hundreds of times an hour stops being read at all. One line per
# (workspace, channel, reader) per interval keeps the signal without the flood.
_WARN_INTERVAL_SECONDS = 600.0
# Bounded so a long-lived process with many channels cannot grow this without
# limit. Overflowing simply forgets who was warned recently — the next warning
# comes a little early, which is the harmless direction.
_WARN_KEYS_MAX = 4096
_last_expand_warning: dict[tuple[str, str, str], float] = {}


def _warn_cannot_expand(
    workspace_id: str, channel_name: str, viewer: str, viewer_label: str,
) -> None:
    import time

    # Keyed by workspace too: channel and agent names are workspace-scoped and
    # the defaults collide constantly ("general", "cloud-agent"), so without it
    # one workspace's warning would suppress a genuinely different gap in
    # another.
    key = (workspace_id, channel_name, viewer)
    now = time.monotonic()
    last = _last_expand_warning.get(key)
    if last is not None and (now - last) < _WARN_INTERVAL_SECONDS:
        return
    if len(_last_expand_warning) >= _WARN_KEYS_MAX:
        _last_expand_warning.clear()
    _last_expand_warning[key] = now
    logger.warning(
        "channel %s is projected but %s cannot expand messages — serving "
        "the full stream to it. Context isolation does not apply to this "
        "reader until it can fetch a message by id. (Further occurrences "
        "for this reader are suppressed for %ds.)",
        channel_name, viewer_label or viewer, int(_WARN_INTERVAL_SECONDS),
    )


def should_project(
    db: Session,
    workspace_id: str,
    channel_name: Optional[str],
    viewer: Optional[str],
    *,
    viewer_can_expand: bool,
    viewer_label: str = "",
) -> bool:
    """Decide whether to project this read, for this reader.

    Every condition below fails open (serve the full stream) because a reader
    that gets too much is merely verbose, while one that silently got too
    little is wrong in a way nobody can see:

    - no viewer, or no channel to resolve a mode from → no projection rather
      than a guess about which thread's policy applies;
    - the channel is 'shared' → the default, nothing to do;
    - the reader cannot fetch a full message on demand → projecting would turn
      "reduced, expandable" into "deleted". Logged at WARNING, because in that
      case the thread is configured for isolation and is not getting it, and
      that gap should be visible to whoever turned the setting on.
    """
    if not viewer or not channel_name:
        return False
    if channel_context_mode(db, workspace_id, channel_name) != "projected":
        return False
    if not viewer_can_expand:
        _warn_cannot_expand(workspace_id, channel_name, viewer, viewer_label)
        return False
    return True


def project_events(serialized_events: list, viewer: str) -> list:
    """Apply the projection to a serialized event list."""
    return [project_event(e, viewer) for e in serialized_events]
