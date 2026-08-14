# -*- coding: utf-8 -*-
"""Binding lifecycle — connect, list, disconnect.

Split from ``routers/integrations.py`` because the callers are different
species. Those endpoints serve the gateway, holding a restricted credential.
These serve a human in the workspace UI (owner or admin), and one endpoint —
activation — serves the gateway during the handshake using a one-time ticket.

    POST   /v1/integration-bindings                 operator starts a connection
    POST   /v1/integration-bindings/activate        gateway completes it
    GET    /v1/integration-bindings                 what the UI lists
    DELETE /v1/integration-bindings/{id}            operator disconnects
    POST   /v1/integration-bindings/{id}/cleanup-ack  gateway confirms wipe

The handshake exists because OAuth lands on the gateway while the binding has
to be created here. Without a ticket, anyone who found the gateway's connect
URL could bind an agent into a workspace they have no access to. The ticket is
minted by an authenticated operator, stored hashed, and spent exactly once.

    authorizing → credentials_stored → active → disconnecting → disconnected

Note which side owns the secret: the gateway generates its own credential and
sends us the fingerprint. Nothing here can reconstruct it, so a lost activation
response is just a retry — same binding, same hash, same row — rather than a
credential we can neither resend nor revoke.
"""

import hashlib
import logging
import secrets
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, Header
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.access import resolve_current_user, verify_workspace_access
from app.config import config
from app.database import get_db
from app.integrations.principal import revoke_keys
from app.models import (
    IntegrationBinding,
    IntegrationKey,
    Workspace,
    WorkspaceMember,
)
from app.response import ResponseCode, json_response, success_response
from app.routers.network import _workspace_filter

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/integration-bindings", tags=["Integrations"])

# Long enough to create a Slack app from a manifest and click through install,
# short enough that a link left in a browser history is worthless tomorrow.
TICKET_TTL = timedelta(minutes=30)

SUPPORTED_PLATFORMS = frozenset({"slack", "lark", "telegram"})


class CreateBindingRequest(BaseModel):
    network: str = Field(..., description="workspace id or slug")
    platform: str
    agent_name: str
    # Which conversations the gateway may open. Absent means DM-only.
    external_scope: dict = Field(default_factory=dict)


class ActivateRequest(BaseModel):
    binding_id: str
    ticket: str
    key_hash: str = Field(..., description="SHA-256 of the credential the gateway generated")
    installation: dict = Field(default_factory=dict, description="non-secret ids: app_id, tenant_id, bot_user_id")


def _load_workspace(db: Session, network: str) -> Optional[Workspace]:
    ws = db.execute(select(Workspace).where(_workspace_filter(network))).scalar_one_or_none()
    if ws is None or ws.status == "deleted":
        return None
    return ws


# ---------------------------------------------------------------------------
# POST /v1/integration-bindings — operator starts a connection
# ---------------------------------------------------------------------------

@router.post("")
def create_binding(
    body: CreateBindingRequest,
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """Reserve a binding and mint the one-time ticket for the OAuth hand-off.

    Owner/admin only — exporting an agent gives an outside platform a way to
    talk to it, which is not an ordinary member's call to make.
    """
    if body.platform not in SUPPORTED_PLATFORMS:
        return json_response(ResponseCode.BAD_REQUEST, f"Unsupported platform: {body.platform}")

    workspace = _load_workspace(db, body.network)
    if workspace is None:
        return json_response(ResponseCode.NOT_FOUND, "Workspace not found")
    if not verify_workspace_access(workspace, x_workspace_token, authorization, db=db, min_role="admin"):
        return json_response(ResponseCode.FORBIDDEN, "Only an owner or admin can export an agent")

    member = db.execute(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace.id,
            WorkspaceMember.agent_name == body.agent_name,
        )
    ).scalar_one_or_none()
    if member is None or member.status == "removed":
        return json_response(ResponseCode.NOT_FOUND, f"No such agent: {body.agent_name}")

    ticket = secrets.token_urlsafe(32)
    now = datetime.now(timezone.utc)
    creator = resolve_current_user(db, authorization)

    binding = IntegrationBinding(
        workspace_id=str(workspace.id),
        platform=body.platform,
        agent_name=body.agent_name,
        external_scope=body.external_scope or {},
        status="authorizing",
        ticket_nonce_hash=hashlib.sha256(ticket.encode("utf-8")).hexdigest(),
        ticket_expires_at=now + TICKET_TTL,
        created_by=creator.email if creator else None,
    )
    db.add(binding)
    db.commit()

    return success_response({
        "binding_id": binding.id,
        # The only time this is readable. It travels in the redirect the
        # operator's browser follows; we keep the hash.
        "ticket": ticket,
        "expires_at": binding.ticket_expires_at.isoformat(),
        "platform": binding.platform,
        "agent_name": binding.agent_name,
    })


