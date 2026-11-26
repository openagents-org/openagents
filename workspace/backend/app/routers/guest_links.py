# -*- coding: utf-8 -*-
"""OpenAgents Share — guest links into one thread (app/services/guest_links.py).

  GET    /v1/share/instructions                         the markdown an agent follows to share itself
  POST   /v1/share/publish                              an agent publishes, on its person's say-so
  GET    /v1/guest-links?network=&channel=             owner: the links of a workspace / thread
  POST   /v1/guest-links  {network, channel, expires_at}  owner: a new link for a shared thread
  GET    /v1/guest-links/workspace?network=             is this a Share workspace, and is it kept yet
  POST   /v1/guest-links/claim  {network}               owner link token + sign-in: keep the workspace
  GET    /v1/guest-links/jam?network=                  the owner's light jam (owner link token)
  GET    /v1/guest-links/jam/messages?network=         ?after= | ?before= — its messages
  POST   /v1/guest-links/jam/messages?network=         {content, idempotency_key} — post as the owner
  POST   /v1/guest-links/import  {network, target}      owner token + sign-in: move it into one of their workspaces
  POST   /v1/guest-links/relocation/accept              the launcher collects its new connection, once
  POST   /v1/guest-links/public/{token}/fork  {target?}  signed-in guest: a private copy in their workspace
  GET    /v1/guest-links/jam/requests?network=         guests' requests waiting for the owner
  POST   /v1/guest-links/jam/requests/{id}?network=    {decision: approve|decline}
  GET    /v1/guest-links/requests?network=&channel=     the same, from the full workspace (owner/admin)
  GET    /v1/guest-links/{jam|guests?network=&channel=}/guests     the thread's guests (owner)
  DELETE .../guests/{id}                                        remove a guest: read-only from then on
  GET    /v1/guest-links/{public/{token}|jam}/resources               the thread's artifacts and routines
  GET    /v1/guest-links/{public/{token}|jam}/files/{id}              a file the thread shows (artifact or attachment)
  GET    /v1/guest-links/{public/{token}|jam}/browsers/{id}/screenshot  a browser session the thread shows
  POST   /v1/guest-links/requests/{id}?network=&channel={decision}
  PATCH  /v1/guest-links/{id}?network=  {expires_at}   owner: change expiry (null = never)
  DELETE /v1/guest-links/{id}?network=                 owner: turn a link off for good

  GET    /v1/guest-links/public/{token}                thread, agents, owner name; no auth
  POST   /v1/guest-links/public/{token}/guests         {name} → a guest session
  GET    /v1/guest-links/public/{token}/messages       ?after= | ?before= &limit= — the thread's messages
  POST   /v1/guest-links/public/{token}/messages       X-Guest-Session; {content, idempotency_key}

Publishing needs no account. With a signed-in bearer the new workspace belongs
to that account; without one it is anonymous and the returned workspace token
is the creator's credential, as for any CLI-created workspace.

Every public response carries no-referrer so the token in the page URL never
leaks through a Referer header.
"""

import logging
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, Header, Query
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse, PlainTextResponse, Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.access import resolve_current_user, verify_workspace_access
from app.database import get_db
from app.response import ResponseCode, json_response, success_response
from app.routers.network import _emit_event_blocking, _resolve_workspace
from app.services import guest_links as svc
from openagents.core.onm_events import Event

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1", tags=["share"])

_PRIVATE = {"Referrer-Policy": "no-referrer", "Cache-Control": "no-store"}


def _ok(data):
    return JSONResponse(jsonable_encoder(success_response(data)), headers=_PRIVATE)


def _fail(err: svc.LinkError):
    resp = json_response(err.status, err.message, data=getattr(err, "data", None))
    for k, v in _PRIVATE.items():
        resp.headers[k] = v
    return resp


# ---------------------------------------------------------------------------
# Instructions an agent follows to share itself (the copy-paste entry point)
# ---------------------------------------------------------------------------

_INSTRUCTIONS = Path(__file__).resolve().parent.parent / "services" / "share_instructions.md"


@router.get("/share/instructions")
def share_instructions():
    """Markdown an agent reads when its person says "share this agent".

    The person pastes one line into Claude Code (or any agent):
    "Read {API}/v1/share/instructions and follow it to share this agent with my team."
    URLs come from this server's own settings, so a self-hosted workspace
    hands out its own endpoints.
    """
    text = _INSTRUCTIONS.read_text(encoding="utf-8")
    import app.config as app_config  # read at request time: settings can be reloaded
    import os
    # SHARE_LAUNCHER_PACKAGE: what `npx` installs (a test build's tarball URL on
    # a private preview); defaults to the published launcher.
    launcher = os.environ.get("SHARE_LAUNCHER_PACKAGE") or "@openagents-org/agent-launcher@latest"
    text = (text.replace("{API}", (app_config.config.PUBLIC_API_BASE or "").rstrip("/"))
            .replace("{APP}", svc.frontend_base()).replace("{LAUNCHER}", launcher))
    return PlainTextResponse(text, media_type="text/markdown; charset=utf-8",
                             headers={"Cache-Control": "public, max-age=300"})


