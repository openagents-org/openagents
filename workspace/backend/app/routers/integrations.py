# -*- coding: utf-8 -*-
"""Gateway-facing endpoints for the Slack / Lark / Telegram bridge.

The general event API lets a caller name its own ``type``, ``source`` and
``target``. That is fine for a workspace token, which is owner-equivalent
anyway, but it is the wrong shape to hand an internet-facing gateway. These
endpoints take structured facts instead — which conversation, who spoke, which
uploads — and compose the event themselves from the binding the credential
resolves to.

    POST /v1/integrations/files          upload one attachment, get an id back
    POST /v1/integrations/ingest         the only place a bridged message is created
    GET  /v1/integrations/events         outbound messages, cursor-paged
    GET  /v1/integrations/events/stream  wake-up signal for the above

Ingest is the sole message-creating path on purpose. An earlier design had the
file endpoint post its own chat message, which turned one Slack message with
two screenshots into three OA messages and three agent replies.
"""

import asyncio
import json as _json
import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, Query, Request, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import Text, and_, cast, or_, select
from sqlalchemy.orm import Session

from app import cache
from app.config import config
from app.database import get_db
from app.integrations.conversations import ScopeError, resolve_conversation
from app.integrations.principal import IntegrationPrincipal, require_gateway_key
from app.models import (
    Channel,
    EventRecord,
    FileRecord,
    IntegrationConversation,
    IntegrationFileUpload,
    IntegrationInbound,
    Workspace,
)
from app.mods.workspace_mod import _auto_title_channel
from app.pipeline_factory import integration_pipeline
from app.response import ResponseCode, json_response, success_response
from app.services.event_dispatch import post_commit_dispatch
from app.storage import get_file_store
from openagents.core.onm_events import Event
from openagents.core.onm_mods import PipelineContext

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/integrations", tags=["Integrations"])

# How long an uploaded attachment may sit unattached before the orphan sweep
# reclaims it. Generous: ingest normally follows within seconds, and the only
# cost of waiting is storage on a file the user did send us.
UPLOAD_TTL = timedelta(hours=6)


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------

class ConversationRef(BaseModel):
    """Where a message came from, in the platform's own identifiers.

    Structured rather than a pre-composed key so the mapping's namespace stays
    ours — see app/integrations/conversations.py.
    """
    kind: str = Field(..., description="dm | channel | thread")
    tenant_id: str = Field(..., description="Slack team / Lark tenant / Telegram bot scope")
    conversation_id: str = Field(..., description="channel or chat id; the peer id for a DM")
    thread_id: Optional[str] = Field(None, description="Slack thread_ts, Telegram root message id")
    title: Optional[str] = None


class SenderRef(BaseModel):
    """Who spoke, on the platform side.

    The id is what identifies them; the display name is only ever shown. Names
    collide and change, so they must not end up load-bearing.
    """
    external_user_id: str
    display_name: Optional[str] = None


class IngestRequest(BaseModel):
    conversation: ConversationRef
    sender: SenderRef
    content: str = ""
    # Ids handed out by POST /files. Not descriptors: the gateway does not get
    # to describe an attachment, only to name one it already uploaded under
    # this same platform event.
    file_ids: List[str] = Field(default_factory=list)
    idempotency_key: str = Field(..., description="the platform's own event id")
    platform_event_id: Optional[str] = Field(
        None, description="defaults to idempotency_key; scopes which uploads may be attached",
    )


# ---------------------------------------------------------------------------
# POST /v1/integrations/files
# ---------------------------------------------------------------------------