# ---------------------------------------------------------------------------
# POST /v1/integration-bindings/activate — gateway completes the handshake
# ---------------------------------------------------------------------------

@router.post("/activate")
def activate_binding(
    body: ActivateRequest,
    db: Session = Depends(get_db),
    x_service_key: Optional[str] = Header(None),
):
    """Spend the ticket and register the gateway's credential fingerprint.

    Authenticated by the shared service key, *and* by the ticket. The service
    key proves the caller is our gateway; the ticket proves this particular
    connection was started by someone with rights to that workspace. Neither
    alone is enough.

    Idempotent by construction: a retry with the same binding and the same hash
    finds the credential already registered and reports success. That is what
    makes a lost response harmless — there is no second credential to mint and
    nothing for the gateway to have missed.
    """
    expected = getattr(config, "INTEGRATION_SERVICE_KEY", None)
    if not expected or not x_service_key or not secrets.compare_digest(x_service_key, expected):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid service credential")

    binding = db.execute(
        select(IntegrationBinding).where(IntegrationBinding.id == body.binding_id)
    ).scalar_one_or_none()
    if binding is None:
        return json_response(ResponseCode.NOT_FOUND, "Binding not found")

    existing = db.execute(
        select(IntegrationKey).where(
            IntegrationKey.binding_id == binding.id,
            IntegrationKey.key_hash == body.key_hash,
            IntegrationKey.revoked_at.is_(None),
        )
    ).scalar_one_or_none()
    if existing is not None and binding.status == "active":
        return success_response({"binding_id": binding.id, "status": binding.status, "reused": True})

    if binding.status not in ("authorizing", "credentials_stored"):
        return json_response(ResponseCode.CONFLICT, f"Binding is {binding.status}")

    now = datetime.now(timezone.utc)
    if not binding.ticket_nonce_hash:
        return json_response(ResponseCode.UNAUTHORIZED, "Ticket already spent")
    expires = binding.ticket_expires_at
    if expires is not None and expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if expires is not None and expires < now:
        return json_response(ResponseCode.UNAUTHORIZED, "Ticket expired")
    presented = hashlib.sha256(body.ticket.encode("utf-8")).hexdigest()
    if not secrets.compare_digest(presented, binding.ticket_nonce_hash):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid ticket")

    if existing is None:
        db.add(IntegrationKey(binding_id=binding.id, key_hash=body.key_hash))

    binding.installation = body.installation or {}
    binding.status = "active"
    binding.activated_at = now
    # Spent. A replay after this point fails the "already spent" check above
    # unless it carries the same credential, which is the idempotent retry.
    binding.ticket_nonce_hash = None
    db.commit()

    logger.info(
        "integration: activated binding %s (%s → %s)",
        binding.id, binding.platform, binding.agent_name,
    )
    return success_response({"binding_id": binding.id, "status": binding.status, "reused": False})


# ---------------------------------------------------------------------------
# GET /v1/integration-bindings — what the UI lists
# ---------------------------------------------------------------------------

