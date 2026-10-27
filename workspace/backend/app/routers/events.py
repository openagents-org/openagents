# -*- coding: utf-8 -*-
"""
ONM Event endpoints — the core of the event-native API.

POST /v1/events    Send any event into the mod pipeline
GET  /v1/events    Poll events (filter by after, target, channel, type)
"""

import asyncio
import hashlib
import json as _json
import logging
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, Header, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import and_, case, cast, func, or_, select, Text
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app import cache
from app.database import SessionLocal, get_db
from app.models import Channel, ChannelMember, EventRecord, Node, Workspace
from app.pipeline_factory import pipeline
from app.response import ResponseCode, json_response, success_response
from app.routers.network import _verify_workspace_access, _workspace_filter
from app.services.unread_window import unread_cutoff_ms
from app.services.read_state import stream_allows as read_state_stream_allows
from app.services.poll_queries import event_type_filter, poll_generation, resume_cursor, stream_head
from openagents.core.onm_events import Event
from openagents.core.onm_mods import EventRejected, PipelineContext

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1", tags=["Events"])


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------

class SendEventRequest(BaseModel):
    type: str
    source: str
    target: str
    payload: Optional[dict] = None
    metadata: Optional[dict] = None
    visibility: Optional[str] = "channel"
    network: Optional[str] = None   # workspace ID or slug
    idempotency_key: Optional[UUID] = None


# ---------------------------------------------------------------------------
# Poll-cache invalidation
# ---------------------------------------------------------------------------

def _poll_filter_hash(
    workspace_id: str,
    target: str = "",
    channel: str = "",
    event_type: str = "",
    conversation: str = "",
    sort: str = "asc",
    limit=50,
    exclude_message_types: str = "",
    viewer_scope: str = "",
) -> str:
    """Canonical per-filter hash, shared by poll_events (head/at-head key
    construction) and _poll_cache_keys_for (invalidation) so the two can
    never drift apart.

    exclude_message_types joins the hash only when set — filters without it
    keep the legacy 7-field hash, which the enumerated invalidation patterns
    (adapter polls, which never pass the param) rely on.
    """
    parts = [
        workspace_id, target or "", channel or "",
        event_type or "", conversation or "",
        sort or "asc", str(limit),
    ]
    if exclude_message_types:
        parts.append(exclude_message_types)
    if viewer_scope:
        # Person-scoped results (DM privacy) — one person's cached page must
        # never be served to another. Appended only when set so the machine
        # hashes enumerated by _poll_cache_keys_for stay unchanged.
        parts.append("viewer=" + viewer_scope)
    return hashlib.sha1("|".join(parts).encode("utf-8")).hexdigest()


def _poll_cache_keys_for(workspace_id: str, event_type: str = ""):
    """Return the (head_tracker_key, at_head_key) pairs that should be
    invalidated when a new event is persisted in *workspace_id*.

    Agents poll with a small set of well-known filter combinations.
    Rather than a wildcard scan we enumerate the patterns the adapters
    actually use:

    1. ``type=workspace.message.posted, sort=asc, limit=500`` — the
       main message poll in ``workspace-client.js:pollPending``.
    2. ``type=workspace.agent.control, target=openagents:*, sort=asc,
       limit=50`` — the control-event poll.
    3. The same as (1) with ``sort=desc, limit=1`` — ``getHeadEventId``.

    We also include variants with common limits (50, 100, 500) and both
    sort orders so we don't miss any.
    """
    keys = []

    # Build the same filter_parts the poll endpoint uses:
    #   [workspace_id, target, channel, type, conversation, sort, limit]
    common_filters = []

    if event_type.startswith("workspace.message"):
        for sort in ("asc",):
            for limit in (500,):
                common_filters.append(
                    (workspace_id, "", "", "workspace.message.posted", "", sort, str(limit))
                )
        # getHeadEventId uses sort=desc, limit=1
        common_filters.append(
            (workspace_id, "", "", "workspace.message.posted", "", "desc", "1")
        )

    elif event_type.startswith("workspace.agent.control"):
        for limit in (50, 500):
            common_filters.append(
                (workspace_id, "", "", "workspace.agent.control", "", "asc", str(limit))
            )

    # Always invalidate the untyped "all events" poll pattern too
    for sort in ("asc", "desc"):
        for limit in (50, 500):
            common_filters.append(
                (workspace_id, "", "", "", "", sort, str(limit))
            )

    for ws, tgt, ch, typ, conv, sort, limit in common_filters:
        fh = _poll_filter_hash(ws, tgt, ch, typ, conv, sort, limit)
        keys.append(("v1events:head:" + fh, "v1events:athead:" + fh))

    return keys


def _invalidate_poll_cache(workspace_id: str, event_type: str = ""):
    """Delete head-tracker and at-head cache entries so polling agents
    see newly posted events immediately instead of receiving a stale
    cached-empty response."""
    for head_key, athead_key in _poll_cache_keys_for(workspace_id, event_type):
        try:
            cache.delete_key(head_key)
        except Exception:
            pass
        try:
            cache.delete_key(athead_key)
        except Exception:
            pass


def _resolve_and_auth_cached(db, network, token, authorization):
    """Resolve a workspace id and authorize the caller, serving the
    workspace-token path from Redis so the hot poll path never touches
    Postgres when the client is already at head.

    Returns ``(workspace_id, error_response, legacy_machine, workspace)``.
    legacy_machine is true only for a verified machine token without a bearer
    or agent identity. Device credentials are revalidated in the DB on each poll.
    Retain a freshly loaded workspace for principal resolution
    so device-token and human cache misses do not load it a second time.

    Only the workspace-token path (the one agents use, `token ==
    password_hash`) is cache-served. Bearer/collaborator auth, cache misses,
    and token mismatches fall through to the DB and repopulate the cache.
    We store a SHA-256 of the token (not the token itself) and a short TTL so
    a rotated/revoked token is honored within the window; freshness of *events*
    is unaffected because the head/at-head caches are still invalidated on every
    post.
    """
    from app.services.access_model import get_request_agent_name
    machine_only = not authorization and not get_request_agent_name()
    ck = "v1ws:resolve:" + hashlib.sha1(network.encode("utf-8")).hexdigest()
    cached = cache.get_bytes(ck)
    if cached is not None:
        try:
            meta = _json.loads(cached)
        except Exception:
            meta = None
        if meta and meta.get("id"):
            ph_sha = meta.get("ph_sha")
            if ph_sha is None:
                # Public workspace (no password) — token path grants access.
                return meta["id"], None, False, None
            if token and hashlib.sha256(token.encode("utf-8")).hexdigest() == ph_sha:
                return meta["id"], None, machine_only, None
            # token missing/mismatch → fall through for bearer/collaborator auth

    if machine_only and token:
        # Device credentials are checked live on every poll. Resolve their
        # workspace and validate the credential in one query instead of loading
        # a Workspace (plus collaborators) and looking up the device twice.
        # Identified agents and people still take full principal resolution.
        device_workspace_id = db.execute(
            select(Node.workspace_id)
            .join(Workspace, Workspace.id == Node.workspace_id)
            .where(Node.token == token, _workspace_filter(network), Workspace.status != "deleted")
        ).scalar_one_or_none()
        if device_workspace_id is not None:
            return str(device_workspace_id), None, True, None

    workspace = db.execute(
        select(Workspace).where(_workspace_filter(network))
    ).scalar_one_or_none()
    if not workspace:
        return None, json_response(ResponseCode.NOT_FOUND, "Network not found"), False, None
    if not _verify_workspace_access(workspace, token, authorization):
        return None, json_response(ResponseCode.UNAUTHORIZED, "Invalid workspace credentials"), False, None

    ph = workspace.password_hash
    meta = {
        "id": str(workspace.id),
        "ph_sha": hashlib.sha256(ph.encode("utf-8")).hexdigest() if ph else None,
    }
    try:
        cache.set_bytes(ck, _json.dumps(meta).encode("utf-8"), ttl_seconds=30.0)
    except Exception:
        pass
    return str(workspace.id), None, bool(machine_only and ph and token == ph), workspace


