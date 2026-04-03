"""
Workspace client for agent workspace operations.

Handles:
- Local identity management (~/.openagents/identity.json)
- Workspace creation and management
- Agent heartbeat/presence
- Message sending/polling
- Login and rename flows
"""

import asyncio
import json
import logging
import secrets
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, List, Dict, Any

logger = logging.getLogger(__name__)

DEFAULT_ENDPOINT = "https://workspace-endpoint.openagents.org"
IDENTITY_DIR = Path.home() / ".openagents"
IDENTITY_FILE = IDENTITY_DIR / "identity.json"


# ---------------------------------------------------------------------------
# Data models
# ---------------------------------------------------------------------------

@dataclass
class LocalAgentIdentity:
    """A locally-stored agent identity (one per agent type)."""
    agent_name: str
    agent_type: str  # claude, codex, gemini, etc.
    api_key: Optional[str] = None  # agent-scoped key from registration
    created_at: Optional[str] = None


@dataclass
class WorkspaceInfo:
    """Info about a connected workspace."""
    workspace_id: str
    slug: str
    name: str
    token: str
    url: str
    channel_name: str


# ---------------------------------------------------------------------------
# Identity storage (~/.openagents/identity.json)
# ---------------------------------------------------------------------------

def _load_identities() -> dict:
    """Load all identities from local storage."""
    if IDENTITY_FILE.exists():
        try:
            return json.loads(IDENTITY_FILE.read_text())
        except (json.JSONDecodeError, OSError):
            pass
    return {"agents": {}, "user_email": None}


def _save_identities(data: dict) -> None:
    """Save identities to local storage."""
    IDENTITY_DIR.mkdir(parents=True, exist_ok=True)
    IDENTITY_FILE.write_text(json.dumps(data, indent=2, default=str))
    try:
        IDENTITY_FILE.chmod(0o600)
    except OSError:
        pass


def get_identity(agent_type: str) -> Optional[LocalAgentIdentity]:
    """Get the saved identity for an agent type."""
    data = _load_identities()
    entry = data.get("agents", {}).get(agent_type)
    if entry:
        return LocalAgentIdentity(
            agent_name=entry["agent_name"],
            agent_type=agent_type,
            api_key=entry.get("api_key"),
            created_at=entry.get("created_at"),
        )
    return None


def save_identity(identity: LocalAgentIdentity) -> None:
    """Save an agent identity to local storage."""
    data = _load_identities()
    data["agents"][identity.agent_type] = {
        "agent_name": identity.agent_name,
        "api_key": identity.api_key,
        "created_at": identity.created_at or datetime.now(timezone.utc).isoformat(),
    }
    _save_identities(data)


def get_user_email() -> Optional[str]:
    """Get the logged-in user email."""
    return _load_identities().get("user_email")


def set_user_email(email: str) -> None:
    """Set the logged-in user email."""
    data = _load_identities()
    data["user_email"] = email
    _save_identities(data)


def clear_user_email() -> None:
    """Clear the logged-in user email (logout)."""
    data = _load_identities()
    data["user_email"] = None
    _save_identities(data)


def generate_agent_name(agent_type: str, context: Optional[str] = None) -> str:
    """Generate an auto-name: {type}-{context}-{4hex} or {type}-{4hex}."""
    suffix = secrets.token_hex(2)
    if context:
        ctx = context.lower().replace(" ", "-")[:20]
        return f"{agent_type}-{ctx}-{suffix}"
    return f"{agent_type}-{suffix}"


# ---------------------------------------------------------------------------
# Workspace API client
# ---------------------------------------------------------------------------

