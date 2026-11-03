# -*- coding: utf-8 -*-
"""
Hosted cloud agents — agents whose runtime Acenta provisions and runs.

GET    /v1/hosted-agents/providers   Provider availability
GET    /v1/hosted-agents             List hosted agents in a workspace
POST   /v1/hosted-agents             Launch a hosted agent
DELETE /v1/hosted-agents/{name}      Remove it and terminate its runtime

Launching mints a dedicated connection (a Node of device_type "hosted") whose
token is handed to Acenta. The runtime joins with that token as a normal
OpenCode agent, so presence comes from real heartbeats; removing the agent
deletes the connection, which revokes the token.
"""

import logging
import secrets
from typing import Optional

from fastapi import APIRouter, Depends, Header, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import naming
from app.access import resolve_current_user
from app.database import get_db
from app.models import HostedAgent, Node, WorkspaceMember
from app.response import ResponseCode, json_response, success_response
from app.routers.network import (
    HOSTED_DEVICE_TYPE,
    _emit_event_blocking,
    _resolve_workspace,
    _verify_workspace_access,
    effective_agent_status,
)
from app.services import hosted_agents as hosting
from app.services.access_model import workspace_human_roles
from openagents.core.onm_events import Event

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1", tags=["Hosted Agents"])

_LAUNCH_ROLES = ("member", "admin", "owner")


def _format(hosted: HostedAgent, member: Optional[WorkspaceMember]) -> dict:
    return {
        "agentName": hosted.agent_name,
        "displayName": hosted.display_name,
        "provider": hosted.provider,
        "status": hosted.status,
        "setupUrl": hosted.setup_url if hosted.status == "setup" else None,
        "presence": effective_agent_status(member) if member else "offline",
        "ownerEmail": hosted.owner_email,
        "createdAt": hosted.created_at.isoformat() if hosted.created_at else None,
    }


@router.get("/hosted-agents/providers")
def list_hosted_providers():
    return success_response({"providers": [hosting.provider_info()]})