@router.post("/files")
async def upload_integration_file(
    file: UploadFile = File(...),
    platform_event_id: str = Form(...),
    platform_file_id: str = Form(...),
    principal: IntegrationPrincipal = Depends(require_gateway_key),
    db: Session = Depends(get_db),
):
    """Store one attachment and return its id. Posts no message.

    Idempotent on ``(binding, platform_event_id, platform_file_id)``. Without
    that key a retry after a lost response would mint a second ``uuid4()`` and
    store the bytes twice — the generic upload endpoint does exactly that,
    which is why the bridge does not use it.
    """
    existing = db.execute(
        select(IntegrationFileUpload).where(
            IntegrationFileUpload.binding_id == principal.binding_id,
            IntegrationFileUpload.platform_event_id == platform_event_id,
            IntegrationFileUpload.platform_file_id == platform_file_id,
        )
    ).scalar_one_or_none()
    if existing is not None:
        record = db.execute(
            select(FileRecord).where(FileRecord.id == existing.file_id)
        ).scalar_one_or_none()
        return success_response({
            "file_id": existing.file_id,
            "filename": record.filename if record else None,
            "size": record.size if record else None,
            "reused": True,
        })

    data = await file.read()
    if len(data) > config.MAX_FILE_SIZE:
        return json_response(
            ResponseCode.BAD_REQUEST,
            f"File too large. Maximum size: {config.MAX_FILE_SIZE // (1024 * 1024)}MB",
        )

    filename = file.filename or platform_file_id
    content_type = file.content_type or "application/octet-stream"
    file_id = str(uuid.uuid4())

    store = get_file_store()
    loop = asyncio.get_event_loop()
    try:
        storage_key = await loop.run_in_executor(
            None, store.save, principal.workspace_id, file_id, filename, data,
        )
    except ValueError as exc:
        return json_response(ResponseCode.BAD_REQUEST, str(exc))

    db.add(FileRecord(
        id=file_id,
        workspace_id=principal.workspace_id,
        filename=filename,
        content_type=content_type,
        size=len(data),
        storage_key=storage_key,
        uploaded_by=f"integration:{principal.platform}",
        # No channel yet — ingest decides which conversation this belongs to,
        # and it may not even get that far.
        channel_name=None,
    ))
    db.add(IntegrationFileUpload(
        binding_id=principal.binding_id,
        platform_event_id=platform_event_id,
        platform_file_id=platform_file_id,
        file_id=file_id,
        expires_at=datetime.now(timezone.utc) + UPLOAD_TTL,
    ))
    db.commit()

    return success_response({
        "file_id": file_id,
        "filename": filename,
        "size": len(data),
        "reused": False,
    })


# ---------------------------------------------------------------------------
# POST /v1/integrations/ingest
# ---------------------------------------------------------------------------