# ---------------------------------------------------------------------------
# POST /v1/events — send an event through the pipeline
# ---------------------------------------------------------------------------

def _extract_bearer(authorization: Optional[str]) -> Optional[str]:
    """Extract bearer token from Authorization header."""
    if authorization and authorization.lower().startswith("bearer "):
        return authorization[7:].strip()
    return None


def _is_person_address(col):
    """SQL: the address is a person identified by email (`human:<email>`)."""
    return and_(col.startswith("human:"), col.like("%@%"))


def _dm_addresses(viewer) -> Optional[list]:
    """Addresses that count as "me" for DM privacy, or None for no filter.

    A person: their `human:<email>` (an anonymous visitor: none, so they see
    only unattributed DMs). An identified agent: its own `openagents:<name>`
    plus its human owner's address — agents inherit what their owner can see.
    Machine callers without an identity keep full read (legacy).
    """
    kind = getattr(viewer, "kind", None)
    if kind == "human":
        return [f"human:{viewer.email}"] if viewer.email else []
    if kind == "agent" and getattr(viewer, "agent_name", None):
        out = [f"openagents:{viewer.agent_name}"]
        if getattr(viewer, "owner_email", None):
            out.append(f"human:{viewer.owner_email}")
        return out
    return None


def _dm_privacy_clause(viewer_email):
    """Rows a person may read, as far as direct messages are concerned.

    Non-direct events are untouched. A direct event is readable when the
    viewer is one of its two sides, or when neither side is a person with an
    email — agent↔agent DMs, and legacy `human:user` DMs which cannot be
    attributed to anyone (kept so existing history does not disappear).
    """
    # Accepts a person's email (legacy call shape) or a list of addresses
    # from _dm_addresses().
    if isinstance(viewer_email, (list, tuple)):
        mine = [a for a in viewer_email if a]
    else:
        mine = [f"human:{viewer_email}"] if viewer_email else []
    allowed = [
        EventRecord.visibility.is_(None),
        EventRecord.visibility != "direct",
        and_(~_is_person_address(EventRecord.source), ~_is_person_address(EventRecord.target)),
    ]
    if mine:
        allowed += [EventRecord.source.in_(mine), EventRecord.target.in_(mine)]
    return or_(*allowed)


def _dm_viewer_scope(viewer) -> Optional[str]:
    """The identity DM privacy filters on, or None when it does not apply.

    Applies to people (signed in, or an anonymous visitor of an open
    workspace — who may see only unattributed DMs) and to identified agents
    (their own DMs and their owner's). Machines without identity keep full read.
    """
    kind = getattr(viewer, "kind", None)
    if kind == "human":
        return viewer.email or "anonymous"
    if kind == "agent" and getattr(viewer, "agent_name", None):
        return "agent:" + viewer.agent_name
    return None


def _attribute_direct_sender(db, workspace, token, authorization, source, payload):
    """Return (source, payload) for a direct message, rewritten to the
    signed-in person's own address when the caller is a person."""
    from app.services.access_model import agent_name_from_source
    from app.services.visibility import resolve_viewer
    try:
        viewer = resolve_viewer(db, workspace, token, authorization,
                                agent_name=agent_name_from_source(source))
    except Exception as e:  # pragma: no cover - defensive
        logger.warning("events: could not resolve DM sender: %s", e)
        return source, payload
    if viewer.kind != "human" or not viewer.email:
        return source, payload
    payload = dict(payload or {})
    payload["sender_email"] = viewer.email
    payload["sender_id"] = viewer.email
    return f"human:{viewer.email}", payload


@router.get("/events/delivery-capabilities")
def delivery_capabilities():
    return success_response({"idempotent_messages": True})