@router.get("/hosted-agents")
def list_hosted_agents(
    network: str = Query(..., description="Workspace ID or slug"),
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    workspace = _resolve_workspace(db, network)
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid workspace credentials")

    rows = db.execute(
        select(HostedAgent).where(HostedAgent.workspace_id == str(workspace.id))
        .order_by(HostedAgent.created_at.asc())
    ).scalars().all()
    members = {
        m.agent_name: m for m in db.execute(
            select(WorkspaceMember).where(WorkspaceMember.workspace_id == workspace.id)
        ).scalars().all()
    }
    visible = []
    for hosted in rows:
        if hosted.status == "terminating":
            hosting.schedule_termination(hosted.id)  # retry cleanup Acenta has not confirmed
            continue
        if hosted.status == "setup":
            # The owner may have just returned from Acenta's launch page.
            try:
                result = hosting.status(hosted)
            except hosting.ProviderError as error:
                result = {"state": "terminated"} if error.status == 404 else None
            if result and result.get("state") == "terminated":
                # Checkout was abandoned and Acenta expired the request.
                hosting.release(db, workspace.id, hosted.agent_name)
                member = members.get(hosted.agent_name)
                if member is not None:
                    member.status = "removed"
                db.delete(hosted)
                db.commit()
                continue
            if result:
                hosting.apply_state(hosted, result)
                db.commit()
        if hosted.agent_name:
            visible.append(_format(hosted, members.get(hosted.agent_name)))
    return success_response({"hosted_agents": visible})


class LaunchHostedAgentRequest(BaseModel):
    network: str
    display_name: str
    provider: str = hosting.PROVIDER


@router.post("/hosted-agents")
def launch_hosted_agent(
    body: LaunchHostedAgentRequest,
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    workspace = _resolve_workspace(db, body.network)
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid workspace credentials")
    # A hosted agent is a paid runtime tied to a person's Acenta account, so a
    # machine token can never launch one.
    user = resolve_current_user(db, authorization) if authorization else None
    if user is None:
        return json_response(ResponseCode.UNAUTHORIZED, "Sign in to launch a cloud agent")
    email = user.email.strip().lower()
    if workspace_human_roles(db, workspace).get(email) not in _LAUNCH_ROLES:
        return json_response(ResponseCode.FORBIDDEN, "Only workspace members can launch cloud agents")
    if body.provider != hosting.PROVIDER:
        return json_response(ResponseCode.BAD_REQUEST, f"Unknown hosted provider '{body.provider}'")
    if not hosting.enabled():
        return json_response(ResponseCode.CONFLICT, "Acenta cloud agents are not available yet")
    display_name = body.display_name.strip()
    if not 1 <= len(display_name) <= 60 or naming.has_unsafe_chars(display_name):
        return json_response(ResponseCode.BAD_REQUEST, "Name must be 1-60 characters")

    hosted = HostedAgent(workspace_id=str(workspace.id), provider=hosting.PROVIDER,
                         display_name=display_name, owner_email=email)
    db.add(hosted)
    db.flush()
    node = Node(workspace_id=str(workspace.id), owner_email=email, node_key=f"hosted:{hosted.id}",
                name=f"Acenta · {display_name}", hostname="acenta.ai", device_type=HOSTED_DEVICE_TYPE,
                token=secrets.token_urlsafe(32))
    db.add(node)
    db.flush()
    hosted.node_id = node.id
    db.commit()

    try:
        result = hosting.launch(
            request_key=hosted.id, name=display_name,
            subject=user.firebase_uid or email, email=email, display_name=user.display_name,
            workspace=workspace, token=node.token,
        )
        agent_name, external_id = result["agent_name"], result["id"]
    except (hosting.ProviderError, KeyError, TypeError) as error:
        db.delete(node)
        db.delete(hosted)
        db.commit()
        message = str(error) if isinstance(error, hosting.ProviderError) else "Acenta returned an unexpected response"
        logger.warning("hosted_agents: launch failed in %s: %s", workspace.id, message)
        return json_response(ResponseCode.BAD_REQUEST, message)

    naming.lock_member_namespace(db, workspace.id)
    member = db.execute(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace.id,
            WorkspaceMember.agent_name == agent_name,
        )
    ).scalar_one_or_none()
    # The name is a label only; keep it off when it would shadow another member.
    label = None if naming.find_alias_clash(db, workspace.id, display_name, exclude_agent=agent_name) else display_name
    if member is None:
        # Placeholder until the runtime's first /v1/join; bound to the hosted
        # connection so only that token can join as this agent.
        member = WorkspaceMember(
            workspace_id=str(workspace.id), agent_name=agent_name, display_name=label,
            role="member", agent_type="opencode", node_id=node.id, owner_email=email,
            visibility="personal", status="offline",
            description="Cloud agent hosted on Acenta",
        )
        db.add(member)
    else:
        member.display_name = member.display_name or label
        member.description = member.description or "Cloud agent hosted on Acenta"
    hosted.agent_name = agent_name
    hosted.external_id = external_id
    hosting.apply_state(hosted, result)
    db.commit()
    logger.info("hosted_agents: launched %s (%s) in workspace %s", agent_name, external_id, workspace.id)
    return success_response(_format(hosted, member))


@router.delete("/hosted-agents/{agent_name}")
def remove_hosted_agent(
    agent_name: str,
    network: str = Query(..., description="Workspace ID or slug"),
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    workspace = _resolve_workspace(db, network)
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")
    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid workspace credentials")
    hosted = db.execute(
        select(HostedAgent).where(
            HostedAgent.workspace_id == str(workspace.id),
            HostedAgent.agent_name == agent_name,
            HostedAgent.status != "terminating",
        )
    ).scalar_one_or_none()
    if hosted is None:
        return json_response(ResponseCode.NOT_FOUND, "Hosted agent not found")
    member = db.execute(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace.id,
            WorkspaceMember.agent_name == agent_name,
        )
    ).scalar_one_or_none()
    if member is not None:
        from app.routers.workspaces import _connection_management_error
        denied = _connection_management_error(db, workspace, member, x_workspace_token, authorization)
        if denied is not None:
            return denied
        # The member-removal handler releases the hosted runtime (see workspace_mod).
        _emit_event_blocking(
            Event(type="network.agent.remove", source="human:user", target="core",
                  payload={"agent_name": agent_name}),
            workspace, db, token=workspace.password_hash,
        )
    else:
        hosting.release(db, workspace.id, agent_name)
        db.commit()
    hosting.schedule_termination(hosted.id)
    return success_response({"agentName": agent_name, "status": "removed"})