# ---------------------------------------------------------------------------
# Publish
# ---------------------------------------------------------------------------

class Excerpt(BaseModel):
    author: str                     # "owner" | "agent"
    text: str


class PublishRequest(BaseModel):
    idempotency_key: str
    title: str
    agent_name: str
    agent_type: Optional[str] = None
    agent_display_name: Optional[str] = None   # ignored: the agent is shown by agent_name
    guest_agent_access: Optional[str] = "open"  # open | approval | off
    guests_can_post: Optional[bool] = True
    guests_can_bring_agents: Optional[bool] = True
    access: Optional[str] = "link"              # link | invited
    invited_emails: List[str] = Field(default_factory=list)
    owner_name: Optional[str] = None
    workspace_name: Optional[str] = None
    excerpts: List[Excerpt] = Field(default_factory=list)
    intro: Optional[str] = None
    link_expires_at: Optional[str] = None   # ISO-8601; null / omitted = never


@router.post("/share/publish")
def publish(body: PublishRequest, db: Session = Depends(get_db), authorization: Optional[str] = Header(None)):
    owner = resolve_current_user(db, authorization) if authorization else None
    if authorization and owner is None:
        # A stale sign-in must not silently publish an anonymous workspace the
        # person believes is in their account.
        return json_response(ResponseCode.UNAUTHORIZED, "Your sign-in expired. Sign in again, or publish without an account.")
    try:
        return _ok(svc.publish(db, body, owner))
    except svc.LinkError as e:
        return _fail(e)


# ---------------------------------------------------------------------------
# Owner management
# ---------------------------------------------------------------------------

def _owner_workspace(db: Session, network: str, token: Optional[str], authorization: Optional[str]):
    workspace = _resolve_workspace(db, network) if network else None
    if workspace is None:
        return None, json_response(ResponseCode.NOT_FOUND, "Workspace not found")
    if not verify_workspace_access(workspace, token, authorization, db, min_role="admin"):
        return None, json_response(ResponseCode.FORBIDDEN, "Only the workspace owner or an admin can manage guest links")
    return workspace, None


class LinkPatch(BaseModel):
    expires_at: Optional[str] = None
    approval_mode: Optional[str] = None
    can_post: Optional[bool] = None
    access: Optional[str] = None
    allow_guest_agents: Optional[bool] = None


class ClaimRequest(BaseModel):
    network: str


@router.get("/guest-links/workspace")
def share_workspace_state(network: str, db: Session = Depends(get_db),
                          x_workspace_token: Optional[str] = Header(None), authorization: Optional[str] = Header(None)):
    """Whether this workspace came from Share and whether someone kept it yet."""
    workspace = _resolve_workspace(db, network) if network else None
    if workspace is None or not verify_workspace_access(workspace, x_workspace_token, authorization, db):
        return json_response(ResponseCode.NOT_FOUND, "Workspace not found")
    return _ok({"share": svc.share_state(workspace)})


@router.post("/guest-links/claim")
def claim_workspace(body: ClaimRequest, db: Session = Depends(get_db),
                    x_workspace_token: Optional[str] = Header(None), authorization: Optional[str] = Header(None)):
    """Keep an anonymously shared workspace: owner link (token) + a signed-in account."""
    user = resolve_current_user(db, authorization) if authorization else None
    if user is None:
        return json_response(ResponseCode.UNAUTHORIZED, "Sign in to keep this workspace")
    workspace = _resolve_workspace(db, body.network) if body.network else None
    if workspace is None or workspace.status == "deleted":
        return json_response(ResponseCode.NOT_FOUND, "Workspace not found")
    try:
        return _ok(svc.claim(db, workspace, x_workspace_token, user))
    except svc.LinkError as e:
        return _fail(e)


class LinkCreate(BaseModel):
    network: str
    channel: str
    expires_at: Optional[str] = None


@router.post("/guest-links")
def create_link(body: LinkCreate, db: Session = Depends(get_db),
                x_workspace_token: Optional[str] = Header(None), authorization: Optional[str] = Header(None)):
    workspace, err = _owner_workspace(db, body.network, x_workspace_token, authorization)
    if err:
        return err
    owner = resolve_current_user(db, authorization) if authorization else None
    created_by = f"human:{owner.email.lower()}" if owner else "share:owner-token"
    try:
        return _ok({"link": svc.serialize_link(svc.create_link(db, workspace, body.channel, body.expires_at, created_by))})
    except svc.LinkError as e:
        return _fail(e)


