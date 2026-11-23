# -*- coding: utf-8 -*-
"""OpenAgents Share — guest links into one thread (app/services/guest_links.py).

  GET    /v1/share/instructions                         the markdown an agent follows to share itself
  POST   /v1/share/publish                              an agent publishes, on its person's say-so
  GET    /v1/guest-links?network=&channel=             owner: the links of a workspace / thread
  POST   /v1/guest-links  {network, channel, expires_at}  owner: a new link for a shared thread
  GET    /v1/guest-links/workspace?network=             is this a Share workspace, and is it kept yet
  POST   /v1/guest-links/claim  {network}               owner link token + sign-in: keep the workspace
  GET    /v1/guest-links/room?network=                  the owner's light room (owner link token)
  GET    /v1/guest-links/room/messages?network=         ?after= | ?before= — its messages
  POST   /v1/guest-links/room/messages?network=         {content, idempotency_key} — post as the owner
  POST   /v1/guest-links/import  {network, target}      owner token + sign-in: move it into one of their workspaces
  POST   /v1/guest-links/relocation/accept              the launcher collects its new connection, once
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
from fastapi.responses import JSONResponse, PlainTextResponse
from pydantic import BaseModel, Field
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
    agent_display_name: Optional[str] = None
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
        return _ok({"link": svc.serialize_link(svc.set_expiry(db, str(workspace.id), link_id, body.expires_at))})
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
def describe_link(token: str, db: Session = Depends(get_db), x_guest_session: Optional[str] = Header(None)):
    try:
        return _ok(svc.describe(db, token, x_guest_session))
    except svc.LinkError as e:
        return _fail(e)


@router.post("/guest-links/public/{token}/guests")
def create_guest(token: str, body: GuestCreate, db: Session = Depends(get_db)):
    try:
        return _ok(svc.create_guest(db, token, body.name))
    except svc.LinkError as e:
        return _fail(e)


@router.get("/guest-links/public/{token}/messages")
def guest_messages(token: str, after: Optional[str] = Query(None), before: Optional[str] = Query(None),
                   limit: int = Query(100), db: Session = Depends(get_db)):
    try:
        return _ok(svc.list_messages(db, token, after, limit, before=before))
    except svc.LinkError as e:
        return _fail(e)


@router.post("/guest-links/public/{token}/messages")
def guest_post(token: str, body: GuestMessage, background_tasks: BackgroundTasks,
               db: Session = Depends(get_db, scope="function"), x_guest_session: Optional[str] = Header(None)):
    try:
        link, workspace, channel, guest, content = svc.prepare_guest_post(db, token, x_guest_session, body.content)
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

    posted = _emit_event_blocking(event, workspace, db, token=workspace.password_hash)
    if posted is None:
        db.rollback()
        return _fail(svc.LinkError(502, "Your message couldn't be delivered. Try again."))
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
# The owner's light room (owner link = the workspace token)
# ---------------------------------------------------------------------------

class ImportRequest(BaseModel):
    network: str
    target: str


class RelocationAccept(BaseModel):
    network: str
    agent_name: str
    relocation_id: str
    session_id: Optional[str] = None


@router.get("/guest-links/room")
def owner_room(network: str, db: Session = Depends(get_db), x_workspace_token: Optional[str] = Header(None)):
    try:
        workspace, channel = svc.owner_room(db, network, x_workspace_token)
        return _ok(svc.describe_room(db, workspace, channel))
    except svc.LinkError as e:
        return _fail(e)


@router.get("/guest-links/room/messages")
def owner_room_messages(network: str, after: Optional[str] = Query(None), before: Optional[str] = Query(None),
                        limit: int = Query(100), db: Session = Depends(get_db),
                        x_workspace_token: Optional[str] = Header(None)):
    try:
        workspace, channel = svc.owner_room(db, network, x_workspace_token)
        return _ok(svc.channel_messages(db, workspace, channel, after, limit, before))
    except svc.LinkError as e:
        return _fail(e)


@router.post("/guest-links/room/messages")
def owner_room_post(network: str, body: GuestMessage, background_tasks: BackgroundTasks,
                    db: Session = Depends(get_db, scope="function"), x_workspace_token: Optional[str] = Header(None)):
    try:
        workspace, channel = svc.owner_room(db, network, x_workspace_token)
    except svc.LinkError as e:
        return _fail(e)
    content = (body.content or "").strip()
    if not content or len(content) > svc.MAX_GUEST_MESSAGE_CHARS:
        return _fail(svc.LinkError(400, "Message is empty or too long"))
    name = svc.owner_name_for(db, workspace, channel)
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
        return _ok(svc.import_into(db, source, x_workspace_token, user, body.target))
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