@router.post("/ingest")
def ingest_message(
    body: IngestRequest,
    background_tasks: BackgroundTasks,
    principal: IntegrationPrincipal = Depends(require_gateway_key),
    db: Session = Depends(get_db),
):
    """Land one platform message as exactly one OA message.

    A ``def`` handler on purpose: the pipeline's writes are synchronous and
    belong on the threadpool, not the event loop — same reasoning as
    ``POST /v1/events``.
    """
    platform_event_id = body.platform_event_id or body.idempotency_key

    # Replay of a delivery we already accepted. Slack retries on its own
    # schedule, so this is routine rather than exceptional.
    prior = db.execute(
        select(IntegrationInbound).where(
            IntegrationInbound.binding_id == principal.binding_id,
            IntegrationInbound.idempotency_key == body.idempotency_key,
        )
    ).scalar_one_or_none()
    if prior is not None:
        return success_response({
            "event_id": prior.event_id,
            "channel_name": prior.channel_name,
            "duplicate": True,
        })

    workspace = db.execute(
        select(Workspace).where(Workspace.id == principal.workspace_id)
    ).scalar_one_or_none()
    if workspace is None:
        return json_response(ResponseCode.NOT_FOUND, "Workspace not found")

    try:
        mapping, _created = resolve_conversation(
            db, principal,
            kind=body.conversation.kind,
            tenant_id=body.conversation.tenant_id,
            conversation_id=body.conversation.conversation_id,
            thread_id=body.conversation.thread_id,
            title=body.conversation.title,
        )
    except ScopeError as exc:
        return json_response(ResponseCode.FORBIDDEN, str(exc))
    except ValueError as exc:
        return json_response(ResponseCode.BAD_REQUEST, str(exc))

    # Attachments. Every id has to be one this binding uploaded under this same
    # platform event and has not already spent — otherwise a gateway could
    # attach another conversation's file, or re-attach one to a second message.
    attachments, upload_rows, bad = _claim_uploads(
        db, principal, platform_event_id, body.file_ids,
    )
    if bad:
        return json_response(
            ResponseCode.BAD_REQUEST,
            f"unknown or already-attached file ids: {', '.join(bad)}",
        )

    payload = {
        "content": body.content,
        "message_type": "chat",
        "sender_name": body.sender.display_name or body.sender.external_user_id,
    }
    if attachments:
        payload["attachments"] = attachments

    event = Event(
        type="workspace.message.posted",
        # A stable, collision-free identity. The display name goes in the
        # payload where the UI reads it; putting it here would break the
        # moment two people share a name or one of them renames.
        source=(
            f"human:{principal.platform}:"
            f"{body.conversation.tenant_id}:{body.sender.external_user_id}"
        ),
        target=f"channel/{mapping.channel_name}",
        payload=payload,
        metadata={
            # Routing is decided here, not by the message body.
            "target_agents": [principal.agent_name],
            # The loop guard. Outbound skips anything already carrying this
            # binding's stamp, so a message we mirrored in never mirrors back
            # out. Structural — never a text comparison.
            "integration_origin": {
                "binding_id": principal.binding_id,
                "platform": principal.platform,
                "external_event_id": platform_event_id,
            },
        },
        visibility="channel",
        network=principal.workspace_id,
    )

    context = PipelineContext(
        network_id=principal.workspace_id,
        agent_address=event.source,
        db=db,
        workspace=workspace,
    )
    result = asyncio.run(integration_pipeline.process(event, context))

    # Auto-titling is the one thing WorkspaceMod would have done for us that is
    # worth keeping, and it is a plain function.
    channel = db.execute(
        select(Channel).where(Channel.id == mapping.channel_id)
    ).scalar_one_or_none()
    if channel is not None and body.content:
        try:
            _auto_title_channel(channel, body.content, db)
        except Exception:  # titling must never fail a delivery
            logger.warning("integration: auto-title failed for %s", mapping.channel_name)

    for row in upload_rows:
        row.attached_event_id = result.id
    for att in attachments:
        rec = db.execute(
            select(FileRecord).where(FileRecord.id == att["file_id"])
        ).scalar_one_or_none()
        if rec is not None:
            rec.channel_name = mapping.channel_name

    db.add(IntegrationInbound(
        binding_id=principal.binding_id,
        idempotency_key=body.idempotency_key,
        event_id=result.id,
        channel_name=mapping.channel_name,
    ))
    db.commit()

    # Shared with POST /v1/events. Skipping it would leave the message sitting
    # in the table with nobody told: no SSE for the workspace UI, no cloud agent
    # woken, stale poll caches.
    post_commit_dispatch(
        background_tasks,
        principal.workspace_id,
        {
            "id": result.id,
            "type": result.type,
            "source": result.source,
            "target": result.target,
            "payload": result.payload,
            "metadata": result.metadata,
            "timestamp": result.timestamp,
        },
        # An integration channel mirrors an external thread; a Workflow
        # template has no business driving it.
        workflow=False,
    )

    return success_response({
        "event_id": result.id,
        "channel_name": mapping.channel_name,
        "duplicate": False,
    })


def _claim_uploads(db, principal, platform_event_id, file_ids):
    """Validate file ids and return (attachments, rows, rejected_ids)."""
    attachments, rows, bad = [], [], []
    for fid in file_ids:
        row = db.execute(
            select(IntegrationFileUpload).where(
                IntegrationFileUpload.binding_id == principal.binding_id,
                IntegrationFileUpload.platform_event_id == platform_event_id,
                IntegrationFileUpload.file_id == fid,
                IntegrationFileUpload.attached_event_id.is_(None),
            )
        ).scalar_one_or_none()
        if row is None:
            bad.append(fid)
            continue
        record = db.execute(
            select(FileRecord).where(FileRecord.id == fid)
        ).scalar_one_or_none()
        if record is None:
            bad.append(fid)
            continue
        rows.append(row)
        # Rebuilt from our own record, not echoed back from the request.
        attachments.append({
            "file_id": record.id,
            "filename": record.filename,
            "content_type": record.content_type,
            "size": record.size,
        })
    return attachments, rows, bad


