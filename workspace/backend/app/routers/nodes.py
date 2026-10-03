# -*- coding: utf-8 -*-
"""
Device endpoints — a device (formerly "node") running the launcher daemon,
connected to a workspace. Served under /v1/devices/* (product wording) and the
legacy /v1/nodes/* alias; the device owner — the human who paired it — is the
only person who controls it (permission model v1.1 §4).

Onboarding flow ("connect a device"):
  1. Owner/admin generates a pairing code in the workspace
     (POST /v1/workspaces/{id}/pairing-codes — see routers/workspaces.py).
  2. The launcher redeems it here (POST /v1/nodes/redeem) → registers a Node and
     receives the workspace token, without the user copy-pasting id + token.
  3. The daemon heartbeats the node (POST /v1/nodes/heartbeat), independent of
     any agent, so the workspace shows the device as connected.
  4. The workspace lists nodes (GET /v1/nodes) with live status.
"""

import logging
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Header, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.access import resolve_current_user, resolve_user_role, role_at_least, verify_workspace_access
from app.config import config
from app.database import get_db
from app.models import Node, NodeCommand, NodePairingCode, Workspace
from app.response import ResponseCode, json_response, success_response
from app.routers.network import _workspace_filter

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/nodes", tags=["Nodes"])

# Permission model v1.1: "node" is called a "device" in the product. Every
# handler below is registered on BOTH prefixes (same function, no duplicated
# logic) so /v1/devices/... is a strict alias of /v1/nodes/... and responses
# carry `device_id` next to the legacy `nodeId`. main.py includes
# `devices_router` AFTER routers/devices.py (push registration, which owns the
# literal /v1/devices/register + /test-push paths) so those keep winning.
devices_router = APIRouter(prefix="/v1/devices", tags=["Devices"])


def _both(method: str, path: str, **kwargs):
    """Register one handler under /v1/nodes AND /v1/devices."""
    def deco(fn):
        for r in (router, devices_router):
            getattr(r, method)(path, **kwargs)(fn)
        return fn
    return deco

NODE_TIMEOUT = timedelta(seconds=config.AGENT_TIMEOUT_SECONDS)

# Pairing codes: 8 chars, no ambiguous glyphs (0/O/1/I/L), shown as XXXX-XXXX.
_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
_CODE_LEN = 8
PAIRING_TTL = timedelta(minutes=30)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def generate_pairing_code() -> str:
    """A fresh normalized (no-dash) pairing code."""
    return "".join(secrets.choice(_CODE_ALPHABET) for _ in range(_CODE_LEN))


def format_pairing_code(code: str) -> str:
    """Human-facing form: XXXX-XXXX."""
    c = normalize_pairing_code(code)
    return f"{c[:4]}-{c[4:]}" if len(c) == _CODE_LEN else c


def normalize_pairing_code(code: str) -> str:
    """Uppercase and strip separators so 'xxxx-xxxx' == 'XXXXXXXX'."""
    return "".join(ch for ch in (code or "").upper() if ch.isalnum())


def _aware(dt: Optional[datetime]) -> Optional[datetime]:
    """SQLite returns naive datetimes; treat them as UTC for comparison."""
    if dt is not None and dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def _machine_token_ok(token, workspace, node) -> bool:
    """Node endpoints accept the shared workspace token (legacy) or the
    node's own per-node token — never another node's."""
    if not token:
        return False
    if workspace.password_hash and token == workspace.password_hash:
        return True
    return bool(node is not None and node.token and token == node.token)