@router.get("/guest-links")
def list_links(network: str, channel: Optional[str] = None, db: Session = Depends(get_db),
               x_workspace_token: Optional[str] = Header(None), authorization: Optional[str] = Header(None)):
    workspace, err = _owner_workspace(db, network, x_workspace_token, authorization)
    if err:
        return err
    return _ok({"links": [svc.serialize_link(l) for l in svc.links_for(db, str(workspace.id), channel)]})


@router.patch("/guest-links/{link_id}")
def patch_link(link_id: str, body: LinkPatch, network: str, db: Session = Depends(get_db),
               x_workspace_token: Optional[str] = Header(None), authorization: Optional[str] = Header(None)):
    workspace, err = _owner_workspace(db, network, x_workspace_token, authorization)
    if err:
        return err
    try:
        link = None
        # Only the fields sent change: {"approval_mode": "owner"} keeps the expiry.
        if "expires_at" in body.model_fields_set:
            link = svc.set_expiry(db, str(workspace.id), link_id, body.expires_at)
        if "approval_mode" in body.model_fields_set:
            link = svc.set_approval_mode(db, str(workspace.id), link_id, body.approval_mode or "")
        if "can_post" in body.model_fields_set:
            link = svc.set_can_post(db, str(workspace.id), link_id, bool(body.can_post))
        if "access" in body.model_fields_set:
            link = svc.set_access(db, str(workspace.id), link_id, body.access or "")
        if "allow_guest_agents" in body.model_fields_set:
            from app.services.room_agents import set_allow_guest_agents
            link = set_allow_guest_agents(db, str(workspace.id), link_id, bool(body.allow_guest_agents))
        if link is None:
            return _fail(svc.LinkError(400, "Nothing to change"))
        return _ok({"link": svc.serialize_link(link)})
    except svc.LinkError as e:
        return _fail(e)


@router.delete("/guest-links/{link_id}")
def revoke_link(link_id: str, network: str, db: Session = Depends(get_db),
                x_workspace_token: Optional[str] = Header(None), authorization: Optional[str] = Header(None)):
    workspace, err = _owner_workspace(db, network, x_workspace_token, authorization)
    if err:
        return err
    try:
        return _ok({"link": svc.serialize_link(svc.revoke(db, str(workspace.id), link_id))})
    except svc.LinkError as e:
        return _fail(e)


# ---------------------------------------------------------------------------
# Public (guest) side
# ---------------------------------------------------------------------------

class GuestCreate(BaseModel):
    name: str


class GuestMessage(BaseModel):
    content: str
    idempotency_key: Optional[str] = None


@router.get("/guest-links/public/{token}")
def describe_link(token: str, db: Session = Depends(get_db), x_guest_session: Optional[str] = Header(None),
                  authorization: Optional[str] = Header(None)):
    try:
        return _ok(svc.describe(db, token, x_guest_session, authorization))
    except svc.LinkError as e:
        return _fail(e)


@router.post("/guest-links/public/{token}/guests")
def create_guest(token: str, body: GuestCreate, db: Session = Depends(get_db),
                 authorization: Optional[str] = Header(None)):
    try:
        return _ok(svc.create_guest(db, token, body.name, authorization))
    except svc.LinkError as e:
        return _fail(e)


@router.get("/guest-links/public/{token}/messages")
def guest_messages(token: str, after: Optional[str] = Query(None), before: Optional[str] = Query(None),
                   limit: int = Query(100), db: Session = Depends(get_db),
                   authorization: Optional[str] = Header(None)):
    try:
        return _ok(svc.list_messages(db, token, after, limit, before=before, authorization=authorization))
    except svc.LinkError as e:
        return _fail(e)