@router.post("/events")
def send_event(
    body: SendEventRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db, scope="function"),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """
    Send an event into the network pipeline.

    The event flows through mod/auth → mod/workspace → mod/persistence
    before delivery to the target.

    Deliberately a `def` handler (threadpool): the pipeline's DB writes,
    pool-checkout waits, and the sync LLM routing call must never run on
    the event loop — see _emit_event_blocking in routers/network.py.
    """
    if not body.network:
        return json_response(ResponseCode.BAD_REQUEST, "Missing required field: network")

    if body.type == "workspace.thread.collaboration.updated":
        return json_response(ResponseCode.FORBIDDEN, "Use the thread collaboration settings endpoint")

    # Resolve workspace
    if body.type == "workspace.message.recalled":
        return json_response(ResponseCode.FORBIDDEN, "Use the message recall endpoint")

    workspace = db.execute(
        select(Workspace).where(_workspace_filter(body.network))
    ).scalar_one_or_none()

    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")

    # v1.1 visibility: a person may not post into a private thread they are
    # not a participant of (machines are exempt; the pipeline auth mod still
    # runs its own checks after this).
    if body.target and str(body.target).startswith("channel/"):
        from app.services.access_model import agent_name_from_source
        from app.services.visibility import can_view_channel_name, resolve_viewer
        _viewer = resolve_viewer(db, workspace, x_workspace_token, authorization,
                                 agent_name=agent_name_from_source(body.source))
        if _viewer.is_human and not can_view_channel_name(
            db, str(workspace.id), _viewer, str(body.target)[len("channel/"):]
        ):
            return json_response(ResponseCode.FORBIDDEN, "No access to this thread")

    # Direct messages are attributed to the real sender. The web client posts
    # people's DMs as `source="human:user"`, which made them unreachable for
    # the recipient (their conversation query looks for `human:<email>`) and
    # unattributable for privacy checks. A signed-in person is always stored
    # as themselves, whatever source the client sent; machine / agent callers
    # keep the source they declared (agents reply to `event.source`).
    source = body.source
    payload = body.payload
    if (body.visibility or "") == "direct" or body.type in ("network.channel.create", "workspace.message.posted"):
        source, payload = _attribute_direct_sender(db, workspace, x_workspace_token, authorization,
                                                   source, payload)
        if body.type == "network.channel.create":
            # The browser's generic human:user source is not an identity.
            # Always bind a new thread to the authenticated creator, even when
            # its selected human_participants list omits them. Never trust an
            # owner supplied by a signed-in client over that identity.
            from app.services.visibility import resolve_viewer
            creator = resolve_viewer(db, workspace, x_workspace_token, authorization)
            if creator.kind == "human" and creator.email:
                payload = dict(payload or {})
                payload["creator_email"] = creator.email
                payload["owner_email"] = creator.email
                from app.services.access_model import can_start_agent_thread
                from app.models import WorkspaceMember
                names = list(payload.get("participants") or [])
                if payload.get("master"):
                    names.append(payload["master"])
                for name in names:
                    member = db.get(WorkspaceMember, (str(workspace.id), name))
                    if not member or member.status == "removed" or not can_start_agent_thread(db, str(workspace.id), creator, member):
                        return json_response(ResponseCode.FORBIDDEN, "You do not have direct access to this agent")

    # Build ONM Event
    event = Event(
        type=body.type,
        source=source,
        target=body.target,
        payload=payload,
        metadata=body.metadata or {},
        visibility=body.visibility or "channel",
        network=str(workspace.id),
    )

    # Build pipeline context — extra kwargs become context.extra dict
    context = PipelineContext(
        network_id=str(workspace.id),
        agent_address=source,
        db=db,
        workspace=workspace,
        token=x_workspace_token,
        bearer_token=_extract_bearer(authorization),
    )

    if body.idempotency_key:
        if body.type != "workspace.message.posted":
            return json_response(ResponseCode.BAD_REQUEST, "Idempotency keys are supported only for messages")
        # A receipt lookup must not bypass auth or let a replaced session keep
        # posting. Normal first delivery still runs the complete pipeline below.
        from app.mods.auth import AuthMod
        if asyncio.run(AuthMod().process(event, context)) is None:
            return json_response(ResponseCode.UNAUTHORIZED, "Invalid workspace credentials")
        if source.startswith("openagents:"):
            from app.mods.workspace_mod import _validate_session
            if _validate_session(db, workspace.id, source[len("openagents:"):], event.metadata.get("session_id")):
                return json_response(ResponseCode.UNAUTHORIZED, "session_revoked: another client is now running as this agent")
        from app.services.message_delivery import prepare_delivery
        try:
            receipt = prepare_delivery(db, event, body.idempotency_key)
        except ValueError as exc:
            return json_response(ResponseCode.CONFLICT, str(exc))
        if receipt:
            return success_response({
                "id": receipt.id, "type": receipt.type, "source": receipt.source,
                "target": receipt.target, "payload": receipt.payload,
                "timestamp": receipt.timestamp, "metadata": receipt.metadata_,
            })

    # Run through pipeline (fresh loop in this worker thread — pipeline is
    # async-shaped but contains only sync I/O, nothing bound to the main loop)
    try:
        result = asyncio.run(pipeline.process(event, context))
    except EventRejected as exc:
        # Surface the reason so clients can roll back optimistic UI on
        # specific failures (e.g. routine_channel_locked,
        # channel_join_forbidden). 403 distinguishes "you can't do this"
        # from generic auth failures.
        reason = exc.reason or "rejected"
        code = ResponseCode.FORBIDDEN if "forbidden" in reason or "locked" in reason \
            else ResponseCode.UNAUTHORIZED
        return json_response(code, reason)

    # Session revocation: another client has since joined as this agent.
    # Return a clear error so the stale client can stop its adapter.
    if result.metadata.get("session_error") == "session_revoked":
        db.rollback()
        return json_response(
            ResponseCode.UNAUTHORIZED,
            "session_revoked: another client is now running as this agent",
        )

    db.commit()

    # Fan out push notifications for relevant events. Runs after the
    # response is sent (FastAPI BackgroundTasks); never blocks event
    # creation; failures are logged but never raised. The service opens
    # its own short-lived DB session because `db` here is request-scoped.
    from app.services.push import fanout_for_event
    event_snapshot = {
        "id": result.id,
        "type": result.type,
        "source": result.source,
        "target": result.target,
        "payload": result.payload,
        "metadata": result.metadata,
        "timestamp": result.timestamp,
        "visibility": getattr(getattr(result, "visibility", None), "value", None)
        or str(getattr(result, "visibility", None) or body.visibility or "channel"),
    }
    background_tasks.add_task(fanout_for_event, str(workspace.id), event_snapshot)

    # Slack-like person notifications: a DM to a person, or an @mention of a
    # person in a thread, files an inbox notification addressed to them (and
    # pushes to their devices). Best-effort — never breaks event creation.
    if result.type == "workspace.message.posted":
        try:
            from app.services.people_notify import notify_people_for_event
            notify_people_for_event(db, workspace, event_snapshot)
        except Exception as e:  # pragma: no cover - notify_people_for_event never raises
            logger.warning("events: people notifications failed: %s", e)

    # Invalidate poll cache head-trackers for this workspace so that
    # agents polling with `after=<head>` don't keep getting a stale
    # cached-empty response.  We delete every `v1events:head:*` and
    # `v1events:athead:*` key that could match ANY filter combination
    # for this workspace.  Because the filter hash includes
    # workspace.id as the first component, a wildcard scan would be
    # expensive — instead we invalidate the two most common poll
    # patterns that agents use (workspace-wide message poll and
    # per-agent control poll).
    try:
        _invalidate_poll_cache(str(workspace.id), result.type)
    except Exception:
        pass

    try:
        cache.publish_event(
            f"ws:{workspace.id}:events",
            _json.dumps(event_snapshot, default=str, separators=(",", ":")).encode(),
        )
    except Exception:
        pass

    # Invoke cloud agents if any are targeted by this message.
    if result.type == "workspace.message.posted":
        # Authoritative activation checkpoint (server-side PostHog, keyed by email).
        from app.services.analytics import track_message_posted
        background_tasks.add_task(track_message_posted, str(workspace.id), event_snapshot)
        from app.services.cloud_agent import invoke_cloud_agents
        background_tasks.add_task(invoke_cloud_agents, str(workspace.id), event_snapshot)
        # Drive any workflow run bound to this channel (advance to the next step).
        from app.services.workflow import advance_workflow
        background_tasks.add_task(advance_workflow, str(workspace.id), event_snapshot)
        # Relay chat messages in bridged channels out to Slack/Telegram.
        from app.services.integrations import relay_for_event
        background_tasks.add_task(relay_for_event, str(workspace.id), event_snapshot)
        # Wake agents watching this thread / this sender (bounded subscriptions).
        from app.services.watches import notify_watchers
        background_tasks.add_task(notify_watchers, str(workspace.id), event_snapshot)
        # Credits campaign: agent replies drive the conversation/daily
        # milestones (no-op unless enabled and the source is an agent).
        if result.source.startswith("openagents:"):
            from app.services import campaign as campaign_service
            background_tasks.add_task(campaign_service.on_agent_message, str(workspace.id), result.source)

    return success_response({
        "id": result.id,
        "type": result.type,
        "source": result.source,
        "target": result.target,
        "payload": result.payload,
        "timestamp": result.timestamp,
        "metadata": result.metadata,
    })


