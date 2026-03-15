"""
Cursor adapter for OpenAgents workspace.

Bridges Cursor to an OpenAgents workspace via:
- Polling loop for incoming messages
- Direct HTTP mode for OpenAI-compatible LLM APIs (primary)
- Workspace context injected via system prompt

In direct mode (when OPENAI_API_KEY and OPENAI_BASE_URL are set),
the adapter calls the chat completions API directly — no Cursor
CLI binary or subscription needed.
"""

import json
import logging
import os
from typing import Optional

import aiohttp

from openagents.adapters.base import BaseAdapter
from openagents.adapters.workspace_prompt import build_openclaw_system_prompt
from openagents.workspace_client import DEFAULT_ENDPOINT

logger = logging.getLogger(__name__)

# Max conversation history entries to keep in memory
MAX_HISTORY_ENTRIES = 50


class CursorAdapter(BaseAdapter):
    """Connects Cursor to an OpenAgents workspace."""

    def __init__(
        self,
        workspace_id: str,
        channel_name: str,
        token: str,
        agent_name: str,
        endpoint: str = DEFAULT_ENDPOINT,
        disabled_modules: set | None = None,
        working_dir: str | None = None,
    ):
        super().__init__(workspace_id, channel_name, token, agent_name, endpoint)
        self.disabled_modules = disabled_modules or set()

        # Direct LLM API mode
        self._direct_api_key = os.environ.get("OPENAI_API_KEY", "")
        self._direct_base_url = os.environ.get("OPENAI_BASE_URL", "").rstrip("/")
        self._direct_model = (
            os.environ.get("CURSOR_MODEL", "")
            or os.environ.get("OPENCLAW_MODEL", "")
        )
        self._direct_mode = bool(self._direct_api_key and self._direct_base_url)

        if self._direct_mode:
            logger.info(
                f"Direct LLM mode: {self._direct_base_url} "
                f"model={self._direct_model or 'gpt-4o'}"
            )
        else:
            logger.warning(
                "Cursor adapter started without direct API config. "
                "Set OPENAI_API_KEY + OPENAI_BASE_URL for direct mode."
            )

        # Conversation history for multi-turn context
        self._conversation_history: list[dict] = []

    def _build_system_prompt(self, channel_name: str) -> str:
        """Build workspace context system prompt."""
        return build_openclaw_system_prompt(
            agent_name=self.agent_name,
            workspace_id=self.workspace_id,
            channel_name=channel_name,
            endpoint=self.endpoint,
            token=self.token,
            mode=self._mode,
            disabled_modules=self.disabled_modules,
        )

    async def _handle_message(self, msg: dict):
        """Process a single incoming message."""
        content = msg.get("content", "").strip()
        if not content:
            return

        msg_channel = msg.get("sessionId") or self.channel_name

        sender = msg.get("senderName") or msg.get("senderType", "user")
        logger.info(
            f"Processing message from {sender} in channel "
            f"{msg_channel}: {content[:80]}..."
        )

        await self._auto_title_channel(msg_channel, content)
        await self._send_status(msg_channel, "thinking...")

        try:
            if self._direct_mode:
                response_text = await self._call_completion_api(
                    content, msg_channel
                )
            else:
                response_text = ""
                await self._send_error(
                    msg_channel,
                    "Cursor direct API mode not configured. "
                    "Set OPENAI_API_KEY + OPENAI_BASE_URL.",
                )
                return

            if response_text:
                self._conversation_history.append(
                    {"role": "user", "content": content}
                )
                self._conversation_history.append(
                    {"role": "assistant", "content": response_text}
                )
                if len(self._conversation_history) > MAX_HISTORY_ENTRIES * 2:
                    self._conversation_history = (
                        self._conversation_history[-MAX_HISTORY_ENTRIES * 2 :]
                    )
                await self._send_response(msg_channel, response_text)
            else:
                await self._send_response(
                    msg_channel, "No response generated. Please try again."
                )

        except Exception as e:
            logger.exception(f"Error handling message: {e}")
            await self._send_error(
                msg_channel, f"Error processing message: {e}"
            )

    async def _call_completion_api(
        self, user_message: str, channel: str
    ) -> str:
        """Call OpenAI-compatible chat completions API directly."""
        system_prompt = self._build_system_prompt(channel)

        messages = [{"role": "system", "content": system_prompt}]
        messages.extend(self._conversation_history)
        messages.append({"role": "user", "content": user_message})

        url = f"{self._direct_base_url}/chat/completions"
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self._direct_api_key}",
        }
        payload = {
            "model": self._direct_model or "gpt-4o",
            "messages": messages,
            "stream": True,
        }

        full_text = ""

        async with aiohttp.ClientSession() as session:
            async with session.post(
                url,
                headers=headers,
                json=payload,
                timeout=aiohttp.ClientTimeout(total=300),
            ) as resp:
                if resp.status != 200:
                    body = await resp.text()
                    raise RuntimeError(
                        f"LLM API returned {resp.status}: {body[:300]}"
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
                    text = delta.get("content")
                    if text:
                        full_text += text

        return full_text.strip()
