# -*- coding: utf-8 -*-
"""Agent profile (v1.1 M3/M4) — availability, specialist profile, shared context.

GET /v1/agents/{agent}/availability   Presence + runtime state with one `reason`
                                      the composer can show ("runtime_offline",
                                      "agent_offline", "busy", "available").
GET /v1/agents/{agent}/profile        Specialist profile for the directory. The
                                      owner / admins / machines see the reviewed
                                      instruction set and allowed knowledge; other
                                      people get a summary. Personal agents the
                                      viewer cannot use are a 404 (not a 403 — the
                                      agent must not be discoverable).
GET /v1/agents/{agent}/shared-context Machine-only. What a run may use when the
                                      request comes from a teammate rather than
                                      the owner: the shared instructions plus the
                                      allowed knowledge with content.

Registered in app/main.py up front so milestone branches never touch main.py.
"""

import logging
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, Header, Path, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import AgentGrant, Channel, KnowledgeEntry, Node, User, WorkspaceMember
from app.response import ResponseCode, json_response, success_response
from app.routers.network import AGENT_TIMEOUT, _resolve_workspace, _verify_workspace_access

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1", tags=["agent_profile"])

SUMMARY_CHARS = 240
SHARED_KNOWLEDGE_CAP = 20_000  # total characters of knowledge content per shared-context response


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _norm(email: Optional[str]) -> Optional[str]:
    e = (email or "").strip().lower()
    return e or None


def _aware(dt: Optional[datetime]) -> Optional[datetime]:
    if dt is None:
        return None
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


def _load_member(db: Session, workspace, agent: str) -> Optional[WorkspaceMember]:
    return db.execute(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace.id,
            WorkspaceMember.agent_name == agent,
            WorkspaceMember.status != "removed",
        )
    ).scalar_one_or_none()


def member_availability(db: Session, member: WorkspaceMember, now: Optional[datetime] = None) -> dict:
    """Same liveness rules as /v1/discover, folded into one `reason`.

    Precedence: a dead runtime explains everything else, then the agent's own
    heartbeat, then whether it is busy. `busy` still means "will answer, later".
    """
    now = now or datetime.now(timezone.utc)
    is_cloud = (member.agent_type or "").startswith("cloud:")

    status = member.status or "offline"
    if not is_cloud and status == "online":
        hb = _aware(member.last_heartbeat)
        if hb is None or (now - hb) > AGENT_TIMEOUT:
            status = "offline"

    runtime_status = None
    runtime_name = None
    if is_cloud:
        runtime_status = "online"
    elif member.node_id:
        node = db.execute(select(Node).where(Node.id == member.node_id)).scalar_one_or_none()
        if node is not None:
            hb = _aware(node.last_heartbeat)
            alive = (node.status == "online") and hb is not None and (now - hb) <= AGENT_TIMEOUT
            runtime_status = "online" if alive else "offline"
            runtime_name = node.name or node.hostname
        else:
            runtime_status = "offline"

    presence_state = member.presence_state
    busy_channels = list(member.busy_channels or [])
    queue_depth = int(member.queue_depth or 0)

    if runtime_status == "offline":
        reason = "runtime_offline"
    elif status != "online":
        reason = "agent_offline"
    elif presence_state == "working" or busy_channels or queue_depth > 0:
        reason = "busy"
    else:
        reason = "available"

    return {
        "status": status,
        "presence_state": presence_state,
        "busy_channels": busy_channels,
        "queue_depth": queue_depth,
        "runtime_status": runtime_status,
        "runtime_name": runtime_name,
        "reason": reason,
    }


def _knowledge_by_slugs(db: Session, workspace_id: str, slugs: List[str]) -> List[KnowledgeEntry]:
    slugs = [s for s in (slugs or []) if isinstance(s, str) and s.strip()]
    if not slugs:
        return []
    rows = db.execute(
        select(KnowledgeEntry).where(
            KnowledgeEntry.workspace_id == str(workspace_id),
            KnowledgeEntry.slug.in_(slugs),
            KnowledgeEntry.status == "active",
        )
    ).scalars().all()
    by_slug = {r.slug: r for r in rows}
    return [by_slug[s] for s in slugs if s in by_slug]


def _knowledge_content(entry: KnowledgeEntry) -> str:
    if not entry.storage_key:
        return ""
    from app.storage import get_file_store
    try:
        return get_file_store().read(entry.storage_key).decode("utf-8")
    except Exception as e:  # missing blob, storage hiccup — never fail the run
        logger.warning("agent_profile: could not read knowledge %s: %s", entry.slug, e)
        return ""


def _owner_display_name(db: Session, email: Optional[str]) -> Optional[str]:
    email = _norm(email)
    if not email:
        return None
    user = db.execute(select(User).where(func.lower(User.email) == email)).scalar_one_or_none()
    return (user.display_name if user and user.display_name else None)


def _grant_count(db: Session, workspace_id: str, agent: str) -> int:
    return int(db.execute(
        select(func.count()).select_from(AgentGrant).where(
            AgentGrant.workspace_id == str(workspace_id),
            AgentGrant.agent_name == agent,
            AgentGrant.revoked_at.is_(None),
        )
    ).scalar() or 0)