def _owner_emails(db: Session, node_ids) -> dict:
    """Device owner = the human who paired it (permission model v1.1 §4).

    Nothing is persisted on the Node row: ownership is derived from the pairing
    code that was redeemed for it — `NodePairingCode.created_by` is the email of
    the person who minted the code and `node_id` is set on redeem. The most
    recent redeem BY A PERSON wins, so re-pairing from another account transfers
    the device while a token-minted code (created_by NULL — scripts, CI) never
    strips an owner. Devices with no human pairer at all have no owner and fall
    back to the legacy owner/admin rule. Returns {node_id: email}.
    """
    ids = [str(i) for i in node_ids if i]
    if not ids:
        return {}
    rows = db.execute(
        select(NodePairingCode.node_id, NodePairingCode.created_by)
        .where(
            NodePairingCode.node_id.in_(ids),
            NodePairingCode.redeemed_at.isnot(None),
            NodePairingCode.created_by.isnot(None),
        )
        .order_by(NodePairingCode.redeemed_at.asc())
    ).all()
    out: dict = {}
    for node_id, email in rows:          # ascending → the latest overwrites
        email = (email or "").strip().lower()
        if email:
            out[str(node_id)] = email
    return out


def _device_owner_email(db: Session, node: Node) -> Optional[str]:
    return _owner_emails(db, [node.id]).get(str(node.id))


def _is_owner(user, owner_email: Optional[str]) -> bool:
    """True when the signed-in `user` is the human who paired the device."""
    return bool(user and owner_email and (user.email or "").strip().lower() == owner_email)


def _format_node(node: Node, now: datetime, owner_email: Optional[str] = None) -> dict:
    status = node.status
    hb = _aware(node.last_heartbeat)
    if hb is None or (now - hb) > NODE_TIMEOUT:
        status = "offline"
    return {
        "nodeId": str(node.id),
        "device_id": str(node.id),
        "name": node.name or node.hostname,
        "hostname": node.hostname,
        "deviceType": node.device_type or "unknown",
        "ownerEmail": owner_email,
        "os": node.os,
        "launcherVersion": node.launcher_version,
        "status": status,
        "agents": node.agents or [],
        "runtimes": node.runtimes or [],
        "fs": node.fs or {},
        "lastHeartbeatAt": node.last_heartbeat.isoformat() if node.last_heartbeat else None,
        "createdAt": node.created_at.isoformat() if node.created_at else None,
    }


# Remote agent-management actions the daemon knows how to execute.
ALLOWED_COMMAND_ACTIONS = {"create_agent", "configure_agent", "start_agent", "stop_agent", "remove_agent", "detect_runtimes", "list_dir", "probe_agent", "list_models"}
# Actions that operate on a single named agent (so the enqueue endpoint requires
# a name). `detect_runtimes` / `list_dir` are node-wide and take no agent;
# `probe_agent` smoke-tests a runtime and accepts either a type or a name.
# `list_models` asks the endpoint an agent is configured for which models it
# serves, with the key that stays on the device.
AGENT_SCOPED_ACTIONS = {"create_agent", "configure_agent", "start_agent", "stop_agent", "remove_agent", "list_models"}


def _format_command(cmd: NodeCommand, *, include_args: bool = False) -> dict:
    out = {
        "commandId": str(cmd.id),
        "action": cmd.action,
        "status": cmd.status,
        "result": cmd.result,
        "agentName": (cmd.command or {}).get("name") if cmd.command else None,
        "createdAt": cmd.created_at.isoformat() if cmd.created_at else None,
        "finishedAt": cmd.finished_at.isoformat() if cmd.finished_at else None,
    }
    if include_args:
        # Only the daemon (machine-authenticated) receives raw args, which may
        # carry an API key for the agent being created.
        out["args"] = cmd.command or {}
    return out


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------

class NodeRedeemRequest(BaseModel):
    code: str
    node_key: str                       # stable device id generated by the launcher
    name: Optional[str] = None
    hostname: Optional[str] = None
    device_type: Optional[str] = None   # server | laptop | desktop | unknown
    os: Optional[str] = None
    launcher_version: Optional[str] = None


