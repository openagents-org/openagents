# -*- coding: utf-8 -*-
"""
Cloud agent CRUD endpoints — add, list, update, remove cloud-based agents.

POST   /v1/cloud-agents              Add a cloud agent
GET    /v1/cloud-agents              List cloud agents in workspace
GET    /v1/cloud-agents/providers    List available providers and models
PATCH  /v1/cloud-agents/{name}       Update cloud agent config
DELETE /v1/cloud-agents/{name}       Remove cloud agent
"""

import logging
import re
from typing import Optional

from fastapi import APIRouter, Depends, Header, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import naming
from app.database import get_db
from app.models import CloudAgentConfig, Workspace, WorkspaceMember
from app.response import ResponseCode, json_response, success_response
from app.routers.network import _resolve_workspace, _verify_workspace_access
from app.services.cloud_providers import providers_catalog, validate_provider_model

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1", tags=["Cloud Agents"])

_AGENT_NAME_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_-]{1,62}[a-zA-Z0-9]$")


def _mask_api_key(key: str) -> str:
    if len(key) <= 8:
        return "****"
    return key[:4] + "..." + key[-4:]


def _format_cloud_agent(cfg: CloudAgentConfig) -> dict:
    return {
        "agentName": cfg.agent_name,
        "provider": cfg.provider,
        "model": cfg.model,
        "category": cfg.category,
        "apiKeyMasked": _mask_api_key(cfg.api_key),
        "baseUrl": cfg.base_url,
        "systemPrompt": cfg.system_prompt,
        "maxTokens": cfg.max_tokens,
        "status": cfg.status,
        "createdAt": cfg.created_at.isoformat() if cfg.created_at else None,
    }


# ---------------------------------------------------------------------------
# GET /v1/cloud-agents/providers
# ---------------------------------------------------------------------------

@router.get("/cloud-agents/providers")
async def list_providers():
    """List available cloud agent providers and their models."""
    return success_response({"providers": providers_catalog()})


# ---------------------------------------------------------------------------
# POST /v1/cloud-agents
# ---------------------------------------------------------------------------

class AddCloudAgentRequest(BaseModel):
    network: str
    agent_name: str
    provider: str
    model: str
    api_key: str
    base_url: Optional[str] = None
    system_prompt: Optional[str] = None
    max_tokens: Optional[int] = None


