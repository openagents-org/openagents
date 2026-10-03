# -*- coding: utf-8 -*-
"""Security groups (permission model v1.1, spec §4).

    GET    /v1/groups?network=                         any member
    POST   /v1/groups {network, name}                  admin → custom group
    PATCH  /v1/groups/{id} {network, name}             admin (custom only)
    DELETE /v1/groups/{id}?network=&dry_run=1          admin → impact; without dry_run deletes
    GET    /v1/groups/{id}/members?network=            any member
    POST   /v1/groups/{id}/members {network, principal_kind, principal_id}   admin (custom only)
    DELETE /v1/groups/{id}/members/{principal_kind}/{principal_id}?network=  admin (custom only)

The builtins `everyone` and `guest` have DERIVED membership (every
collaborator incl. guests / collaborators with role guest) and are read-only.
"""

import logging
import re
from typing import Optional

from fastapi import APIRouter, Depends, Header, Query
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import ResourceGrant, SecurityGroup, SecurityGroupMember, User, WorkspaceMember
from app.response import ResponseCode, json_response, success_response
from app.routers.sharing import _Ctx, _display_names, _is_workspace_member, _load, _norm
from app.services.access_model import (
    get_or_create_builtin_groups,
    group_members,
    revoke_grant,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1", tags=["groups"])

_MAX_NAME = 80


class GroupCreate(BaseModel):
    network: str
    name: str


class GroupPatch(BaseModel):
    network: str
    name: Optional[str] = None


class GroupMemberAdd(BaseModel):
    network: str
    principal_kind: str
    principal_id: str


def _slugify(name: str) -> str:
    slug = re.sub(r"[^\w\s-]", "", name.lower())
    slug = re.sub(r"[\s_]+", "-", slug).strip("-")
    return slug[:60] or "group"


def _unique_slug(db: Session, workspace_id: str, base: str, exclude_id: Optional[str] = None) -> str:
    slug, n = base, 1
    while True:
        q = select(SecurityGroup.id).where(SecurityGroup.workspace_id == workspace_id, SecurityGroup.slug == slug)
        if exclude_id:
            q = q.where(SecurityGroup.id != exclude_id)
        if db.execute(q).first() is None:
            return slug
        n += 1
        slug = f"{base}-{n}"


def _get_group(db: Session, ctx: _Ctx, group_id: str) -> Optional[SecurityGroup]:
    return db.execute(
        select(SecurityGroup).where(SecurityGroup.workspace_id == ctx.workspace.id, SecurityGroup.id == group_id)
    ).scalar_one_or_none()


def _member_count(db: Session, ctx: _Ctx, group: SecurityGroup) -> int:
    if group.kind == "custom":
        return int(db.execute(
            select(func.count()).select_from(SecurityGroupMember).where(SecurityGroupMember.group_id == group.id)
        ).scalar() or 0)
    return len(group_members(db, ctx.workspace, group))


def _serialize(db: Session, ctx: _Ctx, group: SecurityGroup) -> dict:
    return {
        "id": group.id,
        "name": group.name,
        "slug": group.slug,
        "kind": group.kind,
        "member_count": _member_count(db, ctx, group),
        "builtin": group.kind != "custom",
        "created_by": group.created_by,
        "created_at": group.created_at.isoformat() if group.created_at else None,
    }


def _admin_only(ctx: _Ctx):
    if not ctx.is_admin:
        return json_response(ResponseCode.FORBIDDEN, "Only an admin can manage groups")
    return None


def _valid_name(name: Optional[str]) -> Optional[str]:
    n = (name or "").strip()
    if not n or len(n) > _MAX_NAME:
        return None
    return n


# ---------------------------------------------------------------------------
# Groups
# ---------------------------------------------------------------------------

@router.get("/groups")
def list_groups(
    network: str = Query(...),
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    ctx, err = _load(db, network, x_workspace_token, authorization)
    if err:
        return err
    get_or_create_builtin_groups(db, ctx.wid)
    db.commit()
    groups = db.execute(
        select(SecurityGroup).where(SecurityGroup.workspace_id == ctx.workspace.id)
    ).scalars().all()
    order = {"everyone": 0, "guest": 1, "custom": 2}
    groups.sort(key=lambda g: (order.get(g.kind, 9), (g.name or "").lower()))
    return success_response({"groups": [_serialize(db, ctx, g) for g in groups]})


@router.post("/groups")
def create_group(
    body: GroupCreate,
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    ctx, err = _load(db, body.network, x_workspace_token, authorization)
    if err:
        return err
    err = _admin_only(ctx)
    if err:
        return err
    name = _valid_name(body.name)
    if not name:
        return json_response(ResponseCode.BAD_REQUEST, f"name is required (max {_MAX_NAME} chars)")
    get_or_create_builtin_groups(db, ctx.wid)
    base = _slugify(name)
    if base in ("everyone", "guest"):
        base = f"{base}-group"
    group = SecurityGroup(
        workspace_id=ctx.workspace.id, name=name, slug=_unique_slug(db, ctx.wid, base), kind="custom",
        created_by=ctx.viewer.email or ctx.viewer.label,
    )
    db.add(group)
    db.commit()
    return success_response(_serialize(db, ctx, group))


@router.patch("/groups/{group_id}")
def rename_group(
    group_id: str,
    body: GroupPatch,
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    ctx, err = _load(db, body.network, x_workspace_token, authorization)
    if err:
        return err
    err = _admin_only(ctx)
    if err:
        return err
    group = _get_group(db, ctx, group_id)
    if group is None:
        return json_response(ResponseCode.NOT_FOUND, "Group not found")
    if group.kind != "custom":
        return json_response(ResponseCode.BAD_REQUEST, "Builtin groups cannot be renamed")
    if body.name is not None:
        name = _valid_name(body.name)
        if not name:
            return json_response(ResponseCode.BAD_REQUEST, f"name is required (max {_MAX_NAME} chars)")
        if name != group.name:
            group.name = name
            group.slug = _unique_slug(db, ctx.wid, _slugify(name), exclude_id=group.id)
    db.commit()
    return success_response(_serialize(db, ctx, group))


@router.delete("/groups/{group_id}")
def delete_group(
    group_id: str,
    network: str = Query(...),
    dry_run: int = Query(0),
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """With dry_run=1: the impact (active grants targeting the group, member
    rows). Without: revoke those grants and delete the group."""
    ctx, err = _load(db, network, x_workspace_token, authorization)
    if err:
        return err
    err = _admin_only(ctx)
    if err:
        return err
    group = _get_group(db, ctx, group_id)
    if group is None:
        return json_response(ResponseCode.NOT_FOUND, "Group not found")
    if group.kind != "custom":
        return json_response(ResponseCode.BAD_REQUEST, "Builtin groups cannot be deleted")
    grants = db.execute(
        select(ResourceGrant).where(
            ResourceGrant.workspace_id == ctx.workspace.id,
            ResourceGrant.grantee_kind == "group",
            ResourceGrant.grantee_id == group.id,
            ResourceGrant.revoked_at.is_(None),
        )
    ).scalars().all()
    members = _member_count(db, ctx, group)
    impact = {
        "id": group.id,
        "name": group.name,
        "affected_grants": len(grants),
        "members": members,
        "resources": [{"kind": g.resource_kind, "id": g.resource_id} for g in grants][:50],
    }
    if dry_run:
        return success_response({**impact, "deleted": False})
    by = ctx.viewer.email or ctx.viewer.label
    for g in grants:
        revoke_grant(db, g, by)
    db.execute(SecurityGroupMember.__table__.delete().where(SecurityGroupMember.group_id == group.id))
    db.delete(group)
    db.commit()
    logger.info("groups: %s deleted group %s (%s) in %s", by, group.name, group.id, ctx.wid)
    return success_response({**impact, "deleted": True})


# ---------------------------------------------------------------------------
# Members
# ---------------------------------------------------------------------------

def _decorate_members(db: Session, ctx: _Ctx, rows: list) -> list:
    human_names = _display_names(db, [r["principal_id"] for r in rows if r["principal_kind"] == "human"])
    agent_names = {}
    agents = [r["principal_id"] for r in rows if r["principal_kind"] == "agent"]
    if agents:
        agent_names = dict(db.execute(
            select(WorkspaceMember.agent_name, WorkspaceMember.display_name).where(
                WorkspaceMember.workspace_id == ctx.workspace.id,
                WorkspaceMember.agent_name.in_(agents),
            )
        ).all())
    out = []
    for r in rows:
        if r["principal_kind"] == "human":
            label = human_names.get(r["principal_id"]) or r["principal_id"]
        else:
            label = agent_names.get(r["principal_id"]) or f"@{r['principal_id']}"
        out.append({**r, "display_name": label})
    return out


@router.get("/groups/{group_id}/members")
def list_group_members(
    group_id: str,
    network: str = Query(...),
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    ctx, err = _load(db, network, x_workspace_token, authorization)
    if err:
        return err
    group = _get_group(db, ctx, group_id)
    if group is None:
        return json_response(ResponseCode.NOT_FOUND, "Group not found")
    rows = group_members(db, ctx.workspace, group)
    return success_response({
        "group": {"id": group.id, "name": group.name, "kind": group.kind, "builtin": group.kind != "custom"},
        "members": _decorate_members(db, ctx, rows),
    })


@router.post("/groups/{group_id}/members")
def add_group_member(
    group_id: str,
    body: GroupMemberAdd,
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    ctx, err = _load(db, body.network, x_workspace_token, authorization)
    if err:
        return err
    err = _admin_only(ctx)
    if err:
        return err
    group = _get_group(db, ctx, group_id)
    if group is None:
        return json_response(ResponseCode.NOT_FOUND, "Group not found")
    if group.kind != "custom":
        return json_response(ResponseCode.BAD_REQUEST, "Builtin group membership is derived and cannot be edited")
    kind = (body.principal_kind or "").strip().lower()
    if kind == "human":
        pid = _norm(body.principal_id)
        if not pid or "@" not in pid:
            return json_response(ResponseCode.BAD_REQUEST, "principal_id must be an email")
        if not _is_workspace_member(db, ctx.workspace, pid):
            return json_response(ResponseCode.BAD_REQUEST, "That person is not a member of this workspace")
    elif kind == "agent":
        pid = (body.principal_id or "").strip()
        m = db.execute(
            select(WorkspaceMember.agent_name).where(
                WorkspaceMember.workspace_id == ctx.workspace.id,
                WorkspaceMember.agent_name == pid,
                WorkspaceMember.status != "removed",
            )
        ).first()
        if m is None:
            return json_response(ResponseCode.NOT_FOUND, "Agent not found")
    else:
        return json_response(ResponseCode.BAD_REQUEST, "principal_kind must be 'human' or 'agent'")
    existing = db.execute(
        select(SecurityGroupMember).where(
            SecurityGroupMember.group_id == group.id,
            SecurityGroupMember.principal_kind == kind,
            SecurityGroupMember.principal_id == pid,
        )
    ).scalar_one_or_none()
    if existing is None:
        db.add(SecurityGroupMember(group_id=group.id, principal_kind=kind, principal_id=pid,
                                   added_by=ctx.viewer.email or ctx.viewer.label))
        db.commit()
    return success_response({"added": existing is None, "principal_kind": kind, "principal_id": pid,
                             "member_count": _member_count(db, ctx, group)})


@router.delete("/groups/{group_id}/members/{principal_kind}/{principal_id}")
def remove_group_member(
    group_id: str,
    principal_kind: str,
    principal_id: str,
    network: str = Query(...),
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    ctx, err = _load(db, network, x_workspace_token, authorization)
    if err:
        return err
    err = _admin_only(ctx)
    if err:
        return err
    group = _get_group(db, ctx, group_id)
    if group is None:
        return json_response(ResponseCode.NOT_FOUND, "Group not found")
    if group.kind != "custom":
        return json_response(ResponseCode.BAD_REQUEST, "Builtin group membership is derived and cannot be edited")
    kind = (principal_kind or "").strip().lower()
    pid = _norm(principal_id) if kind == "human" else (principal_id or "").strip()
    row = db.execute(
        select(SecurityGroupMember).where(
            SecurityGroupMember.group_id == group.id,
            SecurityGroupMember.principal_kind == kind,
            SecurityGroupMember.principal_id == pid,
        )
    ).scalar_one_or_none()
    if row is None:
        return json_response(ResponseCode.NOT_FOUND, "Not a member of this group")
    db.delete(row)
    db.commit()
    return success_response({"removed": True, "principal_kind": kind, "principal_id": pid,
                             "member_count": _member_count(db, ctx, group)})
