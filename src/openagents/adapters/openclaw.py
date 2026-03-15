"""
OpenClaw adapter for OpenAgents workspace.

Bridges OpenClaw to an OpenAgents workspace via:
- Polling loop for incoming messages
- Gateway WebSocket (chat.send + tool events) for full tool visibility
- Direct HTTP mode for non-gateway LLM APIs
- Workspace context injected via system prompt

OpenClaw runs as a Node.js daemon with an OpenAI-compatible API.
In gateway mode, the adapter uses the WebSocket protocol to send
messages and receive tool events in real-time.  Tool events are only
broadcast to the WebSocket client that initiated the chat request,
so we must use WS for both sending and receiving.
"""

import asyncio
import base64
import json
import logging
import os
import re
import time
import uuid
from pathlib import Path
from typing import Optional

import aiohttp

from openagents.adapters.base import BaseAdapter
from openagents.adapters.utils import format_attachments_for_prompt
from openagents.adapters.workspace_prompt import (
    build_openclaw_skill_md,
    build_openclaw_system_prompt,
)
from openagents.workspace_client import DEFAULT_ENDPOINT

logger = logging.getLogger(__name__)

# Max conversation history entries to keep in memory
MAX_HISTORY_ENTRIES = 50

# OpenClaw device identity path
OPENCLAW_STATE_DIR = Path.home() / ".openclaw"


def _load_openclaw_device_identity() -> Optional[dict]:
    """Load OpenClaw device identity for WebSocket authentication."""
    device_path = OPENCLAW_STATE_DIR / "identity" / "device.json"
    auth_path = OPENCLAW_STATE_DIR / "identity" / "device-auth.json"
    if not device_path.exists() or not auth_path.exists():
        return None
    try:
        device = json.loads(device_path.read_text())
        auth = json.loads(auth_path.read_text())
        return {"device": device, "auth": auth}
    except Exception as e:
        logger.debug(f"Failed to load OpenClaw device identity: {e}")
        return None


def _sign_ws_challenge(device_info: dict, nonce: str) -> Optional[dict]:
    """Build device auth params for WebSocket connect handshake."""
    try:
        from cryptography.hazmat.primitives.serialization import (
            load_pem_private_key,
            load_pem_public_key,
            Encoding,
            PublicFormat,
        )

        device = device_info["device"]
        auth = device_info["auth"]

        private_key = load_pem_private_key(
            device["privateKeyPem"].encode(), password=None
        )
        public_key = load_pem_public_key(device["publicKeyPem"].encode())

        # Raw 32-byte Ed25519 public key
        raw_pub = public_key.public_bytes(Encoding.Raw, PublicFormat.Raw)
        pub_b64url = base64.urlsafe_b64encode(raw_pub).rstrip(b"=").decode()

        device_token = auth["tokens"]["operator"]["token"]
        scopes = auth["tokens"]["operator"]["scopes"]
        signed_at = int(time.time() * 1000)

        client_id = "webchat-ui"
        client_mode = "webchat"
        role = "operator"

        # Build v3 signature payload
        payload = "|".join([
            "v3", device["deviceId"], client_id, client_mode, role,
            ",".join(scopes), str(signed_at), device_token, nonce,
            "linux", "",
        ])
        signature = private_key.sign(payload.encode())
        sig_b64url = base64.urlsafe_b64encode(signature).rstrip(b"=").decode()

        return {
            "auth": {"deviceToken": device_token},
            "client": {
                "id": client_id,
                "displayName": "OpenAgents Adapter",
                "platform": "linux",
                "version": "1.0.0",
                "mode": client_mode,
            },
            "device": {
                "id": device["deviceId"],
                "publicKey": pub_b64url,
                "signature": sig_b64url,
                "signedAt": signed_at,
                "nonce": nonce,
            },
            "caps": ["tool-events"],
            "role": role,
            "scopes": scopes,
            "minProtocol": 3,
            "maxProtocol": 3,
        }
    except ImportError:
        logger.warning(
            "cryptography package not installed — "
            "OpenClaw tool event monitoring disabled"
        )
        return None
    except Exception as e:
        logger.warning(f"Failed to sign WS challenge: {e}")
        return None


