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
* The workspace setting ``realtime_stream`` (Settings → General →
  Experimental) turns the same streams on for one workspace, in addition to
  the allowlist.

The web app's workspace-level stream (GET /v1/events/live) uses the same hub:
it receives the full event feed published on ``ws:<id>:events`` (filtered per
viewer in the endpoint) plus content-free panel topics on ``ws:<id>:ui-wake``
("todos", "knowledge", ...), published from a commit hook over the models
behind each panel.

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
AGENT_WAKE_SUFFIX = "agent-wake"
EVENTS_SUFFIX = "events"
UI_WAKE_SUFFIX = "ui-wake"
PATTERNS = ("ws:*:agent-wake", "ws:*:events", "ws:*:ui-wake")
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


_LIVE_OFF_VALUES = ("0", "false", "off", "no")
_live_override: Optional[bool] = None


def live_stream_enabled() -> bool:
    """The web app's workspace stream (GET /v1/events/live), for web and desktop
    clients. On by default wherever Redis is configured (it carries the event
    feed); operators can turn it off with LIVE_STREAM_ENABLED=false. Clients
    fall back to timed polling whenever it is off or a connection drops."""
    if _live_override is not None:
        return _live_override
    if os.environ.get("LIVE_STREAM_ENABLED", "").strip().lower() in _LIVE_OFF_VALUES:
        return False
    return not cache._disabled


def configure_live_stream(enabled: Optional[bool]) -> None:
    """Force the live stream on/off (tests); None restores the default."""
    global _live_override
    _live_override = enabled


def stream_enabled(workspace_id, settings: Optional[dict] = None) -> bool:
    """Agent wake-up stream: allowlisted (AGENT_STREAM_WORKSPACES, rolled out
    gradually), or the workspace's legacy ``realtime_stream`` setting."""
    if _ALLOW_ALL or str(workspace_id) in _ALLOWED:
        return True
    return bool((settings or {}).get("realtime_stream") is True)


_SETTINGS_TTL_SECONDS = 30.0
_settings_cache: dict[str, tuple[float, dict]] = {}


def workspace_stream_enabled(workspace_id) -> bool:
    """``stream_enabled`` with the workspace settings loaded (sync; run in a
    thread). Cached briefly per worker: a toggle reaches new connections
    within 30 s, open streams re-check when they reconnect (every 5-6 min)."""
    if _ALLOW_ALL or str(workspace_id) in _ALLOWED:
        return True
    import time as _time
    key = str(workspace_id)
    now = _time.monotonic()
    hit = _settings_cache.get(key)
    if hit and hit[0] > now:
        return stream_enabled(key, hit[1])
    from sqlalchemy import select
    from app.database import SessionLocal
    from app.models import Workspace
    db = SessionLocal()
    try:
        settings = db.execute(select(Workspace.settings).where(Workspace.id == key)).scalar_one_or_none() or {}
    finally:
        db.close()
    _settings_cache[key] = (now + _SETTINGS_TTL_SECONDS, dict(settings))
    return stream_enabled(key, settings)


def forget_workspace_settings(workspace_id) -> None:
    """Drop the cached toggle (called when this worker saves the setting)."""
    _settings_cache.pop(str(workspace_id), None)


def wake_channel(workspace_id) -> str:
    return f"ws:{workspace_id}:agent-wake"


def ui_wake_channel(workspace_id) -> str:
    return f"ws:{workspace_id}:ui-wake"


# ---------------------------------------------------------------------------
# Publishing: one summary per workspace per committed transaction
# ---------------------------------------------------------------------------

@event.listens_for(Session, "before_flush")
def _record_event_writes(session, flush_context, instances):
    # Published for every workspace (a few small messages per second in
    # total); whether anyone may listen is decided when a stream connects.
    for row in session.new:
        if not isinstance(row, EventRecord):
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


# ---------------------------------------------------------------------------
# Panel topics for the web app: which panels to refetch after a commit
# ---------------------------------------------------------------------------

