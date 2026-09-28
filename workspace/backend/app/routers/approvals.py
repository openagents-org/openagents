# -*- coding: utf-8 -*-
"""
Approval endpoints — agents ask, humans decide, in the thread.

POST   /v1/approvals                  Agent requests approval (policy applied)
GET    /v1/approvals                  List requests (filter by status/channel)
GET    /v1/approvals/{id}             Read one (agents poll this while waiting)
POST   /v1/approvals/{id}/approve     Human approves
POST   /v1/approvals/{id}/reject      Human rejects
GET    /v1/approval-policy            Effective rules for a scope (+ raw rows)
PUT    /v1/approval-policy            Replace rules for a scope (admin+)

Who may resolve: a signed-in member whose role satisfies the request's
``required_role``. A bare workspace token is accepted ONLY on legacy
workspaces that do not enforce login (there is no identity to check there).
On an enforced-login workspace the token never resolves an approval — agents
hold that token, and an agent must not be able to approve itself.
"""

import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, Header, Path, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.access import resolve_current_user, resolve_user_role
from app.database import get_db
from app.models import ApprovalRequest, Workspace
from app.response import ResponseCode, json_response, success_response
from app.routers.network import _resolve_workspace, _verify_workspace_access
from app.services import approvals as svc

logger = logging.getLogger(__name__)

# Synchronous SQLAlchemy inside → keep handlers `def` so they run in the
# threadpool, never on the event loop.
router = APIRouter(prefix="/v1", tags=["Approvals"])


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------

class CreateApprovalRequest(BaseModel):
    network: str
    channel: str
    kind: str = "other"
    action: str
    details: Optional[str] = None
    risk: Optional[str] = None
    source: Optional[str] = None       # "openagents:<agent>"


class ResolveApprovalRequest(BaseModel):
    network: str
    note: Optional[str] = None


class PolicyRule(BaseModel):
    kind: str
    policy: str


class UpdatePolicyRequest(BaseModel):
    network: str
    channel: Optional[str] = None      # omit / "*" → workspace default
    rules: List[PolicyRule]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _load(db: Session, network: str, token, authorization):
    workspace = _resolve_workspace(db, network)
    if not workspace:
        return None, json_response(ResponseCode.NOT_FOUND, "Network not found")
    if not _verify_workspace_access(workspace, token, authorization):
        return None, json_response(ResponseCode.UNAUTHORIZED, "Invalid credentials")
    return workspace, None


def _bare_agent(source: Optional[str]) -> str:
    s = (source or "").strip()
    if s.startswith("openagents:"):
        s = s[len("openagents:"):]
    return s or "unknown"


def _resolve_actor(db: Session, workspace: Workspace, token, authorization):
    """Who is resolving this approval, and with what role.

    Returns (actor_id, actor_label, role) or (None, None, None) when the
    caller has no identity we can hold to the required role.
    """
    role = resolve_user_role(db, workspace, authorization)
    if role is not None:
        user = resolve_current_user(db, authorization)
        email = user.email if user else "member"
        label = (user.display_name if user and user.display_name else email)
        return email, label, role
    token_ok = bool(workspace.password_hash and token == workspace.password_hash)
    if token_ok and not workspace.require_login:
        # Legacy open workspace: the token IS the human's credential.
        return "token", "Workspace member", "owner"
    return None, None, None


# ---------------------------------------------------------------------------
# POST /v1/approvals
# ---------------------------------------------------------------------------

