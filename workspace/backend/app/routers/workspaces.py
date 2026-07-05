# -*- coding: utf-8 -*-
"""
Workspace management endpoints — CRUD for the workspace itself.

These are NOT part of the ONM spec — they manage the product layer
(creating networks, listing user's workspaces, updating settings).

POST   /v1/workspaces              Create a new workspace
GET    /v1/workspaces              List workspaces
GET    /v1/workspaces/{id}         Get workspace details
PATCH  /v1/workspaces/{id}         Update workspace settings
DELETE /v1/workspaces/{id}         Delete workspace
PATCH  /v1/workspaces/{id}/members/{name}  Update agent description/role
"""

import json as _json
import logging
import secrets
import time
import uuid
from datetime import datetime, timezone, timedelta
from typing import Dict, List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.config import config
from app.database import get_db
from app.models import (
    Channel,
    ChannelMember,
    Workspace,
    WorkspaceCollaborator,
    WorkspaceMember,
)
from app.response import ResponseCode, json_response, success_response
from app.routers.network import _workspace_filter

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/workspaces", tags=["Workspaces"])

AGENT_TIMEOUT = timedelta(seconds=config.AGENT_TIMEOUT_SECONDS)


def _extract_bearer(authorization: Optional[str]) -> Optional[str]:
    """Extract bearer token from Authorization header."""
    if authorization and authorization.lower().startswith("bearer "):
        return authorization[7:].strip()
    return None


def _verify_workspace_access(workspace, token: Optional[str], authorization: Optional[str]) -> bool:
    """Check if the caller has access to a workspace via token, bearer owner, or collaborator."""
    if not workspace.password_hash:
        return True
    if token and token == workspace.password_hash:
        return True
    bearer = _extract_bearer(authorization)
    if bearer:
        from app.firebase_auth import verify_firebase_token
        email = verify_firebase_token(bearer)
        if email:
            email_lower = email.lower()
            # Owner check
            if workspace.creator_email and email_lower == workspace.creator_email.lower():
                return True
            # Collaborator check (loaded via selectin)
            if any(c.email == email_lower for c in (workspace.collaborators or [])):
                return True
    return False


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------

class WorkspaceCreateRequest(BaseModel):
    name: str
    agent_name: Optional[str] = None   # Optional — if provided, becomes master member
    agent_type: Optional[str] = None   # "claude", "openclaw", etc.
    creator_email: Optional[str] = None

class ChannelUpdateRequest(BaseModel):
    title: Optional[str] = None
    status: Optional[str] = None
    starred: Optional[bool] = None
    master_agent: Optional[str] = None  # Reassign channel master
    auto_title: bool = False  # When True, title update is from auto-titling (don't mark as manually set)

class WorkspaceUpdateRequest(BaseModel):
    name: Optional[str] = None
    settings: Optional[dict] = None
    status: Optional[str] = None
    # Convenience top-level toggle for the Browser Fabric viewer in clients.
    # Stored inside `settings.browser_enabled` so we don't need a schema
    # migration — but exposed as a typed field so clients don't have to
    # round-trip the whole settings dict to flip one bool.
    browser_enabled: Optional[bool] = None
    browserfabric_api_key: Optional[str] = None

class CollaboratorAddRequest(BaseModel):
    email: str
    role: str = Field(default="editor", pattern=r"^(editor|viewer)$")


class PresencePingRequest(BaseModel):
    senderEmail: str
    senderDisplayName: Optional[str] = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _mask_bf_key(key: str | None) -> str | None:
    if not key:
        return None
    if len(key) > 12:
        return key[:8] + "..." + key[-4:]
    return key[:4] + "..."