def _ui_topic_map():
    from app import models as m
    # model -> (topic, workspace id attribute, attributes whose change matters
    #           on UPDATE, or None for any change)
    return {
        m.KnowledgeEntry: ("knowledge", "workspace_id", None),
        m.KnowledgeFolder: ("knowledge", "workspace_id", None),
        m.FileRecord: ("files", "workspace_id", None),
        m.BrowserTab: ("browser_tabs", "workspace_id", None),
        m.BrowserContext: ("browser_contexts", "workspace_id", None),
        m.TodoRecord: ("todos", "workspace_id", None),
        m.KanbanTask: ("tasks", "workspace_id", None),
        m.Workflow: ("workflows", "workspace_id", None),
        m.WorkflowRun: ("workflows", "workspace_id", None),
        m.RoutineRecord: ("routines", "workspace_id", None),
        m.NotificationRecord: ("notifications", "workspace_id", None),
        m.ApprovalRequest: ("approvals", "workspace_id", None),
        m.Channel: ("discover", "workspace_id", None),
        # Heartbeats rewrite these rows constantly; only membership and status
        # changes matter to the agent list.
        m.WorkspaceMember: ("discover", "workspace_id", ("status", "role", "agent_type")),
        m.Node: ("discover", "workspace_id", ("status",)),
    }


_UI_TOPICS = None


def _changed(row, attrs) -> bool:
    from sqlalchemy import inspect as sa_inspect
    state = sa_inspect(row)
    for attr in attrs:
        try:
            if state.attrs[attr].history.has_changes():
                return True
        except KeyError:
            continue
    return False


def _event_topics(row) -> tuple:
    etype = str(row.type or "")
    if etype.endswith(".heartbeat"):
        return ()
    topics = ("discover",)
    if row.visibility == "direct":
        topics += ("conversations",)
    return topics


@event.listens_for(Session, "before_flush")
def _record_panel_writes(session, flush_context, instances):
    global _UI_TOPICS
    try:
        if _UI_TOPICS is None:
            _UI_TOPICS = _ui_topic_map()
        pending = None
        for bucket, rows in (("new", session.new), ("dirty", session.dirty), ("deleted", session.deleted)):
            for row in rows:
                if isinstance(row, EventRecord):
                    if bucket != "new":
                        continue
                    topics, workspace_id = _event_topics(row), row.network_id
                else:
                    spec = _UI_TOPICS.get(type(row))
                    if spec is None:
                        continue
                    topic, ws_attr, watched = spec
                    if bucket == "dirty" and watched is not None and not _changed(row, watched):
                        continue
                    topics, workspace_id = (topic,), getattr(row, ws_attr, None)
                if not topics or not workspace_id:
                    continue
                if pending is None:
                    pending = session.info.setdefault("ui_wakes", {})
                pending.setdefault(str(workspace_id), set()).update(topics)
    except Exception as e:  # never break a write over a UI hint
        logger.debug("agent-stream: panel topic bookkeeping failed: %s", e)


@event.listens_for(Session, "after_commit")
def _publish_panel_wakes(session):
    if session.in_nested_transaction():
        return
    for workspace_id, topics in session.info.pop("ui_wakes", {}).items():
        cache.publish_event(ui_wake_channel(workspace_id), json.dumps(
            {"topics": sorted(topics)}, separators=(",", ":")).encode())


@event.listens_for(Session, "after_rollback")
def _discard_panel_wakes(session):
    if not session.in_nested_transaction():
        session.info.pop("ui_wakes", None)


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
    """An agent's stream: accumulated wake kinds plus an event to wait on."""

    def __init__(self, workspace_id: str, agent_address: str):
        self.workspace_id = workspace_id
        self.agent_address = agent_address
        self.kinds: set = set()
        self._ready = asyncio.Event()

    def deliver(self, suffix: str, data: Optional[bytes]) -> None:
        if suffix != AGENT_WAKE_SUFFIX:
            return
        summary = None
        if data is not None:
            try:
                summary = json.loads(data)
                if not isinstance(summary, dict):
                    summary = None
            except Exception:
                summary = None
        self.notify(summary)

    def resync(self) -> None:
        self.notify(None)

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


