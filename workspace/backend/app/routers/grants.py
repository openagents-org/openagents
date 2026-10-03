# -*- coding: utf-8 -*-
"""Resource grants + "why can I see this?" (permission model v1.1, spec §4).

    GET    /v1/grants?network=&resource_kind=&resource_id=     manager of the resource
    POST   /v1/grants {network, resource_kind, resource_id, grantee_kind, grantee_id,
                       rights?, scope?, expires_at?, budget?, note?}
    DELETE /v1/grants/{id}?network=
    GET    /v1/grants/preview?network=&resource_kind=&resource_id=&grantee_kind=&grantee_id=
    GET    /v1/access/explain?network=&resource_kind=&resource_id=   for the caller
    GET    /v1/access/mine?network=                                  the caller's groups + grants
    GET    /v1/access/candidates?network=&kinds=                     grantee picker source

"Manager" = owner of the resource, an admin, a machine, or a holder of the
`share` right. An identified agent manages the artifacts it owns.
"""

import logging
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Any, List, Optional

from fastapi import APIRouter, Depends, Header, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import ResourceGrant, SecurityGroup, WorkspaceMember
from app.response import ResponseCode, json_response, success_response
from app.routers.sharing import _Ctx, _actor_name, _actor_source, _is_workspace_member, _load, _norm
from app.services.access_model import (
    GRANTEE_KINDS,
    RESOURCE_KINDS,
    RIGHTS,
    Resource,
    can_manage,
    create_grant,
    explain,
    grant_candidates,
    grant_preview,
    grantee_label,
    grants_for_pairs,
    load_resource,
    normalize_rights,
    principal_group_ids,
    revoke_grant,
    _identity_pairs,
)
from app.services.notify import notify

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1", tags=["grants"])


class GrantCreate(BaseModel):
    network: str
    resource_kind: str
    resource_id: str
    grantee_kind: str
    grantee_id: str
    rights: Optional[List[str]] = None
    scope: Optional[Any] = None
    expires_at: Optional[str] = None
    budget: Optional[float] = None
    note: Optional[str] = None


def serialize_grant(db: Session, workspace_id: str, g: ResourceGrant) -> dict:
    return {
        "id": g.id,
        "resource_kind": g.resource_kind,
        "resource_id": g.resource_id,
        "grantee_kind": g.grantee_kind,
        "grantee_id": g.grantee_id,
        "grantee_label": grantee_label(db, workspace_id, g.grantee_kind, g.grantee_id),
        "rights": list(g.rights or []),
        "scope": g.scope,
        "expires_at": g.expires_at.isoformat() if g.expires_at else None,
        "budget": float(g.budget) if g.budget is not None else None,
        "granted_by": g.granted_by,
        "note": g.note,
        "created_at": g.created_at.isoformat() if g.created_at else None,
    }


def _resource_or_err(db: Session, ctx: _Ctx, kind: Optional[str], rid: Optional[str]):
    kind = (kind or "").strip().lower()
    rid = (rid or "").strip()
    if kind not in RESOURCE_KINDS:
        return None, json_response(ResponseCode.BAD_REQUEST, f"resource_kind must be one of {', '.join(RESOURCE_KINDS)}")
    if not rid:
        return None, json_response(ResponseCode.BAD_REQUEST, "resource_id is required")
    res = load_resource(db, ctx.wid, kind, rid)
    if res is None:
        return None, json_response(ResponseCode.NOT_FOUND, f"{kind} not found")
    return res, None


def _manager_or_err(db: Session, ctx: _Ctx, res: Resource):
    if not can_manage(db, ctx.viewer, res, ctx.wid):
        return json_response(ResponseCode.FORBIDDEN, "Only the owner, an admin, or someone with the share right can manage access")
    return None


def _parse_expires(raw: Optional[str]):
    if raw is None or not str(raw).strip():
        return None, None
    s = str(raw).strip()
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(s)
    except ValueError:
        return None, json_response(ResponseCode.BAD_REQUEST, "expires_at must be an ISO-8601 timestamp")
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    if dt <= datetime.now(timezone.utc):
        return None, json_response(ResponseCode.BAD_REQUEST, "expires_at must be in the future")
    return dt, None