class NodeHeartbeatRequest(BaseModel):
    node_id: str
    hostname: Optional[str] = None
    device_type: Optional[str] = None
    os: Optional[str] = None
    launcher_version: Optional[str] = None
    agents: Optional[list] = None       # current roster [{name, type, status}]
    runtimes: Optional[list] = None     # per-type detection [{type, installed, ready, ...}]
    fs: Optional[dict] = None           # {home, dirs:[...], roots:[...]} for the working-dir picker


class EnqueueCommandRequest(BaseModel):
    action: str                         # see ALLOWED_COMMAND_ACTIONS
    args: dict = {}                     # create_agent: {name, type, apiKey?, model?, baseUrl?}


class CommandResultRequest(BaseModel):
    ok: bool
    message: Optional[str] = None
    data: Optional[dict] = None


# ---------------------------------------------------------------------------
# POST /v1/nodes/redeem — pair this device to a workspace
# ---------------------------------------------------------------------------

@_both("post", "/redeem")
def redeem_pairing_code(body: NodeRedeemRequest, db: Session = Depends(get_db)):
    """Redeem a pairing code (the code itself is the credential — no auth header).

    Registers/updates the Node and returns the workspace token so the launcher
    can heartbeat and run agents. Codes are single-use and short-lived.
    """
    code = normalize_pairing_code(body.code)
    if not body.node_key:
        return json_response(ResponseCode.BAD_REQUEST, "Missing node_key")

    pc = db.get(NodePairingCode, code)
    if not pc:
        return json_response(ResponseCode.NOT_FOUND, "Invalid pairing code")
    if pc.redeemed_at is not None:
        return json_response(ResponseCode.CONFLICT, "Pairing code already used")
    now = _now()
    if _aware(pc.expires_at) < now:
        return json_response(ResponseCode.GONE, "Pairing code expired")

    workspace = db.execute(
        select(Workspace).where(Workspace.id == pc.workspace_id)
    ).scalar_one_or_none()
    if not workspace or workspace.status == "deleted":
        return json_response(ResponseCode.NOT_FOUND, "Workspace not found")

    node = db.execute(
        select(Node).where(Node.workspace_id == workspace.id, Node.node_key == body.node_key)
    ).scalar_one_or_none()
    if node is None:
        node = Node(workspace_id=workspace.id, node_key=body.node_key)
        db.add(node)
    node.name = body.name or body.hostname or node.name
    node.hostname = body.hostname or node.hostname
    node.device_type = body.device_type or node.device_type or "unknown"
    node.os = body.os or node.os
    node.launcher_version = body.launcher_version or node.launcher_version
    node.status = "online"
    node.last_heartbeat = now
    db.flush()

    pc.redeemed_at = now
    pc.node_id = node.id
    db.commit()

    # Per-node machine credential: minted once, REUSED on re-pair so running
    # agents never blip (redeem upserts the Node by workspace_id+node_key).
    # Deleting the node row is real revocation. Legacy launchers use this
    # token exactly like they used the shared workspace token — every
    # acceptance point takes both (see app.access).
    if not node.token:
        node.token = secrets.token_urlsafe(32)
        db.commit()

    return success_response({
        "nodeId": str(node.id),
        "device_id": str(node.id),
        "workspaceId": str(workspace.id),
        "workspaceSlug": workspace.slug,
        "workspaceName": workspace.name,
        "token": node.token,
    })


# ---------------------------------------------------------------------------
# POST /v1/nodes/heartbeat — node liveness (authenticated by the workspace token)
# ---------------------------------------------------------------------------