@router.post("/guest-links/public/{token}/messages")
def guest_post(token: str, body: GuestMessage, background_tasks: BackgroundTasks,
               db: Session = Depends(get_db, scope="function"), x_guest_session: Optional[str] = Header(None),
               authorization: Optional[str] = Header(None)):
    try:
        link, workspace, channel, guest, content = svc.prepare_guest_post(db, token, x_guest_session, body.content,
                                                                          authorization)
    except svc.LinkError as e:
        return _fail(e)

    address = svc.guest_address(guest.id)
    event = Event(
        type="workspace.message.posted",
        source=f"human:{address}",
        target=f"channel/{channel.name}",
        payload={"content": content, "message_type": "chat", "sender_type": "human",
                 "sender_name": guest.display_name, "sender_display_name": f"{guest.display_name} (guest)",
                 "sender_email": address},
        metadata={"sender_email": address, "guest": {"id": guest.id, "name": guest.display_name},
                  "guest_link_id": link.id},
        visibility="channel",
        network=str(workspace.id),
    )
    key = (body.idempotency_key or "").strip()
    if key:
        if len(key) > 128:
            return _fail(svc.LinkError(400, "idempotency_key is too long"))
        # Echoed so the page can match its pending copy to the stored message,
        # even when a poll returns it before this request does.
        event.metadata["client_key"] = key
        from app.services.message_delivery import prepare_delivery
        try:
            receipt = prepare_delivery(db, event, key)
        except ValueError as exc:
            db.rollback()
            return _fail(svc.LinkError(409, str(exc)))
        if receipt is not None:
            # A retry of a message already delivered: same message, no second run, no charge.
            db.rollback()
            return _ok(svc.serialize_event(receipt))
    try:
        svc.charge_post(db, link, guest)
    except svc.LinkError as e:
        return _fail(e)

    # The owner approves each request: the message is posted (and seen) now,
    # but held from the agent until they decide.
    hold_id = None
    if svc.needs_approval(link, channel, content):
        import uuid as _uuid
        hold_id = str(_uuid.uuid4())
        event.metadata["share_hold"] = hold_id
        event.metadata["share_request"] = {"id": hold_id, "status": "pending"}

    posted = _emit_event_blocking(event, workspace, db, token=workspace.password_hash)
    if posted is None:
        db.rollback()
        return _fail(svc.LinkError(502, "Your message couldn't be delivered. Try again."))
    if hold_id:
        from app.models import ThreadGuestRequest
        db.add(ThreadGuestRequest(id=hold_id, link_id=link.id, guest_id=guest.id, event_id=posted.id))
        svc.notify_owner_of_request(db, workspace, channel, guest.display_name, content)
        db.commit()
    from app.routers.sharing import _after_message_hooks
    _after_message_hooks(background_tasks, str(workspace.id), posted)

    from app.models import EventRecord
    record = db.get(EventRecord, posted.id)
    if record is not None:
        return _ok(svc.serialize_event(record))
    return _ok({"id": posted.id, "type": posted.type, "source": posted.source, "target": posted.target,
                "payload": {"content": content, "sender_name": guest.display_name, "message_type": "chat"},
                "metadata": {"guest": {"id": guest.id, "name": guest.display_name}},
                "timestamp": posted.timestamp})


# ---------------------------------------------------------------------------
# The owner's light jam (owner link = the workspace token)
# ---------------------------------------------------------------------------

class ImportRequest(BaseModel):
    network: str
    target: str


class RelocationAccept(BaseModel):
    network: str
    agent_name: str
    relocation_id: str
    session_id: Optional[str] = None


@router.get("/guest-links/jam")
def owner_room(network: str, db: Session = Depends(get_db), x_workspace_token: Optional[str] = Header(None),
        authorization: Optional[str] = Header(None)):
    try:
        workspace, channel = svc.owner_room(db, network, x_workspace_token, authorization)
        return _ok(svc.describe_room(db, workspace, channel))
    except svc.LinkError as e:
        return _fail(e)


@router.get("/guest-links/jam/messages")
def owner_room_messages(network: str, after: Optional[str] = Query(None), before: Optional[str] = Query(None),
                        limit: int = Query(100), db: Session = Depends(get_db),
                        x_workspace_token: Optional[str] = Header(None),
        authorization: Optional[str] = Header(None)):
    try:
        workspace, channel = svc.owner_room(db, network, x_workspace_token, authorization)
        return _ok(svc.channel_messages(db, workspace, channel, after, limit, before))
    except svc.LinkError as e:
        return _fail(e)


@router.post("/guest-links/jam/messages")
def owner_room_post(network: str, body: GuestMessage, background_tasks: BackgroundTasks,
                    db: Session = Depends(get_db, scope="function"), x_workspace_token: Optional[str] = Header(None),
        authorization: Optional[str] = Header(None)):
    try:
        workspace, channel = svc.owner_room(db, network, x_workspace_token, authorization)
    except svc.LinkError as e:
        return _fail(e)
    content = (body.content or "").strip()
    if not content or len(content) > svc.MAX_GUEST_MESSAGE_CHARS:
        return _fail(svc.LinkError(400, "Message is empty or too long"))
    name = svc.owner_name_for(db, workspace, channel)
    content = svc.address_agents_by_name(db, workspace, channel, content)
    event = Event(
        type="workspace.message.posted", source="human:owner", target=f"channel/{channel.name}",
        payload={"content": content, "message_type": "chat", "sender_type": "human",
                 "sender_name": name, "sender_display_name": name},
        metadata={"share_owner": True}, visibility="channel", network=str(workspace.id),
    )
    key = (body.idempotency_key or "").strip()
    if key:
        if len(key) > 128:
            return _fail(svc.LinkError(400, "idempotency_key is too long"))
        event.metadata["client_key"] = key
        from app.services.message_delivery import prepare_delivery
        try:
            receipt = prepare_delivery(db, event, key)
        except ValueError as exc:
            db.rollback()
            return _fail(svc.LinkError(409, str(exc)))
        if receipt is not None:
            db.rollback()
            return _ok(svc.serialize_event(receipt))
    posted = _emit_event_blocking(event, workspace, db, token=workspace.password_hash)
    if posted is None:
        db.rollback()
        return _fail(svc.LinkError(502, "Your message couldn't be delivered. Try again."))
    from app.routers.sharing import _after_message_hooks
    _after_message_hooks(background_tasks, str(workspace.id), posted)
    from app.models import EventRecord
    record = db.get(EventRecord, posted.id)
    return _ok(svc.serialize_event(record) if record is not None else {"id": posted.id})