def _format_workspace(ws: Workspace, members: list, now: datetime) -> dict:
    agents = []
    for m in members:
        status = m.status
        is_cloud = (m.agent_type or "").startswith("cloud:")
        if not is_cloud and m.last_heartbeat:
            # Ensure timezone-aware comparison (SQLite stores naive datetimes)
            heartbeat = m.last_heartbeat
            if heartbeat.tzinfo is None:
                heartbeat = heartbeat.replace(tzinfo=timezone.utc)
            if (now - heartbeat) > AGENT_TIMEOUT:
                status = "offline"
        agents.append({
            "agentName": m.agent_name,
            "role": m.role,
            "agentType": m.agent_type,
            "status": status,
            "description": m.description,
            "workingDir": m.working_dir,
            "lastHeartbeatAt": m.last_heartbeat.isoformat() if m.last_heartbeat else None,
            "joinedAt": m.joined_at.isoformat() if m.joined_at else None,
        })

    settings = ws.settings or {}
    return {
        "workspaceId": str(ws.id),
        "slug": ws.slug,
        "name": ws.name,
        "creatorEmail": ws.creator_email,
        "settings": settings,
        # Surface browser_enabled at the top level for clients that don't
        # want to dig into the settings dict. Mirrors what's inside settings.
        "browserEnabled": bool(settings.get("browser_enabled", False)),
        "browserfabricApiKey": _mask_bf_key(settings.get("browserfabric_api_key")),
        "status": ws.status,
        "createdAt": ws.created_at.isoformat() if ws.created_at else None,
        "lastActivityAt": ws.last_activity_at.isoformat() if ws.last_activity_at else None,
        "agents": agents,
    }


def _format_channel(ch: Channel) -> dict:
    return {
        "channelId": str(ch.id),
        "workspaceId": str(ch.workspace_id),
        "name": ch.name,
        "title": ch.title,
        "titleManuallySet": bool(ch.title_manually_set),
        "createdBy": ch.created_by,
        "masterAgent": ch.master_agent,
        "resumeFrom": ch.resume_from,
        "status": ch.status,
        "starred": bool(ch.starred),
        "participants": [p.agent_name for p in (ch.participants or [])],
        "createdAt": ch.created_at.isoformat() if ch.created_at else None,
    }


# ---------------------------------------------------------------------------
# POST /v1/workspaces — Create workspace
# ---------------------------------------------------------------------------

@router.post("")
def create_workspace(
    body: WorkspaceCreateRequest,
    db: Session = Depends(get_db),
):
    """Create a new workspace (= ONM network)."""
    # Generate slug and token
    slug = secrets.token_hex(4)
    token = secrets.token_urlsafe(32)

    now = datetime.now(timezone.utc)

    workspace = Workspace(
        slug=slug,
        name=body.name,
        creator_email=body.creator_email,
        password_hash=token,
        settings={},
        status="active",
    )
    db.add(workspace)
    db.flush()

    # Optionally add the creating agent as master member
    if body.agent_name:
        member = WorkspaceMember(
            workspace_id=workspace.id,
            agent_name=body.agent_name,
            role="master",
            agent_type=body.agent_type,
            status="online",
            last_heartbeat=now,
        )
        db.add(member)

    # Seed a default "Session 1" channel ONLY when we know which agent to put in
    # it. An empty channel (no participants) would surface as a thread with no
    # agent — instead, an agent-less workspace starts with zero threads and the
    # user creates their first session via the New Thread dialog (which selects
    # agents). When agent_name is provided (e.g. tests, TUI), the starter
    # channel is created with that agent as master + participant.
    channel = None
    if body.agent_name:
        channel = Channel(
            workspace_id=workspace.id,
            name=f"session-{secrets.token_hex(4)}",
            title="Session 1",
            created_by=body.agent_name,
            master_agent=body.agent_name,
            status="active",
        )
        db.add(channel)
        db.flush()
        db.add(ChannelMember(
            channel_id=channel.id,
            agent_name=body.agent_name,
        ))

    db.commit()
    db.refresh(workspace)

    return success_response({
        "workspaceId": str(workspace.id),
        "slug": workspace.slug,
        "name": workspace.name,
        "token": token,
        "channel": _format_channel(channel) if channel else None,
    })


# ---------------------------------------------------------------------------
# GET /v1/workspaces — List workspaces
# ---------------------------------------------------------------------------

