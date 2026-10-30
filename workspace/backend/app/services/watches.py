# -*- coding: utf-8 -*-
"""
Agent watches — bounded subscriptions that bring news from elsewhere back to
the thread where a human asked.

The problem this solves: the built-in assistant (Yumi) can hand work off to
another thread with ``post_to_thread``, but it is not a participant there and
is only ever invoked by messages that target it — so the outcome never comes
back unless the human asks "any update?". A watch closes that loop:

    1. Right after handing off, the assistant creates a watch (``thread`` or
       ``agent`` subject) with a note to itself ("Li Lei on Feishu asked for
       the report; relay the result") and an expiry.
    2. :func:`notify_watchers` runs as a background hook on every posted
       message (``routers/events.send_event`` and the cloud agent's reply
       path, same pattern as push fan-out / integration relay). When a
       matching agent message lands, it posts a ``system:watch`` wake-up into
       the watcher's ORIGIN thread, targeted at the watcher only, carrying an
       excerpt + the note — and invokes cloud agents so the assistant runs.
    3. The watcher (already a participant of its origin thread) answers there
       — for a bridged ``ext-…`` thread that answer is relayed to Slack/Feishu
       by ``services/integrations``.
    4. :func:`expire_due` (timer loop) closes watches at their expiry; a watch
       that never fired gets one final wake so the human can be told.

What fires a watch: a final ``chat`` (or ``error``) message from an agent
other than the watcher, posted outside the origin thread, in the watched
thread / by the watched agent. Status, thinking and todo events never do.
Wake-ups themselves carry ``metadata.watch`` and are never re-matched, and
the watcher's own messages are ignored, so watches cannot chain into loops
(the cloud-agent depth limit is a second guard).
"""

import asyncio
import logging
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import or_, select

from app import cache
from app.database import SessionLocal
from app.models import AgentWatch, Channel, KanbanTask, Workspace

logger = logging.getLogger(__name__)

WATCH_SOURCE = "system:watch"

SUBJECT_KINDS = ("thread", "agent")
DEFAULT_MINUTES = 120
MAX_MINUTES = 24 * 60
DEFAULT_MAX_FIRES = 10
MAX_MAX_FIRES = 50
MAX_ACTIVE_PER_WATCHER = 20
EXCERPT_CHARS = 700

_COMPLETED = frozenset({"completed", "complete", "succeeded", "success", "finished"})
_FAILED = frozenset({"failed", "error", "errored", "cancelled", "canceled"})

# Keep references to fire-and-forget invoke tasks so they aren't GC'd mid-run.
_background_tasks: set = set()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(dt: Optional[datetime]) -> Optional[datetime]:
    """SQLite hands back naive datetimes; compare everything as UTC-aware."""
    if dt is not None and dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def serialize(w: AgentWatch) -> dict:
    return {
        "id": w.id,
        "watcher": w.watcher_agent,
        "origin_channel": w.origin_channel,
        "subject_kind": w.subject_kind,
        "subject": w.subject,
        "note": w.note,
        "expires_at": _aware(w.expires_at).isoformat() if w.expires_at else None,
        "max_fires": w.max_fires,
        "fires": w.fires,
        "status": w.status,
        "last_fired_at": _aware(w.last_fired_at).isoformat() if w.last_fired_at else None,
        "created_at": _aware(w.created_at).isoformat() if w.created_at else None,
    }


# ---------------------------------------------------------------------------
# Matching
# ---------------------------------------------------------------------------

def _status_kind(event: dict) -> str:
    for container in (event.get("payload"), event.get("metadata")):
        if isinstance(container, dict) and container.get("status_kind"):
            return str(container["status_kind"]).strip().lower()
    return ""


def _is_candidate(event: dict) -> Optional[tuple[str, str, str]]:
    """Cheap pre-filter, no DB. Returns (channel_name, sender, content) for an
    agent's final message outside of any wake-up, else None."""
    if event.get("type") != "workspace.message.posted":
        return None
    payload = event.get("payload") or {}
    if (payload.get("message_type") or "chat") not in ("chat", "error"):
        return None
    metadata = event.get("metadata") or {}
    if metadata.get("watch"):
        return None  # a wake-up itself
    source = str(event.get("source") or "")
    if not source.startswith("openagents:"):
        return None
    target = str(event.get("target") or "")
    if not target.startswith("channel/"):
        return None
    content = str(payload.get("content") or "").strip()
    if not content:
        return None
    return target[len("channel/"):], source[len("openagents:"):], content