@router.get("")
def list_bindings(
    network: str,
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """List this workspace's bindings. Never exposes credentials — there are
    none here to expose, and the fingerprint is not something a browser needs."""
    workspace = _load_workspace(db, network)
    if workspace is None:
        return json_response(ResponseCode.NOT_FOUND, "Workspace not found")
    if not verify_workspace_access(workspace, x_workspace_token, authorization, db=db):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid workspace credentials")

    rows: List[IntegrationBinding] = db.execute(
        select(IntegrationBinding)
        .where(
            IntegrationBinding.workspace_id == str(workspace.id),
            IntegrationBinding.status != "disconnected",
        )
        .order_by(IntegrationBinding.created_at.desc())
    ).scalars().all()

    return success_response({
        "bindings": [{
            "id": b.id,
            "platform": b.platform,
            "agent_name": b.agent_name,
            "status": b.status,
            "installation": b.installation or {},
            "external_scope": b.external_scope or {},
            "created_at": b.created_at.isoformat() if b.created_at else None,
            "activated_at": b.activated_at.isoformat() if b.activated_at else None,
        } for b in rows],
    })


# ---------------------------------------------------------------------------
# DELETE /v1/integration-bindings/{id} — operator disconnects
# ---------------------------------------------------------------------------

@router.delete("/{binding_id}")
def disconnect_binding(
    binding_id: str,
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """Stop the traffic now; the credential wipe finishes asynchronously.

    Revoking here takes effect on the gateway's very next call, so "stop
    sending and receiving" is immediate. Clearing the platform credentials is
    not — they live on the gateway, which has to notice and act. So this lands
    in ``disconnecting`` and only ``cleanup-ack`` completes it. Reporting
    ``disconnected`` before the gateway confirmed would be telling the user
    their Slack token is gone when it may not be.
    """
    binding = db.execute(
        select(IntegrationBinding).where(IntegrationBinding.id == binding_id)
    ).scalar_one_or_none()
    if binding is None:
        return json_response(ResponseCode.NOT_FOUND, "Binding not found")

    workspace = _load_workspace(db, str(binding.workspace_id))
    if workspace is None:
        return json_response(ResponseCode.NOT_FOUND, "Workspace not found")
    if not verify_workspace_access(workspace, x_workspace_token, authorization, db=db, min_role="admin"):
        return json_response(ResponseCode.FORBIDDEN, "Only an owner or admin can disconnect")

    if binding.status == "disconnected":
        return success_response({"binding_id": binding.id, "status": binding.status})

    revoked = revoke_keys(db, binding.id)
    binding.status = "disconnecting"
    binding.disconnect_requested_at = datetime.now(timezone.utc)
    db.commit()

    logger.info("integration: disconnecting binding %s (revoked %d key(s))", binding.id, revoked)
    return success_response({
        "binding_id": binding.id,
        "status": binding.status,
        "message": "Messaging stopped. Credential removal completes once the gateway confirms.",
    })


# ---------------------------------------------------------------------------
# POST /v1/integration-bindings/{id}/cleanup-ack — gateway confirms the wipe
# ---------------------------------------------------------------------------

@router.post("/{binding_id}/cleanup-ack")
def cleanup_ack(
    binding_id: str,
    db: Session = Depends(get_db),
    x_service_key: Optional[str] = Header(None),
):
    """The gateway reports it has flushed and deleted the platform credentials.

    Uses the service key rather than the binding's own credential, which was
    revoked at disconnect — the caller can no longer authenticate as the thing
    it is reporting about.
    """
    expected = getattr(config, "INTEGRATION_SERVICE_KEY", None)
    if not expected or not x_service_key or not secrets.compare_digest(x_service_key, expected):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid service credential")

    binding = db.execute(
        select(IntegrationBinding).where(IntegrationBinding.id == binding_id)
    ).scalar_one_or_none()
    if binding is None:
        return json_response(ResponseCode.NOT_FOUND, "Binding not found")

    binding.status = "disconnected"
    binding.disconnected_at = datetime.now(timezone.utc)
    revoke_keys(db, binding.id)
    db.commit()
    return success_response({"binding_id": binding.id, "status": binding.status})