@router.get("")
def list_workspaces(
    creator_email: Optional[str] = Query(None),
    agent_name: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    """List workspaces, optionally filtered by creator or agent membership."""
    query = select(Workspace).where(Workspace.status != "deleted")

    if creator_email:
        query = query.where(Workspace.creator_email == creator_email)

    if agent_name:
        query = query.join(WorkspaceMember).where(
            WorkspaceMember.agent_name == agent_name
        )

    query = query.options(selectinload(Workspace.members))
    workspaces = db.execute(query.order_by(Workspace.last_activity_at.desc())).scalars().all()
    now = datetime.now(timezone.utc)

    results = [_format_workspace(ws, ws.members, now) for ws in workspaces]

    return success_response(results)


# ---------------------------------------------------------------------------
# GET /v1/workspaces/skill-catalog  (static — no auth required)
# Must be defined before /{workspace_id} to avoid path capture.
# ---------------------------------------------------------------------------

@router.get("/skill-catalog")
async def skill_catalog():
    """Return the full skill catalog (public, static data)."""
    from app.skill_catalog import get_catalog
    return success_response(get_catalog())


# ---------------------------------------------------------------------------
# GET /v1/workspaces/{workspace_id} — Get workspace
# ---------------------------------------------------------------------------

@router.get("/{workspace_id}")
def get_workspace(
    workspace_id: str,
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """Get workspace details by ID or slug."""
    workspace = db.execute(
        select(Workspace).where(_workspace_filter(workspace_id))
    ).scalar_one_or_none()

    if not workspace or workspace.status == "deleted":
        return json_response(ResponseCode.NOT_FOUND, "Workspace not found")

    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid workspace credentials")

    members = db.execute(
        select(WorkspaceMember).where(WorkspaceMember.workspace_id == workspace.id)
    ).scalars().all()

    now = datetime.now(timezone.utc)
    return success_response(_format_workspace(workspace, members, now))


# ---------------------------------------------------------------------------
# PATCH /v1/workspaces/{workspace_id} — Update workspace
# ---------------------------------------------------------------------------

@router.patch("/{workspace_id}")
def update_workspace(
    workspace_id: str,
    body: WorkspaceUpdateRequest,
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """Update workspace name, settings, or status."""
    workspace = db.execute(
        select(Workspace).where(_workspace_filter(workspace_id))
    ).scalar_one_or_none()

    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Workspace not found")

    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid workspace credentials")

    if body.name is not None:
        workspace.name = body.name
    if body.settings is not None:
        workspace.settings = body.settings
    if body.browser_enabled is not None:
        current = dict(workspace.settings or {})
        current["browser_enabled"] = body.browser_enabled
        workspace.settings = current
    if body.browserfabric_api_key is not None:
        current = dict(workspace.settings or {})
        if body.browserfabric_api_key == "":
            current.pop("browserfabric_api_key", None)
        else:
            current["browserfabric_api_key"] = body.browserfabric_api_key
        workspace.settings = current
    if body.status is not None:
        workspace.status = body.status

    db.commit()
    db.refresh(workspace)

    members = db.execute(
        select(WorkspaceMember).where(WorkspaceMember.workspace_id == workspace.id)
    ).scalars().all()

    now = datetime.now(timezone.utc)
    return success_response(_format_workspace(workspace, members, now))


# ---------------------------------------------------------------------------
# POST /v1/workspaces/{workspace_id}/claim — Claim workspace ownership
# ---------------------------------------------------------------------------

@router.post("/{workspace_id}/claim")
def claim_workspace(
    workspace_id: str,
    db: Session = Depends(get_db),
    authorization: Optional[str] = Header(None),
):
    """
    Claim ownership of a workspace.

    Requires a valid Firebase bearer token. Sets creator_email on the workspace
    so the user can access it without a workspace token.
    """
    bearer = _extract_bearer(authorization)
    if not bearer:
        return json_response(ResponseCode.UNAUTHORIZED, "Bearer token required")

    from app.firebase_auth import verify_firebase_token
    email = verify_firebase_token(bearer)
    if not email:
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid or expired token")

    workspace = db.execute(
        select(Workspace).where(_workspace_filter(workspace_id))
    ).scalar_one_or_none()

    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Workspace not found")

    if workspace.creator_email and workspace.creator_email != email:
        return json_response(ResponseCode.FORBIDDEN, "Workspace already claimed by another user")

    workspace.creator_email = email
    db.commit()
    db.refresh(workspace)

    members = db.execute(
        select(WorkspaceMember).where(WorkspaceMember.workspace_id == workspace.id)
    ).scalars().all()

    now = datetime.now(timezone.utc)
    return success_response(_format_workspace(workspace, members, now))


# ---------------------------------------------------------------------------
# POST /v1/workspaces/{workspace_id}/rotate-token
# ---------------------------------------------------------------------------

@router.post("/{workspace_id}/rotate-token")
def rotate_token(
    workspace_id: str,
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """Rotate the workspace token. Old token immediately stops working.

    Requires either the current workspace token or Firebase bearer auth
    from the workspace owner.
    """
    workspace = db.execute(
        select(Workspace).where(_workspace_filter(workspace_id))
    ).scalar_one_or_none()

    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Workspace not found")

    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid credentials")

    new_token = secrets.token_urlsafe(32)
    workspace.password_hash = new_token
    db.commit()

    return success_response({
        "workspace_id": str(workspace.id),
        "token": new_token,
    })


# ---------------------------------------------------------------------------
# DELETE /v1/workspaces/{workspace_id}/members/{agent_name}
# ---------------------------------------------------------------------------

@router.delete("/{workspace_id}/members/{agent_name}")
def remove_member(
    workspace_id: str,
    agent_name: str,
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """Remove an agent from a workspace."""
    workspace = db.execute(
        select(Workspace).where(_workspace_filter(workspace_id))
    ).scalar_one_or_none()

    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Workspace not found")

    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid credentials")

    member = db.execute(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace.id,
            WorkspaceMember.agent_name == agent_name,
        )
    ).scalar_one_or_none()

    if not member:
        return json_response(ResponseCode.NOT_FOUND, "Member not found")

    db.delete(member)
    db.commit()

    return success_response({"agent_name": agent_name, "removed": True})


# ---------------------------------------------------------------------------
# PATCH /v1/workspaces/{workspace_id}/members/{agent_name}
# ---------------------------------------------------------------------------

class MemberUpdateRequest(BaseModel):
    description: Optional[str] = None
    role: Optional[str] = None
    enabled_skills: Optional[Dict[str, bool]] = None


@router.patch("/{workspace_id}/members/{agent_name}")
def update_member(
    workspace_id: str,
    agent_name: str,
    body: MemberUpdateRequest,
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """Update an agent's metadata (description, role)."""
    workspace = db.execute(
        select(Workspace).where(_workspace_filter(workspace_id))
    ).scalar_one_or_none()

    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Workspace not found")

    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid credentials")

    member = db.execute(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace.id,
            WorkspaceMember.agent_name == agent_name,
        )
    ).scalar_one_or_none()

    if not member:
        return json_response(ResponseCode.NOT_FOUND, "Member not found")

    if body.description is not None:
        member.description = body.description
    if body.role is not None:
        member.role = body.role
    if body.enabled_skills is not None:
        from app.skill_catalog import get_skill_defaults
        defaults = get_skill_defaults()
        valid = {k: v for k, v in body.enabled_skills.items() if k in defaults}
        member.enabled_skills = valid or None

    db.commit()

    return success_response({
        "agentName": member.agent_name,
        "description": member.description,
        "role": member.role,
        "enabledSkills": member.enabled_skills,
    })


# ---------------------------------------------------------------------------
# POST /v1/workspaces/{workspace_id}/members/{agent_name}/skills/install
# DELETE /v1/workspaces/{workspace_id}/members/{agent_name}/skills/uninstall
# ---------------------------------------------------------------------------

class SkillInstallRequest(BaseModel):
    skill_id: str


class SkillStatusRequest(BaseModel):
    skill_id: str
    state: str  # "installing" | "installed" | "failed" | "uninstalled"
    path: Optional[str] = None
    error: Optional[str] = None
    partial: Optional[bool] = None  # SKILL.md fetched but bundled files missing


_VALID_SKILL_STATES = {"installing", "installed", "failed", "uninstalled"}


def _emit_agent_control_event(db, workspace, agent_name: str, action: str, payload: dict) -> None:
    """Persist a ``workspace.agent.control`` event targeted at one agent and
    publish it to the workspace's Redis pub/sub channel.

    The launcher's per-agent control poller
    (``GET /v1/events?type=workspace.agent.control&target=openagents:<name>``)
    picks this up and dispatches the action to the adapter. We write the
    EventRecord directly — mirroring mod/persistence — rather than running the
    full event pipeline, because the caller has already verified workspace
    access and there is no human/agent source to authenticate.
    """
    from app import cache
    from app.models import EventRecord

    event_id = str(uuid.uuid4())
    timestamp = int(time.time() * 1000)
    full_payload = {"action": action, **(payload or {})}
    record = EventRecord(
        id=event_id,
        network_id=workspace.id,
        type="workspace.agent.control",
        source="human:system",
        target=f"openagents:{agent_name}",
        payload=full_payload,
        metadata_={},
        timestamp=timestamp,
        visibility="direct",
    )
    db.add(record)
    db.flush()

    try:
        snapshot = {
            "id": event_id,
            "type": "workspace.agent.control",
            "source": "human:system",
            "target": f"openagents:{agent_name}",
            "payload": full_payload,
            "metadata": {},
            "timestamp": timestamp,
        }
        cache.publish_event(
            f"ws:{workspace.id}:events",
            _json.dumps(snapshot, default=str, separators=(",", ":")).encode(),
        )
    except Exception:
        # Pub/sub is a fast-path optimization; the poller still finds the
        # persisted event. Never fail the request on a cache hiccup.
        logger.warning("install_skill: failed to publish control event to cache", exc_info=True)


def _set_skill_status(skills_data: dict, skill_id: str, state: str,
                      path: Optional[str] = None, error: Optional[str] = None,
                      partial: Optional[bool] = None) -> dict:
    """Update the per-skill status map inside an ``enabled_skills`` dict.

    Keeps the legacy ``installed`` list in sync (only successfully-installed
    skills appear there, so existing readers keep working) and stores richer
    state under ``skill_status`` for the UI.
    """
    status_map = dict(skills_data.get("skill_status", {}))
    entry = {"state": state, "updated_at": int(time.time() * 1000)}
    if path:
        entry["path"] = path
    if error:
        entry["error"] = error[:2000]
    if partial:
        entry["partial"] = True
    status_map[skill_id] = entry
    skills_data["skill_status"] = status_map

    installed = [s for s in skills_data.get("installed", []) if s != skill_id]
    if state == "installed":
        installed.append(skill_id)
    skills_data["installed"] = installed
    return skills_data


@router.post("/{workspace_id}/members/{agent_name}/skills/install")
async def install_skill(
    workspace_id: str,
    agent_name: str,
    body: SkillInstallRequest,
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """Request installation of a third-party skill for an agent.

    Marks the skill ``installing`` and emits a ``skill.install`` control event
    so the launcher actually installs it into the agent's skills directory.
    The agent reports back via ``/skills/status`` to flip the state to
    ``installed`` or ``failed`` — the skill is NOT marked installed here.
    """
    from app.skill_catalog import find_skill

    workspace = db.execute(
        select(Workspace).where(_workspace_filter(workspace_id))
    ).scalar_one_or_none()
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Workspace not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid credentials")

    member = db.execute(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace.id,
            WorkspaceMember.agent_name == agent_name,
        )
    ).scalar_one_or_none()
    if not member:
        return json_response(ResponseCode.NOT_FOUND, "Member not found")

    skill = find_skill(body.skill_id)
    if not skill:
        return json_response(ResponseCode.NOT_FOUND, f"Unknown skill: {body.skill_id}")

    skills_data = dict(member.enabled_skills or {})
    skills_data = _set_skill_status(skills_data, body.skill_id, "installing")
    member.enabled_skills = skills_data

    # Carry the catalog metadata the launcher needs to fetch the skill.
    _emit_agent_control_event(db, workspace, agent_name, "skill.install", {
        "skill": {
            "id": skill["id"],
            "name": skill.get("name", skill["id"]),
            "description": skill.get("description", ""),
            "source_repo": skill.get("source_repo", ""),
            "source_path": skill.get("source_path", ""),
        },
    })
    db.commit()

    logger.info(
        "install_skill: queued install of '%s' for agent '%s' in workspace %s",
        body.skill_id, agent_name, workspace.id,
    )
    return success_response({
        "agentName": agent_name,
        "skillId": body.skill_id,
        "action": "installing",
        "state": "installing",
        "installedSkills": list(skills_data.get("installed", [])),
        "skillStatus": skills_data.get("skill_status", {}),
    })


@router.post("/{workspace_id}/members/{agent_name}/skills/status")
async def report_skill_status(
    workspace_id: str,
    agent_name: str,
    body: SkillStatusRequest,
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """Launcher → workspace callback reporting skill install progress/result.

    Updates ``enabled_skills.skill_status`` so the Skill Hub UI can render
    installing → installed / failed, and keeps the legacy ``installed`` list
    in sync. Also re-publishes to the SSE channel for instant UI updates.
    """
    if body.state not in _VALID_SKILL_STATES:
        return json_response(ResponseCode.BAD_REQUEST, f"Invalid state: {body.state}")

    workspace = db.execute(
        select(Workspace).where(_workspace_filter(workspace_id))
    ).scalar_one_or_none()
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Workspace not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid credentials")

    member = db.execute(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace.id,
            WorkspaceMember.agent_name == agent_name,
        )
    ).scalar_one_or_none()
    if not member:
        return json_response(ResponseCode.NOT_FOUND, "Member not found")

    skills_data = dict(member.enabled_skills or {})
    if body.state == "uninstalled":
        # Drop the status entry entirely on uninstall.
        status_map = dict(skills_data.get("skill_status", {}))
        status_map.pop(body.skill_id, None)
        skills_data["skill_status"] = status_map
        skills_data["installed"] = [
            s for s in skills_data.get("installed", []) if s != body.skill_id
        ]
    else:
        skills_data = _set_skill_status(
            skills_data, body.skill_id, body.state, body.path, body.error, body.partial
        )
    member.enabled_skills = skills_data
    db.commit()

    if body.state == "failed":
        logger.error(
            "skill install FAILED: skill='%s' agent='%s' workspace=%s error=%s",
            body.skill_id, agent_name, workspace.id, body.error,
        )
    elif body.state == "installed" and body.partial:
        logger.warning(
            "skill installed PARTIALLY (SKILL.md only, bundled files missing): "
            "skill='%s' agent='%s'", body.skill_id, agent_name,
        )
    else:
        logger.info(
            "skill status: skill='%s' agent='%s' state='%s'",
            body.skill_id, agent_name, body.state,
        )

    # Push a lightweight status event so SSE-connected UIs update instantly.
    try:
        from app import cache
        snapshot = {
            "id": str(uuid.uuid4()),
            "type": "workspace.skill.status",
            "source": f"openagents:{agent_name}",
            "target": f"openagents:{agent_name}",
            "payload": {
                "skill_id": body.skill_id,
                "state": body.state,
                "error": body.error,
            },
            "metadata": {},
            "timestamp": int(time.time() * 1000),
        }
        cache.publish_event(
            f"ws:{workspace.id}:events",
            _json.dumps(snapshot, default=str, separators=(",", ":")).encode(),
        )
    except Exception:
        pass

    return success_response({
        "agentName": agent_name,
        "skillId": body.skill_id,
        "state": body.state,
        "installedSkills": list(skills_data.get("installed", [])),
        "skillStatus": skills_data.get("skill_status", {}),
    })


@router.post("/{workspace_id}/members/{agent_name}/skills/uninstall")
async def uninstall_skill(
    workspace_id: str,
    agent_name: str,
    body: SkillInstallRequest,
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """Uninstall a third-party skill from an agent.

    Removes it from the DB immediately (optimistic) and emits a
    ``skill.uninstall`` control event so the launcher deletes the on-disk
    skill directory.
    """
    from app.skill_catalog import find_skill

    workspace = db.execute(
        select(Workspace).where(_workspace_filter(workspace_id))
    ).scalar_one_or_none()
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Workspace not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid credentials")

    member = db.execute(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace.id,
            WorkspaceMember.agent_name == agent_name,
        )
    ).scalar_one_or_none()
    if not member:
        return json_response(ResponseCode.NOT_FOUND, "Member not found")

    skills_data = dict(member.enabled_skills or {})
    installed = [s for s in skills_data.get("installed", []) if s != body.skill_id]
    skills_data["installed"] = installed
    status_map = dict(skills_data.get("skill_status", {}))
    status_map.pop(body.skill_id, None)
    skills_data["skill_status"] = status_map
    member.enabled_skills = skills_data

    skill = find_skill(body.skill_id) or {"id": body.skill_id}
    _emit_agent_control_event(db, workspace, agent_name, "skill.uninstall", {
        "skill": {
            "id": skill["id"],
            "name": skill.get("name", skill["id"]),
            "source_repo": skill.get("source_repo", ""),
            "source_path": skill.get("source_path", ""),
        },
    })
    db.commit()

    return success_response({
        "agentName": agent_name,
        "skillId": body.skill_id,
        "action": "uninstalled",
        "installedSkills": installed,
    })


# ---------------------------------------------------------------------------
# GET /v1/workspaces/{workspace_id}/channels/{channel_name}
# ---------------------------------------------------------------------------

@router.get("/{workspace_id}/channels/{channel_name}")
def get_channel(
    workspace_id: str,
    channel_name: str,
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """Get channel details."""
    workspace = db.execute(
        select(Workspace).where(_workspace_filter(workspace_id))
    ).scalar_one_or_none()
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Workspace not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid credentials")

    channel = db.execute(
        select(Channel).where(
            Channel.workspace_id == workspace.id,
            Channel.name == channel_name,
        )
    ).scalar_one_or_none()
    if not channel:
        return json_response(ResponseCode.NOT_FOUND, "Channel not found")

    return success_response(_format_channel(channel))


# ---------------------------------------------------------------------------
# PATCH /v1/workspaces/{workspace_id}/channels/{channel_name}
# ---------------------------------------------------------------------------

@router.patch("/{workspace_id}/channels/{channel_name}")
def update_channel(
    workspace_id: str,
    channel_name: str,
    body: ChannelUpdateRequest,
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """Update channel title or status."""
    workspace = db.execute(
        select(Workspace).where(_workspace_filter(workspace_id))
    ).scalar_one_or_none()
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Workspace not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid credentials")

    channel = db.execute(
        select(Channel).where(
            Channel.workspace_id == workspace.id,
            Channel.name == channel_name,
        )
    ).scalar_one_or_none()
    if not channel:
        return json_response(ResponseCode.NOT_FOUND, "Channel not found")

    if body.title is not None:
        channel.title = body.title
        if not body.auto_title:
            channel.title_manually_set = True
    if body.status is not None:
        channel.status = body.status
    if body.starred is not None:
        channel.starred = body.starred
    if body.master_agent is not None:
        channel.master_agent = body.master_agent

    db.commit()
    db.refresh(channel)
    return success_response(_format_channel(channel))


# ---------------------------------------------------------------------------
# DELETE /v1/workspaces/{workspace_id} — Delete workspace
# ---------------------------------------------------------------------------

@router.delete("/{workspace_id}")
def delete_workspace(
    workspace_id: str,
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """Soft-delete a workspace (set status to 'deleted'). Requires workspace token or Firebase owner auth."""
    workspace = db.execute(
        select(Workspace).where(_workspace_filter(workspace_id))
    ).scalar_one_or_none()

    if not workspace or workspace.status == "deleted":
        return json_response(ResponseCode.NOT_FOUND, "Workspace not found")

    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid credentials")

    workspace.status = "deleted"
    db.commit()

    return success_response({"workspaceId": str(workspace.id), "status": "deleted"})


# ---------------------------------------------------------------------------
# Collaborator management (email-based sharing)
# ---------------------------------------------------------------------------

def _format_collaborator(c: WorkspaceCollaborator) -> dict:
    return {
        "email": c.email,
        "displayName": c.display_name,
        "role": c.role,
        "addedBy": c.added_by,
        "addedAt": c.added_at.isoformat() if c.added_at else None,
    }


@router.get("/{workspace_id}/collaborators")
def list_collaborators(
    workspace_id: str,
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """List email-based collaborators for a workspace."""
    workspace = db.execute(
        select(Workspace).where(_workspace_filter(workspace_id))
    ).scalar_one_or_none()
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Workspace not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid credentials")

    collabs = [_format_collaborator(c) for c in (workspace.collaborators or [])]
    return success_response({
        "collaborators": collabs,
        "owner": workspace.creator_email,
    })


@router.post("/{workspace_id}/presence")
async def record_presence(
    workspace_id: str,
    body: PresencePingRequest,
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """Self-register the calling human as a workspace collaborator.

    Called by the web/Swift clients on workspace open once the user is
    signed in. The mention picker reads from `workspace_collaborators`,
    so this is what makes a freshly-logged-in human show up in @-picker
    rows without having to post a message first.
    """
    workspace = db.execute(
        select(Workspace).where(_workspace_filter(workspace_id))
    ).scalar_one_or_none()
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Workspace not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid credentials")

    email = (body.senderEmail or "").strip().lower()
    if not email or "@" not in email:
        return json_response(ResponseCode.BAD_REQUEST, "Invalid email address")

    from app.mods.workspace_mod import _upsert_human_collaborator
    _upsert_human_collaborator(
        workspace,
        {"sender_email": email, "sender_display_name": body.senderDisplayName},
        db,
    )
    db.commit()

    existing = db.execute(
        select(WorkspaceCollaborator).where(
            WorkspaceCollaborator.workspace_id == str(workspace.id),
            WorkspaceCollaborator.email == email,
        )
    ).scalar_one_or_none()
    return success_response(_format_collaborator(existing) if existing else {"email": email})


@router.post("/{workspace_id}/collaborators")
def add_collaborator(
    workspace_id: str,
    body: CollaboratorAddRequest,
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """Add an email-based collaborator to a workspace."""
    workspace = db.execute(
        select(Workspace).where(_workspace_filter(workspace_id))
    ).scalar_one_or_none()
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Workspace not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid credentials")

    email = body.email.strip().lower()
    if not email or "@" not in email:
        return json_response(ResponseCode.BAD_REQUEST, "Invalid email address")

    # Can't add the owner as a collaborator
    if workspace.creator_email and email == workspace.creator_email.lower():
        return json_response(ResponseCode.CONFLICT, "This email is already the workspace owner")

    # Determine who is adding (from bearer token if available)
    added_by = None
    bearer = _extract_bearer(authorization)
    if bearer:
        from app.firebase_auth import verify_firebase_token
        added_by = verify_firebase_token(bearer)

    # Upsert: update role if already exists
    existing = db.execute(
        select(WorkspaceCollaborator).where(
            WorkspaceCollaborator.workspace_id == workspace.id,
            WorkspaceCollaborator.email == email,
        )
    ).scalar_one_or_none()

    if existing:
        existing.role = body.role
        db.commit()
        db.refresh(existing)
        return success_response(_format_collaborator(existing))

    collab = WorkspaceCollaborator(
        workspace_id=workspace.id,
        email=email,
        role=body.role,
        added_by=added_by,
    )
    db.add(collab)
    db.commit()
    db.refresh(collab)
    return success_response(_format_collaborator(collab))


@router.delete("/{workspace_id}/collaborators/{email}")
def remove_collaborator(
    workspace_id: str,
    email: str,
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """Remove an email-based collaborator from a workspace."""
    workspace = db.execute(
        select(Workspace).where(_workspace_filter(workspace_id))
    ).scalar_one_or_none()
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Workspace not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid credentials")

    email_lower = email.strip().lower()
    collab = db.execute(
        select(WorkspaceCollaborator).where(
            WorkspaceCollaborator.workspace_id == workspace.id,
            WorkspaceCollaborator.email == email_lower,
        )
    ).scalar_one_or_none()

    if not collab:
        return json_response(ResponseCode.NOT_FOUND, "Collaborator not found")

    db.delete(collab)
    db.commit()
    return success_response({"email": email_lower, "removed": True})