class WorkspaceClient:
    """HTTP client for workspace API operations (event-native)."""

    def __init__(self, endpoint: str = DEFAULT_ENDPOINT):
        self.endpoint = endpoint.rstrip("/")

    def _frontend_url(self) -> str:
        """Derive the frontend URL from the API endpoint."""
        # workspace-endpoint.openagents.org → workspace.openagents.org
        return self.endpoint.replace("workspace-endpoint", "workspace").replace("/v1", "")

    def _ws_headers(self, token: str) -> Dict[str, str]:
        """Standard headers for workspace-scoped requests."""
        return {
            "Content-Type": "application/json",
            "X-Workspace-Token": token,
        }

    async def register_agent(
        self, agent_name: str, api_key: Optional[str] = None,
        origin: str = "cli",
    ) -> dict:
        """Register an agent identity via /v1/agentid/register."""
        import aiohttp
        headers: Dict[str, str] = {"Content-Type": "application/json"}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"
        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{self.endpoint}/v1/agentid/register",
                json={"agent_name": agent_name, "origin": origin},
                headers=headers,
                timeout=aiohttp.ClientTimeout(total=30),
            ) as resp:
                data = await resp.json()
                if resp.status == 409:
                    return {"already_exists": True, "data": data.get("data", data)}
                if resp.status not in (200, 201):
                    msg = data.get("message", f"HTTP {resp.status}")
                    raise ConnectionError(f"Agent registration failed: {msg}")
                return data.get("data", data)

    async def create_workspace(
        self, agent_name: Optional[str] = None, name: Optional[str] = None,
        agent_type: str | None = None,
    ) -> WorkspaceInfo:
        """Create a workspace via POST /v1/workspaces."""
        import aiohttp
        payload: Dict[str, Any] = {
            "name": name or (f"{agent_name}'s workspace" if agent_name else "My Workspace"),
        }
        if agent_name:
            payload["agent_name"] = agent_name
        if agent_type:
            payload["agent_type"] = agent_type
        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{self.endpoint}/v1/workspaces",
                json=payload,
                headers={"Content-Type": "application/json"},
                timeout=aiohttp.ClientTimeout(total=30),
            ) as resp:
                if resp.status not in (200, 201):
                    try:
                        data = await resp.json()
                        msg = data.get("message", f"HTTP {resp.status}")
                    except Exception:
                        text = await resp.text()
                        msg = f"HTTP {resp.status}: {text[:200]}"
                    raise ConnectionError(f"Workspace creation failed: {msg}")
                data = await resp.json()
                result = data.get("data", data)
                ws_id = result["workspaceId"]
                slug = result.get("slug", ws_id)
                channel = result.get("channel", {})
                return WorkspaceInfo(
                    workspace_id=ws_id,
                    slug=slug,
                    name=result["name"],
                    token=result["token"],
                    url=f"{self._frontend_url()}/{slug}?token={result['token']}",
                    channel_name=channel.get("name", ""),
                )

    async def join_network(
        self, agent_name: str, network: Optional[str], token: str,
        agent_type: str | None = None,
        server_host: str | None = None,
        working_dir: str | None = None,
    ) -> dict:
        """Join an existing workspace via POST /v1/join."""
        import aiohttp
        body: dict = {
            "agent_name": agent_name,
            "token": token,
        }
        if network:
            body["network"] = network
        if agent_type:
            body["agent_type"] = agent_type
        if server_host:
            body["server_host"] = server_host
        if working_dir:
            body["working_dir"] = working_dir
        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{self.endpoint}/v1/join",
                json=body,
                headers={"Content-Type": "application/json"},
                timeout=aiohttp.ClientTimeout(total=30),
            ) as resp:
                data = await resp.json()
                if resp.status not in (200, 201):
                    msg = data.get("message", f"HTTP {resp.status}")
                    raise ConnectionError(f"Failed to join network: {msg}")
                return data.get("data", data)

    async def resolve_token(self, token: str) -> dict:
        """Resolve a workspace token to workspace info.

        Returns dict with workspace_id, slug, name.
        Raises ConnectionError if token is invalid.
        """
        import aiohttp
        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{self.endpoint}/v1/token/resolve",
                json={"token": token},
                headers={"Content-Type": "application/json"},
                timeout=aiohttp.ClientTimeout(total=30),
            ) as resp:
                data = await resp.json()
                if resp.status not in (200, 201):
                    msg = data.get("message", f"HTTP {resp.status}")
                    raise ConnectionError(f"Token resolution failed: {msg}")
                return data.get("data", data)

    async def heartbeat(
        self, workspace_id: str, agent_name: str, token: str,
    ) -> dict:
        """Send heartbeat via POST /v1/heartbeat."""
        import aiohttp
        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{self.endpoint}/v1/heartbeat",
                json={"agent_name": agent_name, "network": workspace_id},
                headers=self._ws_headers(token),
                timeout=aiohttp.ClientTimeout(total=10),
            ) as resp:
                data = await resp.json()
                return data.get("data", data)

    async def disconnect(
        self, workspace_id: str, agent_name: str, token: str,
    ) -> None:
        """Disconnect agent via POST /v1/leave."""
        import aiohttp
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    f"{self.endpoint}/v1/leave",
                    json={"agent_name": agent_name, "network": workspace_id},
                    headers=self._ws_headers(token),
                    timeout=aiohttp.ClientTimeout(total=10),
                ) as resp:
                    pass
        except Exception:
            pass  # best-effort on shutdown

    async def send_message(
        self,
        workspace_id: str,
        channel_name: str,
        token: str,
        content: str,
        sender_type: str = "agent",
        sender_name: Optional[str] = None,
        message_type: str = "chat",
        metadata: Optional[dict] = None,
        attachments: Optional[list] = None,
    ) -> dict:
        """Send message via POST /v1/events (workspace.message.posted event)."""
        import aiohttp
        source_prefix = "openagents" if sender_type == "agent" else "human"
        source = f"{source_prefix}:{sender_name}" if sender_name else f"{source_prefix}:unknown"

        event_payload: Dict[str, Any] = {
            "content": content,
            "message_type": message_type,
        }
        if attachments:
            event_payload["attachments"] = attachments

        event_body: Dict[str, Any] = {
            "type": "workspace.message.posted",
            "source": source,
            "target": f"channel/{channel_name}",
            "payload": event_payload,
            "metadata": metadata or {},
            "network": workspace_id,
        }

        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{self.endpoint}/v1/events",
                json=event_body,
                headers=self._ws_headers(token),
                timeout=aiohttp.ClientTimeout(total=15),
            ) as resp:
                data = await resp.json()
                if resp.status not in (200, 201):
                    msg = data.get("message", f"HTTP {resp.status}")
                    raise ConnectionError(f"Failed to send message: {msg}")
                result = data.get("data", data)
                # Convert event response to message-compatible dict
                return {
                    "messageId": result.get("id", ""),
                    "sessionId": channel_name,
                    "senderType": sender_type,
                    "senderName": sender_name or "unknown",
                    "content": content,
                    "messageType": message_type,
                    "createdAt": datetime.now(timezone.utc).isoformat(),
                }

    async def get_session(
        self,
        workspace_id: str,
        session_id: str,
        token: str,
    ) -> dict:
        """Get channel info via GET /v1/workspaces/{id}/channels/{name}."""
        import aiohttp
        async with aiohttp.ClientSession() as session:
            async with session.get(
                f"{self.endpoint}/v1/workspaces/{workspace_id}/channels/{session_id}",
                headers=self._ws_headers(token),
                timeout=aiohttp.ClientTimeout(total=10),
            ) as resp:
                data = await resp.json()
                if resp.status != 200:
                    return {"sessionId": session_id, "title": session_id, "status": "active"}
                result = data.get("data", data)
                return {
                    "sessionId": result.get("name", session_id),
                    "title": result.get("title", session_id),
                    "titleManuallySet": result.get("titleManuallySet", False),
                    "resumeFrom": result.get("resumeFrom"),
                    "status": result.get("status", "active"),
                }

    async def update_session(
        self,
        workspace_id: str,
        session_id: str,
        token: str,
        title: Optional[str] = None,
        status: Optional[str] = None,
        auto_title: bool = False,
    ) -> dict:
        """Update channel via PATCH /v1/workspaces/{id}/channels/{name}."""
        import aiohttp
        payload: Dict[str, Any] = {}
        if title is not None:
            payload["title"] = title
        if status is not None:
            payload["status"] = status
        if auto_title:
            payload["auto_title"] = True
        async with aiohttp.ClientSession() as session:
            async with session.patch(
                f"{self.endpoint}/v1/workspaces/{workspace_id}/channels/{session_id}",
                json=payload,
                headers=self._ws_headers(token),
                timeout=aiohttp.ClientTimeout(total=10),
            ) as resp:
                data = await resp.json()
                return data.get("data", data)

    async def poll_messages(
        self,
        workspace_id: str,
        channel_name: str,
        token: str,
        after: Optional[str] = None,
        limit: int = 50,
    ) -> List[dict]:
        """Poll messages in a channel via GET /v1/events."""
        import aiohttp
        params: Dict[str, Any] = {
            "network": workspace_id,
            "channel": channel_name,
            "type": "workspace.message",
            "limit": limit,
        }
        if after:
            params["after"] = after

        async with aiohttp.ClientSession() as session:
            async with session.get(
                f"{self.endpoint}/v1/events",
                params=params,
                headers=self._ws_headers(token),
                timeout=aiohttp.ClientTimeout(total=15),
            ) as resp:
                data = await resp.json()
                result = data.get("data") or data
                events = result.get("events", []) if isinstance(result, dict) else []
                return [self._event_to_message(e) for e in events]

    async def poll_pending(
        self,
        workspace_id: str,
        token: str,
        agent_name: str,
        after: Optional[str] = None,
        limit: int = 50,
    ) -> tuple[List[dict], Optional[str]]:
        """Poll for pending messages targeted at this agent via GET /v1/events.

        Returns (messages, last_event_id) where last_event_id is the ID of the
        last raw event from the server (before client-side filtering).  Callers
        must use this cursor for the next poll so the window advances past
        irrelevant events (e.g. other agents' status messages).
        """
        import aiohttp
        params: Dict[str, Any] = {
            "network": workspace_id,
            "type": "workspace.message",
            "limit": limit,
        }
        if after:
            params["after"] = after

        async with aiohttp.ClientSession() as session:
            async with session.get(
                f"{self.endpoint}/v1/events",
                params=params,
                headers=self._ws_headers(token),
                timeout=aiohttp.ClientTimeout(total=15),
            ) as resp:
                data = await resp.json()
                result = data.get("data") or data
                events = result.get("events", []) if isinstance(result, dict) else []

                # Track the last raw event ID so the cursor advances past
                # all events, not just the ones that pass the filter.
                raw_last_id: Optional[str] = None
                if events:
                    raw_last_id = events[-1].get("id")

                # Filter for events targeted at this agent
                messages = []
                for e in events:
                    meta = e.get("metadata") or {}
                    target_agents = meta.get("target_agents") or []
                    source = e.get("source", "")

                    # Exclude own messages
                    if source == f"openagents:{agent_name}":
                        continue

                    if source.startswith("human:"):
                        # Human messages: pick up if targeted at this agent or broadcast
                        if not target_agents or agent_name in target_agents:
                            messages.append(self._event_to_message(e))
                    elif source.startswith("openagents:"):
                        # Agent messages: only pick up if explicitly mentioned
                        if agent_name in target_agents:
                            messages.append(self._event_to_message(e))

                return messages, raw_last_id

    async def poll_control(
        self,
        workspace_id: str,
        token: str,
        agent_name: str,
        after: Optional[str] = None,
    ) -> List[dict]:
        """Poll for control events targeted at this agent."""
        import aiohttp
        params: Dict[str, Any] = {
            "network": workspace_id,
            "type": "workspace.agent.control",
            "limit": 10,
        }
        if after:
            params["after"] = after

        async with aiohttp.ClientSession() as session:
            async with session.get(
                f"{self.endpoint}/v1/events",
                params=params,
                headers=self._ws_headers(token),
                timeout=aiohttp.ClientTimeout(total=10),
            ) as resp:
                data = await resp.json()
                result = data.get("data") or data
                events = result.get("events", []) if isinstance(result, dict) else []
                # Only return events targeted at this agent
                return [
                    e for e in events
                    if e.get("target") == f"openagents:{agent_name}"
                ]

    async def get_agents(
        self, workspace_id: str, token: str,
    ) -> List[dict]:
        """Get workspace agents via GET /v1/discover."""
        import aiohttp
        async with aiohttp.ClientSession() as session:
            async with session.get(
                f"{self.endpoint}/v1/discover",
                params={"network": workspace_id},
                headers=self._ws_headers(token),
                timeout=aiohttp.ClientTimeout(total=10),
            ) as resp:
                data = await resp.json()
                result = data.get("data", data)
                agents_raw = result.get("agents", []) if isinstance(result, dict) else []
                return [
                    {
                        "agentName": a["address"].replace("openagents:", ""),
                        "role": a.get("role", "member"),
                        "status": a.get("status", "offline"),
                    }
                    for a in agents_raw
                ]

    # ── File methods ──

    async def upload_file(
        self,
        workspace_id: str,
        token: str,
        filename: str,
        content: bytes,
        content_type: str = "application/octet-stream",
        source: str = "human:user",
        channel_name: Optional[str] = None,
    ) -> dict:
        """Upload a file via POST /v1/files/base64."""
        import aiohttp
        import base64
        body: Dict[str, Any] = {
            "filename": filename,
            "content_base64": base64.b64encode(content).decode("ascii"),
            "content_type": content_type,
            "network": workspace_id,
            "source": source,
        }
        if channel_name:
            body["channel_name"] = channel_name

        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{self.endpoint}/v1/files/base64",
                json=body,
                headers=self._ws_headers(token),
                timeout=aiohttp.ClientTimeout(total=60),
            ) as resp:
                data = await resp.json()
                if resp.status not in (200, 201):
                    msg = data.get("message", f"HTTP {resp.status}")
                    raise ConnectionError(f"File upload failed: {msg}")
                return data.get("data", data)

    async def list_files(
        self,
        workspace_id: str,
        token: str,
        limit: int = 50,
        offset: int = 0,
    ) -> dict:
        """List files via GET /v1/files."""
        import aiohttp
        params: Dict[str, Any] = {
            "network": workspace_id,
            "limit": limit,
            "offset": offset,
        }
        async with aiohttp.ClientSession() as session:
            async with session.get(
                f"{self.endpoint}/v1/files",
                params=params,
                headers=self._ws_headers(token),
                timeout=aiohttp.ClientTimeout(total=15),
            ) as resp:
                data = await resp.json()
                return data.get("data", data)

    async def get_file_info(
        self,
        token: str,
        file_id: str,
    ) -> dict:
        """Get file metadata via GET /v1/files/{file_id}/info."""
        import aiohttp
        async with aiohttp.ClientSession() as session:
            async with session.get(
                f"{self.endpoint}/v1/files/{file_id}/info",
                headers=self._ws_headers(token),
                timeout=aiohttp.ClientTimeout(total=10),
            ) as resp:
                data = await resp.json()
                if resp.status != 200:
                    return {"id": file_id, "filename": file_id, "content_type": "application/octet-stream"}
                return data.get("data", data)

    async def read_file(
        self,
        workspace_id: str,
        token: str,
        file_id: str,
    ) -> bytes:
        """Download a file via GET /v1/files/{file_id}."""
        import aiohttp
        async with aiohttp.ClientSession() as session:
            async with session.get(
                f"{self.endpoint}/v1/files/{file_id}",
                headers=self._ws_headers(token),
                timeout=aiohttp.ClientTimeout(total=60),
            ) as resp:
                if resp.status != 200:
                    data = await resp.json()
                    msg = data.get("message", f"HTTP {resp.status}")
                    raise ConnectionError(f"File download failed: {msg}")
                return await resp.read()

    async def delete_file(
        self,
        workspace_id: str,
        token: str,
        file_id: str,
    ) -> dict:
        """Delete a file via DELETE /v1/files/{file_id}."""
        import aiohttp
        async with aiohttp.ClientSession() as session:
            async with session.delete(
                f"{self.endpoint}/v1/files/{file_id}",
                headers=self._ws_headers(token),
                timeout=aiohttp.ClientTimeout(total=15),
            ) as resp:
                data = await resp.json()
                if resp.status not in (200, 201):
                    msg = data.get("message", f"HTTP {resp.status}")
                    raise ConnectionError(f"File deletion failed: {msg}")
                return data.get("data", data)

    # ── Browser methods ──

    async def browser_open_tab(
        self, workspace_id: str, token: str,
        url: str = "about:blank", source: str = "human:user",
    ) -> dict:
        """Open a new browser tab via POST /v1/browser/tabs."""
        import aiohttp
        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{self.endpoint}/v1/browser/tabs",
                json={"url": url, "network": workspace_id, "source": source},
                headers=self._ws_headers(token),
                timeout=aiohttp.ClientTimeout(total=30),
            ) as resp:
                if resp.status not in (200, 201):
                    raise ConnectionError(f"Open tab failed: {await self._read_error(resp)}")
                data = await resp.json(content_type=None)
                return data.get("data", data)

    async def browser_list_tabs(self, workspace_id: str, token: str) -> dict:
        """List browser tabs via GET /v1/browser/tabs."""
        import aiohttp
        async with aiohttp.ClientSession() as session:
            async with session.get(
                f"{self.endpoint}/v1/browser/tabs",
                params={"network": workspace_id},
                headers=self._ws_headers(token),
                timeout=aiohttp.ClientTimeout(total=15),
            ) as resp:
                data = await resp.json(content_type=None)
                return data.get("data", data)

    @staticmethod
    async def _read_error(resp) -> str:
        """Extract an error message from a failed response, tolerating any content type."""
        try:
            data = await resp.json(content_type=None)
            return data.get("message", str(resp.status)) if isinstance(data, dict) else str(resp.status)
        except Exception:
            text = await resp.text()
            return text[:200] if text else str(resp.status)

    async def browser_navigate(self, workspace_id: str, token: str, tab_id: str, url: str) -> dict:
        """Navigate a browser tab via POST /v1/browser/tabs/{id}/navigate."""
        import aiohttp
        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{self.endpoint}/v1/browser/tabs/{tab_id}/navigate",
                json={"url": url},
                headers=self._ws_headers(token),
                timeout=aiohttp.ClientTimeout(total=30),
            ) as resp:
                if resp.status not in (200, 201):
                    raise ConnectionError(f"Navigate failed: {await self._read_error(resp)}")
                data = await resp.json(content_type=None)
                return data.get("data", data)

    async def browser_click(self, workspace_id: str, token: str, tab_id: str, selector: str) -> dict:
        """Click an element via POST /v1/browser/tabs/{id}/click."""
        import aiohttp
        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{self.endpoint}/v1/browser/tabs/{tab_id}/click",
                json={"selector": selector},
                headers=self._ws_headers(token),
                timeout=aiohttp.ClientTimeout(total=15),
            ) as resp:
                if resp.status not in (200, 201):
                    raise ConnectionError(f"Click failed: {await self._read_error(resp)}")
                data = await resp.json(content_type=None)
                return data.get("data", data)

    async def browser_type(self, workspace_id: str, token: str, tab_id: str, selector: str, text: str, append: bool = False) -> dict:
        """Type text via POST /v1/browser/tabs/{id}/type."""
        import aiohttp
        payload = {"selector": selector, "text": text}
        if append:
            payload["append"] = True
        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{self.endpoint}/v1/browser/tabs/{tab_id}/type",
                json=payload,
                headers=self._ws_headers(token),
                timeout=aiohttp.ClientTimeout(total=30),
            ) as resp:
                if resp.status not in (200, 201):
                    raise ConnectionError(f"Type failed: {await self._read_error(resp)}")
                data = await resp.json(content_type=None)
                return data.get("data", data)

    async def browser_press_key(self, workspace_id: str, token: str, tab_id: str, key: str) -> dict:
        """Press a keyboard key via POST /v1/browser/tabs/{id}/press_key."""
        import aiohttp
        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{self.endpoint}/v1/browser/tabs/{tab_id}/press_key",
                json={"key": key},
                headers=self._ws_headers(token),
                timeout=aiohttp.ClientTimeout(total=10),
            ) as resp:
                if resp.status not in (200, 201):
                    raise ConnectionError(f"Press key failed: {await self._read_error(resp)}")
                data = await resp.json(content_type=None)
                return data.get("data", data)

    async def browser_evaluate(self, workspace_id: str, token: str, tab_id: str, expression: str) -> dict:
        """Evaluate JavaScript via POST /v1/browser/tabs/{id}/evaluate."""
        import aiohttp
        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{self.endpoint}/v1/browser/tabs/{tab_id}/evaluate",
                json={"expression": expression},
                headers=self._ws_headers(token),
                timeout=aiohttp.ClientTimeout(total=15),
            ) as resp:
                if resp.status not in (200, 201):
                    raise ConnectionError(f"Evaluate failed: {await self._read_error(resp)}")
                data = await resp.json(content_type=None)
                return data.get("data", data)

    async def browser_screenshot(self, workspace_id: str, token: str, tab_id: str) -> bytes:
        """Get screenshot via GET /v1/browser/tabs/{id}/screenshot."""
        import aiohttp
        async with aiohttp.ClientSession() as session:
            async with session.get(
                f"{self.endpoint}/v1/browser/tabs/{tab_id}/screenshot",
                headers=self._ws_headers(token),
                timeout=aiohttp.ClientTimeout(total=30),
            ) as resp:
                if resp.status != 200:
                    raise ConnectionError(f"Screenshot failed: {await self._read_error(resp)}")
                return await resp.read()

    async def browser_snapshot(self, workspace_id: str, token: str, tab_id: str) -> str:
        """Get accessibility snapshot via GET /v1/browser/tabs/{id}/snapshot."""
        import aiohttp
        async with aiohttp.ClientSession() as session:
            async with session.get(
                f"{self.endpoint}/v1/browser/tabs/{tab_id}/snapshot",
                headers=self._ws_headers(token),
                timeout=aiohttp.ClientTimeout(total=15),
            ) as resp:
                if resp.status != 200:
                    raise ConnectionError(f"Snapshot failed: {await self._read_error(resp)}")
                return await resp.text()

    async def browser_close_tab(self, workspace_id: str, token: str, tab_id: str) -> dict:
        """Close a browser tab via DELETE /v1/browser/tabs/{id}."""
        import aiohttp
        async with aiohttp.ClientSession() as session:
            async with session.delete(
                f"{self.endpoint}/v1/browser/tabs/{tab_id}",
                headers=self._ws_headers(token),
                timeout=aiohttp.ClientTimeout(total=15),
            ) as resp:
                if resp.status not in (200, 201):
                    raise ConnectionError(f"Close tab failed: {await self._read_error(resp)}")
                data = await resp.json(content_type=None)
                return data.get("data", data)

    # ── Invitation methods (stubs — not yet event-native) ──

    async def check_invitations(self, agent_name: str) -> List[dict]:
        """Check for pending invitations (stub)."""
        return []

    async def accept_invitation(self, invite_token: str) -> dict:
        """Accept a workspace invitation (stub)."""
        return {}

    async def reject_invitation(self, invite_token: str) -> None:
        """Reject a workspace invitation (stub)."""
        pass

    # ── Internal helpers ──

    @staticmethod
    def _event_to_message(event: dict) -> dict:
        """Convert an ONM event dict to a message-compatible dict."""
        source = event.get("source", "")
        is_human = source.startswith("human:")
        sender_name = source.replace("openagents:", "").replace("human:", "")
        payload = event.get("payload") or {}
        target = event.get("target", "")
        ts = event.get("timestamp")

        msg = {
            "messageId": event.get("id", ""),
            "sessionId": target.replace("channel/", "") if target.startswith("channel/") else target,
            "senderType": "human" if is_human else "agent",
            "senderName": sender_name,
            "content": payload.get("content", ""),
            "mentions": payload.get("mentions", []),
            "messageType": payload.get("message_type", "chat"),
            "metadata": event.get("metadata") or {},
            "createdAt": datetime.fromtimestamp(ts / 1000, tz=timezone.utc).isoformat() if ts else None,
        }
        if payload.get("attachments"):
            msg["attachments"] = payload["attachments"]
        return msg
