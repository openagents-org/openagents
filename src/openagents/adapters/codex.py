"""
Codex CLI adapter for OpenAgents workspace.

Bridges OpenAI Codex CLI to an OpenAgents workspace via:
- Polling loop for incoming messages
- Codex CLI subprocess (exec --json) for task execution
- Response text captured from JSONL stream and posted to workspace

Uses `codex exec --json --full-auto` directly as a subprocess,
parsing JSONL events for tool calls, file changes, and agent messages.

Note: MCP workspace tools are not used because the Python MCP server
uses NDJSON framing while Codex's Rust MCP client uses Content-Length
framing (LSP-style). The adapter posts responses directly instead.
"""

import asyncio
import json
import logging
import shutil
from typing import Optional

from openagents.adapters.base import BaseAdapter
from openagents.workspace_client import DEFAULT_ENDPOINT

logger = logging.getLogger(__name__)


class CodexAdapter(BaseAdapter):
    """Connects OpenAI Codex CLI to an OpenAgents workspace."""

    def __init__(
        self,
        workspace_id: str,
        channel_name: str,
        token: str,
        agent_name: str,
        endpoint: str = DEFAULT_ENDPOINT,
    ):
        super().__init__(workspace_id, channel_name, token, agent_name, endpoint)
        self._codex_thread_id: Optional[str] = None

    def _build_codex_cmd(self, prompt: str) -> list[str]:
        """Build the codex CLI command."""
        codex_bin = shutil.which("codex")
        if not codex_bin:
            raise FileNotFoundError(
                "codex CLI not found. Install with: "
                "npm install -g @openai/codex"
            )

        cmd = [codex_bin, "exec"]

        # Resume existing thread for context continuity
        if self._codex_thread_id:
            cmd.extend(["resume", self._codex_thread_id])

        cmd.extend([
            "--json",       # JSONL output to stdout
            "--full-auto",  # workspace-write sandbox + auto-approve
        ])

        cmd.append(prompt)
        return cmd

    async def _handle_message(self, msg: dict):
        """Process a single incoming message via Codex CLI subprocess."""
        content = msg.get("content", "").strip()
        if not content:
            return

        msg_channel = msg.get("sessionId") or self.channel_name

        sender = msg.get("senderName") or msg.get("senderType", "user")
        logger.info(f"Processing message from {sender} in channel {msg_channel}: {content[:80]}...")

        await self._auto_title_channel(msg_channel, content)
        await self._send_status(msg_channel, "thinking...")

        try:
            cmd = self._build_codex_cmd(content)
        except FileNotFoundError as e:
            await self._send_error(msg_channel, str(e))
            return

        try:
            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                limit=10 * 1024 * 1024,  # 10 MB line buffer
            )

            response_texts = []

            # Read JSONL output line by line
            while True:
                line = await process.stdout.readline()
                if not line:
                    break
                line = line.decode("utf-8", errors="replace").strip()
                if not line:
                    continue

                try:
                    event = json.loads(line)
                except json.JSONDecodeError:
                    logger.debug(f"Non-JSON line from CLI: {line[:100]}")
                    continue

                event_type = event.get("type")

                if event_type == "thread.started":
                    thread_id = event.get("thread_id")
                    if thread_id:
                        self._codex_thread_id = thread_id
                    logger.debug(f"Codex thread started: {thread_id}")

                elif event_type == "item.completed":
                    item = event.get("item", {})
                    item_type = item.get("type")

                    if item_type == "agent_message":
                        text = item.get("text", "")
                        if text:
                            response_texts.append(text)

                    elif item_type == "command_execution":
                        cmd_text = item.get("command", "")[:200]
                        await self._send_status(
                            msg_channel, f"**Running:** `{cmd_text}`",
                        )

                    elif item_type == "file_change":
                        filename = item.get("filename", "")
                        await self._send_status(
                            msg_channel, f"**Editing:** `{filename}`",
                        )

                elif event_type == "item.started":
                    item = event.get("item", {})
                    logger.debug(
                        f"Item started: {item.get('type')} "
                        f"{item.get('id', '')}"
                    )

                elif event_type == "turn.completed":
                    usage = event.get("usage", {})
                    logger.debug(
                        f"Turn completed — tokens: "
                        f"in={usage.get('input_tokens', '?')}, "
                        f"out={usage.get('output_tokens', '?')}"
                    )

                elif event_type == "turn.failed":
                    error = event.get("error", {})
                    logger.warning(
                        f"Codex turn failed: "
                        f"{error.get('message', str(error))}"
                    )

                elif event_type == "error":
                    logger.warning(f"Codex error: {event}")

                else:
                    logger.debug(f"Skipping event type: {event_type}")

            await process.wait()

            if process.returncode != 0:
                stderr = await process.stderr.read()
                stderr_text = stderr.decode(
                    "utf-8", errors="replace"
                ).strip()
                if stderr_text:
                    logger.warning(f"CLI stderr: {stderr_text[:300]}")

            if response_texts:
                full_response = "\n".join(response_texts).strip()
                if full_response:
                    await self._send_response(msg_channel, full_response)
            else:
                await self._send_response(
                    msg_channel, "No response generated. Please try again.",
                )

        except Exception as e:
            logger.exception(f"Error handling message: {e}")
            await self._send_error(msg_channel, f"Error processing message: {e}")