# ---------------------------------------------------------------------------
# GET /v1/integrations/events
# ---------------------------------------------------------------------------

def _outbound_query(db: Session, principal: IntegrationPrincipal):
    """Messages this binding should mirror out to the platform.

    Three filters, and the third is the interesting one:

    * only this binding's channels;
    * only settled chat — ``status``/``thinking``/``todos`` are an agent
      thinking out loud and were never meant to leave the workspace;
    * anything *not* stamped with this binding's ``integration_origin``.

    That last clause is deliberately broader than "the bound agent's replies".
    A workspace member can speak in the thread, and can pull a second agent in;
    both belong on the platform side. What must never go out is a message we
    ourselves mirrored in, which the stamp identifies exactly.
    """
    names = list(db.execute(
        select(IntegrationConversation.channel_name).where(
            IntegrationConversation.binding_id == principal.binding_id,
        )
    ).scalars().all())
    if not names:
        return None, []

    targets = [f"channel/{n}" for n in names]
    q = select(EventRecord).where(
        EventRecord.network_id == principal.workspace_id,
        EventRecord.type == "workspace.message.posted",
        EventRecord.target.in_(targets),
    )

    is_postgres = db.bind.dialect.name == "postgresql"

    if is_postgres:
        origin_is_ours = EventRecord.metadata_.contains(
            {"integration_origin": {"binding_id": principal.binding_id}}
        )
        # Missing message_type counts as chat: every client we ship sets it,
        # and dropping a message because a field was absent is the worse
        # failure of the two.
        settled = or_(
            EventRecord.payload["message_type"].astext == "chat",
            EventRecord.payload["message_type"].astext.is_(None),
        )
    else:
        # SQLite (tests) has no JSONB operators. Over-inclusive on the origin
        # side is not acceptable here — a false negative would mirror a message
        # straight back to the platform it came from — so match the exact
        # serialized fragment rather than the bare id.
        origin_is_ours = cast(EventRecord.metadata_, Text).like(
            f'%"binding_id": "{principal.binding_id}"%'
        )
        settled = or_(
            cast(EventRecord.payload, Text).like('%"message_type": "chat"%'),
            cast(EventRecord.payload, Text).notlike('%"message_type"%'),
        )

    return q.where(~origin_is_ours).where(settled), targets


