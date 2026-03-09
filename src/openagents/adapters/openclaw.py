"""
OpenClaw adapter for OpenAgents workspace.

Bridges OpenClaw to an OpenAgents workspace via:
- Polling loop for incoming messages
- OpenClaw Gateway HTTP API (/v1/chat/completions) for task execution
- Workspace context injected via system prompt

OpenClaw runs as a Node.js daemon with an OpenAI-compatible API.
No native MCP support — workspace tools are exposed via system prompt
instructions, and the adapter posts responses to the workspace directly.
"""

import asyncio
import json
import logging
from typing import Optional

import aiohttp

from openagents.adapters.base import BaseAdapter
from openagents.adapters.utils import format_attachments_for_prompt
from openagents.workspace_client import DEFAULT_ENDPOINT

logger = logging.getLogger(__name__)

# Max conversation history entries to keep in memory
MAX_HISTORY_ENTRIES = 50


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
    ):
        super().__init__(workspace_id, channel_name, token, agent_name, endpoint)

        # OpenClaw connection
        self.openclaw_host = openclaw_host
        self.openclaw_port = openclaw_port
        self.openclaw_token = openclaw_token
        self.openclaw_agent_id = openclaw_agent_id
        self.openclaw_url = (
            f"http://{openclaw_host}:{openclaw_port}/v1/chat/completions"
        )

        # Conversation history for multi-turn context
        self._conversation_history: list[dict] = []

    def _build_system_prompt(self, channel_name: str) -> str:
        """Build system prompt with workspace context."""
        base = (
            f"You are agent '{self.agent_name}' connected to an "
            f"OpenAgents workspace.\n\n"
            f"## Workspace\n"
            f"- Workspace ID: {self.workspace_id}\n"
            f"- Channel: {channel_name}\n"
            f"- Mode: {self._mode}\n\n"
        )
        if self._mode == "plan":
            base += (
                "## Instructions (PLAN mode)\n"
                "- You are in PLAN mode. Only read, analyze, and propose.\n"
                "- Do NOT write code, make changes, or execute actions.\n"
                "- Instead, outline your plan step by step.\n"
                "- Describe what changes you would make and why.\n"
                "- Ask clarifying questions if needed.\n"
                "- When the user is satisfied, they can switch you to Execute mode.\n"
                "- Use markdown formatting for structure.\n"
            )
        else:
            base += (
                "## Instructions (EXECUTE mode)\n"
                "- You are responding to messages from the workspace chat.\n"
                "- Your response will be posted to the workspace automatically.\n"
                "- Be helpful, concise, and direct.\n"
                "- You can write code, explain concepts, and help with tasks.\n"
                "- Use markdown formatting for code blocks and structure.\n"
            )
        return base

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
        """Process a single incoming message via OpenClaw API."""
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
            # Build messages for the API call
            history_text = await self._get_recent_history_text(msg_channel)
            system_prompt = self._build_system_prompt(msg_channel)
            if history_text:
                system_prompt += "\n" + history_text

            messages = [{"role": "system", "content": system_prompt}]
            messages.extend(self._conversation_history)
            messages.append({"role": "user", "content": content})

            response_text = await self._stream_completion(messages)

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

    async def _stream_completion(self, messages: list[dict]) -> str:
        """Call OpenClaw /v1/chat/completions with streaming and return response."""
        headers = {"Content-Type": "application/json"}
        if self.openclaw_token:
            headers["Authorization"] = f"Bearer {self.openclaw_token}"
        headers["x-openclaw-agent-id"] = self.openclaw_agent_id

        payload = {
            "model": f"openclaw:{self.openclaw_agent_id}",
            "messages": messages,
            "stream": True,
            "user": f"openagents-ws-{self.workspace_id}",
        }

        response_parts = []

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
                    if not line:
                        continue
                    if not line.startswith("data: "):
                        continue

                    data = line[6:]
                    if data == "[DONE]":
                        break

                    try:
                        chunk = json.loads(data)
                    except json.JSONDecodeError:
                        logger.debug(f"Non-JSON SSE chunk: {data[:100]}")
                        continue

                    choices = chunk.get("choices", [])
                    if choices:
                        delta = choices[0].get("delta", {})
                        text = delta.get("content")
                        if text:
                            response_parts.append(text)

        return "".join(response_parts).strip()