def _validate_grantee(db: Session, ctx: _Ctx, kind: str, gid: str):
    kind = (kind or "").strip().lower()
    if kind not in GRANTEE_KINDS:
        return None, None, json_response(ResponseCode.BAD_REQUEST, f"grantee_kind must be one of {', '.join(GRANTEE_KINDS)}")
    if kind == "human":
        email = _norm(gid)
        if not email or "@" not in email:
            return None, None, json_response(ResponseCode.BAD_REQUEST, "grantee_id must be an email")
        if not _is_workspace_member(db, ctx.workspace, email):
            return None, None, json_response(ResponseCode.BAD_REQUEST, "That person is not a member of this workspace — invite them first")
        return kind, email, None
    if kind == "agent":
        name = (gid or "").strip()
        m = db.execute(
            select(WorkspaceMember.agent_name).where(
                WorkspaceMember.workspace_id == ctx.workspace.id,
                WorkspaceMember.agent_name == name,
                WorkspaceMember.status != "removed",
            )
        ).first()
        if m is None:
            return None, None, json_response(ResponseCode.NOT_FOUND, "Agent not found")
        return kind, name, None
    g = db.execute(
        select(SecurityGroup).where(SecurityGroup.workspace_id == ctx.workspace.id, SecurityGroup.id == (gid or "").strip())
    ).scalar_one_or_none()
    if g is None:
        return None, None, json_response(ResponseCode.NOT_FOUND, "Group not found")
    return kind, g.id, None


def _resource_title(res: Resource) -> str:
    obj = res.obj
    if res.kind == "channel":
        return getattr(obj, "title", None) or res.id
    if res.kind == "agent":
        return getattr(obj, "display_name", None) or f"@{res.id}"
    if res.kind == "file":
        return getattr(obj, "filename", None) or res.id
    if res.kind == "knowledge":
        return getattr(obj, "title", None) or res.id
    return res.id


# ---------------------------------------------------------------------------
# Grants
# ---------------------------------------------------------------------------

