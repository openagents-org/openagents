"""
Remote Agent Registry for A2A Protocol.

This module provides a registry for managing remote A2A agents that have
announced their presence to the OpenAgents network. It handles:
- Agent announcement and withdrawal
- Agent Card fetching and periodic refresh
- Health checks and stale detection
- Skill collection from remote agents

Remote agents are external A2A-compatible services that expose their
capabilities via the standard Agent Card at /.well-known/agent.json
"""

import asyncio
import hashlib
import logging
import re
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, List, Optional, Callable, Awaitable, Any
from urllib.parse import urlparse

import aiohttp

from openagents.models.a2a import AgentCard, AgentSkill

logger = logging.getLogger(__name__)


class RemoteAgentStatus(str, Enum):
    """Status of a remote agent."""

    ACTIVE = "active"          # Reachable, card is fresh
    STALE = "stale"            # Failed health check, may be temporarily down
    REFRESHING = "refreshing"  # Card refresh in progress


@dataclass
class RemoteAgentEntry:
    """Entry for a remote A2A agent in the registry."""

    agent_id: str                    # Resolved agent ID
    url: str                         # A2A endpoint URL
    agent_card: Optional[AgentCard]  # Fetched from /.well-known/agent.json
    status: RemoteAgentStatus = RemoteAgentStatus.ACTIVE
    announced_at: float = field(default_factory=time.time)
    last_seen: float = field(default_factory=time.time)
    last_card_refresh: float = field(default_factory=time.time)
    failure_count: int = 0
    metadata: Dict[str, Any] = field(default_factory=dict)


# Type alias for event callbacks
RegistryEventCallback = Callable[[str, Dict[str, Any]], Awaitable[None]]


