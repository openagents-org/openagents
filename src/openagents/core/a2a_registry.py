"""
A2A Agent Registry for OpenAgents.

This module provides A2A-specific agent management functionality including:
- Agent Card fetching and refreshing
- Health checking via polling
- URL-to-ID mapping
- Background tasks for card refresh and health monitoring

This keeps A2A protocol concerns separate from the core network topology.
"""

import asyncio
import hashlib
import logging
import re
import time
from typing import Awaitable, Callable, Dict, Any, List, Optional
from urllib.parse import urlparse

import aiohttp

from openagents.models.a2a import AgentCard, AgentSkill
from openagents.models.transport import TransportType, AgentConnection, RemoteAgentStatus

logger = logging.getLogger(__name__)

# Type alias for event callbacks
RegistryEventCallback = Callable[[str, Dict[str, Any]], Awaitable[None]]


class A2AAgentRegistry:
    """
    Registry for managing A2A agents.

    This class handles A2A-specific concerns:
    - Fetching and caching Agent Cards
    - Health checking remote agents
    - Managing URL-to-agent-ID mappings
    - Background tasks for periodic refresh and health checks

    The registry works alongside the main agent registry in NetworkTopology,
    providing A2A-specific functionality without polluting the core topology.
    """

    def __init__(self, config: Optional[Dict[str, Any]] = None):
        """Initialize the A2A agent registry.

        Args:
            config: Optional configuration dictionary with keys:
                - card_refresh_interval: Seconds between card refreshes (default: 300)
                - health_check_interval: Seconds between health checks (default: 60)
                - max_failures_before_stale: Failures before marking stale (default: 3)
                - remove_after_failures: Failures before removal (default: 10)
                - request_timeout: HTTP request timeout in seconds (default: 10)
        """
        config = config or {}

        # Configuration
        self.card_refresh_interval = config.get("card_refresh_interval", 300)
        self.health_check_interval = config.get("health_check_interval", 60)
        self.max_failures_before_stale = config.get("max_failures_before_stale", 3)
        self.remove_after_failures = config.get("remove_after_failures", 10)
        self.request_timeout = config.get("request_timeout", 10)

        # URL to agent_id mapping for quick lookup
        self._url_to_agent_id: Dict[str, str] = {}

        # Reference to the main agent registry (set by topology)
        self._agent_registry: Optional[Dict[str, AgentConnection]] = None

        # Event callback
        self._event_callback: Optional[RegistryEventCallback] = None

        # Background tasks
        self._card_refresh_task: Optional[asyncio.Task] = None
        self._health_check_task: Optional[asyncio.Task] = None
        self._is_running = False

    def set_agent_registry(self, registry: Dict[str, AgentConnection]) -> None:
        """Set reference to the main agent registry.

        Args:
            registry: The agent_registry dict from NetworkTopology
        """
        self._agent_registry = registry

    def set_event_callback(self, callback: RegistryEventCallback) -> None:
        """Set callback for A2A registry events.

        Args:
            callback: Async callback for registry events
        """
        self._event_callback = callback

    async def start(self) -> None:
        """Start background tasks for card refresh and health checking."""
        if self._is_running:
            return

        self._is_running = True
        self._card_refresh_task = asyncio.create_task(self._card_refresh_loop())
        self._health_check_task = asyncio.create_task(self._health_check_loop())
        logger.info("A2A Agent Registry started")

    async def stop(self) -> None:
        """Stop background tasks."""
        self._is_running = False

        if self._card_refresh_task:
            self._card_refresh_task.cancel()
            try:
                await self._card_refresh_task
            except asyncio.CancelledError:
                pass
            self._card_refresh_task = None

        if self._health_check_task:
            self._health_check_task.cancel()
            try:
                await self._health_check_task
            except asyncio.CancelledError:
                pass
            self._health_check_task = None

        logger.info("A2A Agent Registry stopped")

    # =========================================================================
    # Agent Management
    # =========================================================================

    async def announce_agent(
        self,
        url: str,
        preferred_id: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> AgentConnection:
        """Announce a remote A2A agent to the registry.

        This fetches the agent's Agent Card and creates an AgentConnection
        for registration in the main topology.

        Args:
            url: The A2A endpoint URL of the remote agent
            preferred_id: Optional preferred agent ID
            metadata: Optional additional metadata

        Returns:
            The created AgentConnection

        Raises:
            ValueError: If URL is invalid or agent ID conflicts
            ConnectionError: If unable to fetch Agent Card
        """
        if self._agent_registry is None:
            raise RuntimeError("Agent registry not set")

        # Normalize URL
        url = self._normalize_url(url)

        # Check if URL already registered
        if url in self._url_to_agent_id:
            existing_id = self._url_to_agent_id[url]
            logger.info(f"Agent at {url} already registered as {existing_id}")
            return self._agent_registry[existing_id]

        # Resolve agent ID
        agent_id = self._resolve_agent_id(url, preferred_id)

        # Check for ID conflicts
        if agent_id in self._agent_registry:
            agent_id = self._make_unique_id(agent_id)

        # Fetch Agent Card
        agent_card = await self.fetch_agent_card(url)

        # Extract capabilities from card
        capabilities = self._extract_capabilities_from_card(agent_card)

        # Create AgentConnection
        current_time = time.time()
        connection = AgentConnection(
            agent_id=agent_id,
            transport_type=TransportType.A2A,
            address=url,
            capabilities=capabilities,
            metadata=metadata or {},
            last_seen=current_time,
            agent_card=agent_card,
            remote_status=RemoteAgentStatus.ACTIVE,
            announced_at=current_time,
            last_health_check=current_time,
            failure_count=0,
        )

        # Store in registries
        self._agent_registry[agent_id] = connection
        self._url_to_agent_id[url] = agent_id

        logger.info(f"Announced A2A agent: {agent_id} at {url}")

        # Emit event
        await self._emit_event("agent.a2a.announced", {
            "agent_id": agent_id,
            "url": url,
        })

        return connection

    async def withdraw_agent(self, agent_id: str) -> bool:
        """Withdraw an A2A agent from the registry.

        Args:
            agent_id: The agent ID to withdraw

        Returns:
            True if agent was withdrawn, False if not found
        """
        if self._agent_registry is None:
            return False

        if agent_id not in self._agent_registry:
            return False

        connection = self._agent_registry[agent_id]

        # Only allow withdrawing A2A agents
        if connection.transport_type != TransportType.A2A:
            logger.warning(f"Cannot withdraw non-A2A agent: {agent_id}")
            return False

        # Clean up URL mapping
        if connection.address and connection.address in self._url_to_agent_id:
            del self._url_to_agent_id[connection.address]

        del self._agent_registry[agent_id]

        logger.info(f"Withdrawn A2A agent: {agent_id}")

        await self._emit_event("agent.a2a.withdrawn", {
            "agent_id": agent_id,
        })

        return True

    def cleanup_agent(self, agent_id: str) -> None:
        """Clean up A2A-specific data for an agent.

        Called when an agent is being unregistered from the topology.

        Args:
            agent_id: The agent ID being cleaned up
        """
        if self._agent_registry is None:
            return

        connection = self._agent_registry.get(agent_id)
        if connection and connection.address:
            if connection.address in self._url_to_agent_id:
                del self._url_to_agent_id[connection.address]

    # =========================================================================
    # Agent Queries
    # =========================================================================

    def get_a2a_agents(
        self, status: Optional[RemoteAgentStatus] = None
    ) -> List[AgentConnection]:
        """Get all A2A agents.

        Args:
            status: Optional status filter

        Returns:
            List of A2A agent connections
        """
        if self._agent_registry is None:
            return []

        agents = [
            conn for conn in self._agent_registry.values()
            if conn.transport_type == TransportType.A2A
        ]

        if status:
            agents = [a for a in agents if a.remote_status == status]

        return agents

    def get_agent_by_url(self, url: str) -> Optional[AgentConnection]:
        """Get an A2A agent by URL.

        Args:
            url: The A2A endpoint URL

        Returns:
            The agent connection if found, None otherwise
        """
        if self._agent_registry is None:
            return None

        url = self._normalize_url(url)
        agent_id = self._url_to_agent_id.get(url)
        if agent_id:
            return self._agent_registry.get(agent_id)
        return None

    def get_all_skills(self) -> List[AgentSkill]:
        """Get all skills from all active A2A agents.

        Returns:
            List of AgentSkill objects with agent-prefixed IDs
        """
        if self._agent_registry is None:
            return []

        skills = []
        for conn in self._agent_registry.values():
            if conn.transport_type != TransportType.A2A:
                continue
            if conn.remote_status != RemoteAgentStatus.ACTIVE:
                continue
            if not conn.agent_card:
                continue

            for skill in conn.agent_card.skills:
                # Create skill with prefixed ID
                prefixed_skill = AgentSkill(
                    id=f"a2a.{conn.agent_id}.{skill.id}",
                    name=skill.name,
                    description=skill.description,
                    tags=["a2a", conn.agent_id] + skill.tags,
                    input_modes=skill.input_modes,
                    output_modes=skill.output_modes,
                    examples=skill.examples,
                )
                skills.append(prefixed_skill)

        return skills

    def agent_count(self) -> int:
        """Get the number of registered A2A agents."""
        if self._agent_registry is None:
            return 0
        return len([
            c for c in self._agent_registry.values()
            if c.transport_type == TransportType.A2A
        ])

    def active_agent_count(self) -> int:
        """Get the number of active A2A agents."""
        if self._agent_registry is None:
            return 0
        return sum(
            1 for c in self._agent_registry.values()
            if c.transport_type == TransportType.A2A
            and c.remote_status == RemoteAgentStatus.ACTIVE
        )

    # =========================================================================
    # Agent Card Operations
    # =========================================================================

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

    async def refresh_agent_card(self, agent_id: str) -> Optional[AgentCard]:
        """Refresh the Agent Card for an A2A agent.

        Args:
            agent_id: The agent ID to refresh

        Returns:
            The refreshed AgentCard, or None if agent not found
        """
        if self._agent_registry is None:
            return None

        connection = self._agent_registry.get(agent_id)
        if not connection or connection.transport_type != TransportType.A2A:
            return None

        # Mark as refreshing
        connection.remote_status = RemoteAgentStatus.REFRESHING

        try:
            card = await self.fetch_agent_card(connection.address)

            connection.agent_card = card
            connection.last_health_check = time.time()
            connection.remote_status = RemoteAgentStatus.ACTIVE
            connection.failure_count = 0
            connection.capabilities = self._extract_capabilities_from_card(card)

            await self._emit_event("agent.a2a.card_refreshed", {
                "agent_id": agent_id,
            })

            return card

        except Exception as e:
            logger.warning(f"Failed to refresh card for {agent_id}: {e}")
            await self._handle_failure(agent_id)
            return None

    async def health_check_agent(self, agent_id: str) -> bool:
        """Perform a health check on an A2A agent.

        Args:
            agent_id: The agent ID to check

        Returns:
            True if agent is healthy, False otherwise
        """
        if self._agent_registry is None:
            return False

        connection = self._agent_registry.get(agent_id)
        if not connection or connection.transport_type != TransportType.A2A:
            return False

        try:
            timeout = aiohttp.ClientTimeout(total=self.request_timeout)
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.get(connection.address) as response:
                    if response.status == 200:
                        connection.last_seen = time.time()
                        connection.last_health_check = time.time()

                        if connection.remote_status == RemoteAgentStatus.STALE:
                            connection.remote_status = RemoteAgentStatus.ACTIVE
                            connection.failure_count = 0
                            await self._emit_event("agent.a2a.recovered", {
                                "agent_id": agent_id,
                                "url": connection.address,
                            })
                        return True
        except Exception as e:
            logger.debug(f"Health check failed for {agent_id}: {e}")

        await self._handle_failure(agent_id)
        return False

    # =========================================================================
    # Background Tasks
    # =========================================================================

    async def _card_refresh_loop(self) -> None:
        """Background loop for periodic card refresh."""
        while self._is_running:
            try:
                await asyncio.sleep(self.card_refresh_interval)

                if self._agent_registry is None:
                    continue

                current_time = time.time()
                agents_to_refresh = []

                for agent_id, conn in self._agent_registry.items():
                    if conn.transport_type != TransportType.A2A:
                        continue
                    if conn.remote_status == RemoteAgentStatus.ACTIVE:
                        last_refresh = conn.last_health_check or 0
                        if current_time - last_refresh >= self.card_refresh_interval:
                            agents_to_refresh.append(agent_id)

                # Refresh cards in parallel
                if agents_to_refresh:
                    await asyncio.gather(
                        *[self.refresh_agent_card(aid) for aid in agents_to_refresh],
                        return_exceptions=True,
                    )

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in card refresh loop: {e}")

    async def _health_check_loop(self) -> None:
        """Background loop for periodic health checks of A2A agents."""
        while self._is_running:
            try:
                await asyncio.sleep(self.health_check_interval)

                if self._agent_registry is None:
                    continue

                agent_ids = [
                    agent_id for agent_id, conn in self._agent_registry.items()
                    if conn.transport_type == TransportType.A2A
                ]

                # Health check in parallel
                if agent_ids:
                    await asyncio.gather(
                        *[self.health_check_agent(aid) for aid in agent_ids],
                        return_exceptions=True,
                    )

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in health check loop: {e}")

    # =========================================================================
    # Internal Helpers
    # =========================================================================

    async def _handle_failure(self, agent_id: str) -> None:
        """Handle a failure for an A2A agent."""
        if self._agent_registry is None:
            return

        connection = self._agent_registry.get(agent_id)
        if not connection or connection.transport_type != TransportType.A2A:
            return

        connection.failure_count += 1

        if connection.failure_count >= self.remove_after_failures:
            # Remove agent
            url = connection.address
            if url and url in self._url_to_agent_id:
                del self._url_to_agent_id[url]
            del self._agent_registry[agent_id]

            logger.warning(
                f"Removed A2A agent {agent_id} after {connection.failure_count} failures"
            )
            await self._emit_event("agent.a2a.withdrawn", {
                "agent_id": agent_id,
                "reason": "max_failures",
            })

        elif connection.failure_count >= self.max_failures_before_stale:
            if connection.remote_status != RemoteAgentStatus.STALE:
                connection.remote_status = RemoteAgentStatus.STALE

                await self._emit_event("agent.a2a.unreachable", {
                    "agent_id": agent_id,
                    "url": connection.address,
                    "failure_count": connection.failure_count,
                })

    async def _emit_event(self, event_name: str, data: Dict[str, Any]) -> None:
        """Emit an A2A registry event."""
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
            return self._sanitize_id(preferred_id)

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
        unique_part = hashlib.md5(
            f"{base_id}-{time.time()}".encode()
        ).hexdigest()[:8]

        return f"{base_id}-{unique_part}"

    def _extract_capabilities_from_card(self, card: AgentCard) -> List[str]:
        """Extract capabilities list from an Agent Card.

        Args:
            card: The AgentCard

        Returns:
            List of capability strings
        """
        capabilities = []

        # Add skill IDs as capabilities
        for skill in card.skills:
            capabilities.append(f"skill:{skill.id}")

        # Add card-level capabilities
        if card.capabilities:
            if card.capabilities.streaming:
                capabilities.append("streaming")
            if card.capabilities.push_notifications:
                capabilities.append("push_notifications")
            if card.capabilities.state_transition_history:
                capabilities.append("state_history")

        return capabilities