class OpenClawAdapter(BaseAdapter):
    """Connects OpenClaw to an OpenAgents workspace."""

    def __init__(
        self,
        workspace_id: str,
        channel_name: str,
        token: str,
        agent_name: str,
        endpoint: str = DEFAULT_ENDPOINT,
        openclaw_host: str = "127.0.0.1",
        openclaw_port: int = 18789,
        openclaw_token: Optional[str] = None,
        openclaw_agent_id: str = "main",
        disabled_modules: set | None = None,
        working_dir: str | None = None,
    ):
        super().__init__(workspace_id, channel_name, token, agent_name, endpoint)
        self.disabled_modules = disabled_modules or set()

        # Check for direct LLM API mode (bypasses OpenClaw gateway).
        # Only use direct mode if explicitly requested via OPENCLAW_DIRECT_MODE=1,
        # because the LLM env vars (OPENAI_API_KEY, OPENAI_BASE_URL) are also
        # used by the OpenClaw gateway itself and don't imply direct mode.
        self._direct_api_key = os.environ.get("OPENAI_API_KEY") or os.environ.get("ANTHROPIC_API_KEY", "")
        self._direct_base_url = os.environ.get("OPENAI_BASE_URL", "").rstrip("/")
        self._direct_model = os.environ.get("OPENCLAW_MODEL", "")
        self._direct_mode = os.environ.get("OPENCLAW_DIRECT_MODE", "").strip() == "1"

        if self._direct_mode:
            if not (self._direct_api_key and self._direct_base_url):
                raise ValueError(
                    "OPENCLAW_DIRECT_MODE=1 requires OPENAI_API_KEY and OPENAI_BASE_URL"
                )
            self.openclaw_url = f"{self._direct_base_url}/chat/completions"
            logger.info(f"Direct LLM mode: {self._direct_base_url} model={self._direct_model or 'default'}")
        else:
            self.openclaw_url = (
                f"http://{openclaw_host}:{openclaw_port}/v1/chat/completions"
            )

        self.openclaw_host = openclaw_host
        self.openclaw_port = openclaw_port
        self.openclaw_token = openclaw_token
        self.openclaw_agent_id = openclaw_agent_id

        # Conversation history for multi-turn context
        self._conversation_history: list[dict] = []

        # Device identity for gateway WS auth
        self._device_identity = None if self._direct_mode else _load_openclaw_device_identity()

        # Install workspace skill for gateway mode (system prompt injection)
        if not self._direct_mode:
            self._install_workspace_skill()

    def _build_system_prompt(self, channel_name: str) -> str:
        """Build system prompt with workspace context and API skills."""
        return build_openclaw_system_prompt(
            agent_name=self.agent_name,
            workspace_id=self.workspace_id,
            channel_name=channel_name,
            endpoint=self.endpoint,
            token=self.token,
            mode=self._mode,
            disabled_modules=self.disabled_modules,
        )

    def _resolve_openclaw_workspace(self) -> Optional[Path]:
        """Resolve the OpenClaw workspace directory for this agent.

        Multi-agent setups use per-agent workspaces: ~/.openclaw/workspace-<id>
        The default agent ("main") uses ~/.openclaw/workspace.
        """
        agent_id = self.openclaw_agent_id
        if agent_id and agent_id != "main":
            workspace_dir = OPENCLAW_STATE_DIR / f"workspace-{agent_id}"
        else:
            workspace_dir = OPENCLAW_STATE_DIR / "workspace"

        if workspace_dir.is_dir():
            return workspace_dir

        # Fall back to default workspace if per-agent one doesn't exist
        fallback = OPENCLAW_STATE_DIR / "workspace"
        if fallback.is_dir():
            return fallback

        return None

    def _install_workspace_skill(self):
        """Write a SKILL.md into the OpenClaw workspace skills directory.

        OpenClaw auto-discovers skills from <workspace>/skills/ and injects
        them into the system prompt. This is the primary delivery mechanism
        for workspace tool instructions in gateway (WS) mode, where
        chat.send only accepts the user message.

        Each agent gets its own namespaced skill directory so multiple
        agents with different workspace IDs/tokens don't conflict.
        """
        workspace_dir = self._resolve_openclaw_workspace()
        if not workspace_dir:
            logger.debug("OpenClaw workspace not found, skipping skill install")
            return

        skill_name = f"openagents-workspace-{self.agent_name}"
        skill_dir = workspace_dir / "skills" / skill_name
        skill_dir.mkdir(parents=True, exist_ok=True)

        content = build_openclaw_skill_md(
            endpoint=self.endpoint,
            workspace_id=self.workspace_id,
            token=self.token,
            agent_name=self.agent_name,
            channel_name=self.channel_name,
            disabled_modules=self.disabled_modules,
        )

        skill_path = skill_dir / "SKILL.md"
        skill_path.write_text(content)
        logger.info(f"Installed workspace skill at {skill_path}")

    async def _get_recent_history_text(self, channel_name: str) -> str:
        """Fetch recent workspace messages and format as context."""
        try:
            messages = await self.client.poll_messages(
                workspace_id=self.workspace_id,
                channel_name=channel_name,
                token=self.token,
                limit=10,
            )
            if not messages:
                return ""

            lines = ["## Recent Workspace Messages"]
            for msg in messages:
                sender = msg.get("senderName") or msg.get("senderType", "?")
                content = msg.get("content", "")
                msg_type = msg.get("messageType", "chat")
                if msg_type == "status":
                    continue
                lines.append(f"- **{sender}:** {content[:200]}")
            return "\n".join(lines) + "\n"
        except Exception:
            return ""

    async def _handle_message(self, msg: dict):
        """Process a single incoming message via OpenClaw."""
        content = msg.get("content", "").strip()
        attachments = msg.get("attachments", [])

        att_text = format_attachments_for_prompt(attachments)
        if att_text:
            content = (content + att_text) if content else att_text.strip()

        if not content:
            return

        msg_channel = msg.get("sessionId") or self.channel_name

        sender = msg.get("senderName") or msg.get("senderType", "user")
        logger.info(f"Processing message from {sender} in channel {msg_channel}: {content[:80]}...")

        await self._auto_title_channel(msg_channel, content)
        await self._send_status(msg_channel, "thinking...")

        try:
            if self._direct_mode:
                response_text = await self._stream_completion_http(content, msg_channel)
            else:
                response_text = await self._chat_via_ws(content, msg_channel)

            if response_text:
                self._conversation_history.append(
                    {"role": "user", "content": content}
                )
                self._conversation_history.append(
                    {"role": "assistant", "content": response_text}
                )
                if len(self._conversation_history) > MAX_HISTORY_ENTRIES * 2:
                    self._conversation_history = (
                        self._conversation_history[-MAX_HISTORY_ENTRIES * 2:]
                    )

                await self._send_response(msg_channel, response_text)
            else:
                await self._send_response(msg_channel, "No response generated. Please try again.")

        except aiohttp.ClientConnectorError:
            error_msg = (
                f"Cannot connect to OpenClaw Gateway at "
                f"{self.openclaw_host}:{self.openclaw_port}. "
                f"Is OpenClaw running? Start with: openclaw gateway start"
            )
            logger.error(error_msg)
            await self._send_error(msg_channel, error_msg)
        except Exception as e:
            logger.exception(f"Error handling message: {e}")
            await self._send_error(msg_channel, f"Error processing message: {e}")

    # ------------------------------------------------------------------
    # Gateway WebSocket mode (chat.send + tool events)
    # ------------------------------------------------------------------

    async def _chat_via_ws(self, user_message: str, channel: str) -> str:
        """Send message via gateway WebSocket and collect response + tool events.

        This is the primary method for gateway mode.  By sending the chat
        request over the same WebSocket connection, the gateway registers
        our connId as a tool-event recipient, so we receive tool start/end
        events alongside assistant text deltas.
        """
        ws_url = f"ws://{self.openclaw_host}:{self.openclaw_port}"
        idem_key = str(uuid.uuid4()).replace("-", "")[:24]
        session_key = f"openagents-{self.workspace_id[:8]}"

        full_text = ""

        async with aiohttp.ClientSession() as session:
            async with session.ws_connect(
                ws_url,
                headers={"Origin": f"http://localhost:{self.openclaw_port}"},
                heartbeat=30,
                timeout=aiohttp.ClientTimeout(total=300),
            ) as ws:
                # Phase 1: Authenticate
                connected = await self._ws_authenticate(ws)
                if not connected:
                    # Fall back to HTTP if WS auth fails
                    logger.warning("WS auth failed, falling back to HTTP")
                    return await self._stream_completion_http(user_message, channel)

                # Phase 2: Send chat.send request
                await ws.send_json({
                    "type": "req",
                    "id": idem_key,
                    "method": "chat.send",
                    "params": {
                        "sessionKey": session_key,
                        "message": user_message,
                        "idempotencyKey": idem_key,
                    },
                })
                logger.debug(f"Sent chat.send with idem={idem_key}")

                # Phase 3: Collect response events
                async for ws_msg in ws:
                    if ws_msg.type != aiohttp.WSMsgType.TEXT:
                        if ws_msg.type in (aiohttp.WSMsgType.CLOSED, aiohttp.WSMsgType.ERROR):
                            logger.debug(f"WS closed/error: {ws_msg.type}")
                            break
                        continue

                    data = json.loads(ws_msg.data)
                    event = data.get("event")
                    payload = data.get("payload", {})
                    stream = payload.get("stream", "")

                    # chat.send response (acknowledgement)
                    if data.get("type") == "res" and data.get("id") == idem_key:
                        if not data.get("ok"):
                            err = data.get("error", {})
                            raise RuntimeError(f"chat.send failed: {err.get('message', err)}")
                        continue

                    # Tool events (phases: start, update, result)
                    if event == "agent" and stream == "tool":
                        tool_data = payload.get("data", {})
                        phase = tool_data.get("phase", "")
                        tool_name = tool_data.get("name", "")

                        if phase == "start" and tool_name:
                            args = tool_data.get("args", {})
                            if isinstance(args, dict):
                                args_str = json.dumps(args, ensure_ascii=False)
                            else:
                                args_str = str(args) if args else ""
                            preview = args_str[:200] if args_str else ""
                            status = f"**Using tool:** `{tool_name}`"
                            if preview:
                                status += f"\n```\n{preview}\n```"
                            await self._send_status(channel, status)

                        elif phase == "result" and tool_name:
                            meta = tool_data.get("meta", "")
                            is_error = tool_data.get("isError", False)
                            if meta:
                                preview = str(meta)[:300]
                                if is_error:
                                    await self._send_status(
                                        channel,
                                        f"`{tool_name}` error\n```\n{preview}\n```",
                                    )
                                # Only show result for errors (success results
                                # are usually noisy; the tool name + args is enough)
                        # Skip 'update' events (heartbeat-like, no useful data)
                        continue

                    # Assistant text deltas (use 'delta' for incremental text)
                    if event == "agent" and stream == "assistant":
                        delta_text = payload.get("data", {}).get("delta", "")
                        if delta_text:
                            full_text += delta_text
                        continue

                    # Chat final event — extract full text
                    if event == "chat":
                        chat_data = payload.get("data", payload)
                        state = chat_data.get("state") or payload.get("state", "")
                        if state in ("final", "done"):
                            final = chat_data.get("text", "")
                            if final and not full_text:
                                full_text = final
                            break
                        continue

                    # Lifecycle end
                    if event == "agent" and stream == "lifecycle":
                        phase = payload.get("data", {}).get("phase", "")
                        if phase in ("end", "error"):
                            break

        # Strip XML tool blocks (tool_call, tool_response, etc.) from visible text
        clean = self._XML_TOOL_RE.sub("", full_text)
        clean = re.sub(r" +\n", "\n", clean)  # trailing spaces on lines
        clean = re.sub(r"\n{3,}", "\n\n", clean)
        return clean.strip()

    async def _ws_authenticate(self, ws) -> bool:
        """Handle WebSocket connect challenge/response. Returns True if authenticated."""
        if not self._device_identity:
            return False

        # Wait for connect.challenge
        try:
            raw = await asyncio.wait_for(ws.receive(), timeout=10)
        except asyncio.TimeoutError:
            return False

        if raw.type != aiohttp.WSMsgType.TEXT:
            return False

        msg = json.loads(raw.data)
        if msg.get("event") != "connect.challenge":
            return False

        nonce = msg.get("payload", {}).get("nonce", "")
        params = _sign_ws_challenge(self._device_identity, nonce)
        if not params:
            return False

        req_id = str(uuid.uuid4())
        await ws.send_json({
            "type": "req",
            "id": req_id,
            "method": "connect",
            "params": params,
        })

        # Wait for connect response
        try:
            raw = await asyncio.wait_for(ws.receive(), timeout=10)
        except asyncio.TimeoutError:
            return False

        if raw.type != aiohttp.WSMsgType.TEXT:
            return False

        res = json.loads(raw.data)
        if res.get("type") == "res" and res.get("ok"):
            logger.info("OpenClaw WS authenticated — tool events enabled")
            return True

        err = res.get("error", {})
        logger.warning(f"OpenClaw WS auth failed: {err.get('message', err)}")
        return False

    # ------------------------------------------------------------------
    # Direct HTTP mode (for non-gateway LLM APIs)
    # ------------------------------------------------------------------

    # Tags that are NOT tool invocations (common HTML/markup)
    _HTML_TAGS = frozenset({
        "p", "div", "span", "br", "ul", "ol", "li",
        "h1", "h2", "h3", "h4", "h5", "h6",
        "code", "pre", "em", "strong", "a", "img",
        "table", "tr", "td", "th", "thead", "tbody",
        "html", "head", "body", "meta", "link",
        "script", "style", "title",
    })

    # Regex to find complete XML tool blocks: <tag_name>...</tag_name>
    _XML_TOOL_RE = re.compile(r"<(\w+)>(.*?)</\1>", re.DOTALL)

    async def _stream_completion_http(self, user_message: str, channel: str) -> str:
        """Call LLM API via HTTP with streaming (direct mode or fallback).

        Streams the response and posts intermediate chunks to the workspace:
        - Each completed XML tool block is posted as a status message.
        - OpenAI function-calling tool_calls deltas are posted similarly.
        - Only the final prose text is returned for the chat response.
        """
        # Build messages
        history_text = await self._get_recent_history_text(channel)
        system_prompt = self._build_system_prompt(channel)
        if history_text:
            system_prompt += "\n" + history_text

        messages = [{"role": "system", "content": system_prompt}]
        messages.extend(self._conversation_history)
        messages.append({"role": "user", "content": user_message})

        headers = {"Content-Type": "application/json"}

        if self._direct_mode:
            headers["Authorization"] = f"Bearer {self._direct_api_key}"
            model = self._direct_model or "gpt-4o"
        else:
            if self.openclaw_token:
                headers["Authorization"] = f"Bearer {self.openclaw_token}"
            headers["x-openclaw-agent-id"] = self.openclaw_agent_id
            model = f"openclaw:{self.openclaw_agent_id}"

        payload = {
            "model": model,
            "messages": messages,
            "stream": True,
            "user": f"openagents-ws-{self.workspace_id}",
        }

        full_text = ""
        pending_tools: dict[int, dict] = {}
        scan_offset = 0
        thinking_tags: set[str] = set()

        async with aiohttp.ClientSession() as session:
            async with session.post(
                self.openclaw_url,
                headers=headers,
                json=payload,
                timeout=aiohttp.ClientTimeout(total=300),
            ) as resp:
                if resp.status != 200:
                    body = await resp.text()
                    raise RuntimeError(
                        f"OpenClaw API returned {resp.status}: {body[:300]}"
                    )

                async for line in resp.content:
                    line = line.decode("utf-8", errors="replace").strip()
                    if not line or not line.startswith("data: "):
                        continue

                    data = line[6:]
                    if data == "[DONE]":
                        break

                    try:
                        chunk = json.loads(data)
                    except json.JSONDecodeError:
                        continue

                    choices = chunk.get("choices", [])
                    if not choices:
                        continue

                    delta = choices[0].get("delta", {})

                    # Text content (may contain XML tool tags)
                    text = delta.get("content")
                    if text:
                        full_text += text

                        for m in re.finditer(r"<(\w+)>", full_text[scan_offset:]):
                            tag_name = m.group(1)
                            if tag_name not in self._HTML_TAGS and tag_name not in thinking_tags:
                                thinking_tags.add(tag_name)
                                await self._send_status(channel, f"**Using tool:** `{tag_name}`")

                        while True:
                            m = self._XML_TOOL_RE.search(full_text, scan_offset)
                            if not m:
                                break
                            tag_name = m.group(1)
                            if tag_name in self._HTML_TAGS:
                                scan_offset = m.end()
                                continue
                            tool_block = m.group(0)
                            await self._send_status(
                                channel,
                                f"`{tag_name}`\n```xml\n{tool_block}\n```",
                            )
                            scan_offset = m.end()

                    # OpenAI function-calling tool_calls
                    for tc in delta.get("tool_calls", []):
                        idx = tc.get("index", 0)
                        func = tc.get("function", {})
                        if idx not in pending_tools:
                            pending_tools[idx] = {"name": "", "arguments": ""}
                        if func.get("name"):
                            pending_tools[idx]["name"] = func["name"]
                            await self._send_status(channel, f"**Using tool:** `{func['name']}`")
                        if func.get("arguments"):
                            pending_tools[idx]["arguments"] += func["arguments"]

                    finish = choices[0].get("finish_reason")
                    if finish == "tool_calls" and pending_tools:
                        for idx in sorted(pending_tools):
                            tool = pending_tools[idx]
                            args_preview = tool["arguments"][:300]
                            await self._send_status(
                                channel,
                                f"`{tool['name']}`\n```json\n{args_preview}\n```",
                            )
                        pending_tools.clear()

        # Strip XML tool blocks from the final text
        final_text = self._XML_TOOL_RE.sub("", full_text).strip()
        final_text = re.sub(r"\n{3,}", "\n\n", final_text)
        return final_text