@router.post("/guest-links/import")
def import_conversation(body: ImportRequest, db: Session = Depends(get_db),
                        x_workspace_token: Optional[str] = Header(None), authorization: Optional[str] = Header(None)):
    """Add the shared conversation (thread, history, agent, guest link) to one of the person's workspaces."""
    user = resolve_current_user(db, authorization) if authorization else None
    if user is None:
        return json_response(ResponseCode.UNAUTHORIZED, "Sign in to add this conversation to a workspace")
    source = _resolve_workspace(db, body.network) if body.network else None
    if source is None:
        return json_response(ResponseCode.NOT_FOUND, "This owner link isn't valid")
    try:
        return _ok(svc.import_into(db, source, x_workspace_token, user, body.target, authorization))
    except svc.LinkError as e:
        return _fail(e)


@router.post("/guest-links/relocation/accept")
def accept_relocation(body: RelocationAccept, db: Session = Depends(get_db),
                      x_workspace_token: Optional[str] = Header(None)):
    """Called by the launcher after a ``relocate`` control action: its new connection, once."""
    source = _resolve_workspace(db, body.network) if body.network else None
    if source is None:
        return json_response(ResponseCode.NOT_FOUND, "Unknown workspace")
    try:
        return _ok(svc.accept_relocation(db, source, x_workspace_token, body.agent_name,
                                         body.relocation_id, body.session_id))
    except svc.LinkError as e:
        return _fail(e)


class RequestDecision(BaseModel):
    decision: str   # "approve" | "decline"


@router.get("/guest-links/jam/requests")
def owner_room_requests(network: str, db: Session = Depends(get_db), x_workspace_token: Optional[str] = Header(None),
        authorization: Optional[str] = Header(None)):
    """Guests' requests waiting for the owner's decision."""
    try:
        workspace, channel = svc.owner_room(db, network, x_workspace_token, authorization)
        return _ok({"requests": svc.pending_requests(db, workspace, channel)})
    except svc.LinkError as e:
        return _fail(e)


@router.post("/guest-links/jam/requests/{request_id}")
def owner_room_decide(network: str, request_id: str, body: RequestDecision, background_tasks: BackgroundTasks,
                      db: Session = Depends(get_db, scope="function"), x_workspace_token: Optional[str] = Header(None),
        authorization: Optional[str] = Header(None)):
    try:
        workspace, channel = svc.owner_room(db, network, x_workspace_token, authorization)
        req, release = svc.decide_request(db, workspace, channel, request_id, body.decision, "owner",
                                          svc.owner_name_for(db, workspace, channel))
    except svc.LinkError as e:
        return _fail(e)
    _release(db, workspace, req, release, background_tasks)
    return _ok({"request": svc.serialize_request(db, req)})


class ForkRequest(BaseModel):
    target: Optional[str] = None   # a workspace id/slug the guest belongs to; omitted = a new workspace


@router.post("/guest-links/public/{token}/fork")
def fork_shared_thread(token: str, body: ForkRequest, db: Session = Depends(get_db),
                       authorization: Optional[str] = Header(None)):
    """A signed-in guest copies the conversation into their own workspace."""
    user = resolve_current_user(db, authorization) if authorization else None
    if user is None:
        return json_response(ResponseCode.UNAUTHORIZED, "Sign in to copy this conversation")
    try:
        return _ok(svc.fork_for_guest(db, token, user, body.target, authorization))
    except svc.LinkError as e:
        return _fail(e)



# The same decisions from the full workspace (after the conversation was kept
# or moved): the workspace's owners/admins, or its token.

def _workspace_channel(db: Session, workspace, channel_name: str):
    from app.models import Channel
    channel = db.execute(select(Channel).where(Channel.workspace_id == str(workspace.id),
                                               Channel.name == channel_name)).scalar_one_or_none()
    if channel is None:
        raise svc.LinkError(404, "Thread not found")
    return channel


