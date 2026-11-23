"""Wake-up stream for agent connectors (GET /v1/events/agent-stream).

Connectors normally poll ``GET /v1/events`` every 0.25–15 s for messages and
control commands, and almost every poll answers "nothing new". With this
stream a connector keeps one connection open and the server tells it *when*
to poll:

    event: wake
    data: {"kinds": ["message"]}

The stream carries no event content: no ids, text or thread names. The
connector reacts by running its normal poll, so every permission and
visibility rule stays in the poll path and the stream cannot leak anything.

Pieces:

* ``_record_event_writes`` / ``_publish_committed_wakes``: after a commit that
  wrote events, publish one small summary per workspace on Redis
  (``ws:<id>:agent-wake``). Every ORM event writer is covered, the same way
  ``poll_queries`` invalidates its poll caches.
* ``WakeHub``: one Redis pattern subscription per worker process, fanned out in
  memory to that worker's open streams, so open streams do not each hold a
  Redis connection.
* ``AGENT_STREAM_WORKSPACES``: rollout allowlist of workspace ids
  (comma-separated, or ``*`` for all). Unset means off: the endpoint answers
  404 and connectors keep polling. Self-hosters can set ``*``.

If Redis is unavailable or the subscription drops, every open stream gets a
wake for both kinds (so connectors catch up with a poll), and connectors fall
back to polling when the stream itself fails.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from typing import Optional

from sqlalchemy import event
from sqlalchemy.orm import Session

from app import cache
from app.models import EventRecord

logger = logging.getLogger(__name__)

MESSAGE_TYPE = "workspace.message.posted"
CONTROL_TYPE = "workspace.agent.control"
CHANNEL_PATTERN = "ws:*:agent-wake"
# Per commit, keep at most this many sources/targets; beyond it, wake everyone.
_SUMMARY_CAP = 50


def _parse_allowlist(raw: str) -> tuple[bool, frozenset]:
    items = {item.strip() for item in (raw or "").split(",") if item.strip()}
    return "*" in items, frozenset(items - {"*"})


_ALLOW_ALL, _ALLOWED = _parse_allowlist(os.environ.get("AGENT_STREAM_WORKSPACES", ""))


def configure_allowlist(raw: str) -> None:
    """Replace the allowlist (tests)."""
    global _ALLOW_ALL, _ALLOWED
    _ALLOW_ALL, _ALLOWED = _parse_allowlist(raw)


def stream_enabled(workspace_id) -> bool:
    return _ALLOW_ALL or str(workspace_id) in _ALLOWED


def wake_channel(workspace_id) -> str:
    return f"ws:{workspace_id}:agent-wake"


# ---------------------------------------------------------------------------
# Publishing: one summary per workspace per committed transaction
# ---------------------------------------------------------------------------

@event.listens_for(Session, "before_flush")
def _record_event_writes(session, flush_context, instances):
    if not (_ALLOW_ALL or _ALLOWED):
        return
    for row in session.new:
        if not isinstance(row, EventRecord) or not stream_enabled(row.network_id):
            continue
        if row.type == MESSAGE_TYPE:
            kind = "m"
            who = row.source
        elif row.type == CONTROL_TYPE:
            kind = "c"
            who = row.target
        else:
            continue
        pending = session.info.setdefault("agent_wakes", {})
        summary = pending.setdefault(str(row.network_id), {"m": [], "c": []})
        summary[kind].append(str(who or ""))


def _encode(summary: dict) -> bytes:
    out = {}
    for kind in ("m", "c"):
        items = summary.get(kind) or []
        if not items:
            continue
        if len(items) > _SUMMARY_CAP:
            out[kind] = None  # too many to list: wake every agent for this kind
        else:
            out[kind] = sorted(set(items))
    return json.dumps(out, separators=(",", ":")).encode()


@event.listens_for(Session, "after_commit")
def _publish_committed_wakes(session):
    if session.in_nested_transaction():
        return
    for workspace_id, summary in session.info.pop("agent_wakes", {}).items():
        cache.publish_event(wake_channel(workspace_id), _encode(summary))


@event.listens_for(Session, "after_rollback")
def _discard_rolled_back_wakes(session):
    if not session.in_nested_transaction():
        session.info.pop("agent_wakes", None)


def kinds_for(summary: Optional[dict], agent_address: str) -> set:
    """Which polls ``agent_address`` (``openagents:<name>``) should run.

    ``None`` means the hub lost its subscription: poll everything.
    Messages an agent posted itself do not wake it; control commands wake only
    the agent they target. Anything unexpected errs towards waking.
    """
    if summary is None:
        return {"message", "control"}
    kinds = set()
    if "m" in summary:
        sources = summary["m"]
        if sources is None or any(source != agent_address for source in sources):
            kinds.add("message")
    if "c" in summary:
        targets = summary["c"]
        if targets is None or agent_address in targets:
            kinds.add("control")
    return kinds


# ---------------------------------------------------------------------------
# Per-worker fan-out
# ---------------------------------------------------------------------------

class Subscription:
    """One open stream: accumulated wake kinds plus an event to wait on."""

    def __init__(self, workspace_id: str, agent_address: str):
        self.workspace_id = workspace_id
        self.agent_address = agent_address
        self.kinds: set = set()
        self._ready = asyncio.Event()

    def notify(self, summary: Optional[dict]) -> None:
        kinds = kinds_for(summary, self.agent_address)
        if kinds:
            self.kinds |= kinds
            self._ready.set()

    async def wait(self, timeout: float) -> set:
        """Kinds accumulated since the last call; empty on timeout."""
        try:
            await asyncio.wait_for(self._ready.wait(), timeout)
        except asyncio.TimeoutError:
            return set()
        self._ready.clear()
        kinds, self.kinds = self.kinds, set()
        return kinds


class WakeHub:
    def __init__(self):
        self._subs: dict[str, set[Subscription]] = {}
        self._task: Optional[asyncio.Task] = None

    def subscribe(self, workspace_id: str, agent_address: str) -> Subscription:
        sub = Subscription(str(workspace_id), agent_address)
        self._subs.setdefault(sub.workspace_id, set()).add(sub)
        if self._task is None or self._task.done():
            self._task = asyncio.get_running_loop().create_task(self._run())
        return sub

    def unsubscribe(self, sub: Subscription) -> None:
        subs = self._subs.get(sub.workspace_id)
        if subs is not None:
            subs.discard(sub)
            if not subs:
                self._subs.pop(sub.workspace_id, None)

    def stream_count(self) -> int:
        return sum(len(subs) for subs in self._subs.values())

    def _dispatch(self, channel: bytes, data: bytes) -> None:
        # channel = b"ws:<workspace id>:agent-wake"
        try:
            workspace_id = channel.decode().split(":", 2)[1]
        except Exception:
            return
        subs = self._subs.get(workspace_id)
        if not subs:
            return
        try:
            summary = json.loads(data)
            if not isinstance(summary, dict):
                summary = None
        except Exception:
            summary = None
        for sub in list(subs):
            sub.notify(summary)

    def _wake_all(self) -> None:
        for subs in list(self._subs.values()):
            for sub in list(subs):
                sub.notify(None)

    async def _run(self) -> None:
        delay = 1.0
        while self._subs:
            pubsub = None
            try:
                client = await cache._lazy_async_client()
                if client is None:
                    raise RuntimeError("redis unavailable")
                pubsub = client.pubsub()
                await pubsub.psubscribe(CHANNEL_PATTERN)
                # Wakes published while we were not subscribed are lost.
                self._wake_all()
                delay = 1.0
                while self._subs:
                    msg = await pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
                    if msg and msg.get("type") == "pmessage":
                        self._dispatch(msg["channel"], msg["data"])
            except asyncio.CancelledError:
                raise
            except Exception as e:
                logger.warning("agent-stream: wake subscription failed (%s); retrying in %.0fs", e, delay)
                self._wake_all()
                await asyncio.sleep(delay)
                delay = min(delay * 2, 30.0)
            finally:
                if pubsub is not None:
                    try:
                        await pubsub.punsubscribe(CHANNEL_PATTERN)
                        await pubsub.close()
                    except Exception:
                        pass


hub = WakeHub()