@router.post("/events/{event_id}/recall")
def recall_message(
    event_id: str, network: str, db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None), authorization: Optional[str] = Header(None),
):
    """Withdraw only the sender's unassigned human message; never cancel agent work."""
    import time
    from fastapi import HTTPException
    from app.models import ApprovalRequest
    from app.services.visibility import resolve_viewer, can_view_channel
    workspace = db.execute(select(Workspace).where(_workspace_filter(network))).scalar_one_or_none()
    if not workspace or not _verify_workspace_access(workspace, x_workspace_token, authorization):
        raise HTTPException(403, "No access to this workspace")
    viewer = resolve_viewer(db, workspace, x_workspace_token, authorization)
    if viewer.kind != "human" or not viewer.email:
        raise HTTPException(403, "Sign in as the message sender")
    original = db.execute(select(EventRecord).where(
        EventRecord.id == event_id, EventRecord.network_id == workspace.id,
        EventRecord.type == "workspace.message.posted",
    ).with_for_update()).scalar_one_or_none()
    if not original or original.source.lower() != f"human:{viewer.email.lower()}":
        raise HTTPException(403, "Only the sender can recall this message")
    if original.target.startswith("channel/"):
        channel = db.execute(select(Channel).where(Channel.workspace_id == workspace.id,
            Channel.name == original.target[8:])).scalar_one_or_none()
        if not channel or not can_view_channel(db, str(workspace.id), viewer, channel):
            raise HTTPException(403, "No access to this thread")
    metadata = dict(original.metadata_ or {})
    if metadata.get("recalled"):
        return success_response({"message_id": original.id, "recalled": True})
    choice = metadata.get("routing_choice") or {}
    if ((original.payload or {}).get("message_type", "chat") != "chat"
            or metadata.get("target_agents") != ["__no_response__"]
            or metadata.get("routing_assignment") or metadata.get("approval_id")
            or choice.get("status") == "assigned"):
        raise HTTPException(409, "Messages assigned to an agent cannot be recalled")
    approval = db.execute(select(ApprovalRequest.id).where(
        ApprovalRequest.workspace_id == workspace.id,
        ApprovalRequest.policy_requirements["trigger_event_id"].astext == original.id,
    ).limit(1)).first()
    agent_reply = db.execute(select(EventRecord.id).where(
        EventRecord.network_id == workspace.id, EventRecord.source.like("openagents:%"),
        EventRecord.metadata_["in_reply_to"].astext == original.id,
    ).limit(1)).first()
    if approval or agent_reply:
        raise HTTPException(409, "This message has already started agent work")
    metadata.update(recalled=True, recalled_at=int(time.time() * 1000))
    metadata.pop("reply_to", None)
    if choice:
        metadata["routing_choice"] = {**choice, "status": "dismissed"}
    original.metadata_ = metadata
    # Remove the withdrawn content and attachments from future history reads.
    original.payload = {key: value for key, value in (original.payload or {}).items()
                        if key not in ("content", "attachments", "reply_to")}
    original.payload["content"] = ""
    citations = db.execute(select(EventRecord).where(EventRecord.network_id == workspace.id,
        EventRecord.metadata_["reply_to"]["message_id"].astext == original.id)).scalars().all()
    for reply in citations:
        reply.metadata_ = {**reply.metadata_, "reply_to": {
            **reply.metadata_["reply_to"], "content": "", "recalled": True,
        }}
    # A fresh event lets incremental pollers update already-loaded messages.
    notice = Event(type="workspace.message.recalled", source=original.source,
        target=original.target, visibility=original.visibility or "channel",
        payload={"message_type": "recall", "recalled_message_id": original.id},
        metadata={"target_agents": ["__no_response__"]})
    db.add(EventRecord(id=notice.id, network_id=str(workspace.id), type=notice.type,
        source=notice.source, target=notice.target, visibility=original.visibility,
        payload=notice.payload, metadata_=notice.metadata, timestamp=notice.timestamp))
    db.commit()
    _invalidate_poll_cache(str(workspace.id), "workspace.message.posted")
    snapshot = {"id": notice.id, "type": notice.type, "source": notice.source,
        "target": notice.target, "payload": notice.payload, "metadata": notice.metadata,
        "timestamp": notice.timestamp}
    try:
        cache.publish_event(f"ws:{workspace.id}:events", _json.dumps(snapshot, default=str).encode())
    except Exception:
        pass
    return success_response({"message_id": original.id, "recalled": True})


class RoutingChoiceRequest(BaseModel):
    agent: Optional[str] = None  # null dismisses the pending request
    reclassify: bool = False  # Explicit sender action on a human-directed message.


@router.post("/events/{event_id}/routing")
def resolve_routing_choice(
    event_id: str,
    body: RoutingChoiceRequest,
    network: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db, scope="function"),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """Only the original sender can assign/dismiss their pending message.

    Lock the original event so double-clicks and retries cannot start two runs.
    The follow-up goes through the normal auth, sharing, and approval pipeline.
    """
    from copy import deepcopy
    from fastapi import HTTPException
    from app.models import WorkspaceMember
    from app.services.visibility import resolve_viewer, can_view_channel
    from app.services.thread_agent_requests import request_access
    from app.services.workflow import get_active_run
    workspace = db.execute(select(Workspace).where(_workspace_filter(network))).scalar_one_or_none()
    if not workspace or not _verify_workspace_access(workspace, x_workspace_token, authorization):
        raise HTTPException(403, "No access to this workspace")
    viewer = resolve_viewer(db, workspace, x_workspace_token, authorization)
    if viewer.kind != "human" or not viewer.email:
        raise HTTPException(403, "Sign in as the message sender")
    original = db.execute(select(EventRecord).where(
        EventRecord.id == event_id, EventRecord.network_id == workspace.id,
        EventRecord.type == "workspace.message.posted",
    ).with_for_update()).scalar_one_or_none()
    metadata = (original.metadata_ or {}) if original else {}
    choice = metadata.get("routing_choice")
    if body.reclassify:
        if not original or original.source.lower() != f"human:{viewer.email.lower()}":
            raise HTTPException(403, "Only the message sender can choose an agent")
        if (not original.target.startswith("channel/") or metadata.get("recalled")
                or metadata.get("routing_assignment") or metadata.get("approval_id") or metadata.get("approval")
                or (original.payload or {}).get("message_type", "chat") != "chat"):
            raise HTTPException(409, "This message cannot be reassigned")
        # Preserve idempotency when the sender retries the same assignment.
        already_assigned = isinstance(choice, dict) and choice.get("status") == "assigned"
        if not already_assigned and (metadata.get("target_agents") != ["__no_response__"] or not body.agent):
            raise HTTPException(409, "Only human-directed messages can be reassigned")
        if not already_assigned:
            choice = {"status": "pending", "requester_email": viewer.email.lower(), "candidates": [body.agent]}
    if not isinstance(choice, dict) or not original.target.startswith("channel/"):
        raise HTTPException(404, "Assignment request not found")
    if viewer.email.lower() != str(choice.get("requester_email", "")).lower():
        raise HTTPException(403, "Only the message sender can choose an agent")
    channel = db.execute(select(Channel).where(Channel.workspace_id == workspace.id,
        Channel.name == original.target[8:], Channel.status == "active")).scalar_one_or_none()
    if not channel or not can_view_channel(db, str(workspace.id), viewer, channel):
        raise HTTPException(403, "No access to this thread")
    if choice.get("status") != "pending":
        return success_response(choice)
    updated = dict(choice)
    if body.agent is None:
        updated["status"] = "dismissed"
        original.metadata_ = {**(original.metadata_ or {}), "routing_choice": updated}
        db.commit()
        _invalidate_poll_cache(str(workspace.id), original.type)
        return success_response(updated)
    member = db.get(WorkspaceMember, (str(workspace.id), body.agent))
    if (body.agent not in choice.get("candidates", []) or not member or member.status == "removed"
            or (body.reclassify and member.status != "online")
            or not db.get(ChannelMember, (channel.id, body.agent))
            or request_access(db, str(workspace.id), channel, member, viewer.email.lower()) == "no"):
        raise HTTPException(403, "This agent is no longer available to you in this thread")
    if get_active_run(db, str(workspace.id), channel.name):
        raise HTTPException(409, "A workflow is now running in this thread")
    payload = deepcopy(original.payload or {})
    if choice.get("continuation"):
        from app.services.completion_routing import latest_human, bounded
        from app.mods.workspace_mod import _agent_chat_stopped
        root = latest_human(db, workspace.id, original.target)
        if not root or root.id != choice.get('root_id') or _agent_chat_stopped(db, workspace, channel):
            raise HTTPException(409, "This request was stopped or superseded by a newer message")
        payload = {"content": "Continue this request: " + bounded((root.payload or {}).get('content'))
                   + "\nNext task: " + str(choice.get('task') or 'Determine and complete the remaining work.')
                   + "\nLatest agent result (context):\n" + bounded((original.payload or {}).get('content'))}
    payload.update({"sender_email": viewer.email.lower(), "sender_id": viewer.email.lower(),
                    "message_type": "chat"})
    event = Event(type="workspace.message.posted", source=f"human:{viewer.email.lower()}",
        target=original.target, visibility=original.visibility or "channel", payload=payload,
        metadata={"routing_assignment": {"message_id": original.id, "agent": body.agent, "thread_id": channel.id}})
    updated.update(status="assigned", agent=body.agent, assignment_event_id=event.id)
    original.metadata_ = {**(original.metadata_ or {}), "routing_choice": updated}
    context = PipelineContext(network_id=str(workspace.id), agent_address=event.source,
        db=db, workspace=workspace, token=x_workspace_token, bearer_token=_extract_bearer(authorization),
        routing_assignment_agent=body.agent)
    try:
        result = asyncio.run(pipeline.process(event, context))
        if result is None:
            raise HTTPException(403, "Could not assign this request")
        db.commit()
    except EventRejected as exc:
        db.rollback()
        raise HTTPException(403, exc.reason or "Could not assign this request") from exc
    except Exception:
        db.rollback()
        raise
    _invalidate_poll_cache(str(workspace.id), result.type)
    snapshot = {"id": result.id, "type": result.type, "source": result.source,
                "target": result.target, "payload": result.payload, "metadata": result.metadata,
                "timestamp": result.timestamp}
    try:
        cache.publish_event(
            f"ws:{workspace.id}:events",
            _json.dumps(snapshot, default=str, separators=(",", ":")).encode(),
        )
    except Exception:
        pass
    from app.services.cloud_agent import invoke_cloud_agents
    from app.services.push import fanout_for_event
    background_tasks.add_task(invoke_cloud_agents, str(workspace.id), snapshot)
    background_tasks.add_task(fanout_for_event, str(workspace.id), snapshot)
    return success_response(updated)