@router.get("/guest-links/requests")
def workspace_requests(network: str, channel: str, db: Session = Depends(get_db),
                       x_workspace_token: Optional[str] = Header(None), authorization: Optional[str] = Header(None)):
    workspace, err = _owner_workspace(db, network, x_workspace_token, authorization)
    if err:
        return err
    try:
        return _ok({"requests": svc.pending_requests(db, workspace, _workspace_channel(db, workspace, channel))})
    except svc.LinkError as e:
        return _fail(e)


@router.post("/guest-links/requests/{request_id}")
def workspace_decide(request_id: str, network: str, channel: str, body: RequestDecision,
                     background_tasks: BackgroundTasks, db: Session = Depends(get_db, scope="function"),
                     x_workspace_token: Optional[str] = Header(None), authorization: Optional[str] = Header(None)):
    workspace, err = _owner_workspace(db, network, x_workspace_token, authorization)
    if err:
        return err
    user = resolve_current_user(db, authorization) if authorization else None
    try:
        ch = _workspace_channel(db, workspace, channel)
        label = (getattr(user, "display_name", None) or (user.email.split("@")[0] if user else None)
                 or svc.owner_name_for(db, workspace, ch))
        req, release = svc.decide_request(db, workspace, ch, request_id, body.decision,
                                          f"human:{user.email.lower()}" if user else "owner", label)
    except svc.LinkError as e:
        return _fail(e)
    _release(db, workspace, req, release, background_tasks)
    return _ok({"request": svc.serialize_request(db, req)})


def _release(db, workspace, req, release, background_tasks):
    if not release:
        return
    event = Event(type="workspace.message.posted", source=release["source"], target=release["target"],
                  payload=release["payload"], metadata=release["metadata"], visibility="channel",
                  network=str(workspace.id))
    posted = _emit_event_blocking(event, workspace, db, token=workspace.password_hash)
    if posted is not None:
        from app.models import ThreadGuestRequest
        row = db.get(ThreadGuestRequest, req.id)
        row.released_event_id = posted.id
        db.commit()
        from app.routers.sharing import _after_message_hooks
        _after_message_hooks(background_tasks, str(workspace.id), posted)



# ---------------------------------------------------------------------------
# Thread resources for the share pages (guest link or owner link)
# ---------------------------------------------------------------------------

def _file_response(record, data: bytes) -> Response:
    """A thread file for the share pages: never rendered by the API origin itself."""
    from urllib.parse import quote as _q
    name = record.filename.rsplit("/", 1)[-1]
    return Response(content=data, media_type=record.content_type or "application/octet-stream", headers={
        **_PRIVATE,
        "Content-Disposition": f"attachment; filename*=UTF-8''{_q(name)}",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox; default-src 'none'",
    })


async def _screenshot(db: Session, workspace, tab):
    from app.routers import browser as browser_router
    return await browser_router.get_screenshot(
        tab.id, quality="sd", source=None, channel=None,
        x_workspace_token=workspace.password_hash, authorization=None, db=db)


@router.get("/guest-links/public/{token}/resources")
def guest_resources(token: str, db: Session = Depends(get_db), authorization: Optional[str] = Header(None)):
    try:
        _link, workspace, channel = svc.live_link(db, token, authorization)
        return _ok(svc.thread_resources(db, workspace, channel))
    except svc.LinkError as e:
        return _fail(e)


@router.get("/guest-links/public/{token}/files/{file_id}")
def guest_file(token: str, file_id: str, db: Session = Depends(get_db), authorization: Optional[str] = Header(None)):
    try:
        _link, workspace, channel = svc.live_link(db, token, authorization)
        return _file_response(*svc.thread_file(db, workspace, channel, file_id))
    except svc.LinkError as e:
        return _fail(e)


@router.get("/guest-links/public/{token}/browsers/{tab_id}/screenshot")
async def guest_browser_screenshot(token: str, tab_id: str, db: Session = Depends(get_db), authorization: Optional[str] = Header(None)):
    try:
        _link, workspace, channel = svc.live_link(db, token, authorization)
        tab = svc.thread_browser(db, workspace, channel, tab_id)
    except svc.LinkError as e:
        return _fail(e)
    return await _screenshot(db, workspace, tab)


@router.get("/guest-links/jam/resources")
def room_resources(network: str, db: Session = Depends(get_db), x_workspace_token: Optional[str] = Header(None),
        authorization: Optional[str] = Header(None)):
    try:
        workspace, channel = svc.owner_room(db, network, x_workspace_token, authorization)
        return _ok(svc.thread_resources(db, workspace, channel))
    except svc.LinkError as e:
        return _fail(e)