def _resolve(db, network, agent, x_workspace_token, authorization):
    """Common prelude: workspace → access → viewer → member (visibility-aware).
    Returns (workspace, viewer, member, error_response)."""
    from app.services.visibility import can_use_agent, resolve_viewer
    workspace = _resolve_workspace(db, network)
    if not workspace:
        return None, None, None, json_response(ResponseCode.NOT_FOUND, "Network not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return None, None, None, json_response(ResponseCode.UNAUTHORIZED, "Invalid workspace credentials")
    viewer = resolve_viewer(db, workspace, x_workspace_token, authorization)
    member = _load_member(db, workspace, agent)
    # A personal agent the viewer may not use does not exist for them.
    if member is None or not can_use_agent(db, str(workspace.id), viewer, member):
        return workspace, viewer, None, json_response(ResponseCode.NOT_FOUND, "Agent not found")
    return workspace, viewer, member, None


# ---------------------------------------------------------------------------
# GET /v1/agents/{agent}/availability
# ---------------------------------------------------------------------------

@router.get("/agents/{agent}/availability")
def agent_availability(
    agent: str = Path(...),
    network: str = Query(..., description="Workspace ID or slug"),
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    _, _, member, err = _resolve(db, network, agent, x_workspace_token, authorization)
    if err is not None:
        return err
    return success_response(member_availability(db, member))


# ---------------------------------------------------------------------------
# GET /v1/agents/{agent}/profile
# ---------------------------------------------------------------------------

@router.get("/agents/{agent}/profile")
def agent_profile(
    agent: str = Path(...),
    network: str = Query(..., description="Workspace ID or slug"),
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    from app.access import resolve_user_role, role_at_least
    from app.services.visibility import is_agent_owner

    workspace, viewer, member, err = _resolve(db, network, agent, x_workspace_token, authorization)
    if err is not None:
        return err

    if viewer.machine:
        can_manage = True
    else:
        role = resolve_user_role(db, workspace, authorization)
        can_manage = role_at_least(role, "admin") or is_agent_owner(viewer, member)

    knowledge = _knowledge_by_slugs(db, workspace.id, member.allowed_knowledge or [])
    profile = {
        "agent_name": member.agent_name,
        "display_name": member.display_name,
        "agent_type": member.agent_type,
        "owner_email": _norm(member.owner_email),
        "owner_display_name": _owner_display_name(db, member.owner_email),
        "visibility": member.visibility or "team",
        "purpose": member.purpose,
        "example_requests": list(member.example_requests or []),
        "required_inputs": member.required_inputs,
        "cost_owner": member.cost_owner,
        "grant_count": _grant_count(db, workspace.id, member.agent_name),
        "availability": member_availability(db, member),
        "can_manage": bool(can_manage),
    }
    if can_manage:
        profile["shared_instructions"] = member.shared_instructions
        profile["allowed_knowledge"] = [{"slug": k.slug, "title": k.title} for k in knowledge]
    else:
        text = (member.shared_instructions or "").strip()
        profile["shared_instructions_summary"] = text[:SUMMARY_CHARS] if text else None
        profile["allowed_knowledge_count"] = len(knowledge)
    return success_response(profile)


# ---------------------------------------------------------------------------
# GET /v1/agents/{agent}/shared-context
# ---------------------------------------------------------------------------

@router.get("/agents/{agent}/shared-context")
def agent_shared_context(
    agent: str = Path(...),
    network: str = Query(..., description="Workspace ID or slug"),
    requester_email: Optional[str] = Query(None, description="The person whose message triggered this run"),
    channel: Optional[str] = Query(None, description="The thread the run happens in"),
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """What the agent's own run may use for a request that is not its owner's.

    `apply` is true when the agent has an owner and either the requester is
    someone else or the thread is directed by someone else. The connector
    then prepends the shared instructions + allowed knowledge to the prompt
    and tells the agent to stay inside them.
    """
    from app.services.visibility import is_machine_caller

    workspace = _resolve_workspace(db, network)
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")
    if not is_machine_caller(workspace, x_workspace_token):
        return json_response(ResponseCode.FORBIDDEN, "shared-context is for the agent runtime (workspace token) only")

    member = _load_member(db, workspace, agent)
    if member is None:
        return json_response(ResponseCode.NOT_FOUND, "Agent not found")

    owner = _norm(member.owner_email)
    requester = _norm(requester_email)
    director = None
    if channel:
        ch = db.execute(
            select(Channel).where(Channel.workspace_id == workspace.id, Channel.name == channel)
        ).scalar_one_or_none()
        if ch is not None:
            director = _norm(ch.director_email)

    apply = bool(owner) and (
        (requester is not None and requester != owner)
        or (director is not None and director != owner)
    )

    result = {
        "apply": apply,
        "owner_email": owner,
        "requester_email": requester,
        "director_email": director,
        "shared_instructions": member.shared_instructions if apply else None,
        "allowed_knowledge": [],
        "cost_owner": member.cost_owner,
    }
    if apply:
        budget = SHARED_KNOWLEDGE_CAP
        for entry in _knowledge_by_slugs(db, workspace.id, member.allowed_knowledge or []):
            content = _knowledge_content(entry)
            truncated = False
            if len(content) > budget:
                content = content[:max(0, budget)]
                truncated = True
            budget -= len(content)
            item = {"slug": entry.slug, "title": entry.title, "content": content}
            if truncated:
                item["truncated"] = True
            result["allowed_knowledge"].append(item)
            if budget <= 0:
                break
    return success_response(result)