def _describe_kind(event: dict, channel_name: str, db, workspace_id: str) -> str:
    """Human-readable trigger kind: 'completed' / 'error' / 'reply', plus the
    Kanban column when the subject is a task thread."""
    payload = event.get("payload") or {}
    sk = _status_kind(event)
    if payload.get("message_type") == "error" or sk in _FAILED:
        kind = "error"
    elif sk in _COMPLETED:
        kind = "completed"
    else:
        kind = "reply"
    if channel_name.startswith("task:"):
        task = db.execute(
            select(KanbanTask).where(
                KanbanTask.workspace_id == workspace_id,
                KanbanTask.channel_name == channel_name,
            )
        ).scalar_one_or_none()
        if task is not None:
            kind += f"; task \"{task.title}\" is now in {task.status.replace('_', ' ')}"
    return kind


def _thread_title(db, workspace_id: str, channel_name: str) -> str:
    ch = db.execute(
        select(Channel).where(
            Channel.workspace_id == workspace_id,
            Channel.name == channel_name,
        )
    ).scalar_one_or_none()
    return (ch.title if ch is not None and ch.title else channel_name)


def _wake_text(sender: str, channel_name: str, title: str, kind: str,
               content: str, notes: list[str]) -> str:
    excerpt = content if len(content) <= EXCERPT_CHARS else content[:EXCERPT_CHARS] + " …"
    where = f"\"{title}\" (thread id: {channel_name})" if title != channel_name else f"thread {channel_name}"
    lines = [
        f"👀 Watch update — {sender} posted in {where} [{kind}]:",
        "",
        excerpt,
    ]
    if notes:
        lines += ["", "Your note when you set this watch: " + " | ".join(n for n in notes if n)]
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Wake-up delivery
# ---------------------------------------------------------------------------

async def _emit_wake(
    db, workspace, watcher: str, origin_channel: str, content: str,
    watch_meta: dict, depth: int, invoke_inline: bool,
) -> None:
    """Post the wake-up into the origin thread and make it reach the watcher.

    Mirrors what ``POST /v1/events`` does after the pipeline (commit, poll
    cache, Redis publish, cloud-agent invoke). ``invoke_inline`` awaits the
    cloud-agent run (background-thread callers); the timer loop passes False
    so a multi-second LLM call never blocks timer firing.
    """
    from app.pipeline_factory import pipeline
    from app.routers.events import _invalidate_poll_cache
    from app.services import cloud_agent
    from openagents.core.onm_events import Event
    from openagents.core.onm_mods import EventRejected, PipelineContext

    event = Event(
        type="workspace.message.posted",
        source=WATCH_SOURCE,
        target=f"channel/{origin_channel}",
        payload={"content": content, "message_type": "chat"},
        # Routing skips system sources, so this pre-set target list is what
        # delivers the wake-up to the watcher alone (same as timer fires).
        metadata={
            "target_agents": [watcher],
            "watch": watch_meta,
            "cloud_agent_depth": depth,
        },
        visibility="channel",
        network=str(workspace.id),
    )
    ctx = PipelineContext(
        network_id=str(workspace.id),
        agent_address=WATCH_SOURCE,
        db=db,
        workspace=workspace,
        token=workspace.password_hash,
    )
    try:
        await pipeline.process(event, ctx)
    except EventRejected as exc:
        logger.warning("watches: wake-up rejected: %s", exc.reason)
        db.rollback()
        return
    db.commit()

    snapshot = {
        "id": event.id,
        "type": event.type,
        "source": event.source,
        "target": event.target,
        "payload": event.payload,
        "metadata": event.metadata,
        "timestamp": event.timestamp,
    }
    try:
        _invalidate_poll_cache(str(workspace.id), event.type)
    except Exception:
        pass
    try:
        import json as _json
        cache.publish_event(
            f"ws:{workspace.id}:events",
            _json.dumps(snapshot, default=str, separators=(",", ":")).encode(),
        )
    except Exception:
        pass

    # Node agents poll and will see the targeted message; cloud agents (the
    # assistant) must be invoked explicitly, like the events route does.
    try:
        if invoke_inline:
            await cloud_agent.invoke_cloud_agents(str(workspace.id), snapshot)
        else:
            task = asyncio.get_running_loop().create_task(
                cloud_agent.invoke_cloud_agents(str(workspace.id), snapshot)
            )
            _background_tasks.add(task)
            task.add_done_callback(_background_tasks.discard)
    except Exception:
        logger.exception("watches: cloud agent invoke failed for %s", watcher)


