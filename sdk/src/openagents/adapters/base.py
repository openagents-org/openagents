"""
Base adapter for OpenAgents workspace.

Extracts the common connectivity logic shared by all adapters:
- Event cursor management and skip-existing-events on startup
- Heartbeat loop (30s)
- Adaptive poll loop with deduplication
- Control event polling (mode changes, stop)
- Per-channel task dispatch with queuing
- Auto-titling of new channels
- Graceful shutdown with disconnect

Subclasses only need to implement ``_handle_message(msg, channel)``
and optionally override ``_on_control_action()`` for custom control events.
"""

import asyncio
import logging
from abc import ABC, abstractmethod
from typing import Optional

from openagents.workspace_client import WorkspaceClient, DEFAULT_ENDPOINT
from openagents.adapters.utils import generate_session_title, SESSION_DEFAULT_RE

logger = logging.getLogger(__name__)


class BaseAdapter(ABC):
    """Common adapter infrastructure for all agent types."""

    def __init__(
        self,
        workspace_id: str,
        channel_name: str,
        token: str,
        agent_name: str,
        endpoint: str = DEFAULT_ENDPOINT,
    ):
        self.workspace_id = workspace_id
        self.channel_name = channel_name  # default/initial channel
        self.token = token
        self.agent_name = agent_name
        self.endpoint = endpoint
        self.client = WorkspaceClient(endpoint=endpoint)
        self._last_event_id: Optional[str] = None
        self._running = False
        self._processed_ids: set = set()
        self._titled_sessions: set = set()
        self._mode: str = "execute"
        self._last_control_id: Optional[str] = None
        # Per-channel task tracking for parallel execution
        self._channel_tasks: dict[str, asyncio.Task] = {}
        self._channel_queues: dict[str, list[dict]] = {}

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    async def run(self):
        """Start the adapter: heartbeat + poll loop."""
        self._running = True
        await self._skip_existing_events()
        heartbeat_task = asyncio.create_task(self._heartbeat_loop())
        try:
            await self._poll_loop()
        except asyncio.CancelledError:
            pass
        finally:
            self._running = False
            heartbeat_task.cancel()
            try:
                await heartbeat_task
            except asyncio.CancelledError:
                pass
            await self.client.disconnect(
                self.workspace_id, self.agent_name, self.token
            )

    # ------------------------------------------------------------------
    # Event cursor / skip existing
    # ------------------------------------------------------------------

    async def _skip_existing_events(self):
        """Advance the event cursor past all existing events on startup."""
        try:
            while True:
                _, raw_cursor = await self.client.poll_pending(
                    workspace_id=self.workspace_id,
                    token=self.token,
                    agent_name=self.agent_name,
                    after=self._last_event_id,
                    limit=200,
                )
                if not raw_cursor or raw_cursor == self._last_event_id:
                    break
                self._last_event_id = raw_cursor
            if self._last_event_id:
                logger.debug(f"Skipped existing events, cursor at {self._last_event_id}")
        except Exception as e:
            logger.debug(f"Failed to skip existing events: {e}")

    # ------------------------------------------------------------------
    # Heartbeat
    # ------------------------------------------------------------------

    async def _heartbeat_loop(self):
        """Send heartbeat every 30 seconds."""
        while self._running:
            try:
                await self.client.heartbeat(
                    self.workspace_id, self.agent_name, self.token
                )
            except Exception as e:
                logger.debug(f"Heartbeat failed: {e}")
            await asyncio.sleep(30)

    # ------------------------------------------------------------------
    # Control polling
    # ------------------------------------------------------------------

    async def _poll_control(self):
        """Check for control events (mode changes, stop) targeted at this agent."""
        try:
            events = await self.client.poll_control(
                workspace_id=self.workspace_id,
                token=self.token,
                agent_name=self.agent_name,
                after=self._last_control_id,
            )
            for ev in events:
                ev_id = ev.get("id")
                if ev_id:
                    self._last_control_id = ev_id
                payload = ev.get("payload") or {}
                action = payload.get("action")
                if action == "set_mode":
                    new_mode = payload.get("mode", "execute")
                    if new_mode in ("execute", "plan") and new_mode != self._mode:
                        old_mode = self._mode
                        self._mode = new_mode
                        logger.info(f"Mode changed: {old_mode} -> {new_mode}")
                else:
                    await self._on_control_action(action, payload)
        except Exception as e:
            logger.debug(f"Control poll failed: {e}")

    async def _on_control_action(self, action: Optional[str], payload: dict):
        """Handle adapter-specific control actions. Override in subclasses."""
        pass

    async def _control_poller_loop(self):
        """Persistent background loop for control events."""
        while self._running:
            await self._poll_control()
            await asyncio.sleep(2)

    # ------------------------------------------------------------------
    # Poll loop
    # ------------------------------------------------------------------

    async def _poll_loop(self):
        """Poll for new messages across all channels and dispatch."""
        idle_count = 0
        control_task = asyncio.create_task(self._control_poller_loop())

        try:
            while self._running:
                try:
                    messages, raw_cursor = await self.client.poll_pending(
                        workspace_id=self.workspace_id,
                        token=self.token,
                        agent_name=self.agent_name,
                        after=self._last_event_id,
                    )
                except Exception as e:
                    logger.warning(f"Poll failed: {e}")
                    await asyncio.sleep(5)
                    continue

                if raw_cursor:
                    self._last_event_id = raw_cursor

                # Deduplicate
                incoming = []
                for msg in messages:
                    msg_id = msg.get("id") or msg.get("messageId")
                    if msg_id and msg_id in self._processed_ids:
                        continue
                    incoming.append(msg)

                if incoming:
                    idle_count = 0
                    for msg in incoming:
                        msg_id = msg.get("id") or msg.get("messageId")
                        if msg_id:
                            self._processed_ids.add(msg_id)
                        await self._dispatch_message(msg)
                else:
                    idle_count += 1

                # Adaptive polling: 2s active, up to 15s idle
                delay = min(2 + idle_count, 15) if not incoming else 2
                await asyncio.sleep(delay)
        finally:
            control_task.cancel()
            tasks = [t for t in self._channel_tasks.values() if t and not t.done()]
            if tasks:
                await asyncio.gather(*tasks, return_exceptions=True)

    # ------------------------------------------------------------------
    # Channel dispatch
    # ------------------------------------------------------------------

    def _is_channel_busy(self, channel: str) -> bool:
        """Check if a channel has a running task."""
        task = self._channel_tasks.get(channel)
        return task is not None and not task.done()

    async def _dispatch_message(self, msg: dict):
        """Route a message to its channel — run in parallel or queue if busy."""
        channel = msg.get("sessionId") or self.channel_name

        if self._is_channel_busy(channel):
            self._channel_queues.setdefault(channel, []).append(msg)
            try:
                await self.client.send_message(
                    workspace_id=self.workspace_id,
                    channel_name=channel,
                    token=self.token,
                    content="message queued — will process after current task",
                    sender_type="agent",
                    sender_name=self.agent_name,
                    message_type="status",
                    metadata={"agent_mode": self._mode},
                )
            except Exception:
                pass
            return

        task = asyncio.create_task(self._channel_worker(channel, msg))
        self._channel_tasks[channel] = task

    async def _channel_worker(self, channel: str, msg: dict):
        """Process a message and then drain the channel's queue."""
        try:
            await self._handle_message(msg)
        except Exception as e:
            logger.exception(f"Error in channel worker for {channel}: {e}")
            try:
                await self._send_error(channel, f"Agent error: {e}")
            except Exception:
                pass

        while True:
            queue = self._channel_queues.get(channel, [])
            if not queue:
                break
            next_msg = queue.pop(0)
            try:
                await self._handle_message(next_msg)
            except Exception as e:
                logger.exception(f"Error processing queued message in {channel}: {e}")
                try:
                    await self._send_error(channel, f"Agent error: {e}")
                except Exception:
                    pass

    # ------------------------------------------------------------------
    # Auto-title helper
    # ------------------------------------------------------------------

    async def _auto_title_channel(self, channel: str, content: str):
        """Auto-title a channel on first message (if not manually titled)."""
        if channel in self._titled_sessions:
            return
        self._titled_sessions.add(channel)
        title = generate_session_title(content)
        if not title:
            return
        try:
            info = await self.client.get_session(
                self.workspace_id, channel, self.token,
            )
            if not info.get("titleManuallySet") and SESSION_DEFAULT_RE.match(info.get("title", "")):
                await self.client.update_session(
                    self.workspace_id, channel, self.token,
                    title=title, auto_title=True,
                )
                logger.debug(f"Auto-titled channel: {title}")
        except Exception as e:
            logger.debug(f"Failed to auto-title channel: {e}")

    # ------------------------------------------------------------------
    # Status helper
    # ------------------------------------------------------------------

    async def _send_status(self, channel: str, content: str):
        """Send a status message to a channel."""
        try:
            await self.client.send_message(
                workspace_id=self.workspace_id,
                channel_name=channel,
                token=self.token,
                content=content,
                sender_type="agent",
                sender_name=self.agent_name,
                message_type="status",
                metadata={"agent_mode": self._mode},
            )
        except Exception:
            pass

    async def _send_response(self, channel: str, content: str):
        """Send a chat response to a channel."""
        await self.client.send_message(
            workspace_id=self.workspace_id,
            channel_name=channel,
            token=self.token,
            content=content,
            sender_type="agent",
            sender_name=self.agent_name,
        )

    async def _send_error(self, channel: str, error: str):
        """Send an error message to a channel."""
        try:
            await self.client.send_message(
                workspace_id=self.workspace_id,
                channel_name=channel,
                token=self.token,
                content=error,
                sender_type="agent",
                sender_name=self.agent_name,
            )
        except Exception:
            pass

    # ------------------------------------------------------------------
    # Abstract
    # ------------------------------------------------------------------

    @abstractmethod
    async def _handle_message(self, msg: dict):
        """Process a single incoming message. Must be implemented by subclasses."""
        ...