@router.get("/guest-links/jam/files/{file_id}")
def room_file(network: str, file_id: str, db: Session = Depends(get_db), x_workspace_token: Optional[str] = Header(None),
        authorization: Optional[str] = Header(None)):
    try:
        workspace, channel = svc.owner_room(db, network, x_workspace_token, authorization)
        return _file_response(*svc.thread_file(db, workspace, channel, file_id))
    except svc.LinkError as e:
        return _fail(e)


@router.get("/guest-links/jam/browsers/{tab_id}/screenshot")
async def room_browser_screenshot(network: str, tab_id: str, db: Session = Depends(get_db),
                                  x_workspace_token: Optional[str] = Header(None),
        authorization: Optional[str] = Header(None)):
    try:
        workspace, channel = svc.owner_room(db, network, x_workspace_token, authorization)
        tab = svc.thread_browser(db, workspace, channel, tab_id)
    except svc.LinkError as e:
        return _fail(e)
    return await _screenshot(db, workspace, tab)



# Guests of the thread: list, and remove one (owner jam, or the full workspace).

@router.get("/guest-links/jam/guests")
def room_guests(network: str, db: Session = Depends(get_db), x_workspace_token: Optional[str] = Header(None),
        authorization: Optional[str] = Header(None)):
    try:
        workspace, channel = svc.owner_room(db, network, x_workspace_token, authorization)
        return _ok({"guests": svc.list_guests(db, workspace, channel)})
    except svc.LinkError as e:
        return _fail(e)


@router.delete("/guest-links/jam/guests/{guest_id}")
def room_remove_guest(network: str, guest_id: str, db: Session = Depends(get_db),
                      x_workspace_token: Optional[str] = Header(None),
        authorization: Optional[str] = Header(None)):
    try:
        workspace, channel = svc.owner_room(db, network, x_workspace_token, authorization)
        return _ok({"guest": svc.remove_guest(db, workspace, channel, guest_id)})
    except svc.LinkError as e:
        return _fail(e)


@router.get("/guest-links/guests")
def workspace_guests(network: str, channel: str, db: Session = Depends(get_db),
                     x_workspace_token: Optional[str] = Header(None), authorization: Optional[str] = Header(None)):
    workspace, err = _owner_workspace(db, network, x_workspace_token, authorization)
    if err:
        return err
    try:
        return _ok({"guests": svc.list_guests(db, workspace, _workspace_channel(db, workspace, channel))})
    except svc.LinkError as e:
        return _fail(e)


@router.delete("/guest-links/guests/{guest_id}")
def workspace_remove_guest(guest_id: str, network: str, channel: str, db: Session = Depends(get_db),
                           x_workspace_token: Optional[str] = Header(None), authorization: Optional[str] = Header(None)):
    workspace, err = _owner_workspace(db, network, x_workspace_token, authorization)
    if err:
        return err
    try:
        return _ok({"guest": svc.remove_guest(db, workspace, _workspace_channel(db, workspace, channel), guest_id)})
    except svc.LinkError as e:
        return _fail(e)



# ---------------------------------------------------------------------------
# A person's jams
# ---------------------------------------------------------------------------

@router.get("/jams")
def list_my_rooms(db: Session = Depends(get_db), authorization: Optional[str] = Header(None)):
    """Jams the signed-in person owns: not workspaces until they say so."""
    user = resolve_current_user(db, authorization) if authorization else None
    if user is None:
        return json_response(ResponseCode.UNAUTHORIZED, "Sign in to see your jams")
    return _ok({"jams": svc.my_rooms(db, user)})


@router.post("/jams/{network}/keep-as-workspace")
def room_keep_as_workspace(network: str, db: Session = Depends(get_db),
                           x_workspace_token: Optional[str] = Header(None), authorization: Optional[str] = Header(None)):
    user = resolve_current_user(db, authorization) if authorization else None
    if user is None:
        return json_response(ResponseCode.UNAUTHORIZED, "Sign in to keep this jam as a workspace")
    try:
        workspace, channel = svc.owner_room(db, network, x_workspace_token, authorization)
        return _ok(svc.keep_as_workspace(db, workspace, channel, user))
    except svc.LinkError as e:
        return _fail(e)


@router.delete("/jams/{network}")
def room_delete(network: str, db: Session = Depends(get_db),
                x_workspace_token: Optional[str] = Header(None), authorization: Optional[str] = Header(None)):
    try:
        workspace, _channel = svc.owner_room(db, network, x_workspace_token, authorization)
        svc.delete_room(db, workspace)
        return _ok({"deleted": True})
    except svc.LinkError as e:
        return _fail(e)



class PinBody(BaseModel):
    kind: Optional[str] = None   # "file" | "browser" | null to close
    id: Optional[str] = None


