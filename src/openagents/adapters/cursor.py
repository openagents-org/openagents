"""
Cursor CLI adapter for OpenAgents workspace.

Bridges the official ``cursor-agent`` CLI to an OpenAgents workspace via:
- Polling loop for incoming messages
- Cursor CLI subprocess execution with JSON output
- OpenAgents MCP server exposed through Cursor's global ``mcp.json``
- Per-channel session resume for conversation continuity
"""

import asyncio
import json
import logging
import os
from pathlib import Path
from typing import Any, Optional

from openagents.adapters.base import BaseAdapter
from openagents.adapters.utils import (
    ensure_runtime_env_home,
    find_executable,
    first_text,
    format_attachments_for_prompt,
    write_json_file,
    build_workspace_mcp_server,
)
from openagents.adapters.workspace_prompt import build_openclaw_system_prompt
from openagents.workspace_client import DEFAULT_ENDPOINT

logger = logging.getLogger(__name__)


class CursorAdapter(BaseAdapter):
    """Connects Cursor CLI to an OpenAgents workspace."""

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
        self.working_dir = working_dir
        self._cursor_binary = find_executable("cursor-agent", "cursor")
        self._cursor_model = os.environ.get("CURSOR_MODEL", "").strip()
        self._sessions_file = (
            Path.home() / ".openagents" / "sessions" / f"{workspace_id}_{agent_name}_cursor.json"
        )
        self._runtime_home = (
            Path.home() / ".openagents" / "runtime" / "cursor" / f"{workspace_id}_{agent_name}"
        )
        self._channel_sessions: dict[str, str] = {}
        self._load_sessions()

    def _load_sessions(self):
        try:
            if self._sessions_file.exists():
                data = json.loads(self._sessions_file.read_text(encoding="utf-8"))
                if isinstance(data, dict):
                    self._channel_sessions.update(
                        {
                            str(channel): str(session_id)
                            for channel, session_id in data.items()
                            if session_id
                        }
                    )
        except Exception:
            logger.debug("Could not load Cursor session state", exc_info=True)

    def _save_sessions(self):
        try:
            self._sessions_file.parent.mkdir(parents=True, exist_ok=True)
            self._sessions_file.write_text(
                json.dumps(self._channel_sessions, indent=2),
                encoding="utf-8",
            )
        except Exception:
            logger.debug("Could not save Cursor session state", exc_info=True)

    def _build_system_prompt(self, channel_name: str) -> str:
        return build_openclaw_system_prompt(
            agent_name=self.agent_name,
            workspace_id=self.workspace_id,
            channel_name=channel_name,
            endpoint=self.endpoint,
            token=self.token,
            mode=self._mode,
            disabled_modules=self.disabled_modules,
        )

    def _cursor_env(self, channel_name: str) -> dict[str, str]:
        runtime_home = self._runtime_home
        env = ensure_runtime_env_home(os.environ, runtime_home)
        env["CURSOR_API_KEY"] = os.environ.get("CURSOR_API_KEY", "")
        mcp_config = {
            "mcpServers": build_workspace_mcp_server(
                self.workspace_id,
                channel_name,
                self.agent_name,
                self.endpoint,
                self.token,
                disable_files="files" in self.disabled_modules,
                disable_browser="browser" in self.disabled_modules,
            )
        }
        write_json_file(runtime_home / ".cursor" / "mcp.json", mcp_config)
        return env

    def _extract_tool_name(self, event: dict[str, Any]) -> str:
        for key in ("tool_name", "toolName", "name"):
            if isinstance(event.get(key), str) and event[key]:
                return event[key]
        for container_key in ("tool_call", "tool", "call"):
            container = event.get(container_key)
            if isinstance(container, dict):
                for key in ("name", "tool", "toolName"):
                    if isinstance(container.get(key), str) and container[key]:
                        return container[key]
        return ""

    def _extract_session_id(self, event: dict[str, Any]) -> str:
        for key in ("session_id", "sessionId", "conversation_id", "conversationId"):
            value = event.get(key)
            if isinstance(value, str) and value:
                return value
        result = event.get("result")
        if isinstance(result, dict):
            for key in ("session_id", "sessionId", "conversation_id", "conversationId"):
                value = result.get(key)
                if isinstance(value, str) and value:
                    return value
        return ""

    def _extract_result_text(self, event: dict[str, Any]) -> str:
        candidates = [
            event.get("result"),
            event.get("message"),
            event.get("content"),
            event.get("text"),
            event.get("output"),
            event.get("assistant_message"),
        ]
        for candidate in candidates:
            text = first_text(candidate).strip()
            if text:
                return text
        return ""

    def _build_cursor_cmd(self, prompt: str, channel_name: str) -> list[str]:
        if not self._cursor_binary:
            raise FileNotFoundError(
                "cursor-agent CLI not found. Install Cursor CLI and ensure 'cursor-agent' is on PATH."
            )

        full_prompt = f"{self._build_system_prompt(channel_name)}\n\n---\n\n{prompt}"

        cmd = [
            self._cursor_binary,
            "-p",
            full_prompt,
            "--print",
            "--output-format",
            "stream-json",
        ]
        if self._mode != "plan":
            cmd.append("--force")
        if self._cursor_model:
            cmd.extend(["-m", self._cursor_model])

        session_id = self._channel_sessions.get(channel_name)
        if session_id:
            cmd.extend(["--resume", session_id])

        return cmd

    async def _handle_message(self, msg: dict):
        content = msg.get("content", "").strip()
        attachments = msg.get("attachments", [])

        att_text = format_attachments_for_prompt(attachments)
        if att_text:
            content = (content + att_text) if content else att_text.strip()
        if not content:
            return

        if not os.environ.get("CURSOR_API_KEY"):
            await self._send_error(
                msg.get("sessionId") or self.channel_name,
                "Cursor is not configured. Set CURSOR_API_KEY and restart the agent.",
            )
            return

        msg_channel = msg.get("sessionId") or self.channel_name
        sender = msg.get("senderName") or msg.get("senderType", "user")
        logger.info(
            "Processing Cursor message from %s in channel %s: %s...",
            sender,
            msg_channel,
            content[:80],
        )

        await self._auto_title_channel(msg_channel, content)
        await self._send_status(msg_channel, "thinking...")

        try:
            cmd = self._build_cursor_cmd(content, msg_channel)
        except FileNotFoundError as exc:
            await self._send_error(msg_channel, str(exc))
            return

        env = self._cursor_env(msg_channel)
        process = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=env,
            cwd=self.working_dir,
        )

        final_chunks: list[str] = []
        last_text = ""

        try:
            assert process.stdout is not None
            while True:
                line = await process.stdout.readline()
                if not line:
                    break

                raw = line.decode("utf-8", errors="replace").strip()
                if not raw:
                    continue

                try:
                    event = json.loads(raw)
                except json.JSONDecodeError:
                    logger.debug("Cursor non-JSON line: %s", raw[:200])
                    continue

                session_id = self._extract_session_id(event)
                if session_id:
                    self._channel_sessions[msg_channel] = session_id
                    self._save_sessions()

                event_type = event.get("type", "")
                if event_type == "tool_call_started":
                    tool_name = self._extract_tool_name(event) or "tool"
                    await self._send_status(msg_channel, f"Using tool: `{tool_name}`")
                    continue
                if event_type in {"tool_call_completed", "tool_call_finished"}:
                    continue

                text = self._extract_result_text(event)
                if text and text != last_text:
                    last_text = text
                    if event_type == "result":
                        final_chunks = [text]
                    else:
                        final_chunks.append(text)

            returncode = await process.wait()
            stderr_text = ""
            if process.stderr is not None:
                stderr_text = (
                    (await process.stderr.read()).decode("utf-8", errors="replace").strip()
                )

            if returncode != 0:
                detail = stderr_text or "cursor-agent exited with an error"
                await self._send_error(msg_channel, detail[:1200])
                return

            response = "\n".join(chunk for chunk in final_chunks if chunk).strip()
            if not response:
                response = stderr_text.strip()
            if not response:
                response = "No response generated. Please try again."
            await self._send_response(msg_channel, response)
        finally:
            if process.returncode is None:
                process.kill()
                await process.wait()
