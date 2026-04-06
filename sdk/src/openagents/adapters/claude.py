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
import platform
import shutil
import sys
import tempfile
from pathlib import Path
from typing import Optional

from openagents.adapters.base import BaseAdapter
from openagents.adapters.utils import format_attachments_for_prompt
from openagents.adapters.workspace_prompt import build_claude_system_prompt
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
        working_dir: str | None = None,
    ):
        super().__init__(workspace_id, channel_name, token, agent_name, endpoint)
        self.disabled_modules = disabled_modules or set()
        self.working_dir = working_dir
        self._channel_sessions: dict[str, str] = {}  # channel_name → Claude CLI session_id
        self._current_process: Optional[asyncio.subprocess.Process] = None
        self._channel_processes: dict[str, asyncio.subprocess.Process] = {}  # channel → subprocess
        self._sessions_file = (
            Path.home() / ".openagents" / "sessions"
            / f"{workspace_id}_{agent_name}.json"
        )
        self._load_sessions()

    def _load_sessions(self):
        """Load persisted channel→session_id mapping from disk."""
        try:
            if self._sessions_file.exists():
                data = json.loads(self._sessions_file.read_text())
                if isinstance(data, dict):
                    self._channel_sessions.update(data)
                    logger.info(f"Loaded {len(data)} session(s) from {self._sessions_file.name}")
        except Exception:
            logger.debug("Could not load sessions file, starting fresh")

    def _save_sessions(self):
        """Persist channel→session_id mapping to disk."""
        try:
            self._sessions_file.parent.mkdir(parents=True, exist_ok=True)
            self._sessions_file.write_text(json.dumps(self._channel_sessions))
        except Exception:
            logger.debug("Could not save sessions file")

    async def _on_control_action(self, action: Optional[str], payload: dict):
        """Handle stop control action."""
        if action == "stop":
            await self._stop_current_process()

    async def _stop_process(self, proc: asyncio.subprocess.Process):
        """Kill a single Claude subprocess and its children."""
        if proc and proc.returncode is None:
            try:
                # Try to kill the entire process group (catches child
                # processes like Playwright MCP servers that may hold
                # stdout open after the main process exits).
                # os.killpg/os.getpgid are POSIX-only; fall back to
                # proc.terminate() on Windows.
                import signal
                try:
                    os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
                except (ProcessLookupError, PermissionError, OSError, AttributeError):
                    proc.terminate()
                try:
                    await asyncio.wait_for(proc.wait(), timeout=5)
                except asyncio.TimeoutError:
                    try:
                        os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
                    except (ProcessLookupError, PermissionError, OSError, AttributeError):
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
        # On Windows, prefer .cmd/.exe wrappers over bare npm bash shims
        if platform.system() == "Windows":
            claude_bin = shutil.which("claude.cmd") or shutil.which("claude.exe") or shutil.which("claude")
        else:
            claude_bin = shutil.which("claude")
        if not claude_bin:
            raise FileNotFoundError(
                "claude CLI not found. Install with: curl -fsSL https://claude.ai/install.sh | bash"
            )

        system_prompt = "\n" + build_claude_system_prompt(
            agent_name=self.agent_name,
            workspace_id=self.workspace_id,
            channel_name=channel_name,
            mode=self._mode,
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
        else:
            cmd.append("--dangerously-skip-permissions")
            allowed = mcp_tools + mcp_write_tools + ["Read", "Write", "Edit", "Bash", "Glob", "Grep"]

        cmd.extend(["--append-system-prompt", system_prompt])
        cmd.extend(["--allowedTools"] + allowed)
        cmd.extend(["--disallowedTools", "AskUserQuestion"])

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

        # Resolve absolute path to openagents binary so the MCP server
        # subprocess works even when the CLI isn't on the default PATH
        # (e.g. installed via pipx or virtualenv on macOS).
        is_windows = platform.system() == "Windows"

        # Try to find openagents with proper extension on Windows
        if is_windows:
            oa_bin = shutil.which("openagents.cmd") or shutil.which("openagents.exe") or shutil.which("openagents")
        else:
            oa_bin = shutil.which("openagents")

        if not oa_bin:
            # Check next to the current Python interpreter (virtualenv/pipx)
            candidates = []
            if is_windows:
                candidates = [
                    Path(sys.executable).parent / "openagents.cmd",
                    Path(sys.executable).parent / "openagents.exe",
                    Path(sys.executable).parent / "Scripts" / "openagents.cmd",
                    Path(sys.executable).parent / "Scripts" / "openagents.exe",
                ]
            else:
                candidates = [Path(sys.executable).parent / "openagents"]

            for candidate in candidates:
                if candidate.exists():
                    oa_bin = str(candidate)
                    break
        if not oa_bin:
            # Check common user install location (pip install --user)
            user_bin = Path.home() / ".local" / "bin" / "openagents"
            if user_bin.exists():
                oa_bin = str(user_bin)
        if not oa_bin:
            # Check Homebrew location on macOS
            homebrew_bin = Path("/opt/homebrew/bin/openagents")
            if homebrew_bin.exists():
                oa_bin = str(homebrew_bin)
        if not oa_bin:
            # Last resort: bare name and hope PATH is set
            logger.warning(
                "Could not find openagents binary in common locations. "
                "Using 'openagents' and hoping it's in PATH. "
                "MCP tools may not be available."
            )
            oa_bin = "openagents"
        else:
            logger.debug(f"Using openagents binary at: {oa_bin}")

        mcp_config = {
            "mcpServers": {
                "openagents-workspace": {
                    "type": "stdio",
                    "command": oa_bin,
                    "args": mcp_args,
                    "env": {"OA_WORKSPACE_TOKEN": self.token},
                },
            },
        }

        # Write MCP config to a temp file instead of passing inline JSON.
        # On Windows, cmd.exe /c mangles nested double quotes in arguments,
        # so inline JSON via --mcp-config breaks.  A file path is safe
        # on all platforms.
        mcp_dir = Path.home() / ".openagents" / "mcp-configs"
        mcp_dir.mkdir(parents=True, exist_ok=True)
        mcp_file = tempfile.NamedTemporaryFile(
            mode="w", suffix=".json", dir=mcp_dir, delete=False,
        )
        json.dump(mcp_config, mcp_file)
        mcp_file.close()
        cmd.extend(["--mcp-config", mcp_file.name])

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
                        self._save_sessions()
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

        mcp_config_file = None
        try:
            cmd = self._build_claude_cmd(content, msg_channel)
            # Track the temp MCP config file for cleanup
            try:
                idx = cmd.index("--mcp-config")
                mcp_config_file = cmd[idx + 1]
            except (ValueError, IndexError):
                pass
        except FileNotFoundError as e:
            await self._send_error(msg_channel, str(e))
            return

        # Build clean env without CLAUDECODE to allow nested sessions
        clean_env = {
            k: v for k, v in os.environ.items()
            if k not in ("CLAUDECODE", "CLAUDE_CODE_SESSION")
        }

        try:
            # On Windows, .cmd files need cmd.exe to interpret them, and
            # start_new_session (setsid) is POSIX-only.
            is_windows = platform.system() == "Windows"
            if is_windows and cmd[0].lower().endswith(".cmd"):
                cmd = ["cmd.exe", "/c"] + cmd

            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=clean_env,
                cwd=self.working_dir,
                limit=10 * 1024 * 1024,  # 10 MB line buffer (default 64KB too small for large tool outputs)
                start_new_session=not is_windows,  # setsid is POSIX-only
            )
            self._current_process = process
            self._channel_processes[msg_channel] = process

            # last_response_text holds the text from the most recent
            # assistant turn.  Earlier turns are intermediate reasoning
            # (already streamed as "thinking"); the last one is the
            # final answer we post as "chat" when the process exits.
            last_response_text: list[str] = []
            has_tool_use_since_last_text = False
            posted_thinking = False
            idle_notified = False
            consecutive_timeouts = 0

            # Read stream-json output line by line
            while True:
                try:
                    line = await asyncio.wait_for(
                        process.stdout.readline(), timeout=15.0,
                    )
                    consecutive_timeouts = 0
                except asyncio.TimeoutError:
                    consecutive_timeouts += 1
                    # Check if process has already exited
                    if process.returncode is not None:
                        logger.info(f"Process exited (rc={process.returncode}) but stdout not closed — breaking")
                        break
                    # Long pause — likely compaction or rate-limiting
                    if not idle_notified:
                        idle_notified = True
                        await self._send_status(
                            msg_channel,
                            "Compacting conversation...",
                        )
                    # Safety: if we've been timing out for >5 minutes with no
                    # output, the process is likely hung. Kill it.
                    if consecutive_timeouts > 20:  # 20 * 15s = 5 minutes
                        logger.warning(f"Process unresponsive for {consecutive_timeouts * 15}s — killing")
                        await self._stop_process(process)
                        break
                    continue
                if not line:
                    break
                idle_notified = False
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
                    # Process content blocks from assistant message.
                    # Each assistant event is one turn.  Text blocks
                    # are streamed as "thinking"; tool_use blocks as
                    # "status".  We track the latest text so we can
                    # post it as the final "chat" response on exit.
                    message_data = event.get("message", {})
                    blocks = message_data.get("content", [])

                    for block in blocks:
                        block_type = block.get("type")
                        if block_type == "text":
                            text = block.get("text", "")
                            if text.strip():
                                # If there was a tool call since the last
                                # text, this is a new reasoning segment —
                                # reset the response buffer.
                                if has_tool_use_since_last_text:
                                    last_response_text = []
                                    has_tool_use_since_last_text = False
                                last_response_text.append(text.strip())
                                posted_thinking = True

                                # Post as "thinking" so users see
                                # intermediate reasoning in real-time.
                                thinking = text.strip()
                                await self.client.send_message(
                                    workspace_id=self.workspace_id,
                                    channel_name=msg_channel,
                                    token=self.token,
                                    content=thinking,
                                    sender_type="agent",
                                    sender_name=self.agent_name,
                                    message_type="thinking",
                                    metadata={"agent_mode": self._mode},
                                )
                        elif block_type == "tool_use":
                            has_tool_use_since_last_text = True
                            posted_thinking = False
                            # Clear stale text — it was already posted as
                            # "thinking".  Without this, if the process
                            # exits after a tool_use with no final text
                            # turn, the pre-tool text would be re-posted
                            # as the final "chat" response.
                            last_response_text = []
                            tool_name = block.get("name", "")
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
                        self._save_sessions()
                    if event.get("is_error"):
                        logger.warning(f"Claude error: {event.get('result', '')[:200]}")

                elif event_type == "system":
                    subtype = event.get("subtype", "")
                    message = event.get("message", "")
                    logger.debug(f"CLI system event: subtype={subtype} session={event.get('session_id')} message={str(message)[:200]}")
                    # Surface compaction events
                    if (
                        subtype in ("compact", "auto_compact", "context_pruning") or
                        "compact" in str(message).lower() or "compact" in subtype.lower()
                    ):
                        status_text = str(message) if message else "Compacting conversation..."
                        await self._send_status(msg_channel, status_text)

                elif event_type == "rate_limit_event":
                    info = event.get("rate_limit_info", {})
                    logger.debug(f"Rate limit status: {info.get('status')}")

                else:
                    logger.info(f"Unhandled event type: {event_type} — keys: {list(event.keys())}")

            await process.wait()
            self._current_process = None
            self._channel_processes.pop(msg_channel, None)

            if process.returncode != 0:
                stderr = await process.stderr.read()
                stderr_text = stderr.decode("utf-8", errors="replace").strip()
                if stderr_text:
                    logger.warning(f"CLI stderr: {stderr_text[:300]}")

            # Post the final response.  last_response_text holds text
            # from the last assistant turn (after all tool calls).
            # If posted_thinking is True, the last text was already
            # streamed as "thinking" and no tool call followed — so
            # it IS the final answer.  Post it as "chat" so the UI
            # renders it as a proper response bubble.
            if last_response_text:
                full_response = "\n".join(last_response_text).strip()
                if full_response:
                    await self._send_response(msg_channel, full_response)
            elif not posted_thinking:
                await self._send_response(msg_channel, "No response generated. Please try again.")

        except Exception as e:
            logger.exception(f"Error handling message: {e}")
            await self._send_error(msg_channel, f"Error processing message: {e}")
        finally:
            # Clean up temp MCP config file
            if mcp_config_file:
                try:
                    os.unlink(mcp_config_file)
                except OSError:
                    pass
            # Always clean up process tracking so the channel is no longer
            # considered busy.  Without this, if the subprocess exits
            # unexpectedly (crash, OOM, pipe error) the UI shows the thread
            # as stuck because no terminal event is ever posted.
            self._channel_processes.pop(msg_channel, None)
            if self._current_process is not None and self._current_process.returncode is not None:
                self._current_process = None