@router.put("/guest-links/jam/pin")
def room_pin(network: str, body: PinBody, db: Session = Depends(get_db),
             x_workspace_token: Optional[str] = Header(None), authorization: Optional[str] = Header(None)):
    """The artifact the owner has open: guests see it open when they arrive."""
    try:
        workspace, channel = svc.owner_room(db, network, x_workspace_token, authorization)
        return _ok({"pinnedArtifact": svc.set_pinned(db, workspace, channel, body.kind, body.id)})
    except svc.LinkError as e:
        return _fail(e)



class InviteBody(BaseModel):
    emails: List[str]


@router.get("/guest-links/{link_id}/invites")
def list_invites(link_id: str, network: str, db: Session = Depends(get_db),
                 x_workspace_token: Optional[str] = Header(None), authorization: Optional[str] = Header(None)):
    workspace, err = _owner_workspace(db, network, x_workspace_token, authorization)
    if err:
        return err
    try:
        link = svc._owned_link(db, str(workspace.id), link_id)
        return _ok({"access": link.access or "link", "emails": list(link.invited_emails or [])})
    except svc.LinkError as e:
        return _fail(e)


@router.post("/guest-links/{link_id}/invites")
def add_invites(link_id: str, network: str, body: InviteBody, db: Session = Depends(get_db),
                x_workspace_token: Optional[str] = Header(None), authorization: Optional[str] = Header(None)):
    """Invite people by email (they get an email with the link and sign in with that address)."""
    workspace, err = _owner_workspace(db, network, x_workspace_token, authorization)
    if err:
        return err
    user = resolve_current_user(db, authorization) if authorization else None
    try:
        link0 = svc._owned_link(db, str(workspace.id), link_id)
        inviter = (getattr(user, "display_name", None) or (user.email.split("@")[0] if user else None)
                   or link0.owner_name or "Someone")
        link, new = svc.add_invites(db, workspace, link_id, body.emails, inviter)
        return _ok({"link": svc.serialize_link(link), "added": new})
    except svc.LinkError as e:
        return _fail(e)


@router.delete("/guest-links/{link_id}/invites")
def remove_invite(link_id: str, network: str, email: str, db: Session = Depends(get_db),
                  x_workspace_token: Optional[str] = Header(None), authorization: Optional[str] = Header(None)):
    workspace, err = _owner_workspace(db, network, x_workspace_token, authorization)
    if err:
        return err
    try:
        return _ok({"link": svc.serialize_link(svc.remove_invite(db, workspace, link_id, email))})
    except svc.LinkError as e:
        return _fail(e)


# ---------------------------------------------------------------------------
# More agents in the jam: the owner's, and guests' own (limited connections)
# ---------------------------------------------------------------------------

class AgentBody(BaseModel):
    name: str
    type: Optional[str] = "claude"


@router.post("/guest-links/jam/agents")
def room_add_agent(network: str, body: AgentBody, db: Session = Depends(get_db),
                   x_workspace_token: Optional[str] = Header(None), authorization: Optional[str] = Header(None)):
    from app.services import room_agents
    try:
        workspace, channel = svc.owner_room(db, network, x_workspace_token, authorization)
        return _ok(room_agents.add_owner_agent(db, workspace, channel, body.name, body.type or "claude"))
    except svc.LinkError as e:
        return _fail(e)


@router.delete("/guest-links/jam/agents/{name}")
def room_remove_agent(network: str, name: str, db: Session = Depends(get_db),
                      x_workspace_token: Optional[str] = Header(None), authorization: Optional[str] = Header(None)):
    from app.services import room_agents
    try:
        workspace, channel = svc.owner_room(db, network, x_workspace_token, authorization)
        return _ok(room_agents.remove_owner_agent(db, workspace, channel, name))
    except svc.LinkError as e:
        return _fail(e)


@router.post("/guest-links/public/{token}/agents")
def guest_bring_agent(token: str, body: AgentBody, db: Session = Depends(get_db),
                      x_guest_session: Optional[str] = Header(None), authorization: Optional[str] = Header(None)):
    """A guest brings their own agent. The connection token in the reply is shown once."""
    from app.services import room_agents
    try:
        return _ok(room_agents.bring_guest_agent(db, token, x_guest_session, authorization,
                                                 body.name, body.type or "claude"))
    except svc.LinkError as e:
        return _fail(e)


@router.delete("/guest-links/public/{token}/agents/{name}")
def guest_remove_agent(token: str, name: str, db: Session = Depends(get_db),
                       x_guest_session: Optional[str] = Header(None), authorization: Optional[str] = Header(None)):
    from app.services import room_agents
    try:
        return _ok(room_agents.remove_guest_agent(db, token, x_guest_session, authorization, name))
    except svc.LinkError as e:
        return _fail(e)