@_both("post", "/heartbeat")
def node_heartbeat(
    body: NodeHeartbeatRequest,
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
):
    node = db.execute(select(Node).where(Node.id == body.node_id)).scalar_one_or_none()
    if not node:
        return json_response(ResponseCode.NOT_FOUND, "Node not found")

    workspace = db.execute(
        select(Workspace).where(Workspace.id == node.workspace_id)
    ).scalar_one_or_none()
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Workspace not found")

    # Machine credential: the shared workspace token, or this node's own.
    if not _machine_token_ok(x_workspace_token, workspace, node):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid workspace token")

    now = _now()
    node.last_heartbeat = now
    node.status = "online"
    if body.hostname:
        node.hostname = body.hostname
    if body.device_type:
        node.device_type = body.device_type
    if body.os:
        node.os = body.os
    if body.launcher_version:
        node.launcher_version = body.launcher_version
    if body.agents is not None:
        node.agents = body.agents
    if body.runtimes is not None:
        node.runtimes = body.runtimes
    if body.fs is not None:
        node.fs = body.fs

    # Deliver any queued remote commands on this heartbeat (the node isn't
    # directly reachable, so the heartbeat is our push channel). Mark them
    # delivered so they aren't handed out twice.
    pending = db.execute(
        select(NodeCommand)
        .where(NodeCommand.node_id == node.id, NodeCommand.status == "pending")
        .order_by(NodeCommand.created_at.asc())
    ).scalars().all()
    for cmd in pending:
        cmd.status = "running"
        cmd.delivered_at = now
    db.commit()

    return success_response({
        "nodeId": str(node.id),
        "device_id": str(node.id),
        "status": "online",
        "commands": [_format_command(c, include_args=True) for c in pending],
    })


# ---------------------------------------------------------------------------
# GET /v1/nodes?network=... — list a workspace's nodes (for the UI)
# ---------------------------------------------------------------------------