# ---------------------------------------------------------------------------
# Hook: message posted → wake matching watchers
# ---------------------------------------------------------------------------

def notify_watchers(workspace_id: str, event: dict) -> None:
    """Background hook on every posted message. Cheap no-op for the vast
    majority of events; never raises."""
    cand = _is_candidate(event)
    if cand is None:
        return
    channel_name, sender, content = cand

    db = SessionLocal()
    try:
        now = _now()
        watches = db.execute(
            select(AgentWatch).where(
                AgentWatch.workspace_id == workspace_id,
                AgentWatch.status == "active",
                or_(
                    (AgentWatch.subject_kind == "thread") & (AgentWatch.subject == channel_name),
                    (AgentWatch.subject_kind == "agent") & (AgentWatch.subject == sender),
                ),
            )
        ).scalars().all()
        watches = [
            w for w in watches
            if w.watcher_agent != sender            # never wake an agent for its own words
            and w.origin_channel != channel_name    # the watcher already sees its own thread
            and _aware(w.expires_at) > now
        ]
        if not watches:
            return

        workspace = db.get(Workspace, workspace_id)
        if workspace is None or workspace.status == "deleted":
            return

        kind = _describe_kind(event, channel_name, db, workspace_id)
        title = _thread_title(db, workspace_id, channel_name)
        depth = int((event.get("metadata") or {}).get("cloud_agent_depth") or 0) + 1

        # One wake-up per (watcher, origin) even if several watches match the
        # same event (e.g. a thread watch AND an agent watch).
        groups: dict = {}
        for w in watches:
            groups.setdefault((w.watcher_agent, w.origin_channel), []).append(w)

        for (watcher, origin), group in groups.items():
            notes = [w.note for w in group if w.note]
            text = _wake_text(sender, channel_name, title, kind, content, notes)
            meta = {
                "ids": [w.id for w in group],
                "subject_thread": channel_name,
                "subject_agent": sender,
                "kind": kind,
                "source_event_id": event.get("id"),
            }
            for w in group:
                w.fires = (w.fires or 0) + 1
                w.last_fired_at = now
                if w.fires >= (w.max_fires or DEFAULT_MAX_FIRES):
                    w.status = "exhausted"
            db.flush()
            try:
                asyncio.run(_emit_wake(
                    db, workspace, watcher, origin, text, meta, depth, invoke_inline=True,
                ))
            except Exception:
                logger.exception("watches: wake-up failed for %s in %s", watcher, origin)
                db.rollback()
        db.commit()
    except Exception:
        logger.exception("watches: notify_watchers failed")
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Expiry (timer loop)
# ---------------------------------------------------------------------------

async def expire_due(db, now: Optional[datetime] = None, limit: int = 50) -> int:
    """Close watches past their expiry. A watch that never fired wakes its
    watcher one last time so the human can be told nothing came back.
    Runs inside the timer loop's session; commits per watch. Returns the
    number of watches expired."""
    now = now or _now()
    due = db.execute(
        select(AgentWatch).where(
            AgentWatch.status == "active",
            AgentWatch.expires_at <= now,
        ).limit(limit)
    ).scalars().all()
    count = 0
    for w in due:
        w.status = "expired"
        db.flush()
        count += 1
        if (w.fires or 0) > 0:
            db.commit()
            continue
        workspace = db.get(Workspace, w.workspace_id)
        if workspace is None or workspace.status == "deleted":
            db.commit()
            continue
        subject = f"thread {w.subject}" if w.subject_kind == "thread" else f"agent {w.subject}"
        text = (
            f"⌛ Watch expired — no reply, error or task change from {subject} "
            f"before the watch ran out."
        )
        if w.note:
            text += f"\n\nYour note when you set this watch: {w.note}"
        text += "\n\nUse read_thread to check on it, and set a new watch if the human still wants updates."
        meta = {
            "ids": [w.id],
            "subject_thread": w.subject if w.subject_kind == "thread" else None,
            "subject_agent": w.subject if w.subject_kind == "agent" else None,
            "kind": "expired",
        }
        try:
            await _emit_wake(
                db, workspace, w.watcher_agent, w.origin_channel, text, meta,
                depth=1, invoke_inline=False,
            )
        except Exception:
            logger.exception("watches: expiry wake-up failed for %s", w.id)
            db.rollback()
        db.commit()
    return count