@router.post("/cloud-agents")
async def add_cloud_agent(
    body: AddCloudAgentRequest,
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """Add a cloud-based agent to the workspace."""
    workspace = _resolve_workspace(db, body.network)
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")

    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid workspace credentials")

    if not _AGENT_NAME_RE.match(body.agent_name):
        return json_response(
            ResponseCode.BAD_REQUEST,
            "Agent name must be 3-64 chars, alphanumeric/hyphen/underscore",
        )

    model_info = validate_provider_model(body.provider, body.model)
    if not model_info:
        return json_response(
            ResponseCode.BAD_REQUEST,
            f"Unknown provider/model: {body.provider}/{body.model}",
        )

    # The built-in "openagents" provider (Yumi) is server-managed: it runs the
    # assistant tool loop and its key is injected at call time, so the user
    # doesn't (and can't) supply one. This is the re-add path after a user
    # removed the built-in agent.
    from app.services.yumi import YUMI_CATEGORY, YUMI_KEY_PLACEHOLDER
    is_builtin = body.provider == "openagents"
    if is_builtin:
        category = YUMI_CATEGORY
        effective_key = YUMI_KEY_PLACEHOLDER
        member_description = "OpenAgents built-in assistant — helps you get started"
    else:
        category = model_info.category
        effective_key = body.api_key
        member_description = f"Cloud agent: {model_info.label} ({body.provider})"

    # Namespace lock BEFORE the membership read: a concurrent create/rename
    # could otherwise invalidate what we read before we write.
    naming.lock_member_namespace(db, workspace.id)

    existing = db.execute(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace.id,
            WorkspaceMember.agent_name == body.agent_name,
        )
    ).scalar_one_or_none()
    if existing and existing.status != "removed":
        return json_response(
            ResponseCode.BAD_REQUEST,
            f"Agent '{body.agent_name}' already exists in this workspace",
        )

    # Names and display-name aliases share one namespace (both are routable in
    # the picker and the LLM router) — reject a new agent whose name matches
    # another member's display_name.
    alias_clash = naming.find_alias_clash(
        db, workspace.id, body.agent_name, exclude_agent=body.agent_name,
    )
    if alias_clash:
        return json_response(
            ResponseCode.BAD_REQUEST,
            f"Agent name '{body.agent_name}' conflicts with the display name "
            f"of member '{alias_clash}'",
        )

    if body.provider == "custom" and not body.base_url:
        return json_response(
            ResponseCode.BAD_REQUEST,
            "Custom provider requires a base_url",
        )

    # Re-adding a previously-removed cloud agent: reactivate the soft-deleted
    # member and refresh its retained CloudAgentConfig rather than failing with
    # "already exists". (issue #347)
    if existing and existing.status == "removed":
        existing.status = "online"
        existing.last_heartbeat = None
        existing.agent_type = f"cloud:{body.provider}"
        existing.description = member_description
        cfg = db.execute(
            select(CloudAgentConfig).where(
                CloudAgentConfig.workspace_id == str(workspace.id),
                CloudAgentConfig.agent_name == body.agent_name,
            )
        ).scalar_one_or_none()
        if cfg is not None:
            cfg.provider = body.provider
            cfg.model = body.model
            cfg.category = category
            cfg.api_key = effective_key
            cfg.base_url = None if is_builtin else body.base_url
            cfg.system_prompt = None if is_builtin else body.system_prompt
            cfg.max_tokens = None if is_builtin else body.max_tokens
            cfg.status = "active"
        db.commit()
        logger.info(
            "cloud_agents: reactivated %s (%s/%s) in workspace %s",
            body.agent_name, body.provider, body.model, workspace.id,
        )
        return success_response(_format_cloud_agent(cfg))

    cfg = CloudAgentConfig(
        workspace_id=str(workspace.id),
        agent_name=body.agent_name,
        provider=body.provider,
        model=body.model,
        category=category,
        api_key=effective_key,
        base_url=None if is_builtin else body.base_url,
        system_prompt=None if is_builtin else body.system_prompt,
        max_tokens=None if is_builtin else body.max_tokens,
    )
    db.add(cfg)

    member = WorkspaceMember(
        workspace_id=str(workspace.id),
        agent_name=body.agent_name,
        role="member",
        agent_type=f"cloud:{body.provider}",
        status="online",
        description=member_description,
    )
    db.add(member)

    db.commit()

    logger.info(
        "cloud_agents: added %s (%s/%s) to workspace %s",
        body.agent_name, body.provider, body.model, workspace.id,
    )

    return success_response(_format_cloud_agent(cfg))


# ---------------------------------------------------------------------------
# GET /v1/cloud-agents
# ---------------------------------------------------------------------------