@router.get("/grants/preview")
def preview_grant(
    network: str = Query(...),
    resource_kind: str = Query(...),
    resource_id: str = Query(...),
    grantee_kind: Optional[str] = Query(None),
    grantee_id: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """What becomes accessible to the grantee: channels → thread + files +
    tasks; agents → profile + example requests; files/knowledge → the item."""
    ctx, err = _load(db, network, x_workspace_token, authorization)
    if err:
        return err
    res, err = _resource_or_err(db, ctx, resource_kind, resource_id)
    if err:
        return err
    err = _manager_or_err(db, ctx, res)
    if err:
        return err
    out = {"resource_kind": res.kind, "resource_id": res.id, "title": _resource_title(res),
           "items": grant_preview(db, ctx.wid, res)}
    if grantee_kind and grantee_id:
        kind, gid, err = _validate_grantee(db, ctx, grantee_kind, grantee_id)
        if err:
            return err
        out["grantee"] = {"kind": kind, "id": gid, "label": grantee_label(db, ctx.wid, kind, gid)}
    return success_response(out)


@router.get("/grants")
def list_grants(
    network: str = Query(...),
    resource_kind: str = Query(...),
    resource_id: str = Query(...),
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    ctx, err = _load(db, network, x_workspace_token, authorization)
    if err:
        return err
    res, err = _resource_or_err(db, ctx, resource_kind, resource_id)
    if err:
        return err
    err = _manager_or_err(db, ctx, res)
    if err:
        return err
    from app.services.access_model import active_grants
    grants = active_grants(db, ctx.wid, res.kind, res.id)
    return success_response({"grants": [serialize_grant(db, ctx.wid, g) for g in grants]})


@router.post("/grants")
def add_grant(
    body: GrantCreate,
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    ctx, err = _load(db, body.network, x_workspace_token, authorization)
    if err:
        return err
    res, err = _resource_or_err(db, ctx, body.resource_kind, body.resource_id)
    if err:
        return err
    err = _manager_or_err(db, ctx, res)
    if err:
        return err
    kind, gid, err = _validate_grantee(db, ctx, body.grantee_kind, body.grantee_id)
    if err:
        return err
    if body.rights is not None:
        bad = [r for r in body.rights if str(r).strip().lower() not in RIGHTS]
        if bad:
            return json_response(ResponseCode.BAD_REQUEST, f"rights must be a subset of {list(RIGHTS)}")
    rights = normalize_rights(body.rights)
    expires_at, err = _parse_expires(body.expires_at)
    if err:
        return err
    budget = None
    if body.budget is not None:
        try:
            budget = Decimal(str(body.budget))
        except InvalidOperation:
            return json_response(ResponseCode.BAD_REQUEST, "budget must be a number")
        if budget < 0:
            return json_response(ResponseCode.BAD_REQUEST, "budget must be >= 0")
    note = (body.note or "").strip() or None
    by = ctx.viewer.email or ctx.viewer.label

    grant, created = create_grant(
        db, ctx.wid, resource_kind=res.kind, resource_id=res.id, grantee_kind=kind, grantee_id=gid,
        rights=rights, scope=body.scope, expires_at=expires_at, budget=budget, granted_by=by, note=note,
    )
    if created and kind == "human" and gid != ctx.viewer.email:
        title = _resource_title(res)
        noun = {"channel": "thread", "agent": "agent", "file": "file", "knowledge": "knowledge entry"}.get(res.kind, res.kind)
        notify(
            db, ctx.wid,
            source=_actor_source(ctx),
            title=f"{_actor_name(db, ctx)} shared the {noun} “{title}” with you",
            message=note or f"You can now access “{title}”.",
            recipient_email=gid,
            kind="share",
            channel_name=res.id if res.kind == "channel" else None,
            action_ref=f"{res.kind}:{res.id}",
        )
    db.commit()
    logger.info("grants: %s granted %s on %s/%s to %s:%s", by, rights, res.kind, res.id, kind, gid)
    return success_response({**serialize_grant(db, ctx.wid, grant), "created": created})


@router.delete("/grants/{grant_id}")
def delete_grant(
    grant_id: str,
    network: str = Query(...),
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    ctx, err = _load(db, network, x_workspace_token, authorization)
    if err:
        return err
    g = db.execute(
        select(ResourceGrant).where(ResourceGrant.workspace_id == ctx.workspace.id, ResourceGrant.id == grant_id)
    ).scalar_one_or_none()
    if g is None:
        return json_response(ResponseCode.NOT_FOUND, "Grant not found")
    res = load_resource(db, ctx.wid, g.resource_kind, g.resource_id)
    if res is not None:
        err = _manager_or_err(db, ctx, res)
        if err:
            return err
    elif not ctx.is_admin:
        return json_response(ResponseCode.FORBIDDEN, "Only an admin can revoke a grant on a deleted resource")
    already = g.revoked_at is not None
    revoke_grant(db, g, ctx.viewer.email or ctx.viewer.label)
    db.commit()
    return success_response({"revoked": True, "id": g.id, "already_revoked": already})


# ---------------------------------------------------------------------------
# Access
# ---------------------------------------------------------------------------

@router.get("/access/explain")
def explain_access(
    network: str = Query(...),
    resource_kind: str = Query(...),
    resource_id: str = Query(...),
    right: str = Query("read"),
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    ctx, err = _load(db, network, x_workspace_token, authorization)
    if err:
        return err
    res, err = _resource_or_err(db, ctx, resource_kind, resource_id)
    if err:
        return err
    right = (right or "read").strip().lower()
    if right not in RIGHTS:
        return json_response(ResponseCode.BAD_REQUEST, f"right must be one of {list(RIGHTS)}")
    ex = explain(db, ctx.viewer, res, right, ctx.wid)
    return success_response({
        **ex.as_dict(),
        "right": right,
        "resource_kind": res.kind,
        "resource_id": res.id,
        "owner": res.owner,
        "visibility": res.visibility,
        "principal": {"kind": ctx.viewer.kind, "email": ctx.viewer.email, "agent_name": ctx.viewer.agent_name},
    })


@router.get("/access/mine")
def my_access(
    network: str = Query(...),
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """The caller's groups and the grants that reach them (directly, via a
    group, or — for an agent — via its owner)."""
    ctx, err = _load(db, network, x_workspace_token, authorization)
    if err:
        return err
    group_ids = principal_group_ids(db, ctx.wid, ctx.viewer)
    groups = []
    if group_ids:
        groups = [{"id": g.id, "name": g.name, "kind": g.kind, "builtin": g.kind != "custom"} for g in db.execute(
            select(SecurityGroup).where(SecurityGroup.id.in_(list(group_ids)))
        ).scalars().all()]
    grants = []
    if not ctx.viewer.machine:
        pairs = _identity_pairs(db, ctx.wid, ctx.viewer)
        grants = [{**serialize_grant(db, ctx.wid, g), "via": g.grantee_kind}
                  for g in grants_for_pairs(db, ctx.wid, pairs)]
    return success_response({
        "principal": {"kind": ctx.viewer.kind, "email": ctx.viewer.email, "agent_name": ctx.viewer.agent_name,
                      "role": ctx.role},
        "groups": groups,
        "grants": grants,
    })


@router.get("/access/candidates")
def access_candidates(
    network: str = Query(...),
    kinds: Optional[str] = Query(None, description="comma-separated subset of human,agent,group"),
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """Everything a grant can target (source for the grantee picker)."""
    ctx, err = _load(db, network, x_workspace_token, authorization)
    if err:
        return err
    wanted = [k.strip() for k in (kinds or "").split(",") if k.strip()] or None
    out = grant_candidates(db, ctx.workspace, kinds=wanted)
    db.commit()  # builtin groups may have been created lazily
    return success_response(out)