class RemoteAgentRegistry:
    """
    Registry for remote A2A agents.

    Manages the lifecycle of remote agents that announce themselves to
    the OpenAgents network via the A2A protocol.

    Features:
        - Agent announcement with URL and optional preferred ID
        - Automatic Agent Card fetching
        - Periodic card refresh
        - Health checks with stale detection
        - Automatic removal after max failures

    Configuration:
        card_refresh_interval: Seconds between card refreshes (default: 300)
        health_check_interval: Seconds between health checks (default: 60)
        max_failures_before_stale: Failures before marking stale (default: 3)
        remove_after_failures: Failures before removal (default: 10)
        request_timeout: HTTP request timeout in seconds (default: 10)
    """

    def __init__(
        self,
        config: Optional[Dict[str, Any]] = None,
        event_callback: Optional[RegistryEventCallback] = None,
    ):
        """Initialize the remote agent registry.

        Args:
            config: Registry configuration options
            event_callback: Async callback for registry events
        """
        self.config = config or {}
        self._event_callback = event_callback

        # Configuration
        self.card_refresh_interval = self.config.get("card_refresh_interval", 300)
        self.health_check_interval = self.config.get("health_check_interval", 60)
        self.max_failures_before_stale = self.config.get("max_failures_before_stale", 3)
        self.remove_after_failures = self.config.get("remove_after_failures", 10)
        self.request_timeout = self.config.get("request_timeout", 10)

        # Registry storage
        self._agents: Dict[str, RemoteAgentEntry] = {}
        self._url_to_id: Dict[str, str] = {}  # URL → agent_id mapping
        self._lock = asyncio.Lock()

        # Background tasks
        self._refresh_task: Optional[asyncio.Task] = None
        self._health_check_task: Optional[asyncio.Task] = None
        self._running = False

    async def start(self) -> None:
        """Start background tasks for refresh and health checks."""
        if self._running:
            return

        self._running = True
        self._refresh_task = asyncio.create_task(self._card_refresh_loop())
        self._health_check_task = asyncio.create_task(self._health_check_loop())
        logger.info("Remote agent registry started")

    async def stop(self) -> None:
        """Stop background tasks."""
        self._running = False

        if self._refresh_task:
            self._refresh_task.cancel()
            try:
                await self._refresh_task
            except asyncio.CancelledError:
                pass
            self._refresh_task = None

        if self._health_check_task:
            self._health_check_task.cancel()
            try:
                await self._health_check_task
            except asyncio.CancelledError:
                pass
            self._health_check_task = None

        logger.info("Remote agent registry stopped")

    async def announce(
        self,
        url: str,
        preferred_id: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> RemoteAgentEntry:
        """Announce a remote A2A agent to the registry.

        Args:
            url: The A2A endpoint URL of the remote agent
            preferred_id: Optional preferred agent ID
            metadata: Optional additional metadata

        Returns:
            The created RemoteAgentEntry

        Raises:
            ValueError: If URL is invalid or agent ID conflicts
            ConnectionError: If unable to fetch Agent Card
        """
        # Normalize URL
        url = self._normalize_url(url)

        # Check if URL already registered
        async with self._lock:
            if url in self._url_to_id:
                existing_id = self._url_to_id[url]
                logger.info(f"Agent at {url} already registered as {existing_id}")
                return self._agents[existing_id]

        # Resolve agent ID
        agent_id = self._resolve_agent_id(url, preferred_id)

        # Check for ID conflicts
        async with self._lock:
            if agent_id in self._agents:
                # ID conflict - generate unique ID
                agent_id = self._make_unique_id(agent_id)

        # Fetch Agent Card
        agent_card = await self.fetch_agent_card(url)

        # Create entry
        entry = RemoteAgentEntry(
            agent_id=agent_id,
            url=url,
            agent_card=agent_card,
            status=RemoteAgentStatus.ACTIVE,
            metadata=metadata or {},
        )

        # Store in registry
        async with self._lock:
            self._agents[agent_id] = entry
            self._url_to_id[url] = agent_id

        logger.info(f"Announced remote agent: {agent_id} at {url}")

        # Emit event
        await self._emit_event("agent.remote.announced", {
            "agent_id": agent_id,
            "url": url,
        })

        return entry

    async def withdraw(self, agent_id: str) -> bool:
        """Withdraw a remote agent from the registry.

        Args:
            agent_id: The agent ID to withdraw

        Returns:
            True if agent was withdrawn, False if not found
        """
        async with self._lock:
            if agent_id not in self._agents:
                return False

            entry = self._agents.pop(agent_id)
            if entry.url in self._url_to_id:
                del self._url_to_id[entry.url]

        logger.info(f"Withdrawn remote agent: {agent_id}")

        await self._emit_event("agent.remote.withdrawn", {
            "agent_id": agent_id,
        })

        return True

    async def get(self, agent_id: str) -> Optional[RemoteAgentEntry]:
        """Get a remote agent by ID.

        Args:
            agent_id: The agent ID to look up

        Returns:
            The agent entry if found, None otherwise
        """
        return self._agents.get(agent_id)

    async def get_by_url(self, url: str) -> Optional[RemoteAgentEntry]:
        """Get a remote agent by URL.

        Args:
            url: The A2A endpoint URL

        Returns:
            The agent entry if found, None otherwise
        """
        url = self._normalize_url(url)
        agent_id = self._url_to_id.get(url)
        if agent_id:
            return self._agents.get(agent_id)
        return None

    async def list(
        self,
        status: Optional[RemoteAgentStatus] = None,
    ) -> List[RemoteAgentEntry]:
        """List all remote agents.

        Args:
            status: Optional status filter

        Returns:
            List of remote agent entries
        """
        agents = list(self._agents.values())
        if status:
            agents = [a for a in agents if a.status == status]
        return agents

    async def list_active(self) -> List[RemoteAgentEntry]:
        """List only active remote agents."""
        return await self.list(status=RemoteAgentStatus.ACTIVE)

    def get_all_skills(self) -> List[AgentSkill]:
        """Get all skills from all active remote agents.

        Returns:
            List of AgentSkill objects with agent-prefixed IDs
        """
        skills = []
        for entry in self._agents.values():
            if entry.status != RemoteAgentStatus.ACTIVE:
                continue
            if not entry.agent_card:
                continue

            for skill in entry.agent_card.skills:
                # Create skill with prefixed ID
                prefixed_skill = AgentSkill(
                    id=f"remote.{entry.agent_id}.{skill.id}",
                    name=skill.name,
                    description=skill.description,
                    tags=["remote", entry.agent_id] + skill.tags,
                    input_modes=skill.input_modes,
                    output_modes=skill.output_modes,
                    examples=skill.examples,
                )
                skills.append(prefixed_skill)

        return skills

    async def fetch_agent_card(self, url: str) -> AgentCard:
        """Fetch an Agent Card from a remote URL.

        Args:
            url: The A2A endpoint URL

        Returns:
            The fetched AgentCard

        Raises:
            ConnectionError: If unable to fetch or parse the card
        """
        card_url = self._get_agent_card_url(url)

        try:
            timeout = aiohttp.ClientTimeout(total=self.request_timeout)
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.get(card_url) as response:
                    if response.status != 200:
                        raise ConnectionError(
                            f"Failed to fetch Agent Card: HTTP {response.status}"
                        )

                    data = await response.json()
                    card = AgentCard(**data)

                    logger.debug(f"Fetched Agent Card from {card_url}")
                    return card

        except aiohttp.ClientError as e:
            raise ConnectionError(f"Failed to fetch Agent Card: {e}")
        except Exception as e:
            raise ConnectionError(f"Failed to parse Agent Card: {e}")

    async def refresh_card(self, agent_id: str) -> Optional[AgentCard]:
        """Refresh the Agent Card for a remote agent.

        Args:
            agent_id: The agent ID to refresh

        Returns:
            The refreshed AgentCard, or None if agent not found
        """
        entry = self._agents.get(agent_id)
        if not entry:
            return None

        async with self._lock:
            entry.status = RemoteAgentStatus.REFRESHING

        try:
            card = await self.fetch_agent_card(entry.url)

            async with self._lock:
                entry.agent_card = card
                entry.last_card_refresh = time.time()
                entry.status = RemoteAgentStatus.ACTIVE
                entry.failure_count = 0

            await self._emit_event("agent.remote.card_refreshed", {
                "agent_id": agent_id,
            })

            return card

        except Exception as e:
            logger.warning(f"Failed to refresh card for {agent_id}: {e}")
            await self._handle_failure(agent_id)
            return None

    async def health_check(self, agent_id: str) -> bool:
        """Perform a health check on a remote agent.

        Args:
            agent_id: The agent ID to check

        Returns:
            True if agent is healthy, False otherwise
        """
        entry = self._agents.get(agent_id)
        if not entry:
            return False

        try:
            # Try to fetch the info endpoint or agent card
            timeout = aiohttp.ClientTimeout(total=self.request_timeout)
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.get(entry.url) as response:
                    if response.status == 200:
                        async with self._lock:
                            entry.last_seen = time.time()
                            if entry.status == RemoteAgentStatus.STALE:
                                entry.status = RemoteAgentStatus.ACTIVE
                                entry.failure_count = 0
                                await self._emit_event("agent.remote.recovered", {
                                    "agent_id": agent_id,
                                    "url": entry.url,
                                })
                        return True
        except Exception as e:
            logger.debug(f"Health check failed for {agent_id}: {e}")

        await self._handle_failure(agent_id)
        return False

    async def _handle_failure(self, agent_id: str) -> None:
        """Handle a failure for an agent."""
        entry = self._agents.get(agent_id)
        if not entry:
            return

        async with self._lock:
            entry.failure_count += 1

            if entry.failure_count >= self.remove_after_failures:
                # Remove agent
                del self._agents[agent_id]
                if entry.url in self._url_to_id:
                    del self._url_to_id[entry.url]

                logger.warning(
                    f"Removed agent {agent_id} after {entry.failure_count} failures"
                )
                await self._emit_event("agent.remote.withdrawn", {
                    "agent_id": agent_id,
                    "reason": "max_failures",
                })

            elif entry.failure_count >= self.max_failures_before_stale:
                if entry.status != RemoteAgentStatus.STALE:
                    entry.status = RemoteAgentStatus.STALE

                    await self._emit_event("agent.remote.unreachable", {
                        "agent_id": agent_id,
                        "url": entry.url,
                        "failure_count": entry.failure_count,
                    })

    async def _card_refresh_loop(self) -> None:
        """Background loop for periodic card refresh."""
        while self._running:
            try:
                await asyncio.sleep(self.card_refresh_interval)

                current_time = time.time()
                agents_to_refresh = []

                for agent_id, entry in self._agents.items():
                    if entry.status == RemoteAgentStatus.ACTIVE:
                        if current_time - entry.last_card_refresh >= self.card_refresh_interval:
                            agents_to_refresh.append(agent_id)

                # Refresh cards in parallel
                if agents_to_refresh:
                    await asyncio.gather(
                        *[self.refresh_card(aid) for aid in agents_to_refresh],
                        return_exceptions=True,
                    )

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in card refresh loop: {e}")

    async def _health_check_loop(self) -> None:
        """Background loop for periodic health checks."""
        while self._running:
            try:
                await asyncio.sleep(self.health_check_interval)

                agent_ids = list(self._agents.keys())

                # Health check in parallel
                if agent_ids:
                    await asyncio.gather(
                        *[self.health_check(aid) for aid in agent_ids],
                        return_exceptions=True,
                    )

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in health check loop: {e}")

    async def _emit_event(self, event_name: str, data: Dict[str, Any]) -> None:
        """Emit a registry event."""
        if self._event_callback:
            try:
                await self._event_callback(event_name, data)
            except Exception as e:
                logger.debug(f"Event callback error: {e}")

    def _normalize_url(self, url: str) -> str:
        """Normalize a URL for consistent storage."""
        # Ensure scheme
        if not url.startswith(("http://", "https://")):
            url = f"https://{url}"

        # Remove trailing slash
        url = url.rstrip("/")

        return url

    def _get_agent_card_url(self, url: str) -> str:
        """Get the Agent Card URL for an endpoint."""
        url = self._normalize_url(url)
        return f"{url}/.well-known/agent.json"

    def _resolve_agent_id(
        self,
        url: str,
        preferred_id: Optional[str] = None,
    ) -> str:
        """Resolve the agent ID from URL and preferred ID.

        Args:
            url: The A2A endpoint URL
            preferred_id: Optional preferred agent ID

        Returns:
            The resolved agent ID
        """
        if preferred_id:
            # Sanitize preferred ID
            return self._sanitize_id(preferred_id)

        # Derive from URL
        return self._derive_id_from_url(url)

    def _derive_id_from_url(self, url: str) -> str:
        """Derive an agent ID from a URL.

        Examples:
            https://translate.example.com → translate-example-com
            https://api.agents.io/translator → api-agents-io-translator
        """
        parsed = urlparse(url)

        # Combine host and path
        parts = [parsed.netloc]
        if parsed.path and parsed.path != "/":
            path_parts = parsed.path.strip("/").split("/")
            parts.extend(path_parts)

        # Join and sanitize
        raw_id = "-".join(parts)
        return self._sanitize_id(raw_id)

    def _sanitize_id(self, raw_id: str) -> str:
        """Sanitize a string for use as agent ID."""
        # Convert to lowercase
        sanitized = raw_id.lower()

        # Replace non-alphanumeric with dashes
        sanitized = re.sub(r"[^a-z0-9]+", "-", sanitized)

        # Remove leading/trailing dashes
        sanitized = sanitized.strip("-")

        # Limit length
        if len(sanitized) > 64:
            sanitized = sanitized[:64]

        return sanitized or "agent"

    def _make_unique_id(self, base_id: str) -> str:
        """Make a unique ID by appending a hash suffix."""
        # Use timestamp + random for uniqueness
        unique_part = hashlib.md5(
            f"{base_id}-{time.time()}".encode()
        ).hexdigest()[:8]

        return f"{base_id}-{unique_part}"

    def agent_count(self) -> int:
        """Get the number of registered agents."""
        return len(self._agents)

    def active_count(self) -> int:
        """Get the number of active agents."""
        return sum(
            1 for a in self._agents.values()
            if a.status == RemoteAgentStatus.ACTIVE
        )

    async def clear(self) -> None:
        """Clear all agents from the registry."""
        async with self._lock:
            self._agents.clear()
            self._url_to_id.clear()

        logger.info("Cleared remote agent registry")