@_both("get", "")
def list_nodes(
    network: str = Query(..., description="Workspace ID or slug"),
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    workspace = db.execute(
        select(Workspace).where(_workspace_filter(network))
    ).scalar_one_or_none()
    if not workspace or workspace.status == "deleted":
        return json_response(ResponseCode.NOT_FOUND, "Workspace not found")
    if not verify_workspace_access(workspace, x_workspace_token, authorization, db=db):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid workspace credentials")

    nodes = db.execute(
        select(Node).where(Node.workspace_id == workspace.id).order_by(Node.created_at.asc())
    ).scalars().all()
    now = _now()
    owners = _owner_emails(db, [n.id for n in nodes])
    return success_response([_format_node(n, now, owners.get(str(n.id))) for n in nodes])


# ---------------------------------------------------------------------------
# DELETE /v1/nodes/{node_id} — unpair/forget a node (owner/admin)
# ---------------------------------------------------------------------------

@_both("delete", "/{node_id}")
def delete_node(
    node_id: str,
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """Remove a device from the workspace. Its queued commands cascade-delete.

    Allowed for the device owner (the human who paired it), an admin/owner of
    the workspace (unpair is the one admin control over someone else's device),
    or the machine token. Useful for a device that's gone (offline /
    disconnected). If the daemon is still running there, it will re-register on
    its next heartbeat — the user should stop it (`agn down`) / disconnect
    before removing.
    """
    node = db.execute(select(Node).where(Node.id == node_id)).scalar_one_or_none()
    if not node:
        return json_response(ResponseCode.NOT_FOUND, "Device not found")
    workspace = db.execute(
        select(Workspace).where(Workspace.id == node.workspace_id)
    ).scalar_one_or_none()
    if not workspace or workspace.status == "deleted":
        return json_response(ResponseCode.NOT_FOUND, "Workspace not found")
    # A signed-in person is judged by identity even though the web client also
    # sends the shared workspace token; token-only callers (scripts, the device
    # itself) keep the machine rule.
    user = resolve_current_user(db, authorization)
    if user is not None:
        allowed = _is_owner(user, _device_owner_email(db, node)) or role_at_least(
            resolve_user_role(db, workspace, authorization), "admin"
        )
    else:
        allowed = verify_workspace_access(workspace, x_workspace_token, authorization, db=db, min_role="admin")
    if not allowed:
        return json_response(
            ResponseCode.FORBIDDEN,
            "Only the person who connected this device, or a workspace admin, can remove it",
        )

    db.delete(node)
    db.commit()
    return success_response({"nodeId": node_id, "device_id": node_id, "removed": True})


# ---------------------------------------------------------------------------
# Remote agent management — commands queued for a node's daemon
# ---------------------------------------------------------------------------

@_both("post", "/{node_id}/commands")
def enqueue_command(
    node_id: str,
    body: EnqueueCommandRequest,
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """Queue a remote agent-management command for a device.

    Only the device owner (the human who paired it) or the device's own machine
    token may control it — not other members, and not admins (they can only
    unpair, see DELETE). Devices with no recorded human pairer (code minted with
    the workspace token) keep the legacy owner/admin rule so scripts and older
    pairings do not regress. The daemon receives the command on its next
    heartbeat and runs it locally.
    """
    action = (body.action or "").strip()
    if action not in ALLOWED_COMMAND_ACTIONS:
        return json_response(ResponseCode.BAD_REQUEST, f"Unknown action '{action}'")

    node = db.execute(select(Node).where(Node.id == node_id)).scalar_one_or_none()
    if not node:
        return json_response(ResponseCode.NOT_FOUND, "Node not found")
    workspace = db.execute(
        select(Workspace).where(Workspace.id == node.workspace_id)
    ).scalar_one_or_none()
    if not workspace or workspace.status == "deleted":
        return json_response(ResponseCode.NOT_FOUND, "Workspace not found")
    owner = _device_owner_email(db, node)
    user = resolve_current_user(db, authorization)
    if user is not None:
        # Signed-in person: identity wins even though the web client also sends
        # the shared workspace token (otherwise every member could drive every
        # device). Admins are NOT exempt — they may only unpair (DELETE).
        if owner:
            if not _is_owner(user, owner):
                return json_response(
                    ResponseCode.FORBIDDEN,
                    f"Only the person who connected this device ({owner}) can manage its agents",
                )
        elif not role_at_least(resolve_user_role(db, workspace, authorization), "admin"):
            return json_response(ResponseCode.FORBIDDEN, "Only an owner or admin can manage this device's agents")
    elif not _machine_token_ok(x_workspace_token, workspace, node):
        # No identity: the device's own token (or the legacy shared token) only.
        if owner or not verify_workspace_access(workspace, x_workspace_token, authorization, db=db, min_role="admin"):
            return json_response(
                ResponseCode.FORBIDDEN,
                "Only the person who connected this device, or the device itself, can manage its agents",
            )

    args = dict(body.args or {})
    if action in AGENT_SCOPED_ACTIONS:
        if not (args.get("name") or "").strip():
            return json_response(ResponseCode.BAD_REQUEST, "Missing agent name")
        if action == "create_agent" and not (args.get("type") or "").strip():
            return json_response(ResponseCode.BAD_REQUEST, "Missing agent type")
    if action == "probe_agent" and not (
        (args.get("type") or "").strip() or (args.get("name") or "").strip()
    ):
        return json_response(ResponseCode.BAD_REQUEST, "Missing agent type or name")

    # A saved Model access entry can stand in for raw credentials: the browser
    # sends its id and the key/base URL are resolved here, server-side.
    access_id = (args.pop("modelAccessId", "") or "").strip()
    if access_id:
        from app.models import ModelAccess
        entry = db.execute(
            select(ModelAccess).where(
                ModelAccess.id == access_id,
                ModelAccess.workspace_id == str(workspace.id),
            )
        ).scalar_one_or_none()
        if not entry:
            return json_response(ResponseCode.NOT_FOUND, "Model access not found")
        args.setdefault("apiKey", entry.api_key)
        # The base URL to hand the daemon depends on the AGENT's wire protocol,
        # not just the provider: Claude-family CLIs speak the Anthropic
        # protocol natively, everything else is OpenAI-compatible.
        from app.services import agent_registry
        agent_type = (args.get("type") or "").strip()
        detail = agent_registry.get_agent(agent_type) if agent_type else None
        protocol = (detail or {}).get("protocol") or "openai"

        base_url = entry.base_url
        if protocol == "anthropic":
            # Native Anthropic key → no override (the CLI's default endpoint);
            # a relay entry carries its own base_url and passes through as-is.
            if entry.provider not in ("anthropic", "custom", "custom-anthropic"):
                return json_response(
                    ResponseCode.BAD_REQUEST,
                    f"'{entry.label}' ({entry.provider}) can't drive a {agent_type} agent — "
                    "use an Anthropic key or an Anthropic-compatible endpoint",
                )
        elif entry.provider == "custom-anthropic":
            # Anthropic wire format can't drive an OpenAI-protocol agent.
            return json_response(
                ResponseCode.BAD_REQUEST,
                f"'{entry.label}' is an Anthropic-compatible endpoint and can't drive "
                f"a {agent_type} agent — pick an OpenAI-compatible access instead",
            )
        elif not base_url:
            if entry.provider == "anthropic":
                # Route Anthropic keys through Anthropic's OpenAI-compat endpoint.
                base_url = "https://api.anthropic.com/v1/"
            else:
                from app.services.cloud_providers import PROVIDERS
                prov = PROVIDERS.get(entry.provider)
                base_url = prov.base_url if prov else None  # None → provider SDK default (OpenAI)
        if base_url:
            args.setdefault("baseUrl", base_url)

    creator = resolve_current_user(db, authorization)
    cmd = NodeCommand(
        node_id=node.id,
        workspace_id=workspace.id,
        action=action,
        command=args,
        created_by=creator.email if creator else None,
    )
    db.add(cmd)
    db.commit()
    return success_response(_format_command(cmd))


@_both("get", "/{node_id}/commands")
def list_commands(
    node_id: str,
    db: Session = Depends(get_db),
    limit: int = Query(20, ge=1, le=100),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """Recent commands for a node, so the UI can show pending/done status."""
    node = db.execute(select(Node).where(Node.id == node_id)).scalar_one_or_none()
    if not node:
        return json_response(ResponseCode.NOT_FOUND, "Node not found")
    workspace = db.execute(
        select(Workspace).where(Workspace.id == node.workspace_id)
    ).scalar_one_or_none()
    if not workspace or workspace.status == "deleted":
        return json_response(ResponseCode.NOT_FOUND, "Workspace not found")
    if not verify_workspace_access(workspace, x_workspace_token, authorization, db=db):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid workspace credentials")

    cmds = db.execute(
        select(NodeCommand)
        .where(NodeCommand.node_id == node.id)
        .order_by(NodeCommand.created_at.desc())
        .limit(limit)
    ).scalars().all()
    return success_response([_format_command(c) for c in cmds])


@_both("post", "/commands/{command_id}/result")
def post_command_result(
    command_id: str,
    body: CommandResultRequest,
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
):
    """The daemon reports a command's outcome (authenticated by workspace token)."""
    cmd = db.execute(select(NodeCommand).where(NodeCommand.id == command_id)).scalar_one_or_none()
    if not cmd:
        return json_response(ResponseCode.NOT_FOUND, "Command not found")
    workspace = db.execute(
        select(Workspace).where(Workspace.id == cmd.workspace_id)
    ).scalar_one_or_none()
    if not workspace:
        return json_response(ResponseCode.NOT_FOUND, "Workspace not found")
    node = db.execute(select(Node).where(Node.id == cmd.node_id)).scalar_one_or_none()
    if not _machine_token_ok(x_workspace_token, workspace, node):
        return json_response(ResponseCode.UNAUTHORIZED, "Invalid workspace token")

    cmd.status = "done" if body.ok else "error"
    cmd.result = {"ok": body.ok, "message": body.message, "data": body.data}
    # Scrub the stored args (may hold an API key) now that we're done with them.
    cmd.command = {"name": (cmd.command or {}).get("name")} if cmd.command else {}
    cmd.finished_at = _now()
    db.commit()
    return success_response(_format_command(cmd))
