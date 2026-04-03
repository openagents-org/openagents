"""
Workspace Connector for OpenAgents

Connects agents to an OpenAgents Workspace backend via the /v1/ ONM API.
This is the native connector for the workspace — events flow through the
full mod pipeline (auth → workspace → persistence) instead of a shim.
"""

import asyncio
import logging
import time
from typing import Dict, Any, Optional, List

from openagents.config.globals import SYSTEM_EVENT_LIST_MODS
from openagents.models.event_response import EventResponse
from openagents.models.event import Event
from openagents.sdk.connectors.base import NetworkConnector

logger = logging.getLogger(__name__)


class WorkspaceConnector(NetworkConnector):
    """Connects an agent to an OpenAgents Workspace via /v1/ endpoints.

    The workspace backend implements the ONM event protocol with a full mod
    pipeline.  This connector speaks that protocol natively — no transport
    bridge or shim required.
    """

    def __init__(
        self,
        host: str,
        port: int,
        agent_id: str,
        metadata: Optional[Dict[str, Any]] = None,
        password_hash: Optional[str] = None,
        timeout: int = 30,
    ):
        super().__init__(host, port, agent_id, metadata)

        self.timeout = timeout
        self.token = password_hash or ""
        self.is_polling = True

        self.session = None
        self.base_url = f"http://{host}:{port}"
        self.aiohttp = None

        # State
        self.network_id: Optional[str] = None
        self._poll_cursor: Optional[str] = None  # event ID for cursor-based pagination
        self._heartbeat_task: Optional[asyncio.Task] = None
        self._discover_cache: Dict[str, Any] = {}
        self._seeded_events: List[Event] = []  # reserved for future use (e.g. chat-style agents)

    # ------------------------------------------------------------------
    # HTTP session helpers
    # ------------------------------------------------------------------

    async def _load_http_modules(self):
        if self.aiohttp is None:
            try:
                import aiohttp
                self.aiohttp = aiohttp
                return True
            except ImportError:
                logger.error("aiohttp is required for WorkspaceConnector")
                return False
        return True

    def _headers(self) -> Dict[str, str]:
        """Standard headers for workspace API calls."""
        h = {"Content-Type": "application/json"}
        if self.token:
            h["X-Workspace-Token"] = self.token
        return h

    # ------------------------------------------------------------------
    # connect / disconnect
    # ------------------------------------------------------------------

    async def connect_to_server(self) -> bool:
        try:
            if not await self._load_http_modules():
                return False

            connector = self.aiohttp.TCPConnector(limit=30, ttl_dns_cache=300)
            timeout = self.aiohttp.ClientTimeout(total=self.timeout)
            self.session = self.aiohttp.ClientSession(
                connector=connector, timeout=timeout, headers=self._headers(),
            )

            # 1. Health check
            async with self.session.get(f"{self.base_url}/api/health") as resp:
                if resp.status != 200:
                    logger.error("Workspace health check failed: HTTP %d", resp.status)
                    return False
                health = await resp.json()
                if isinstance(health.get("data"), dict):
                    health = health["data"]
                if not health.get("success", health.get("is_running", False)):
                    logger.error("Workspace is not running")
                    return False

            # 2. Join the workspace
            join_body = {
                "agent_name": self.agent_id,
                "token": self.token,
            }
            if self.network_id:
                join_body["network"] = self.network_id

            async with self.session.post(
                f"{self.base_url}/v1/join", json=join_body,
            ) as resp:
                if resp.status != 200:
                    body = await resp.text()
                    logger.error("Workspace join failed: HTTP %d — %s", resp.status, body)
                    return False
                join_data = (await resp.json()).get("data", {})
                self.network_id = join_data.get("network_id", self.network_id)
                logger.info("Joined workspace %s as %s (role=%s)",
                            self.network_id, self.agent_id, join_data.get("role"))

            if not self.network_id:
                logger.error("No network_id after join — cannot proceed")
                return False

            # 3. Discover (cache mods, channels, agents)
            await self._refresh_discover()

            # 4. Seed poll cursor with recent history
            await self._seed_history()

            # 5. Start heartbeat
            self._heartbeat_task = asyncio.create_task(self._heartbeat_loop())

            self.is_connected = True
            logger.info("WorkspaceConnector connected to %s:%s", self.host, self.port)
            return True

        except Exception as e:
            logger.error("WorkspaceConnector connect failed: %s", e)
            return False

    async def disconnect(self) -> bool:
        try:
            self.is_connected = False

            if self._heartbeat_task and not self._heartbeat_task.done():
                self._heartbeat_task.cancel()
                try:
                    await self._heartbeat_task
                except asyncio.CancelledError:
                    pass

            if self.session and self.network_id:
                try:
                    await self.session.post(
                        f"{self.base_url}/v1/leave",
                        json={"agent_name": self.agent_id, "network": self.network_id},
                        timeout=self.aiohttp.ClientTimeout(total=5),
                    )
                except Exception as e:
                    logger.warning("Failed to leave workspace: %s", e)

            if self.session:
                await self.session.close()
                await asyncio.sleep(0.1)
                self.session = None

            logger.info("WorkspaceConnector disconnected")
            return True
        except Exception as e:
            logger.error("WorkspaceConnector disconnect error: %s", e)
            return False

    # ------------------------------------------------------------------
    # send_event — translate SDK Event → ONM /v1/events
    # ------------------------------------------------------------------

    async def send_event(self, message: Event) -> EventResponse:
        if not self.is_connected:
            return self._create_error_response("Not connected")

        # Intercept system list_mods event — return cached discover data
        if message.event_name == SYSTEM_EVENT_LIST_MODS:
            return self._handle_list_mods()

        # Intercept mod retrieval/query events — handle via workspace API
        if message.event_name == "thread.channel_messages.retrieve":
            return await self._handle_retrieve_channel_messages(message)
        if message.event_name == "thread.channels.list":
            return await self._handle_list_channels(message)

        if not self._validate_event(message):
            return self._create_error_response("Event validation failed")

        # Translate SDK Event → ONM /v1/events format
        payload = message.payload or {}
        channel = payload.get("channel", "")
        content = payload.get("content", "")
        if isinstance(content, dict):
            content = content.get("text", "")

        # Build ONM event
        source = message.source_id or self.agent_id
        if not source.startswith("openagents:"):
            source = f"openagents:{source}"

        target = f"channel/{channel}" if channel else message.destination_id or ""

        onm_payload = {"content": str(content), "message_type": payload.get("message_type", "chat"), "sender_type": "agent"}
        if payload.get("reply_to_id"):
            onm_payload["reply_to_id"] = payload["reply_to_id"]
        if payload.get("mentions"):
            onm_payload["mentions"] = payload["mentions"]

        body = {
            "type": "workspace.message.posted",
            "source": source,
            "target": target,
            "payload": onm_payload,
            "metadata": message.metadata or {},
            "visibility": "channel",
            "network": self.network_id,
        }

        try:
            async with self.session.post(
                f"{self.base_url}/v1/events", json=body,
            ) as resp:
                resp_data = await resp.json()
                data = resp_data.get("data")
                if resp.status == 200 and resp_data.get("code", -1) == 0:
                    logger.info("Sent event to %s: %s", target, str(content)[:80])
                    return self._create_success_response("Event sent", data)
                else:
                    msg = resp_data.get("message", "Unknown error")
                    logger.error("Failed to send event: %s", msg)
                    return self._create_error_response(msg)
        except Exception as e:
            logger.error("send_event error: %s", e)
            return self._create_error_response(str(e))

    # ------------------------------------------------------------------
    # poll_messages — GET /v1/events with cursor
    # ------------------------------------------------------------------

    async def poll_messages(self) -> List[Event]:
        if not self.is_connected:
            return []

        try:
            params = {
                "network": self.network_id,
                "member": self.agent_id,
                "limit": "50",
            }
            if self._poll_cursor:
                params["after"] = self._poll_cursor

            async with self.session.get(
                f"{self.base_url}/v1/events", params=params,
            ) as resp:
                if resp.status != 200:
                    return []
                resp_data = await resp.json()
                data = resp_data.get("data", {})
                raw_events = data.get("events", [])

            if not raw_events:
                return []

            # Update cursor to last event
            self._poll_cursor = raw_events[-1]["id"]

            # Convert to SDK Events, skip own messages
            events = []
            agent_source = f"openagents:{self.agent_id}"
            for raw in raw_events:
                if raw.get("source") == agent_source:
                    continue
                if raw.get("type") != "workspace.message.posted":
                    continue

                event = self._workspace_event_to_sdk(raw)
                if event:
                    events.append(event)

            if events:
                logger.info("Polled %d events from workspace", len(events))

            for event in events:
                await self.consume_message(event)

            return events

        except Exception as e:
            logger.error("poll_messages error: %s", e)
            return []

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _workspace_event_to_sdk(self, raw: Dict[str, Any]) -> Optional[Event]:
        """Convert a workspace EventRecord dict to an SDK Event."""
        try:
            payload = raw.get("payload", {})
            source = raw.get("source", "")
            target = raw.get("target", "")

            # Extract channel from target (e.g., "channel/session-abc" → "session-abc")
            channel = target.removeprefix("channel/") if target.startswith("channel/") else ""

            # Strip "openagents:" prefix from source for SDK source_id
            source_id = source.removeprefix("openagents:")

            # Build SDK payload matching what the messaging adapter produces
            sdk_payload = {
                "content": payload.get("content", ""),
                "sender_id": source,
                "message_id": raw.get("id", ""),
                "channel": channel,
                "message_type": "channel_message",
                "timestamp": raw.get("timestamp", 0),
            }

            # Check for @mentions
            mentions = payload.get("mentions", [])
            if self.agent_id in mentions:
                sdk_payload["mentioned_agent_id"] = self.agent_id

            return Event(
                event_name="thread.channel_message.notification",
                source_id=source_id,
                destination_id=self.agent_id,
                event_id=raw.get("id", ""),
                timestamp=raw.get("timestamp", int(time.time())),
                payload=sdk_payload,
                metadata=raw.get("metadata") or {},
                thread_name=f"thread:channel/{channel}" if channel else None,
                text_representation=payload.get("content", ""),
            )
        except Exception as e:
            logger.error("Failed to convert workspace event: %s", e)
            return None

    def _handle_list_mods(self) -> EventResponse:
        """Return workspace mods in the format the runner expects."""
        mods = [
            {"name": "openagents.mods.workspace.messaging", "version": "1.0", "requires_adapter": True},
        ]
        return self._create_success_response("Mods listed", {"mods": mods})

    async def _handle_retrieve_channel_messages(self, message: Event) -> EventResponse:
        """Handle channel message retrieval by querying the workspace API directly."""
        payload = message.payload or {}
        channel = payload.get("channel", "")
        limit = payload.get("limit", 50)
        offset = payload.get("offset", 0)

        try:
            params = {
                "network": self.network_id,
                "channel": channel,
                "limit": str(limit),
                "sort": "desc",
            }
            async with self.session.get(
                f"{self.base_url}/v1/events", params=params,
            ) as resp:
                if resp.status != 200:
                    return self._create_error_response(f"Retrieval failed: HTTP {resp.status}")
                data = (await resp.json()).get("data", {})
                raw_events = data.get("events", [])

            # Convert to the format the adapter expects
            messages = []
            for raw in reversed(raw_events):  # oldest first
                p = raw.get("payload", {})
                source = raw.get("source", "")
                messages.append({
                    "id": raw.get("id", ""),
                    "sender_id": source,
                    "content": p.get("content", ""),
                    "timestamp": raw.get("timestamp", 0),
                    "message_type": p.get("message_type", "chat"),
                })

            # Synthesize response event and inject through the pipeline
            response_event = Event(
                event_name="thread.channel_messages.retrieve_response",
                source_id="workspace",
                destination_id=self.agent_id,
                payload={
                    "success": True,
                    "request_id": message.event_id,
                    "channel": channel,
                    "messages": messages,
                    "total_count": len(messages),
                    "offset": offset,
                    "limit": limit,
                    "has_more": len(raw_events) >= limit,
                },
            )
            await self.consume_message(response_event)

            return self._create_success_response("Messages retrieved")

        except Exception as e:
            logger.error("retrieve_channel_messages error: %s", e)
            return self._create_error_response(str(e))

    async def _handle_list_channels(self, message: Event) -> EventResponse:
        """Handle channel listing using cached discover data."""
        channels = self._discover_cache.get("channels", [])

        response_event = Event(
            event_name="thread.channels.list_response",
            source_id="workspace",
            destination_id=self.agent_id,
            payload={
                "success": True,
                "request_id": message.event_id,
                "channels": channels,
            },
        )
        await self.consume_message(response_event)

        return self._create_success_response("Channels listed")

    async def _refresh_discover(self):
        """Call /v1/discover and cache the result."""
        try:
            params = {"network": self.network_id}
            async with self.session.get(
                f"{self.base_url}/v1/discover", params=params,
            ) as resp:
                if resp.status == 200:
                    self._discover_cache = (await resp.json()).get("data", {})
                    agents = self._discover_cache.get("agents", [])
                    channels = self._discover_cache.get("channels", [])
                    logger.info("Discover: %d agents, %d channels", len(agents), len(channels))
        except Exception as e:
            logger.warning("Discover failed: %s", e)

    async def _seed_history(self):
        """Set the poll cursor to the most recent event so we don't replay history."""
        try:
            params = {
                "network": self.network_id,
                "member": self.agent_id,
                "sort": "desc",
                "limit": "1",
            }
            async with self.session.get(
                f"{self.base_url}/v1/events", params=params,
            ) as resp:
                if resp.status == 200:
                    data = (await resp.json()).get("data", {})
                    events = data.get("events", [])
                    if events:
                        self._poll_cursor = events[0]["id"]
                        logger.info("Seeded poll cursor at event %s", self._poll_cursor[:8])
        except Exception as e:
            logger.warning("Failed to seed history: %s", e)

    async def _heartbeat_loop(self):
        """Send periodic heartbeats to keep the agent online."""
        while self.is_connected:
            try:
                await asyncio.sleep(30)
                if not self.is_connected:
                    break
                await self.session.post(
                    f"{self.base_url}/v1/heartbeat",
                    json={"agent_name": self.agent_id, "network": self.network_id},
                )
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.warning("Heartbeat failed: %s", e)