@router.get("/cloud-agents")
async def list_cloud_agents(
    network: str = Query(..., description="Workspace ID or slug"),
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """List cloud agents in a workspace."""
    workspace = _resolve_workspace(db, network)
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")

    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid workspace credentials")

    configs = db.execute(
        select(CloudAgentConfig).where(
            CloudAgentConfig.workspace_id == str(workspace.id),
        )
    ).scalars().all()

    return success_response({
        "cloud_agents": [_format_cloud_agent(c) for c in configs],
    })


# ---------------------------------------------------------------------------
# PATCH /v1/cloud-agents/{agent_name}
# ---------------------------------------------------------------------------

class UpdateCloudAgentRequest(BaseModel):
    network: str
    model: Optional[str] = None
    api_key: Optional[str] = None
    base_url: Optional[str] = None
    system_prompt: Optional[str] = None
    max_tokens: Optional[int] = None
    status: Optional[str] = None


@router.patch("/cloud-agents/{agent_name}")
async def update_cloud_agent(
    agent_name: str,
    body: UpdateCloudAgentRequest,
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """Update a cloud agent's configuration."""
    workspace = _resolve_workspace(db, body.network)
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")

    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid workspace credentials")

    cfg = db.execute(
        select(CloudAgentConfig).where(
            CloudAgentConfig.workspace_id == str(workspace.id),
            CloudAgentConfig.agent_name == agent_name,
        )
    ).scalar_one_or_none()

    if not cfg:
        return json_response(ResponseCode.NOT_FOUND, "Cloud agent not found")

    if body.model is not None:
        model_info = validate_provider_model(cfg.provider, body.model)
        if not model_info:
            return json_response(
                ResponseCode.BAD_REQUEST,
                f"Unknown model: {body.model} for provider {cfg.provider}",
            )
        cfg.model = body.model
        cfg.category = model_info.category

        member = db.execute(
            select(WorkspaceMember).where(
                WorkspaceMember.workspace_id == workspace.id,
                WorkspaceMember.agent_name == agent_name,
            )
        ).scalar_one_or_none()
        if member:
            member.description = f"Cloud agent: {model_info.label} ({cfg.provider})"

    if body.api_key is not None:
        cfg.api_key = body.api_key

    if body.base_url is not None:
        cfg.base_url = body.base_url or None

    if body.system_prompt is not None:
        cfg.system_prompt = body.system_prompt or None

    if body.max_tokens is not None:
        cfg.max_tokens = body.max_tokens or None

    if body.status is not None and body.status in ("active", "disabled"):
        cfg.status = body.status

    db.commit()

    return success_response(_format_cloud_agent(cfg))


# ---------------------------------------------------------------------------
# DELETE /v1/cloud-agents/{agent_name}
# ---------------------------------------------------------------------------

@router.delete("/cloud-agents/{agent_name}")
async def remove_cloud_agent(
    agent_name: str,
    network: str = Query(..., description="Workspace ID or slug"),
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """Remove a cloud agent from the workspace."""
    workspace = _resolve_workspace(db, network)
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")

    if not _verify_workspace_access(workspace, x_workspace_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid workspace credentials")

    cfg = db.execute(
        select(CloudAgentConfig).where(
            CloudAgentConfig.workspace_id == str(workspace.id),
            CloudAgentConfig.agent_name == agent_name,
        )
    ).scalar_one_or_none()

    if not cfg:
        return json_response(ResponseCode.NOT_FOUND, "Cloud agent not found")

    db.delete(cfg)

    member = db.execute(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace.id,
            WorkspaceMember.agent_name == agent_name,
        )
    ).scalar_one_or_none()
    if member:
        db.delete(member)

    db.commit()

    logger.info("cloud_agents: removed %s from workspace %s", agent_name, workspace.id)

    return success_response({"agentName": agent_name, "status": "removed"})


# ---------------------------------------------------------------------------
# Google OAuth — "Sign in with Google" for Gemini
# ---------------------------------------------------------------------------

import secrets
from urllib.parse import urlencode

from fastapi.responses import RedirectResponse

_GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
_GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
_GOOGLE_SCOPES = "https://www.googleapis.com/auth/generative-language.retriever https://www.googleapis.com/auth/cloud-platform"

_oauth_states: dict[str, dict] = {}


@router.get("/cloud-agents/google/auth")
async def google_oauth_start(
    network: str = Query(...),
    agent_name: str = Query("gemini"),
    model: str = Query("gemini-3.5-flash"),
    # Browsers navigate here via plain href (no way to set headers), so the
    # workspace token may also arrive as a query parameter.
    token: Optional[str] = Query(None),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    """Initiate Google OAuth flow — redirects user to Google consent screen."""
    from app.config import config as app_config

    if not app_config.GOOGLE_OAUTH_CLIENT_ID:
        return json_response(ResponseCode.BAD_REQUEST, "Google OAuth not configured on this server")

    workspace = _resolve_workspace(db, network)
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Network not found")

    # The callback mints a workspace member, so starting the flow requires
    # workspace credentials — a state must never be issued to an anonymous
    # caller (it used to fall back to the workspace's own token).
    caller_token = x_workspace_token or token
    if not _verify_workspace_access(workspace, caller_token, authorization):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid workspace credentials")

    # Same name rule as POST /cloud-agents — validate BEFORE the state is
    # written, since the callback trusts everything stored in it.
    if not _AGENT_NAME_RE.match(agent_name):
        return json_response(
            ResponseCode.BAD_REQUEST,
            "Agent name must be 3-64 chars, alphanumeric/hyphen/underscore",
        )

    state = secrets.token_urlsafe(32)
    _oauth_states[state] = {
        "workspace_id": str(workspace.id),
        "token": caller_token or workspace.password_hash,
        "agent_name": agent_name,
        "model": model,
    }

    params = {
        "client_id": app_config.GOOGLE_OAUTH_CLIENT_ID,
        "redirect_uri": app_config.GOOGLE_OAUTH_REDIRECT_URI,
        "response_type": "code",
        "scope": _GOOGLE_SCOPES,
        "access_type": "offline",
        "prompt": "consent",
        "state": state,
    }
    return RedirectResponse(f"{_GOOGLE_AUTH_URL}?{urlencode(params)}")


@router.get("/cloud-agents/google/callback")
async def google_oauth_callback(
    code: Optional[str] = Query(None),
    state: Optional[str] = Query(None),
    error: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    """Handle Google OAuth callback — exchange code for tokens and create cloud agent."""
    import httpx
    from app.config import config as app_config

    if error:
        return _oauth_error_page(f"Google authorization denied: {error}")

    if not state or state not in _oauth_states:
        return _oauth_error_page("Invalid OAuth state — please try again")

    session = _oauth_states.pop(state)

    try:
        async with httpx.AsyncClient(timeout=30) as http:
            r = await http.post(_GOOGLE_TOKEN_URL, data={
                "code": code,
                "client_id": app_config.GOOGLE_OAUTH_CLIENT_ID,
                "client_secret": app_config.GOOGLE_OAUTH_CLIENT_SECRET,
                "redirect_uri": app_config.GOOGLE_OAUTH_REDIRECT_URI,
                "grant_type": "authorization_code",
            })
            r.raise_for_status()
            tokens = r.json()
    except Exception as exc:
        logger.exception("Google OAuth token exchange failed")
        return _oauth_error_page(f"Token exchange failed: {exc}")

    access_token = tokens.get("access_token", "")
    refresh_token = tokens.get("refresh_token", "")

    workspace_id = session["workspace_id"]
    agent_name = session["agent_name"]
    model = session["model"]

    workspace = db.execute(
        select(Workspace).where(Workspace.id == workspace_id)
    ).scalar_one_or_none()
    if not workspace:
        return _oauth_error_page("Workspace not found")

    # Namespace lock BEFORE the reads, then the guard BEFORE any session
    # mutation — bailing out after a db.add() would leave a pending orphan.
    naming.lock_member_namespace(db, workspace_id)

    existing_cfg = db.execute(
        select(CloudAgentConfig).where(
            CloudAgentConfig.workspace_id == workspace_id,
            CloudAgentConfig.agent_name == agent_name,
        )
    ).scalar_one_or_none()

    existing_member = None
    if not existing_cfg:
        existing_member = db.execute(
            select(WorkspaceMember).where(
                WorkspaceMember.workspace_id == workspace_id,
                WorkspaceMember.agent_name == agent_name,
            )
        ).scalar_one_or_none()
        # An active member of another type (a local daemon agent, say) must
        # not silently gain a cloud config — both runtimes would then answer
        # for the same name. Mirrors the POST /cloud-agents "already exists"
        # rule; a member that IS a Google cloud agent (config lost) is a
        # legitimate repair and passes through.
        if (existing_member and existing_member.status != "removed"
                and (existing_member.agent_type or "") != "cloud:google"):
            logger.warning(
                "cloud_agents: OAuth callback refused agent %s in %s — an "
                "active %s member already owns the name",
                agent_name, workspace_id, existing_member.agent_type,
            )
            return _oauth_error_page(
                f"An agent named '{agent_name}' already exists in this "
                "workspace. Pick a different name and connect again."
            )
        if not existing_member:
            # Same namespace guard as every other member-creating entry point.
            alias_clash = naming.find_alias_clash(
                db, workspace_id, agent_name, exclude_agent=agent_name,
            )
            if alias_clash:
                logger.warning(
                    "cloud_agents: OAuth callback refused agent %s in %s — "
                    "clashes with display name of %s",
                    agent_name, workspace_id, alias_clash,
                )
                return _oauth_error_page(
                    f"The agent name '{agent_name}' conflicts with the display "
                    f"name of member '{alias_clash}'. Remove or rename that "
                    "member, then connect again."
                )

    if existing_cfg:
        existing_cfg.api_key = access_token
        existing_cfg.base_url = f"oauth_refresh:{refresh_token}" if refresh_token else None
        existing_cfg.model = model
    else:
        db.add(CloudAgentConfig(
            workspace_id=workspace_id,
            agent_name=agent_name,
            provider="google",
            model=model,
            category="chat",
            api_key=access_token,
            base_url=f"oauth_refresh:{refresh_token}" if refresh_token else None,
        ))
        if not existing_member:
            db.add(WorkspaceMember(
                workspace_id=workspace_id,
                agent_name=agent_name,
                role="member",
                agent_type="cloud:google",
                status="online",
                description=f"Cloud agent: {model} (Google AI via OAuth)",
            ))

    db.commit()
    logger.info("cloud_agents: Google OAuth completed for %s in workspace %s", agent_name, workspace_id)

    return _oauth_success_page(agent_name)


def _oauth_success_page(agent_name: str):
    from fastapi.responses import HTMLResponse
    return HTMLResponse(f"""<!DOCTYPE html><html><head><title>Connected!</title>
<style>body{{font-family:system-ui;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#f9fafb}}
.card{{text-align:center;padding:2rem;border-radius:12px;border:1px solid #e5e7eb;background:#fff;max-width:400px}}
h2{{margin:0 0 .5rem;font-size:1.25rem}}p{{color:#6b7280;font-size:.875rem;margin:0 0 1rem}}
.btn{{display:inline-block;padding:.5rem 1.5rem;background:#111;color:#fff;border-radius:8px;text-decoration:none;font-size:.875rem}}</style></head>
<body><div class="card"><h2>Gemini Connected</h2>
<p>Cloud agent <strong>@{agent_name}</strong> is now connected via your Google account.</p>
<p style="font-size:.75rem;color:#9ca3af">You can close this window and return to the workspace.</p>
<script>setTimeout(()=>window.close(),3000)</script></div></body></html>""")


def _oauth_error_page(message: str):
    from fastapi.responses import HTMLResponse
    return HTMLResponse(f"""<!DOCTYPE html><html><head><title>Error</title>
<style>body{{font-family:system-ui;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#f9fafb}}
.card{{text-align:center;padding:2rem;border-radius:12px;border:1px solid #fecaca;background:#fff;max-width:400px}}
h2{{margin:0 0 .5rem;font-size:1.25rem;color:#dc2626}}p{{color:#6b7280;font-size:.875rem;margin:0}}</style></head>
<body><div class="card"><h2>Connection Failed</h2><p>{message}</p></div></body></html>""", status_code=400)
