"""
Claude Code adapter for OpenAgents workspace.

Bridges Claude Code to an OpenAgents workspace via:
- Polling loop for incoming messages
- Claude CLI subprocess (stream-json) for task execution
- MCP server for workspace tool access

Uses `claude` CLI directly instead of claude-agent-sdk to avoid
SDK parsing issues with rate_limit_event and other unknown message types.
"""

import asyncio
import json
import logging
import os
import shutil
from typing import Optional

from openagents.adapters.base import BaseAdapter
from openagents.adapters.utils import format_attachments_for_prompt
from openagents.workspace_client import DEFAULT_ENDPOINT

logger = logging.getLogger(__name__)


class ClaudeAdapter(BaseAdapter):
    """Connects Claude Code to an OpenAgents workspace."""

    def __init__(
        self,
        workspace_id: str,
        channel_name: str,
        token: str,
        agent_name: str,
        endpoint: str = DEFAULT_ENDPOINT,
        disabled_modules: set | None = None,
    ):
        super().__init__(workspace_id, channel_name, token, agent_name, endpoint)
        self.disabled_modules = disabled_modules or set()
        self._channel_sessions: dict[str, str] = {}  # channel_name → Claude CLI session_id
        self._current_process: Optional[asyncio.subprocess.Process] = None
        self._channel_processes: dict[str, asyncio.subprocess.Process] = {}  # channel → subprocess

    async def _on_control_action(self, action: Optional[str], payload: dict):
        """Handle stop control action."""
        if action == "stop":
            await self._stop_current_process()

    async def _stop_process(self, proc: asyncio.subprocess.Process):
        """Kill a single Claude subprocess."""
        if proc and proc.returncode is None:
            try:
                proc.terminate()
                try:
                    await asyncio.wait_for(proc.wait(), timeout=5)
                except asyncio.TimeoutError:
                    proc.kill()
                    await proc.wait()
            except ProcessLookupError:
                pass

    async def _stop_current_process(self):
        """Kill all running Claude subprocesses (stop button)."""
        procs = list(self._channel_processes.items())
        if not procs:
            return
        logger.info(f"Stopping {len(procs)} running process(es)...")
        for channel, proc in procs:
            await self._stop_process(proc)
            self._channel_processes.pop(channel, None)
            self._channel_queues.pop(channel, None)
            try:
                await self.client.send_message(
                    workspace_id=self.workspace_id,
                    channel_name=channel,
                    token=self.token,
                    content="Execution stopped by user",
                    sender_type="agent",
                    sender_name=self.agent_name,
                    message_type="status",
                    metadata={"agent_mode": self._mode},
                )
            except Exception:
                pass

    def _build_claude_cmd(self, prompt: str, channel_name: str) -> list[str]:
        """Build the claude CLI command for a specific channel."""
        claude_bin = shutil.which("claude")
        if not claude_bin:
            raise FileNotFoundError(
                "claude CLI not found. Install with: curl -fsSL https://claude.ai/install.sh | bash"
            )

        system_prompt = (
            f"\nYou are agent '{self.agent_name}' connected to an "
            f"OpenAgents workspace.\n"
            f"You MUST use the workspace_send_message MCP tool to "
            f"communicate your responses.\n"
            f"Text you generate is NOT visible to anyone unless you "
            f"call workspace_send_message.\n"
            f"Use workspace_get_history to read previous messages.\n"
            f"Use workspace_get_agents to see other agents.\n"
            f"\n## Multi-Agent Delegation\n"
            f"To delegate work to another agent, @mention them in "
            f"your message. Example: workspace_send_message(content="
            f"'@agent-b Please review the tests'). Only @mentioned "
            f"agents will receive the message.\n"
            f"IMPORTANT: Do NOT @mention an agent just to say thanks "
            f"or acknowledge — that wakes them up for nothing. Only "
            f"@mention when you need them to do work. When the task "
            f"is complete, report results to the user without "
            f"@mentioning other agents.\n"
            f"Use workspace_get_agents to discover available agents.\n"
        )

        cmd = [
            claude_bin,
            "-p", prompt,
            "--output-format", "stream-json",
            "--verbose",
        ]

        # Mode-dependent permission and tool flags
        _pfx = "mcp__openagents-workspace__"
        mcp_tools = [
            f"{_pfx}workspace_send_message",
            f"{_pfx}workspace_get_history",
            f"{_pfx}workspace_get_agents",
            f"{_pfx}workspace_status",
        ]
        mcp_write_tools = []

        # Conditionally include file tools
        if "files" not in self.disabled_modules:
            mcp_tools += [f"{_pfx}workspace_list_files", f"{_pfx}workspace_read_file"]
            mcp_write_tools += [f"{_pfx}workspace_write_file", f"{_pfx}workspace_delete_file"]

        # Conditionally include browser tools
        if "browser" not in self.disabled_modules:
            mcp_tools += [
                f"{_pfx}workspace_browser_list_tabs",
                f"{_pfx}workspace_browser_snapshot",
                f"{_pfx}workspace_browser_screenshot",
            ]
            mcp_write_tools += [
                f"{_pfx}workspace_browser_open",
                f"{_pfx}workspace_browser_navigate",
                f"{_pfx}workspace_browser_click",
                f"{_pfx}workspace_browser_type",
                f"{_pfx}workspace_browser_close",
            ]

        # Tunnel tools
        if "tunnel" not in self.disabled_modules:
            mcp_tools.append(f"{_pfx}tunnel_list")
            mcp_write_tools += [f"{_pfx}tunnel_expose", f"{_pfx}tunnel_close"]

        if self._mode == "plan":
            cmd.extend(["--permission-mode", "plan"])
            allowed = mcp_tools + ["Read", "Glob", "Grep"]
            system_prompt += (
                "\nYou are in PLAN mode. Only read, analyze, and propose "
                "changes. Do not make edits. Share your plan via "
                "workspace_send_message.\n"
            )
        else:
            cmd.append("--dangerously-skip-permissions")
            allowed = mcp_tools + mcp_write_tools + ["Read", "Write", "Edit", "Bash", "Glob", "Grep"]

        cmd.extend(["--append-system-prompt", system_prompt])
        cmd.extend(["--allowedTools"] + allowed)

        # Resume existing conversation for context continuity
        session_id = self._channel_sessions.get(channel_name)
        if session_id:
            cmd.extend(["--resume", session_id])

        # MCP config for workspace tools — uses the message's channel
        mcp_args = [
            "mcp-server",
            "--workspace-id", self.workspace_id,
            "--channel-name", channel_name,
            "--agent-name", self.agent_name,
            "--endpoint", self.endpoint,
        ]
        if "files" in self.disabled_modules:
            mcp_args.append("--disable-files")
        if "browser" in self.disabled_modules:
            mcp_args.append("--disable-browser")

        mcp_config = {
            "mcpServers": {
                "openagents-workspace": {
                    "type": "stdio",
                    "command": "openagents",
                    "args": mcp_args,
                    "env": {"OA_WORKSPACE_TOKEN": self.token},
                },
            },
        }
        cmd.extend(["--mcp-config", json.dumps(mcp_config)])

        return cmd

    async def _handle_message(self, msg: dict):
        """Process a single incoming message via Claude CLI subprocess."""
        content = msg.get("content", "").strip()
        attachments = msg.get("attachments", [])

        # Append attachment info so the agent knows about uploaded files
        att_text = format_attachments_for_prompt(attachments)
        if att_text:
            content = (content + att_text) if content else att_text.strip()

        if not content:
            return

        # Use the message's channel so responses go to the correct channel
        msg_channel = msg.get("sessionId") or self.channel_name

        sender = msg.get("senderName") or msg.get("senderType", "user")
        logger.info(f"Processing message from {sender} in channel {msg_channel}: {content[:80]}...")

        # Auto-title + resume-from: on first encounter of a channel, fetch its info
        if msg_channel not in self._titled_sessions:
            self._titled_sessions.add(msg_channel)
            try:
                info = await self.client.get_session(
                    self.workspace_id, msg_channel, self.token,
                )
                # Resume from a previous channel's Claude session if specified
                resume_from = info.get("resumeFrom")
                if resume_from and msg_channel not in self._channel_sessions:
                    source_session = self._channel_sessions.get(resume_from)
                    if source_session:
                        self._channel_sessions[msg_channel] = source_session
                        logger.info(f"Resuming channel {msg_channel} from {resume_from} (session {source_session})")

                # Auto-title
                from openagents.adapters.utils import generate_session_title, SESSION_DEFAULT_RE
                title = generate_session_title(content)
                if title:
                    if not info.get("titleManuallySet") and SESSION_DEFAULT_RE.match(info.get("title", "")):
                        await self.client.update_session(
                            self.workspace_id, msg_channel, self.token,
                            title=title, auto_title=True,
                        )
                        logger.debug(f"Auto-titled channel: {title}")
            except Exception as e:
                logger.debug(f"Failed to fetch/auto-title channel: {e}")
        else:
            pass  # already titled

        # Post "thinking..." status
        await self._send_status(msg_channel, "thinking...")

        try:
            cmd = self._build_claude_cmd(content, msg_channel)
        except FileNotFoundError as e:
            await self._send_error(msg_channel, str(e))
            return

        # Build clean env without CLAUDECODE to allow nested sessions
        clean_env = {
            k: v for k, v in os.environ.items()
            if k not in ("CLAUDECODE", "CLAUDE_CODE_SESSION")
        }

        try:
            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=clean_env,
                limit=10 * 1024 * 1024,  # 10 MB line buffer (default 64KB too small for large tool outputs)
            )
            self._current_process = process
            self._channel_processes[msg_channel] = process

            used_send_tool = False
            response_text = []

            # Read stream-json output line by line
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

                if event_type == "assistant":
                    # Process content blocks from assistant message
                    message_data = event.get("message", {})
                    for block in message_data.get("content", []):
                        block_type = block.get("type")
                        if block_type == "text":
                            response_text.append(block.get("text", ""))
                        elif block_type == "tool_use":
                            tool_name = block.get("name", "")
                            if "workspace_send_message" in tool_name:
                                used_send_tool = True
                            else:
                                # Stream intermediate tool use as status
                                tool_input = str(block.get("input", ""))[:200]
                                await self._send_status(
                                    msg_channel,
                                    f"**Using tool:** `{tool_name}`\n```\n{tool_input}\n```",
                                )

                elif event_type == "result":
                    # Save session_id per channel for conversation continuity
                    session_id = event.get("session_id")
                    if session_id:
                        self._channel_sessions[msg_channel] = session_id
                    if event.get("is_error"):
                        logger.warning(f"Claude error: {event.get('result', '')[:200]}")

                elif event_type == "system":
                    logger.debug(f"CLI init: session={event.get('session_id')}")

                elif event_type == "rate_limit_event":
                    info = event.get("rate_limit_info", {})
                    logger.debug(f"Rate limit status: {info.get('status')}")

                else:
                    logger.debug(f"Skipping event type: {event_type}")

            await process.wait()
            self._current_process = None
            self._channel_processes.pop(msg_channel, None)

            if process.returncode != 0:
                stderr = await process.stderr.read()
                stderr_text = stderr.decode("utf-8", errors="replace").strip()
                if stderr_text:
                    logger.warning(f"CLI stderr: {stderr_text[:300]}")

            # Fallback: if Claude didn't use workspace_send_message,
            # post the text response directly
            if not used_send_tool and response_text:
                full_response = "\n".join(response_text).strip()
                if full_response:
                    await self._send_response(msg_channel, full_response)
            elif not used_send_tool and not response_text:
                await self._send_response(msg_channel, "No response generated. Please try again.")

        except Exception as e:
            logger.exception(f"Error handling message: {e}")
            await self._send_error(msg_channel, f"Error processing message: {e}")