class LiveSubscription:
    """A browser tab's workspace stream: raw events (filtered later by the
    endpoint) plus panel topics. Bounded: if a tab falls far behind it gets one
    ``resync`` instead of an unbounded backlog, and catches up by polling."""

    MAX_EVENTS = 500

    def __init__(self, workspace_id: str):
        self.workspace_id = workspace_id
        self.events: list = []
        self.topics: set = set()
        self.needs_resync = False
        self._ready = asyncio.Event()

    def deliver(self, suffix: str, data: Optional[bytes]) -> None:
        if suffix == EVENTS_SUFFIX and data is not None:
            if len(self.events) >= self.MAX_EVENTS:
                self.events.clear()
                self.needs_resync = True
            else:
                self.events.append(data)
        elif suffix == UI_WAKE_SUFFIX and data is not None:
            try:
                topics = json.loads(data).get("topics") or []
                self.topics.update(str(t) for t in topics)
            except Exception:
                return
        else:
            return
        self._ready.set()

    def resync(self) -> None:
        self.events.clear()
        self.needs_resync = True
        self._ready.set()

    async def wait(self, timeout: float):
        """``(events, topics, resync)`` since the last call; empty on timeout."""
        try:
            await asyncio.wait_for(self._ready.wait(), timeout)
        except asyncio.TimeoutError:
            return [], set(), False
        self._ready.clear()
        events, self.events = self.events, []
        topics, self.topics = self.topics, set()
        resync, self.needs_resync = self.needs_resync, False
        return events, topics, resync


class WakeHub:
    """One Redis pattern subscription per worker process, fanned out in memory
    to that worker's open agent and browser streams."""

    def __init__(self):
        self._subs: dict[str, set] = {}
        self._task: Optional[asyncio.Task] = None

    def _add(self, sub):
        self._subs.setdefault(sub.workspace_id, set()).add(sub)
        if self._task is None or self._task.done():
            self._task = asyncio.get_running_loop().create_task(self._run())
        return sub

    def subscribe(self, workspace_id: str, agent_address: str) -> Subscription:
        return self._add(Subscription(str(workspace_id), agent_address))

    def subscribe_live(self, workspace_id: str) -> LiveSubscription:
        return self._add(LiveSubscription(str(workspace_id)))

    def unsubscribe(self, sub) -> None:
        subs = self._subs.get(sub.workspace_id)
        if subs is not None:
            subs.discard(sub)
            if not subs:
                self._subs.pop(sub.workspace_id, None)

    def stream_count(self) -> int:
        return sum(len(subs) for subs in self._subs.values())

    def _dispatch(self, channel: bytes, data: bytes) -> None:
        # channel = b"ws:<workspace id>:<suffix>"; only routing here, no
        # decoding unless this worker has a stream for the workspace.
        try:
            _, workspace_id, suffix = channel.decode().split(":", 2)
        except Exception:
            return
        subs = self._subs.get(workspace_id)
        if not subs:
            return
        for sub in list(subs):
            sub.deliver(suffix, data)

    def _wake_all(self) -> None:
        for subs in list(self._subs.values()):
            for sub in list(subs):
                sub.resync()

    async def _run(self) -> None:
        delay = 1.0
        while self._subs:
            pubsub = None
            try:
                client = await cache._lazy_async_client()
                if client is None:
                    raise RuntimeError("redis unavailable")
                pubsub = client.pubsub()
                await pubsub.psubscribe(*PATTERNS)
                # Anything published while we were not subscribed is lost.
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
                        await pubsub.punsubscribe(*PATTERNS)
                        await pubsub.close()
                    except Exception:
                        pass


hub = WakeHub()