# ---------------------------------------------------------------------------
# GET /v1/events — poll events
# ---------------------------------------------------------------------------

@router.get("/events")
def poll_events(
    network: str = Query(..., description="Network (workspace) ID or slug"),
    after: Optional[str] = Query(None, description="Return events after this event ID"),
    before: Optional[str] = Query(None, description="Return events before this event ID"),
    target: Optional[str] = Query(None, description="Filter by target address"),
    channel: Optional[str] = Query(None, description="Filter by channel name"),
    type: Optional[str] = Query(None, description="Filter by event type prefix"),
    target_agents: Optional[str] = Query(None, description="Filter to events routed to this agent (metadata.target_agents contains it, plus untargeted events). Server-side counterpart of the adapter's client-side target filter."),
    conversation: Optional[str] = Query(None, description="Filter to DM conversation between two agents (comma-separated addresses)"),
    search: Optional[str] = Query(None, description="Search message content (case-insensitive)"),
    member: Optional[str] = Query(None, description="Filter to channels where this agent is a member"),
    exclude_message_types: Optional[str] = Query(None, description="Comma-separated payload.message_type values to exclude (e.g. 'thinking,status,todos'). Events without a message_type are always kept."),
    sort: Optional[str] = Query(None, description="Sort order: 'asc' (default) or 'desc'"),
    limit: int = Query(50, ge=1, le=500, description="Max events to return"),
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """
    Poll events from the network.

    Supports filtering by target, channel, type, and cursor-based pagination
    using the `after` parameter (event ID — events are sorted by timestamp).
    """
    # Resolve workspace + authorize. Served from Redis for the workspace-token
    # path so an at-head poll (the common idle case) never checks out a Postgres
    # connection — the DB `SELECT workspace` used to run on every poll, before
    # the cache, so even a cached-empty response cost a pooled connection.
    workspace_id, err, legacy_machine, resolved_workspace = _resolve_and_auth_cached(db, network, x_workspace_token, authorization)
    if err is not None:
        return err

    # v1.1 visibility: people do not read private threads they are not in.
    # Machines (token-only callers: agents, daemons) are exempt. Deny a
    # single-thread read up front; for cross-thread reads exclude the hidden
    # targets and bypass the identity-blind poll cache.
    from app.services.visibility import hidden_channel_targets, resolve_viewer
    from app.services.access_model import Principal
    viewer = (Principal("machine", workspace_id=workspace_id) if legacy_machine else
              resolve_viewer(db, resolved_workspace if resolved_workspace is not None else str(workspace_id),
                             x_workspace_token, authorization))
    hidden_targets = hidden_channel_targets(db, workspace_id, viewer) if viewer.is_human else set()
    if hidden_targets:
        if channel and f"channel/{channel}" in hidden_targets:
            return json_response(ResponseCode.FORBIDDEN, "No access to this thread")
        if target and target in hidden_targets:
            return json_response(ResponseCode.FORBIDDEN, "No access to this thread")

    # DM privacy: a person reads only the direct messages they are a side of
    # (plus unattributable agent↔agent / legacy ones). The scope joins every
    # cache key below so pages are never shared between people.
    dm_scope = _dm_viewer_scope(viewer)

    # Two-level read-through cache for poll traffic.
    #
    # Level 1: FULL key (includes `after`/`before` cursor). Dedupes identical
    # polls from the same agent within the TTL window. Correct for any
    # parameters.
    #
    # Level 2: HEAD-CURSOR tracking. When a non-empty poll returns events,
    # we remember the newest event id for these filters. When a subsequent
    # poll comes in with `after = cached_head_id` (i.e. the client is
    # already caught up to the most recent event we've seen), its "give me
    # anything newer" query is equivalent to a no-cursor "give me the empty
    # set". Many agents sharing the head cursor all hash to the same
    # Level-2 key and share a single DB hit.
    #
    # This is a strict correctness guarantee: we only route to Level 2 when
    # the caller's cursor is EQUAL to the tracked head. Agents that are
    # behind (historical backfill) fall through to Level 1 / DB.
    #
    # Both cached answers carry the workspace's event-write generation, which
    # changes on every committed event write. The enumerated invalidation in
    # _invalidate_poll_cache only covers workspace-wide filters, so without
    # the generation a `channel=`/`target=`/`conversation=` poll could be
    # served a page cached just before a new event landed in its thread.
    cache_key = None
    athead_cache_key = None
    head_tracker_key = None
    incoming_after = after or ""
    # `target_agents` is a per-agent filter — every agent sends a distinct
    # value, which would explode the head-tracker key space (invalidation
    # enumerates a fixed set of filter combos, not agent names). Skip the
    # cache for these polls, same as `member`; the filtered query is cheap.
    if not search and not member and not target_agents and not hidden_targets:
        key_parts = [
            workspace_id, target or "", channel or "",
            type or "", conversation or "",
            after or "", before or "",
            sort or "asc", str(limit),
        ]
        if exclude_message_types:
            key_parts.append(exclude_message_types)
        if dm_scope:
            key_parts.append("viewer=" + dm_scope)
        generation = poll_generation(workspace_id)
        key_parts.append("gen=" + generation)
        cache_key = "v1events:full:" + hashlib.sha1(
            "|".join(key_parts).encode("utf-8")
        ).hexdigest()

        # Per-filter head cursor marker (what the newest event id was for
        # this filter the last time we saw any events). Cursor-free.
        filter_hash = _poll_filter_hash(
            workspace_id, target or "", channel or "",
            type or "", conversation or "",
            sort or "asc", limit, exclude_message_types or "",
            dm_scope or "",
        )
        head_tracker_key = "v1events:head:" + filter_hash
        athead_cache_key = "v1events:athead:" + filter_hash + ":" + generation

        import json as _json

        # Level 1: exact-match cache
        cached = cache.get_bytes(cache_key)
        if cached is not None:
            try:
                return _json.loads(cached)
            except Exception:
                pass

        # Level 2: if client is at head (after == last-known head), route
        # to a shared cached-empty response. Only fires when we already know
        # the head AND client's cursor matches it — so agents behind head
        # cannot receive this cached empty by mistake.
        if before is None:
            head_id = cache.get_bytes(head_tracker_key)
            if head_id is not None:
                head_id_str = head_id.decode("utf-8") if isinstance(head_id, bytes) else str(head_id)
                if head_id_str and head_id_str == incoming_after:
                    cached_empty = cache.get_bytes(athead_cache_key)
                    if cached_empty is not None:
                        try:
                            return _json.loads(cached_empty)
                        except Exception:
                            pass

    def load_response():
        query = select(EventRecord).where(EventRecord.network_id == workspace_id)
        if hidden_targets:
            query = query.where(EventRecord.target.notin_(list(hidden_targets)))
        if dm_scope:
            query = query.where(_dm_privacy_clause(_dm_addresses(viewer)))

        # Filter events to only channels where the agent is a member
        if member:
            member_channel_names = db.execute(
                select(Channel.name).where(
                    Channel.workspace_id == workspace_id,
                    Channel.id.in_(
                        select(ChannelMember.channel_id).where(ChannelMember.agent_name == member)
                    ),
                )
            ).scalars().all()
            channel_targets = [f"channel/{name}" for name in member_channel_names]
            if channel_targets:
                query = query.where(EventRecord.target.in_(channel_targets))
            else:
                # Agent is not a member of any channel — return empty
                return success_response({"events": [], "has_more": False})

        if conversation:
            parts = [p.strip() for p in conversation.split(",", 1)]
            if len(parts) != 2 or not parts[0] or not parts[1]:
                return json_response(ResponseCode.BAD_REQUEST, "conversation must be two comma-separated addresses")
            a, b = parts
            query = query.where(
                EventRecord.visibility == "direct",
                ~EventRecord.target.startswith("channel/"),
                or_(
                    and_(EventRecord.source == a, EventRecord.target == b),
                    and_(EventRecord.source == b, EventRecord.target == a),
                ),
            )

        after_position = None
        if after:
            cursor_row = db.execute(
                select(EventRecord.timestamp, EventRecord.id).where(EventRecord.id == after)
            ).one_or_none()
            if cursor_row is not None:
                after_position = {"id": cursor_row.id, "timestamp": cursor_row.timestamp}
                # Use (timestamp, id) tuple to avoid skipping/duplicating events with the same timestamp
                query = query.where(
                    or_(
                        EventRecord.timestamp > cursor_row.timestamp,
                        and_(EventRecord.timestamp == cursor_row.timestamp, EventRecord.id > cursor_row.id),
                    )
                )

        if before:
            cursor_row = db.execute(
                select(EventRecord.timestamp, EventRecord.id).where(EventRecord.id == before)
            ).one_or_none()
            if cursor_row is not None:
                query = query.where(
                    or_(
                        EventRecord.timestamp < cursor_row.timestamp,
                        and_(EventRecord.timestamp == cursor_row.timestamp, EventRecord.id < cursor_row.id),
                    )
                )

        if target:
            query = query.where(EventRecord.target == target)

        if channel:
            query = query.where(EventRecord.target == f"channel/{channel}")

        if type:
            query = query.where(event_type_filter(type))

        if exclude_message_types:
            excluded = [t.strip() for t in exclude_message_types.split(",") if t.strip()]
            if excluded:
                # payload->>'message_type' — NULL (missing key / non-message event)
                # must be kept, so the NOT IN check alone is not enough.
                message_type = EventRecord.payload["message_type"].as_string()
                query = query.where(
                    or_(message_type.is_(None), message_type.notin_(excluded))
                )

        if target_agents:
            # Return only events routed to this agent — mirrors the adapter's
            # client-side `target_agents` filter so agents stop pulling the whole
            # network's traffic and discarding ~(N-1)/N of it.
            #
            # The set matches exactly what the adapter keeps (verified against live
            # traffic — this filter == the client filter for every agent):
            #   • events whose metadata.target_agents contains this agent, PLUS
            #   • *untargeted human* messages (no target_agents key) — the adapter
            #     broadcasts those.
            # Untargeted *agent/system* messages are the bulk of a busy workspace's
            # traffic (agent-to-agent chatter) and the adapter always discards them
            # when they carry no target list, so returning them was the difference
            # between "filter is correct" and "filter actually reduces load". They
            # are excluded here. Events targeted at *other* agents and the
            # `["__no_response__"]` sentinel are excluded too.
            if db.bind.dialect.name == "postgresql":
                # `@>` array containment (GIN-friendly); `? 'target_agents'` detects
                # the untargeted case, scoped to human senders.
                query = query.where(
                    or_(
                        EventRecord.metadata_.contains({"target_agents": [target_agents]}),
                        and_(
                            EventRecord.source.startswith("human:"),
                            ~EventRecord.metadata_.has_key("target_agents"),
                        ),
                    )
                )
            else:
                # SQLite (tests): no JSONB operators — fall back to a text match.
                # Over-inclusive on the containment side but safe; the adapter
                # re-filters client-side.
                meta_text = cast(EventRecord.metadata_, Text)
                query = query.where(
                    or_(
                        meta_text.like(f'%"{target_agents}"%'),
                        and_(
                            EventRecord.source.startswith("human:"),
                            meta_text.notlike('%target_agents%'),
                        ),
                    )
                )

        if search:
            # Search within payload JSON for content field (works with both JSONB and JSON)
            query = query.where(
                cast(EventRecord.payload, Text).ilike(f"%{search}%")
            )

        # Head-cursor snapshot for target_agents polls. When we filter to one
        # agent's events, the last *returned* event can lag far behind the stream
        # tip (most traffic is for other agents), so a naive "cursor = last event"
        # would make the agent re-scan the same range every poll — reintroducing
        # the O(traffic) scan we're trying to remove. Capture the tip of the
        # *unfiltered* (network+type[+channel/target]) stream BEFORE running the
        # main query so the client can skip past other agents' events once it has
        # drained its own. Snapshotting first guarantees we never advance past an
        # event the main query didn't get to see (at worst a harmless re-scan).
        head_snapshot = stream_head(db, workspace_id, type, channel, target) if target_agents else None

        if sort == "desc":
            query = query.order_by(EventRecord.timestamp.desc(), EventRecord.id.desc()).limit(limit + 1)
        else:
            query = query.order_by(EventRecord.timestamp.asc(), EventRecord.id.asc()).limit(limit + 1)
        rows = db.execute(query).scalars().all()

        has_more = len(rows) > limit
        events = rows[:limit]

        composing = False
        if not search and not conversation:
            from app.composing import has_any_composing
            composing = has_any_composing(workspace_id)

        response_data = {
            "events": [
                {
                    "id": e.id,
                    "type": e.type,
                    "source": e.source,
                    "target": e.target,
                    "payload": e.payload,
                    "metadata": e.metadata_,
                    "timestamp": e.timestamp,
                    "visibility": e.visibility,
                }
                for e in events
            ],
            "has_more": has_more,
            "oldest_id": (events[-1].id if sort == "desc" else events[0].id) if events else None,
            "newest_id": (events[0].id if sort == "desc" else events[-1].id) if events else None,
        }
        if target_agents:
            # Cursor the agent should resume from. If more of *its own* events
            # remain (has_more), continue from the last one returned; otherwise
            # jump to the stream tip so it skips past other agents' traffic
            # instead of re-scanning it next poll. Additive field — older clients
            # ignore it and fall back to newest_id.
            next_cursor = response_data["newest_id"]
            if not has_more:
                newest = (events[0] if sort == "desc" else events[-1]) if events else None
                next_cursor = resume_cursor(head_snapshot,
                    {"id": newest.id, "timestamp": newest.timestamp} if newest else None,
                    after_position)
            response_data["next_cursor"] = next_cursor
        if composing:
            response_data["composing"] = True

        response = success_response(response_data)

        # Populate cache for subsequent polls within the TTL window.
        # success_response returns a dict; Redis stores the serialized JSON.
        if cache_key is not None and isinstance(response, dict):
            try:
                import json as _json
                serialized = _json.dumps(
                    response, default=str, separators=(",", ":")
                ).encode("utf-8")
                # The outer singleflight helper stores the exact response.
                # Level 2 maintenance — track the head cursor for these
                # filters, and cache the "empty" response when the client was
                # already at head.
                if head_tracker_key is not None:
                    newest_id = response.get("data", {}).get("newest_id")
                    if events and newest_id:
                        # Update head tracker — newest_id is the tip we just saw.
                        # Longer TTL because head updates are cheap and we want
                        # subsequent at-head checks to find it.
                        cache.set_bytes(
                            head_tracker_key,
                            str(newest_id).encode("utf-8"),
                            ttl_seconds=30.0,
                        )
                    elif not events and incoming_after:
                        # DB returned empty AND the client had a cursor. This
                        # confirms "after = head" for this filter. Populate
                        # both the head tracker (so other clients can match)
                        # and the shared at-head empty response.
                        cache.set_bytes(
                            head_tracker_key,
                            incoming_after.encode("utf-8"),
                            ttl_seconds=30.0,
                        )
                        cache.set_bytes(
                            athead_cache_key,
                            serialized,
                            ttl_seconds=1.5,
                        )
            except Exception:
                pass

        return response

    return cache.json_singleflight(cache_key, 1.5, load_response, cache_if=lambda value: isinstance(value, dict))


# ---------------------------------------------------------------------------
# GET /v1/events/conversations — discover agent-to-agent DM conversations
# ---------------------------------------------------------------------------

@router.get("/events/conversations")
def list_conversations(
    network: str = Query(..., description="Network (workspace) ID or slug"),
    agent: Optional[str] = Query(None, description="Filter to conversations involving this agent"),
    limit: int = Query(20, ge=1, le=100),
    read_at: Optional[str] = Query(None, max_length=32768, description="JSON map of DM session IDs to last-read timestamps"),
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """
    List active agent-to-agent DM conversations.

    Returns distinct conversation pairs with their latest message,
    ordered by most recent activity.
    """
    workspace = db.execute(
        select(Workspace).where(_workspace_filter(network))
    ).scalar_one_or_none()

    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")

    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid workspace credentials")

    try:
        read_markers = _json.loads(read_at) if read_at else {}
        if not isinstance(read_markers, dict) or any(
            not isinstance(key, str) or not key.startswith("dm:")
            or type(value) is not int or value < 0 or value > 9007199254740991
            for key, value in read_markers.items()
        ):
            raise ValueError()
    except (ValueError, TypeError):
        return json_response(ResponseCode.BAD_REQUEST, "Invalid DM read markers")

    unread_cutoff = unread_cutoff_ms()
    # Build a subquery to find the latest event per conversation pair.
    # Normalize pairs so (A→B) and (B→A) are the same conversation.
    # Use case() instead of func.least/greatest for SQLite compatibility.
    lesser = case(
        (EventRecord.source <= EventRecord.target, EventRecord.source),
        else_=EventRecord.target,
    )
    greater = case(
        (EventRecord.source > EventRecord.target, EventRecord.source),
        else_=EventRecord.target,
    )

    # Direct routing is also used for agent control traffic. Only posted
    # messages form conversations; the internal system actor is never a DM peer.
    conversation_events = (
        EventRecord.network_id == workspace.id,
        EventRecord.visibility == "direct",
        EventRecord.type == "workspace.message.posted",
        func.lower(EventRecord.source) != "human:system",
        func.lower(EventRecord.target) != "human:system",
        ~EventRecord.target.startswith("channel/"),
    )
    base = (
        select(
            lesser.label("agent_a"),
            greater.label("agent_b"),
            func.max(EventRecord.timestamp).label("last_ts"),
            func.count().label("msg_count"),
        )
        .where(*conversation_events)
    )

    if agent:
        base = base.where(
            or_(EventRecord.source == agent, EventRecord.target == agent)
        )

    # DM privacy: a person lists only the pairs they are part of, plus
    # agent↔agent / legacy unattributed pairs. Machines see every pair.
    from app.services.visibility import resolve_viewer
    viewer = resolve_viewer(db, workspace, x_workspace_token, authorization)
    if _dm_viewer_scope(viewer):
        base = base.where(_dm_privacy_clause(_dm_addresses(viewer)))

    base = base.group_by("agent_a", "agent_b").order_by(func.max(EventRecord.timestamp).desc()).limit(limit)

    pairs = db.execute(base).all()

    from app.models import DirectThreadLink, DirectThreadPreference
    # Stored per-person markers (shared across devices) merge with the ones
    # older clients still send from local storage; the newer one wins.
    from app.services.read_state import merged_for_viewer
    read_markers = merged_for_viewer(db, workspace.id, viewer, read_markers, keep=lambda key: key.startswith('dm:'))

    preferences = {}
    if viewer.is_human and viewer.email:
        preferences = {key: pref for key, pref in db.execute(
            select(DirectThreadLink.session_key, DirectThreadPreference).join(
                DirectThreadPreference, DirectThreadPreference.thread_id == DirectThreadLink.id
            ).where(DirectThreadLink.workspace_id == workspace.id, DirectThreadPreference.user_email == viewer.email)
        ).all()}
    # For each pair, fetch the actual latest event
    conversations = []
    for row in pairs:
        latest_event = db.execute(
            select(EventRecord)
            .where(
                *conversation_events,
                EventRecord.timestamp == row.last_ts,
                or_(
                    and_(EventRecord.source == row.agent_a, EventRecord.target == row.agent_b),
                    and_(EventRecord.source == row.agent_b, EventRecord.target == row.agent_a),
                ),
            )
            .limit(1)
        ).scalar_one_or_none()

        if latest_event:
            payload = latest_event.payload or {}
            session_id = f"dm:{row.agent_a},{row.agent_b}"
            last_read = read_markers.get(session_id)
            own_addresses = (_dm_addresses(viewer) or []) + ["human:user"]
            unread_count = None
            if last_read is not None:
                unread_count = db.scalar(select(func.count()).select_from(EventRecord).where(
                    EventRecord.network_id == workspace.id,
                    EventRecord.visibility == "direct",
                    EventRecord.type == "workspace.message.posted",
                    or_(
                        EventRecord.payload["message_type"].as_string().is_(None),
                        EventRecord.payload["message_type"].as_string().notin_(["thinking", "status", "todos"]),
                    ),
                    EventRecord.timestamp > last_read,
                    EventRecord.timestamp >= unread_cutoff,
                    EventRecord.target.in_(own_addresses),
                    ~EventRecord.source.in_(own_addresses),
                    or_(
                        and_(EventRecord.source == row.agent_a, EventRecord.target == row.agent_b),
                        and_(EventRecord.source == row.agent_b, EventRecord.target == row.agent_a),
                    ),
                )) or 0
            conversations.append({
                "agents": [row.agent_a, row.agent_b],
                "pinned": bool(preferences.get(session_id) and preferences[session_id].pinned),
                "starred": bool(preferences.get(session_id) and preferences[session_id].starred),
                "last_message": {
                    "content": payload.get("content", ""),
                    "sender": latest_event.source,
                    "timestamp": latest_event.timestamp,
                },
                "message_count": row.msg_count,
                "unread_count": unread_count,
                "read_at": last_read,
            })

    return success_response({"conversations": conversations})


# ---------------------------------------------------------------------------
# GET /v1/events/latest-per-channel — bulk thread preview endpoint
# ---------------------------------------------------------------------------

@router.get("/events/latest-per-channel")
def latest_per_channel(
    network: str = Query(..., description="Network (workspace) ID or slug"),
    type: Optional[str] = Query("workspace.message", description="Event type prefix to filter"),
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """
    Return the most recent event per channel in a single query.

    Replaces N separate pollEvents calls for thread list previews.
    Uses indexed per-target lookups on PostgreSQL, with a SQLite fallback.
    """
    workspace = db.execute(
        select(Workspace).where(_workspace_filter(network))
    ).scalar_one_or_none()

    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")

    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid workspace credentials")

    # Visibility: a person gets no preview of a private thread they cannot
    # see, nor of a DM they are not a side of (same rules as GET /v1/events).
    # Machines / identified agents keep every channel. No response cache here.
    from app.services.visibility import hidden_channel_targets, resolve_viewer
    from app.services.channel_previews import latest_channel_query
    visibility_filters = []
    viewer = resolve_viewer(db, workspace, x_workspace_token, authorization)
    if getattr(viewer, "kind", None) == "human":
        hidden_targets = hidden_channel_targets(db, str(workspace.id), viewer)
        if hidden_targets:
            visibility_filters.append(EventRecord.target.notin_(list(hidden_targets)))
        visibility_filters.append(_dm_privacy_clause(viewer.email))

    query = latest_channel_query(workspace.id, type, visibility_filters,
                                 postgres=db.get_bind().dialect.name == 'postgresql')
    rows = db.execute(query).all()

    channels = {}
    for row in rows:
        channel_name = row.target.replace("channel/", "", 1)
        channels[channel_name] = {
            "id": row.id,
            "type": row.type,
            "source": row.source,
            "target": row.target,
            "payload": row.payload,
            "metadata": row.metadata,
            "timestamp": row.timestamp,
            "visibility": row.visibility,
        }

    return success_response({"channels": channels})


# ---------------------------------------------------------------------------
# Per-event visibility (shared by the stream; mirrors the SQL filters above)
# ---------------------------------------------------------------------------

def _is_person_addr(address) -> bool:
    return isinstance(address, str) and address.startswith("human:") and "@" in address


def _event_visible_to(event: dict, viewer_email: Optional[str], hidden_channels) -> bool:
    """Python twin of `hidden_channel_targets` + `_dm_privacy_clause`.

    Events published without a `visibility` field (some producers omit it)
    are treated as direct when they do not target a channel — the safe side.
    """
    target = str(event.get("target") or "")
    if target.startswith("channel/"):
        return target[len("channel/"):] not in hidden_channels
    if str(event.get("type") or "").startswith("network.channel."):
        # Thread lifecycle events (create / update / …) name the thread in
        # the payload; a private thread's creation must not leak either.
        payload = event.get("payload") if isinstance(event.get("payload"), dict) else {}
        name = payload.get("name") or payload.get("channel") or payload.get("channel_name")
        if isinstance(name, str) and name.startswith("channel/"):
            name = name[len("channel/"):]
        if name and name in hidden_channels:
            return False
    vis = event.get("visibility")
    if vis not in (None, "", "direct"):
        return True
    source = str(event.get("source") or "")
    me = f"human:{viewer_email}" if viewer_email else None
    if me and me in (source, target):
        return True
    return not (_is_person_addr(source) or _is_person_addr(target))


def _load_hidden_channel_names(workspace_id: str, viewer) -> set:
    db = SessionLocal()
    try:
        from app.services.visibility import hidden_channel_names
        return set(hidden_channel_names(db, workspace_id, viewer))
    finally:
        db.close()


class _StreamVisibility:
    """A person's stream filter: hidden thread names are loaded at connect
    and refreshed every REFRESH_SECONDS or when a `network.channel.*` event
    passes (thread created / access changed), so the per-event check needs
    no database round trip."""

    REFRESH_SECONDS = 30.0

    def __init__(self, workspace_id: str, viewer, hidden):
        self.workspace_id = workspace_id
        self.viewer = viewer
        self.email = viewer.email
        self.hidden = set(hidden)
        self._loaded_at = asyncio.get_event_loop().time()

    async def maybe_refresh(self, event: dict) -> None:
        now = asyncio.get_event_loop().time()
        etype = str(event.get("type") or "")
        if not (etype.startswith("network.channel.") or now - self._loaded_at >= self.REFRESH_SECONDS):
            return
        try:
            self.hidden = await asyncio.to_thread(_load_hidden_channel_names, self.workspace_id, self.viewer)
        except Exception as e:  # keep the previous set; never kill the stream
            logger.warning("stream: hidden-thread refresh failed: %s", e)
        self._loaded_at = now

    def allows(self, event: dict) -> bool:
        return _event_visible_to(event, self.email, self.hidden)


# ---------------------------------------------------------------------------
# GET /v1/events/stream — Server-Sent Events
# ---------------------------------------------------------------------------

def _authorize_event_stream(network, effective_token, authorization, channel=None):
    """Keep pool checkout, auth queries, and cleanup off the event loop."""
    db = SessionLocal()
    try:
        workspace = db.execute(
            select(Workspace).where(_workspace_filter(network))
        ).scalar_one_or_none()
        if not workspace:
            return None, json_response(ResponseCode.NOT_FOUND, "Network not found")
        if not _verify_workspace_access(workspace, effective_token, authorization):
            return None, json_response(ResponseCode.UNAUTHORIZED, "Invalid credentials")
        workspace_id = str(workspace.id)
        from app.services.visibility import hidden_channel_names, resolve_viewer
        viewer = resolve_viewer(db, workspace, effective_token, authorization)
        dm_scope = _dm_viewer_scope(viewer) if getattr(viewer, "kind", None) == "human" else None
        hidden = set(hidden_channel_names(db, workspace_id, viewer)) if dm_scope else set()
        if dm_scope and channel and channel in hidden:
            return None, json_response(ResponseCode.FORBIDDEN, "No access to this thread")
        return (workspace_id, viewer, dm_scope, hidden), None
    finally:
        db.close()


@router.get("/events/stream")
async def stream_events(
    request: Request,
    network: str = Query(...),
    channel: Optional[str] = Query(None),
    token: Optional[str] = Query(None),
    access_token: Optional[str] = Query(None, description="Bearer token for browsers (EventSource cannot set headers); identifies the signed-in person"),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """Stream new events via Server-Sent Events (SSE).

    Uses Redis pub/sub under the hood. Falls back gracefully — if Redis
    is unavailable the connection closes and the client should fall back
    to polling.

    Visibility matches polling: the viewer is resolved once at connect (a
    bearer — header or `access_token` — wins over the workspace token). For a
    person, private threads they cannot see and DMs they are not a side of are
    never streamed. Machines / identified agents receive everything.
    """
    effective_token = x_workspace_token or token
    if not authorization and access_token:
        authorization = f"Bearer {access_token}"

    scope, error = await run_in_threadpool(
        _authorize_event_stream, network, effective_token, authorization, channel,
    )
    if error is not None:
        return error
    workspace_id, viewer, dm_scope, hidden = scope
    target_prefix = f"channel/{channel}" if channel else None
    stream_filter = _StreamVisibility(workspace_id, viewer, hidden) if dm_scope else None

    async def event_generator():
        keepalive_interval = 30
        last_keepalive = asyncio.get_event_loop().time()

        # subscribe_events yields raw event bytes, plus None on idle ticks
        # (~1/s). The idle tick is what lets us emit keepalives and notice a
        # disconnected client during long quiet periods — previously both were
        # gated behind an actual event arriving, so a silent stream sent zero
        # bytes and proxies dropped the connection, leaving clients stuck on
        # "thinking…".
        async for data in cache.subscribe_events(f"ws:{workspace_id}:events"):
            if await request.is_disconnected():
                break

            if data is not None:
                try:
                    event = _json.loads(data)
                    if stream_filter is not None:
                        await stream_filter.maybe_refresh(event)
                    if not read_state_stream_allows(event, viewer):
                        pass
                    elif stream_filter is not None and not stream_filter.allows(event):
                        pass
                    elif not (target_prefix and event.get("target", "") != target_prefix):
                        event_id = event.get("id", "")
                        yield f"id: {event_id}\ndata: {data.decode()}\n\n"
                        last_keepalive = asyncio.get_event_loop().time()
                except Exception:
                    pass

            now = asyncio.get_event_loop().time()
            if now - last_keepalive >= keepalive_interval:
                yield ": keepalive\n\n"
                last_keepalive = now

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
