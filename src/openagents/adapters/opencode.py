"""
OpenCode CLI adapter for OpenAgents workspace.

Bridges the official ``opencode`` CLI to an OpenAgents workspace via:
- Polling loop for incoming messages
- ``opencode run --format json`` subprocess execution
- Runtime-injected OpenCode config for model/provider/MCP settings
- Per-channel session resume for conversation continuity
"""

import asyncio
import json
import logging
import os
from pathlib import Path
from typing import Any

from openagents.adapters.base import BaseAdapter
from openagents.adapters.utils import (
    ensure_runtime_env_home,
    find_executable,
    first_text,
    format_attachments_for_prompt,
    resolve_openagents_binary,
)
from openagents.adapters.workspace_prompt import build_openclaw_system_prompt
from openagents.workspace_client import DEFAULT_ENDPOINT

logger = logging.getLogger(__name__)


class OpenCodeAdapter(BaseAdapter):
    """Connects OpenCode CLI to an OpenAgents workspace."""

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
        self._opencode_binary = find_executable("opencode")
        self._runtime_root = (
            Path.home() / ".openagents" / "runtime" / "opencode" / f"{workspace_id}_{agent_name}"
        )
        self._sessions_file = (
            Path.home() / ".openagents" / "sessions" / f"{workspace_id}_{agent_name}_opencode.json"
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
            logger.debug("Could not load OpenCode session state", exc_info=True)

    def _save_sessions(self):
        try:
            self._sessions_file.parent.mkdir(parents=True, exist_ok=True)
            self._sessions_file.write_text(
                json.dumps(self._channel_sessions, indent=2),
                encoding="utf-8",
            )
        except Exception:
            logger.debug("Could not save OpenCode session state", exc_info=True)

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

    def _resolve_provider_config(self) -> tuple[str, dict[str, Any]]:
        model_name = (
            os.environ.get("OPENCODE_MODEL")
            or os.environ.get("LLM_MODEL")
            or os.environ.get("OPENCLAW_MODEL")
            or ""
        ).strip()
        llm_base_url = (os.environ.get("LLM_BASE_URL") or os.environ.get("OPENAI_BASE_URL") or "").strip()
        llm_api_key = (
            os.environ.get("LLM_API_KEY")
            or os.environ.get("OPENAI_API_KEY")
            or os.environ.get("ANTHROPIC_API_KEY")
            or ""
        ).strip()

        if llm_base_url:
            model_name = model_name or "gpt-5.4"
            provider_id = "openagents-openai-compatible"
            return (
                f"{provider_id}/{model_name}",
                {
                    provider_id: {
                        "npm": "@ai-sdk/openai-compatible",
                        "name": "OpenAgents OpenAI-compatible",
                        "options": {
                            "baseURL": llm_base_url,
                            "apiKey": llm_api_key,
                        },
                        "models": {
                            model_name: {
                                "name": model_name,
                            }
                        },
                    }
                },
            )

        if os.environ.get("ANTHROPIC_API_KEY") and (model_name.startswith("claude") or not model_name):
            model_name = model_name or "claude-sonnet-4-5"
            return (
                f"anthropic/{model_name}",
                {
                    "anthropic": {
                        "options": {
                            "apiKey": os.environ.get("ANTHROPIC_API_KEY", ""),
                        }
                    }
                },
            )

        model_name = model_name or "gpt-5.4"
        api_key = os.environ.get("OPENAI_API_KEY") or llm_api_key
        return (
            f"openai/{model_name}",
            {
                "openai": {
                    "options": {
                        "apiKey": api_key,
                    }
                }
            },
        )

    def _runtime_env(self, channel_name: str) -> tuple[dict[str, str], str]:
        model_ref, provider_cfg = self._resolve_provider_config()
        runtime_root = self._runtime_root
        runtime_root.mkdir(parents=True, exist_ok=True)

        config = {
            "$schema": "https://opencode.ai/config.json",
            "model": model_ref,
            "provider": provider_cfg,
            "permission": (
                {
                    "*": "allow",
                }
                if self._mode != "plan"
                else {
                    "*": "allow",
                    "edit": "deny",
                    "bash": "deny",
                    "task": "deny",
                }
            ),
            "mcp": {
                "openagents-workspace": {
                    "type": "local",
                    "command": [
                        resolve_openagents_binary(),
                        "mcp-server",
                        "--workspace-id",
                        self.workspace_id,
                        "--channel-name",
                        channel_name,
                        "--agent-name",
                        self.agent_name,
                        "--endpoint",
                        self.endpoint,
                        *(["--disable-files"] if "files" in self.disabled_modules else []),
                        *(["--disable-browser"] if "browser" in self.disabled_modules else []),
                    ],
                    "enabled": True,
                    "environment": {
                        "OA_WORKSPACE_TOKEN": self.token,
                    },
                }
            },
        }

        env = dict(os.environ)
        env["OPENCODE_CONFIG_CONTENT"] = json.dumps(config)
        env["XDG_CONFIG_HOME"] = str(runtime_root / "config")
        env["XDG_DATA_HOME"] = str(runtime_root / "data")
        env["XDG_STATE_HOME"] = str(runtime_root / "state")
        env = ensure_runtime_env_home(env, runtime_root / "home")
        return env, model_ref

    def _extract_session_id(self, event: dict[str, Any]) -> str:
        properties = event.get("properties")
        if isinstance(properties, dict):
            if isinstance(properties.get("sessionID"), str) and properties["sessionID"]:
                return properties["sessionID"]
            info = properties.get("info")
            if isinstance(info, dict):
                session_id = info.get("id")
                if isinstance(session_id, str) and session_id:
                    return session_id
        return ""

    def _tool_status_text(self, part: dict[str, Any]) -> str:
        tool_name = part.get("tool", "tool")
        state = part.get("state") or {}
        status = state.get("status")
        title = first_text(state.get("title") or state.get("metadata") or "").strip()
        if status == "running":
            return title or f"Using tool: `{tool_name}`"
        if status == "completed":
            return title or f"Completed tool: `{tool_name}`"
        if status == "error":
            error = first_text(state.get("error")).strip()
            return error or f"Tool failed: `{tool_name}`"
        return f"Using tool: `{tool_name}`"

    def _build_opencode_cmd(self, prompt: str, channel_name: str, model_ref: str) -> list[str]:
        if not self._opencode_binary:
            raise FileNotFoundError(
                "opencode CLI not found. Install it with 'openagents install opencode' or ensure 'opencode' is on PATH."
            )

        full_prompt = f"{self._build_system_prompt(channel_name)}\n\n---\n\n{prompt}"
        cmd = [
            self._opencode_binary,
            "run",
            "--format",
            "json",
            "--model",
            model_ref,
        ]
        session_id = self._channel_sessions.get(channel_name)
        if session_id:
            cmd.extend(["--session", session_id])
        cmd.append(full_prompt)
        return cmd

    async def _handle_message(self, msg: dict):
        content = msg.get("content", "").strip()
        attachments = msg.get("attachments", [])

        att_text = format_attachments_for_prompt(attachments)
        if att_text:
            content = (content + att_text) if content else att_text.strip()
        if not content:
            return

        if not (
            os.environ.get("LLM_API_KEY")
            or os.environ.get("OPENAI_API_KEY")
            or os.environ.get("ANTHROPIC_API_KEY")
        ):
            await self._send_error(
                msg.get("sessionId") or self.channel_name,
                "OpenCode is not configured. Set LLM_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY and restart the agent.",
            )
            return

        msg_channel = msg.get("sessionId") or self.channel_name
        sender = msg.get("senderName") or msg.get("senderType", "user")
        logger.info(
            "Processing OpenCode message from %s in channel %s: %s...",
            sender,
            msg_channel,
            content[:80],
        )

        await self._auto_title_channel(msg_channel, content)
        await self._send_status(msg_channel, "thinking...")

        env, model_ref = self._runtime_env(msg_channel)
        try:
            cmd = self._build_opencode_cmd(content, msg_channel, model_ref)
        except FileNotFoundError as exc:
            await self._send_error(msg_channel, str(exc))
            return

        process = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=env,
            cwd=self.working_dir,
        )

        assistant_message_ids: set[str] = set()
        assistant_parts: dict[str, str] = {}
        last_status = ""

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
                    logger.debug("OpenCode non-JSON line: %s", raw[:200])
                    continue

                session_id = self._extract_session_id(event)
                if session_id:
                    self._channel_sessions[msg_channel] = session_id
                    self._save_sessions()

                event_type = event.get("type", "")
                properties = event.get("properties") or {}

                if event_type == "message.updated":
                    info = properties.get("info") or {}
                    if info.get("role") == "assistant" and info.get("id"):
                        assistant_message_ids.add(info["id"])
                    continue

                if event_type == "message.part.updated":
                    part = properties.get("part") or {}
                    part_type = part.get("type")
                    message_id = part.get("messageID")

                    if part_type == "tool":
                        status_text = self._tool_status_text(part)
                        if status_text and status_text != last_status:
                            last_status = status_text
                            await self._send_status(msg_channel, status_text)
                        continue

                    if part_type == "patch":
                        files = part.get("files") or []
                        if files:
                            await self._send_status(
                                msg_channel,
                                "Editing: " + ", ".join(f"`{name}`" for name in files[:5]),
                            )
                        continue

                    if part_type == "text" and (message_id in assistant_message_ids or not assistant_message_ids):
                        text = properties.get("delta") or part.get("text") or ""
                        if not text and part.get("id") in assistant_parts:
                            text = assistant_parts[part["id"]]
                        if text:
                            if properties.get("delta") and part.get("id") in assistant_parts:
                                assistant_parts[part["id"]] += str(text)
                            else:
                                assistant_parts[part["id"]] = str(text)
                        continue

                if event_type == "command.executed":
                    name = properties.get("name", "command")
                    arguments = properties.get("arguments", "").strip()
                    summary = f"`{name} {arguments}`".strip()
                    await self._send_status(msg_channel, f"Running: {summary}")
                    continue

                if event_type == "file.edited":
                    file_name = properties.get("file", "")
                    if file_name:
                        await self._send_status(msg_channel, f"Edited: `{file_name}`")
                    continue

                if event_type == "session.compacted":
                    await self._send_status(msg_channel, "Compacting conversation...")
                    continue

                if event_type == "session.error":
                    error = first_text(properties.get("error")).strip()
                    if error:
                        await self._send_error(msg_channel, error[:1200])
                    continue

            returncode = await process.wait()
            stderr_text = ""
            if process.stderr is not None:
                stderr_text = (
                    (await process.stderr.read()).decode("utf-8", errors="replace").strip()
                )

            if returncode != 0:
                detail = stderr_text or "opencode exited with an error"
                await self._send_error(msg_channel, detail[:1200])
                return

            response = "\n".join(
                text.strip() for text in assistant_parts.values() if text.strip()
            ).strip()
            if not response:
                response = stderr_text.strip()
            if not response:
                response = "No response generated. Please try again."
            await self._send_response(msg_channel, response)
        finally:
            if process.returncode is None:
                process.kill()
                await process.wait()