@router.post("/approvals")
def create_approval(
    body: CreateApprovalRequest,
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """An agent asks for permission. Policy may answer immediately."""
    workspace, err = _load(db, body.network, x_workspace_token, authorization)
    if err:
        return err
    if not body.action or not body.action.strip():
        return json_response(ResponseCode.BAD_REQUEST, "action is required")
    if not body.channel or not body.channel.strip():
        return json_response(ResponseCode.BAD_REQUEST, "channel is required")
    kind = (body.kind or "other").strip().lower()
    if kind not in svc.KINDS:
        kind = "other"

    a = svc.create_request(
        db, workspace,
        channel_name=body.channel.strip(),
        agent=_bare_agent(body.source),
        kind=kind,
        action=body.action,
        details=body.details,
        risk=(body.risk or "").lower() or None,
    )
    db.commit()
    return success_response(svc.serialize(a))


# ---------------------------------------------------------------------------
# GET /v1/approvals
# ---------------------------------------------------------------------------

@router.get("/approvals")
def list_approvals(
    network: str = Query(...),
    status: Optional[str] = Query(None, description="pending | approved | rejected | expired"),
    channel: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    workspace, err = _load(db, network, x_workspace_token, authorization)
    if err:
        return err
    q = select(ApprovalRequest).where(ApprovalRequest.workspace_id == str(workspace.id))
    if status:
        q = q.where(ApprovalRequest.status == status)
    if channel:
        q = q.where(ApprovalRequest.channel_name == channel)
    rows = db.execute(q.order_by(ApprovalRequest.created_at.desc()).limit(limit)).scalars().all()
    return success_response({
        "approvals": [svc.serialize(a) for a in rows],
        "pending_by_agent": svc.pending_for_agent(db, str(workspace.id)),
    })


# ---------------------------------------------------------------------------
# GET /v1/approvals/{id}
# ---------------------------------------------------------------------------

@router.get("/approvals/{approval_id}")
def get_approval(
    approval_id: str = Path(...),
    network: str = Query(...),
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    workspace, err = _load(db, network, x_workspace_token, authorization)
    if err:
        return err
    a = db.execute(
        select(ApprovalRequest).where(
            ApprovalRequest.id == approval_id,
            ApprovalRequest.workspace_id == str(workspace.id),
        )
    ).scalar_one_or_none()
    if not a:
        return json_response(ResponseCode.NOT_FOUND, "Approval not found")
    return success_response(svc.serialize(a))


# ---------------------------------------------------------------------------
# POST /v1/approvals/{id}/approve | reject
# ---------------------------------------------------------------------------

def _resolve(approval_id: str, body: ResolveApprovalRequest, approve: bool, db, token, authorization):
    workspace, err = _load(db, body.network, token, authorization)
    if err:
        return err
    a = db.execute(
        select(ApprovalRequest).where(
            ApprovalRequest.id == approval_id,
            ApprovalRequest.workspace_id == str(workspace.id),
        )
    ).scalar_one_or_none()
    if not a:
        return json_response(ResponseCode.NOT_FOUND, "Approval not found")
    if a.status != svc.STATUS_PENDING:
        return json_response(ResponseCode.BAD_REQUEST, f"Approval is already {a.status}")

    actor_id, actor_label, role = _resolve_actor(db, workspace, token, authorization)
    if actor_id is None:
        return json_response(
            ResponseCode.FORBIDDEN,
            "Sign in as a workspace member to resolve approvals",
        )
    if not svc.role_can_resolve(role, a.required_role):
        return json_response(
            ResponseCode.FORBIDDEN,
            f"This action requires {a.required_role} approval; your role is {role}",
        )

    svc.resolve(
        db, workspace, a,
        approve=approve,
        actor_id=actor_id,
        actor_label=actor_label,
        actor_role=role,
        note=body.note,
    )
    db.commit()
    return success_response(svc.serialize(a))


@router.post("/approvals/{approval_id}/approve")
def approve_approval(
    body: ResolveApprovalRequest,
    approval_id: str = Path(...),
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    return _resolve(approval_id, body, True, db, x_workspace_token, authorization)


@router.post("/approvals/{approval_id}/reject")
def reject_approval(
    body: ResolveApprovalRequest,
    approval_id: str = Path(...),
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    return _resolve(approval_id, body, False, db, x_workspace_token, authorization)


# ---------------------------------------------------------------------------
# Policy
# ---------------------------------------------------------------------------

@router.get("/approval-policy")
def get_policy(
    network: str = Query(...),
    channel: Optional[str] = Query(None, description="Channel to resolve for; omit for the workspace default"),
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    workspace, err = _load(db, network, x_workspace_token, authorization)
    if err:
        return err
    ws_id = str(workspace.id)
    scope = channel or svc.WORKSPACE_SCOPE
    ws_row = svc._policy_row(db, ws_id, svc.WORKSPACE_SCOPE)
    ch_row = svc._policy_row(db, ws_id, scope) if scope != svc.WORKSPACE_SCOPE else None
    return success_response({
        "scope": scope,
        "rules": svc.effective_rules(db, ws_id, scope),
        "workspace_rules": (ws_row.rules if ws_row else []),
        "channel_rules": (ch_row.rules if ch_row else []),
        "policies": list(svc.POLICIES),
        "defaults": svc.DEFAULT_RULES,
    })


@router.put("/approval-policy")
def put_policy(
    body: UpdatePolicyRequest,
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """Replace the rules for a scope. Admin or above (token = owner-equivalent,
    matching every other workspace-settings mutation)."""
    workspace = _resolve_workspace(db, body.network)
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")
    from app.access import verify_workspace_access
    if not verify_workspace_access(workspace, x_workspace_token, authorization, db=db, min_role="admin"):
        return json_response(ResponseCode.FORBIDDEN, "Admin role required")
    for r in body.rules:
        if r.policy not in svc.POLICIES:
            return json_response(ResponseCode.BAD_REQUEST, f"policy must be one of: {', '.join(svc.POLICIES)}")
    scope = (body.channel or "").strip() or svc.WORKSPACE_SCOPE
    user = resolve_current_user(db, authorization)
    row = svc.set_rules(
        db, str(workspace.id), scope,
        [r.model_dump() for r in body.rules],
        updated_by=(user.email if user else "token"),
    )
    db.commit()
    return success_response({
        "scope": scope,
        "rules": svc.effective_rules(db, str(workspace.id), scope),
        "saved": row.rules,
    })