@router.get("/events")
def outbound_events(
    after: Optional[str] = Query(None, description="cursor from a previous next_cursor"),
    limit: int = Query(100, ge=1, le=500),
    principal: IntegrationPrincipal = Depends(require_gateway_key),
    db: Session = Depends(get_db),
):
    """Drain outbound messages, ordered and resumable.

    ``next_cursor`` matters more here than on the general endpoint. This query
    discards most of a busy channel's traffic, so a cursor parked on "the last
    chat I returned" would rescan the same thinking/status events on every
    wake-up. When the caller has drained everything, we hand back the tip of
    the unfiltered stream instead — snapshotted *before* the main query, so the
    cursor can never skip an event that query hadn't yet seen.
    """
    q, targets = _outbound_query(db, principal)
    if q is None:
        return success_response({"events": [], "has_more": False, "next_cursor": after})

    head_snapshot = db.execute(
        select(EventRecord.id)
        .where(
            EventRecord.network_id == principal.workspace_id,
            EventRecord.target.in_(targets),
        )
        .order_by(EventRecord.timestamp.desc(), EventRecord.id.desc())
        .limit(1)
    ).scalar()

    if after:
        cursor_row = db.execute(
            select(EventRecord.timestamp, EventRecord.id).where(EventRecord.id == after)
        ).one_or_none()
        if cursor_row is not None:
            q = q.where(
                or_(
                    EventRecord.timestamp > cursor_row.timestamp,
                    and_(
                        EventRecord.timestamp == cursor_row.timestamp,
                        EventRecord.id > cursor_row.id,
                    ),
                )
            )

    rows = db.execute(
        q.order_by(EventRecord.timestamp.asc(), EventRecord.id.asc()).limit(limit + 1)
    ).scalars().all()

    has_more = len(rows) > limit
    events = rows[:limit]

    by_channel = {
        c.channel_name: c
        for c in db.execute(
            select(IntegrationConversation).where(
                IntegrationConversation.binding_id == principal.binding_id,
            )
        ).scalars().all()
    }

    out = []
    for e in events:
        channel_name = (e.target or "").replace("channel/", "", 1)
        mapping = by_channel.get(channel_name)
        payload = e.payload or {}
        out.append({
            "id": e.id,
            "timestamp": e.timestamp,
            "channel_name": channel_name,
            # Saves the gateway a lookup, and keeps the mapping single-sourced
            # here rather than duplicated on its side.
            "external_key": mapping.external_key if mapping else None,
            "conversation_kind": mapping.conversation_kind if mapping else None,
            "author": _author_of(e),
            "content": payload.get("content", ""),
            "attachments": payload.get("attachments") or [],
        })

    if has_more and events:
        next_cursor = events[-1].id
    else:
        next_cursor = head_snapshot or (events[-1].id if events else after)

    return success_response({
        "events": out,
        "has_more": has_more,
        "next_cursor": next_cursor,
    })


def _author_of(event: EventRecord) -> dict:
    """How the platform side should label this message.

    Everything leaves through one bot, so a message from a human or from a
    second agent has to say so in its own body — otherwise the thread reads as
    though the bot said it.
    """
    source = event.source or ""
    payload = event.payload or {}
    if source.startswith("openagents:"):
        return {"kind": "agent", "name": source[len("openagents:"):]}
    if source.startswith("human:"):
        return {
            "kind": "human",
            "name": payload.get("sender_name") or source[len("human:"):],
        }
    return {"kind": "system", "name": source}


# ---------------------------------------------------------------------------
# GET /v1/integrations/events/stream
# ---------------------------------------------------------------------------

@router.get("/events/stream")
async def outbound_stream(
    request: Request,
    principal: IntegrationPrincipal = Depends(require_gateway_key),
):
    """Tell the gateway when to drain. Carries no message content.

    Redis pub/sub has no replay, so a subscriber that consumed frames directly
    would lose whatever arrived while it was reconnecting. Frames here are a
    nudge; the data always comes from ``GET /events`` with a durable cursor.
    That keeps the normal path event-driven — no periodic polling — while a
    reconnect just drains from wherever the cursor sits.

    The binding id is baked into every channel name, so one prefix test filters
    the whole binding without tracking which conversations exist.
    """
    prefix = f"channel/{principal.channel_prefix}"

    async def gen():
        keepalive = 30
        last = asyncio.get_event_loop().time()
        # subscribe_events yields event bytes, and None on an idle tick — the
        # idle tick is what lets a silent stream still emit keepalives and
        # notice the client went away.
        async for data in cache.subscribe_events(f"ws:{principal.workspace_id}:events"):
            if await request.is_disconnected():
                break

            if data is not None:
                try:
                    evt = _json.loads(data)
                    if (evt.get("target") or "").startswith(prefix):
                        origin = (evt.get("metadata") or {}).get("integration_origin") or {}
                        if origin.get("binding_id") != principal.binding_id:
                            yield (
                                f"id: {evt.get('id', '')}\n"
                                f"data: {_json.dumps({'wake': True, 'event_id': evt.get('id')})}\n\n"
                            )
                            last = asyncio.get_event_loop().time()
                except Exception:
                    pass

            now = asyncio.get_event_loop().time()
            if now - last >= keepalive:
                yield ": keepalive\n\n"
                last = now

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
