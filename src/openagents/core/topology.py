"""
Network topology abstraction layer for OpenAgents.

This module provides the NetworkTopology abstraction and implementations
for both centralized and decentralized network topologies.

The topology layer manages both local agents (connected via gRPC, WebSocket, HTTP)
and remote A2A agents (announced via the A2A protocol).
"""

from abc import ABC, abstractmethod
from typing import Awaitable, Callable, Dict, Any, List, Optional, Set
import asyncio
import hashlib
import logging
import re
import time
import uuid
from urllib.parse import urlparse

import aiohttp

from openagents.config.globals import DEFAULT_TRANSPORT_ADDRESS
from openagents.models.event import Event
from openagents.models.a2a import AgentCard, AgentSkill

from .transports import Transport, Message
from openagents.models.transport import TransportType, AgentConnection, RemoteAgentStatus
from openagents.models.network_config import NetworkConfig, NetworkMode

logger = logging.getLogger(__name__)


# Type alias for event callbacks
RegistryEventCallback = Callable[[str, Dict[str, Any]], Awaitable[None]]


class NetworkTopology(ABC):
    """Abstract base class for network topology implementations."""

    def __init__(self, node_id: str, config: NetworkConfig):
        self.node_id = node_id
        self.config = config
        self.transports: Dict[TransportType, Transport] = {}
        self.agent_registry: Dict[str, AgentConnection] = {}
        self.is_running = False
        self.network_context = None  # NetworkContext for MCP transport, set after creation

        # Agent group membership tracking
        # Maps agent_id -> group_name
        self.agent_group_membership: Dict[str, str] = {}

        # Remote A2A agent tracking
        # Maps URL -> agent_id for quick lookup
        self._url_to_agent_id: Dict[str, str] = {}

        # Remote agent configuration (can be overridden by config)
        remote_config = getattr(config, 'remote_agents', {}) or {}
        self.card_refresh_interval = remote_config.get("card_refresh_interval", 300)
        self.health_check_interval = remote_config.get("health_check_interval", 60)
        self.max_failures_before_stale = remote_config.get("max_failures_before_stale", 3)
        self.remove_after_failures = remote_config.get("remove_after_failures", 10)
        self.request_timeout = remote_config.get("request_timeout", 10)

        # Event callback for remote agent events
        self._remote_event_callback: Optional[RegistryEventCallback] = None

        # Background tasks for remote agent management
        self._card_refresh_task: Optional[asyncio.Task] = None
        self._remote_health_check_task: Optional[asyncio.Task] = None

    @abstractmethod
    async def initialize(self) -> bool:
        """Initialize the network topology.

        Returns:
            bool: True if initialization successful
        """
        pass

    @abstractmethod
    async def shutdown(self) -> bool:
        """Shutdown the network topology.

        Returns:
            bool: True if shutdown successful
        """
        pass

    @abstractmethod
    async def register_agent(
        self,
        agent_info: AgentConnection,
        password_hash: Optional[str] = None,
        requested_group: Optional[str] = None
    ) -> bool:
        """Register an agent with the network.

        Args:
            agent_info: Information about the agent to register
            password_hash: Password hash for group authentication (optional)
            requested_group: Explicitly requested group name (optional)

        Returns:
            bool: True if registration successful
        """
        pass

    async def unregister_agent(self, agent_id: str) -> bool:
        """Unregister an agent from the network.

        Args:
            agent_id: ID of the agent to unregister

        Returns:
            bool: True if unregistration successful
        """
        await self.cleanup_agent(agent_id)
        return True

    async def is_agent_registered(self, agent_id: str) -> bool:
        """Check if an agent is registered with the network.

        Args:
            agent_id: ID of the agent to check

        Returns:
            bool: True if agent is registered, False otherwise
        """
        return agent_id in self.agent_registry

    @abstractmethod
    async def register_event_handler(self, handler: Callable[[Event], Awaitable[None]]):
        """Register an event handler to process events sent via the unified SendEvent method.

        Args:
            handler: Async function that takes an Event and processes it
        """
        pass

    async def route_event(self, event: Event) -> bool:
        """Route an event through the network to a specific agent.

        Args:
            event: Event to route

        Returns:
            bool: True if routing successful
        """
        target_agent_id = event.destination_id
        if target_agent_id is None:
            logger.warning("Cannot route event: no target_agent_id specified")
            return False
        if target_agent_id not in self.agent_registry:
            logger.warning(
                f"Cannot route event: target agent {target_agent_id} not found"
            )
            return False
        connection = self.agent_registry[target_agent_id]
        transport_type = connection.transport_type
        if transport_type in self.transports:
            return await self.transports[transport_type].send(event)

    async def record_heartbeat(self, agent_id: str):
        """Record a heartbeat for an agent."""
        if agent_id in self.agent_registry:
            self.agent_registry[agent_id].last_seen = time.time()

    def get_agent_registry(self) -> Dict[str, AgentConnection]:
        """Get all registered agents.

        Returns:
            Dict[str, AgentInfo]: Dictionary of agent ID to agent info
        """
        return self.agent_registry.copy()
    
    def get_agent_group_membership(self) -> Dict[str, str]:
        """Get all agent group membership.

        Returns:
            Dict[str, str]: Dictionary of agent ID to group name
        """
        return self.agent_group_membership.copy()

    def get_agent_connection(self, agent_id: str) -> Optional[AgentConnection]:
        """Get information about a specific agent.

        Args:
            agent_id: ID of the agent

        Returns:
            Optional[AgentConnection]: Agent connection if found, None otherwise
        """
        return self.agent_registry.get(agent_id)

    def register_event_handler(self, handler: Callable[[Event], Awaitable[None]]):
        """Register an event handler to process events sent via the unified SendEvent method.

        Args:
            handler: Async function that takes an Event and processes it
        """
        for transport in self.transports.values():
            transport.register_event_handler(handler)

    def _assign_agent_to_group(
        self,
        agent_id: str,
        metadata: Dict[str, Any],
        requested_group: Optional[str] = None,
        password_hash: Optional[str] = None
    ) -> Optional[str]:
        """Assign agent to a group based on explicit group selection or password hash matching.

        If requested_group is specified, validate it and verify password if required.
        Otherwise, fall back to legacy password-hash matching behavior.

        Args:
            agent_id: ID of the agent
            metadata: Agent metadata (unused for group assignment)
            requested_group: Explicitly requested group name (optional)
            password_hash: Password hash for group authentication (direct parameter)

        Returns:
            Optional[str]: Name of the assigned group, or None if registration should be rejected
        """
        # If explicit group is requested, use new behavior
        if requested_group:
            return self._assign_to_requested_group(agent_id, requested_group, password_hash)

        # Otherwise, use legacy password-hash matching behavior
        return self._legacy_assign_by_password(agent_id, metadata, password_hash)

    def _assign_to_requested_group(
        self,
        agent_id: str,
        requested_group: str,
        password_hash: Optional[str] = None
    ) -> Optional[str]:
        """Assign agent to explicitly requested group with password verification.

        Args:
            agent_id: ID of the agent
            requested_group: Name of the group to join
            password_hash: Password hash for group authentication

        Returns:
            Optional[str]: Name of the assigned group, or None if registration should be rejected
        """
        # Check if requested group exists
        if requested_group not in self.config.agent_groups:
            # Check if it's the default group (may not be in agent_groups)
            if requested_group == self.config.default_agent_group:
                # Default group with no password requirement
                self.agent_group_membership[agent_id] = requested_group
                logger.info(f"Agent {agent_id} assigned to default group '{requested_group}'")
                return requested_group

            logger.warning(f"Agent {agent_id} requested invalid group '{requested_group}'")
            return None

        group_config = self.config.agent_groups[requested_group]

        # Check if group requires password
        if group_config.password_hash:
            if not password_hash:
                logger.warning(
                    f"Agent {agent_id} registration rejected: password required for group '{requested_group}'"
                )
                return None
            if password_hash != group_config.password_hash:
                logger.warning(
                    f"Agent {agent_id} registration rejected: invalid password for group '{requested_group}'"
                )
                return None

        # Password valid or not required - assign to group
        self.agent_group_membership[agent_id] = requested_group
        logger.info(f"Agent {agent_id} assigned to requested group '{requested_group}'")
        return requested_group

    def _legacy_assign_by_password(
        self,
        agent_id: str,
        metadata: Dict[str, Any],
        password_hash: Optional[str] = None
    ) -> Optional[str]:
        """Legacy behavior: assign agent to group based on password hash matching.

        Agent provides password_hash during registration. Server compares against stored hash.

        Args:
            agent_id: ID of the agent
            metadata: Agent metadata (unused for group assignment)
            password_hash: Password hash for group authentication (direct parameter)

        Returns:
            Optional[str]: Name of the assigned group, or None if registration should be rejected
                         (when requires_password=True and no valid password provided)
        """
        default_group = self.config.default_agent_group

        # If no password hash provided
        if not password_hash:
            # Check if password is required
            if self.config.requires_password:
                logger.warning(f"Agent {agent_id} registration rejected: password required")
                return None
            # Otherwise assign to default group
            self.agent_group_membership[agent_id] = default_group
            return default_group

        # Try to match password hash with configured groups
        for group_name, group_config in self.config.agent_groups.items():
            if group_config.password_hash and password_hash == group_config.password_hash:
                self.agent_group_membership[agent_id] = group_name
                logger.info(f"Agent {agent_id} assigned to group '{group_name}'")
                return group_name

        # Invalid credentials
        if self.config.requires_password:
            # Reject registration if password is required but invalid
            logger.warning(
                f"Agent {agent_id} registration rejected: invalid password"
            )
            return None
        else:
            # Assign to default group if password not strictly required
            logger.warning(
                f"Agent {agent_id} provided invalid credentials, assigning to '{default_group}' group"
            )
            self.agent_group_membership[agent_id] = default_group
            return default_group

    async def cleanup_agent(self, agent_id: str):
        """Cleanup an agent's connection."""
        if agent_id in self.agent_registry:
            connection = self.agent_registry[agent_id]
            transport_type = connection.transport_type
            if transport_type in self.transports:
                self.transports[transport_type].cleanup_agent(agent_id)

            # Clean up URL mapping for remote agents
            if connection.is_remote() and connection.address:
                if connection.address in self._url_to_agent_id:
                    del self._url_to_agent_id[connection.address]

            del self.agent_registry[agent_id]

        # Remove from group membership
        if agent_id in self.agent_group_membership:
            del self.agent_group_membership[agent_id]

    # =========================================================================
    # Remote A2A Agent Management
    # =========================================================================

    def set_remote_event_callback(self, callback: RegistryEventCallback) -> None:
        """Set callback for remote agent events.

        Args:
            callback: Async callback for registry events
        """
        self._remote_event_callback = callback

    async def announce_remote_agent(
        self,
        url: str,
        preferred_id: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> AgentConnection:
        """Announce a remote A2A agent to the registry.

        This is the A2A-aligned way for external agents to join the network.
        The agent provides its A2A endpoint URL, and the network fetches its
        Agent Card to discover its capabilities.

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
        # Normalize URL
        url = self._normalize_url(url)

        # Check if URL already registered
        if url in self._url_to_agent_id:
            existing_id = self._url_to_agent_id[url]
            logger.info(f"Agent at {url} already registered as {existing_id}")
            return self.agent_registry[existing_id]

        # Resolve agent ID
        agent_id = self._resolve_agent_id(url, preferred_id)

        # Check for ID conflicts
        if agent_id in self.agent_registry:
            # ID conflict - generate unique ID
            agent_id = self._make_unique_id(agent_id)

        # Fetch Agent Card
        agent_card = await self.fetch_agent_card(url)

        # Extract capabilities from card
        capabilities = self._extract_capabilities_from_card(agent_card)

        # Create AgentConnection for remote agent
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

        # Store in registry
        self.agent_registry[agent_id] = connection
        self._url_to_agent_id[url] = agent_id

        logger.info(f"Announced remote agent: {agent_id} at {url}")

        # Emit event
        await self._emit_remote_event("agent.remote.announced", {
            "agent_id": agent_id,
            "url": url,
        })

        return connection

    async def withdraw_remote_agent(self, agent_id: str) -> bool:
        """Withdraw a remote agent from the registry.

        Args:
            agent_id: The agent ID to withdraw

        Returns:
            True if agent was withdrawn, False if not found
        """
        if agent_id not in self.agent_registry:
            return False

        connection = self.agent_registry[agent_id]

        # Only allow withdrawing remote agents
        if not connection.is_remote():
            logger.warning(f"Cannot withdraw non-remote agent: {agent_id}")
            return False

        # Clean up URL mapping
        if connection.address and connection.address in self._url_to_agent_id:
            del self._url_to_agent_id[connection.address]

        del self.agent_registry[agent_id]

        logger.info(f"Withdrawn remote agent: {agent_id}")

        await self._emit_remote_event("agent.remote.withdrawn", {
            "agent_id": agent_id,
        })

        return True

    def get_remote_agents(
        self, status: Optional[RemoteAgentStatus] = None
    ) -> List[AgentConnection]:
        """Get all remote A2A agents.

        Args:
            status: Optional status filter

        Returns:
            List of remote agent connections
        """
        agents = [
            conn for conn in self.agent_registry.values()
            if conn.is_remote()
        ]
        if status:
            agents = [a for a in agents if a.remote_status == status]
        return agents

    def get_local_agents(self) -> List[AgentConnection]:
        """Get all local agents (non-A2A).

        Returns:
            List of local agent connections
        """
        return [
            conn for conn in self.agent_registry.values()
            if not conn.is_remote()
        ]

    def get_agent_by_url(self, url: str) -> Optional[AgentConnection]:
        """Get a remote agent by URL.

        Args:
            url: The A2A endpoint URL

        Returns:
            The agent connection if found, None otherwise
        """
        url = self._normalize_url(url)
        agent_id = self._url_to_agent_id.get(url)
        if agent_id:
            return self.agent_registry.get(agent_id)
        return None

    def get_all_remote_skills(self) -> List[AgentSkill]:
        """Get all skills from all active remote agents.

        Returns:
            List of AgentSkill objects with agent-prefixed IDs
        """
        skills = []
        for conn in self.agent_registry.values():
            if not conn.is_remote():
                continue
            if conn.remote_status != RemoteAgentStatus.ACTIVE:
                continue
            if not conn.agent_card:
                continue

            for skill in conn.agent_card.skills:
                # Create skill with prefixed ID
                prefixed_skill = AgentSkill(
                    id=f"remote.{conn.agent_id}.{skill.id}",
                    name=skill.name,
                    description=skill.description,
                    tags=["remote", conn.agent_id] + skill.tags,
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

    async def refresh_agent_card(self, agent_id: str) -> Optional[AgentCard]:
        """Refresh the Agent Card for a remote agent.

        Args:
            agent_id: The agent ID to refresh

        Returns:
            The refreshed AgentCard, or None if agent not found
        """
        connection = self.agent_registry.get(agent_id)
        if not connection or not connection.is_remote():
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

            await self._emit_remote_event("agent.remote.card_refreshed", {
                "agent_id": agent_id,
            })

            return card

        except Exception as e:
            logger.warning(f"Failed to refresh card for {agent_id}: {e}")
            await self._handle_remote_failure(agent_id)
            return None

    async def health_check_remote_agent(self, agent_id: str) -> bool:
        """Perform a health check on a remote agent.

        Args:
            agent_id: The agent ID to check

        Returns:
            True if agent is healthy, False otherwise
        """
        connection = self.agent_registry.get(agent_id)
        if not connection or not connection.is_remote():
            return False

        try:
            # Try to fetch the info endpoint or agent card
            timeout = aiohttp.ClientTimeout(total=self.request_timeout)
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.get(connection.address) as response:
                    if response.status == 200:
                        connection.last_seen = time.time()
                        connection.last_health_check = time.time()

                        if connection.remote_status == RemoteAgentStatus.STALE:
                            connection.remote_status = RemoteAgentStatus.ACTIVE
                            connection.failure_count = 0
                            await self._emit_remote_event("agent.remote.recovered", {
                                "agent_id": agent_id,
                                "url": connection.address,
                            })
                        return True
        except Exception as e:
            logger.debug(f"Health check failed for {agent_id}: {e}")

        await self._handle_remote_failure(agent_id)
        return False

    async def _handle_remote_failure(self, agent_id: str) -> None:
        """Handle a failure for a remote agent."""
        connection = self.agent_registry.get(agent_id)
        if not connection or not connection.is_remote():
            return

        connection.failure_count += 1

        if connection.failure_count >= self.remove_after_failures:
            # Remove agent
            url = connection.address
            if url and url in self._url_to_agent_id:
                del self._url_to_agent_id[url]
            del self.agent_registry[agent_id]

            logger.warning(
                f"Removed agent {agent_id} after {connection.failure_count} failures"
            )
            await self._emit_remote_event("agent.remote.withdrawn", {
                "agent_id": agent_id,
                "reason": "max_failures",
            })

        elif connection.failure_count >= self.max_failures_before_stale:
            if connection.remote_status != RemoteAgentStatus.STALE:
                connection.remote_status = RemoteAgentStatus.STALE

                await self._emit_remote_event("agent.remote.unreachable", {
                    "agent_id": agent_id,
                    "url": connection.address,
                    "failure_count": connection.failure_count,
                })

    async def _card_refresh_loop(self) -> None:
        """Background loop for periodic card refresh."""
        while self.is_running:
            try:
                await asyncio.sleep(self.card_refresh_interval)

                current_time = time.time()
                agents_to_refresh = []

                for agent_id, conn in self.agent_registry.items():
                    if not conn.is_remote():
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

    async def _remote_health_check_loop(self) -> None:
        """Background loop for periodic health checks of remote agents."""
        while self.is_running:
            try:
                await asyncio.sleep(self.health_check_interval)

                agent_ids = [
                    agent_id for agent_id, conn in self.agent_registry.items()
                    if conn.is_remote()
                ]

                # Health check in parallel
                if agent_ids:
                    await asyncio.gather(
                        *[self.health_check_remote_agent(aid) for aid in agent_ids],
                        return_exceptions=True,
                    )

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in remote health check loop: {e}")

    async def _emit_remote_event(self, event_name: str, data: Dict[str, Any]) -> None:
        """Emit a remote agent registry event."""
        if self._remote_event_callback:
            try:
                await self._remote_event_callback(event_name, data)
            except Exception as e:
                logger.debug(f"Remote event callback error: {e}")

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

    def remote_agent_count(self) -> int:
        """Get the number of registered remote agents."""
        return len([c for c in self.agent_registry.values() if c.is_remote()])

    def active_remote_count(self) -> int:
        """Get the number of active remote agents."""
        return sum(
            1 for c in self.agent_registry.values()
            if c.is_remote() and c.remote_status == RemoteAgentStatus.ACTIVE
        )


class CentralizedTopology(NetworkTopology):
    """Centralized network topology using a coordinator/registry server."""

    def __init__(self, node_id: str, config: NetworkConfig):
        super().__init__(node_id, config)
        self.heartbeat_task: Optional[asyncio.Task] = None

    async def initialize(self) -> bool:
        """Initialize the centralized topology."""
        try:
            # Initialize all transports from config
            for transport_config in self.config.transports:
                transport_type = transport_config.type

                # Ensure each transport type has at most one instance
                if transport_type in self.transports:
                    logger.warning(
                        f"Transport type {transport_type} already initialized, skipping duplicate"
                    )
                    continue

                # Create transport instance based on type
                if transport_type == TransportType.HTTP:
                    from .transports import HttpTransport

                    workspace_path = self.network_context.workspace_path if self.network_context else None
                    transport = HttpTransport(transport_config.config, workspace_path=workspace_path)
                elif transport_type == TransportType.WEBSOCKET:
                    from .transports import WebSocketTransport

                    transport = WebSocketTransport(transport_config.config)
                elif transport_type == TransportType.GRPC:
                    from .transports import GRPCTransport

                    transport = GRPCTransport(transport_config.config)
                elif transport_type == TransportType.MCP:
                    from .transports import MCPTransport

                    transport = MCPTransport(
                        config=transport_config.config,
                        context=self.network_context,  # NetworkContext set by AgentNetwork
                    )
                else:
                    logger.error(f"Unsupported transport type: {transport_type}")
                    continue

                # Initialize transport
                if not await transport.initialize():
                    logger.error(f"Failed to initialize {transport_type} transport")
                    continue

                # Start listening on transport-specific port
                transport_host = transport_config.config.get(
                    "host",
                    (
                        DEFAULT_TRANSPORT_ADDRESS[transport_type]["host"]
                        if transport_type in DEFAULT_TRANSPORT_ADDRESS
                        else "0.0.0.0"
                    ),
                )
                transport_port = transport_config.config.get(
                    "port",
                    (
                        DEFAULT_TRANSPORT_ADDRESS[transport_type]["port"]
                        if transport_type in DEFAULT_TRANSPORT_ADDRESS
                        else 8000
                    ),
                )

                # Handle port: null - transport can still be initialized but won't bind to a port
                # (useful for MCP transport when serve_mcp is enabled on HTTP transport)
                if transport_port is None:
                    logger.info(
                        f"{transport_type} transport initialized with port: null (standalone binding disabled)"
                    )
                    self.transports[transport_type] = transport
                    continue

                if not await transport.listen(f"{transport_host}:{transport_port}"):
                    logger.error(
                        f"Failed to start {transport_type} transport on {transport_host}:{transport_port}"
                    )
                    continue

                # Store transport
                self.transports[transport_type] = transport
                logger.info(
                    f"Started {transport_type} transport on {transport_host}:{transport_port}"
                )

            if not self.transports:
                logger.error("No transports successfully initialized")
                return False

            # Initialize MCP on HTTP transport if serve_mcp is enabled
            if TransportType.HTTP in self.transports:
                http_transport = self.transports[TransportType.HTTP]
                if hasattr(http_transport, "_serve_mcp") and http_transport._serve_mcp:
                    # Set network context for MCP tool collection
                    if hasattr(http_transport, "network_context"):
                        http_transport.network_context = self.network_context
                    # Initialize MCP tool collector (don't fail network startup if this fails)
                    if hasattr(http_transport, "initialize_mcp"):
                        try:
                            http_transport.initialize_mcp()
                        except Exception as e:
                            logger.warning(
                                f"HTTP transport MCP initialization failed: {e}. "
                                f"MCP endpoint /mcp will be available but tools may not work."
                            )

            self.is_running = True
            self.heartbeat_task = asyncio.create_task(self._heartbeat_monitor())

            # Start remote agent background tasks
            self._card_refresh_task = asyncio.create_task(self._card_refresh_loop())
            self._remote_health_check_task = asyncio.create_task(self._remote_health_check_loop())

            logger.info(
                f"Centralized topology initialized with {len(self.transports)} transports"
            )
            return True
        except Exception as e:
            logger.error(f"Failed to initialize centralized topology: {e}")
            return False

    async def cleanup_agent(self, agent_id: str):
        """Cleanup an agent's connection."""
        if agent_id in self.agent_registry:
            connection = self.agent_registry[agent_id]
            transport_type = connection.transport_type
            if transport_type in self.transports:
                self.transports[transport_type].cleanup_agent(agent_id)
            del self.agent_registry[agent_id]

        # Remove from group membership
        if agent_id in self.agent_group_membership:
            del self.agent_group_membership[agent_id]

    async def _heartbeat_monitor(self) -> None:
        """Monitor agent connections and clean up stale ones."""
        heartbeat_interval = self.config.heartbeat_interval
        # Use connection_timeout as agent_timeout if agent_timeout not available
        agent_timeout = getattr(
            self.config, "agent_timeout", self.config.connection_timeout * 6
        )
        logger.info(
            f"Starting heartbeat monitor (interval: {heartbeat_interval}s, timeout: {agent_timeout}s)"
        )

        while self.is_running:
            try:
                current_time = asyncio.get_event_loop().time()
                stale_agents = []

                # Check all connected agents for activity
                for agent_id, connection in self.agent_registry.items():
                    time_since_activity = current_time - connection.last_seen

                    if time_since_activity > agent_timeout:
                        stale_agents.append(agent_id)
                        logger.warning(
                            f"Agent {agent_id} failed heartbeat check (inactive for {time_since_activity:.1f}s)"
                        )

                # Clean up stale agents
                for agent_id in stale_agents:
                    logger.info(f"Cleaning up stale agent {agent_id}")
                    self.unregister_agent(agent_id)

                # Wait for next heartbeat interval
                await asyncio.sleep(heartbeat_interval)

            except asyncio.CancelledError:
                logger.info("Heartbeat monitor cancelled")
                break
            except Exception as e:
                logger.error(f"Error in heartbeat monitor: {e}")
                await asyncio.sleep(heartbeat_interval)

    async def shutdown(self) -> bool:
        """Shutdown the centralized topology."""
        self.is_running = False

        if self.heartbeat_task:
            self.heartbeat_task.cancel()
            try:
                await self.heartbeat_task
            except asyncio.CancelledError:
                pass

        # Stop remote agent background tasks
        if self._card_refresh_task:
            self._card_refresh_task.cancel()
            try:
                await self._card_refresh_task
            except asyncio.CancelledError:
                pass
            self._card_refresh_task = None

        if self._remote_health_check_task:
            self._remote_health_check_task.cancel()
            try:
                await self._remote_health_check_task
            except asyncio.CancelledError:
                pass
            self._remote_health_check_task = None

        # Shutdown all transports (make a copy to avoid modification during iteration)
        for transport_type, transport in list(self.transports.items()):
            try:
                await transport.shutdown()
                logger.info(f"Shutdown {transport_type} transport")
            except Exception as e:
                logger.error(f"Error shutting down {transport_type} transport: {e}")

        self.transports.clear()
        logger.info("Centralized topology shutdown")
        return True

    async def register_agent(
        self,
        agent_info: AgentConnection,
        password_hash: Optional[str] = None,
        requested_group: Optional[str] = None
    ) -> bool:
        """Register an agent with the centralized registry."""
        # Assign agent to group based on metadata, requested_group and password_hash
        assigned_group = self._assign_agent_to_group(
            agent_info.agent_id,
            agent_info.metadata,
            requested_group=requested_group,
            password_hash=password_hash
        )

        # If group assignment returns None, reject registration
        if assigned_group is None:
            logger.warning(f"Agent {agent_info.agent_id} registration rejected by group assignment")
            return False

        self.agent_registry[agent_info.agent_id] = agent_info
        # TODO: send out an event in the system

        logger.info(f"Registered agent {agent_info.agent_id} in centralized registry (group: {assigned_group})")
        return True

    async def unregister_agent(self, agent_id: str) -> bool:
        """Unregister an agent from the centralized registry."""
        # TODO: send out an event in the system

        await super().unregister_agent(agent_id)

        logger.info(f"Unregistered agent {agent_id} from centralized registry")
        return True


class DecentralizedTopology(NetworkTopology):
    """Decentralized network topology using P2P protocols.

    Note that this topology is currently work in progress.
    """

    def __init__(self, node_id: str, config: NetworkConfig):
        super().__init__(node_id, config)
        self.bootstrap_nodes = config.bootstrap_nodes
        self.discovery_interval = config.discovery_interval
        self.dht_table: Dict[str, AgentConnection] = {}  # Distributed hash table
        self.discovery_task: Optional[asyncio.Task] = None
        self.heartbeat_task: Optional[asyncio.Task] = None
        self.connected_peers: Set[str] = set()

    async def initialize(self) -> bool:
        """Initialize the decentralized topology."""
        try:
            # Initialize all transports from config
            for transport_config in self.config.transports:
                transport_type = TransportType(transport_config.get("type", "libp2p"))

                # Ensure each transport type has at most one instance
                if transport_type in self.transports:
                    logger.warning(
                        f"Transport type {transport_type} already initialized, skipping duplicate"
                    )
                    continue

                # For now, use WebSocket as libp2p is not implemented
                if transport_type == TransportType.LIBP2P:
                    logger.warning(
                        "libp2p not implemented, falling back to WebSocket for P2P simulation"
                    )
                    transport_type = TransportType.WEBSOCKET

                # Create transport instance based on type
                if transport_type == TransportType.HTTP:
                    from .transports import HttpTransport

                    workspace_path = self.network_context.workspace_path if self.network_context else None
                    transport = HttpTransport(transport_config.get("config", {}), workspace_path=workspace_path)
                elif transport_type == TransportType.WEBSOCKET:
                    from .transports import WebSocketTransport

                    transport = WebSocketTransport(transport_config.get("config", {}))
                elif transport_type == TransportType.GRPC:
                    from .transports import GRPCTransport

                    transport = GRPCTransport(transport_config.get("config", {}))
                else:
                    logger.error(f"Unsupported transport type: {transport_type}")
                    continue

                # Initialize transport
                if not await transport.initialize():
                    logger.error(f"Failed to initialize {transport_type} transport")
                    continue

                # Start listening on transport-specific port (use 0 for random port in P2P)
                transport_port = transport_config.get("config", {}).get("port", 0)
                host = getattr(self.config, "host", "0.0.0.0")
                if not await transport.listen(f"{host}:{transport_port}"):
                    logger.error(
                        f"Failed to start {transport_type} transport on {host}:{transport_port}"
                    )
                    continue

                # Store transport
                self.transports[transport_type] = transport
                logger.info(
                    f"Started {transport_type} transport on {host}:{transport_port}"
                )

            if not self.transports:
                logger.error("No transports successfully initialized")
                return False

            self.is_running = True

            # Connect to bootstrap nodes
            await self._connect_to_bootstrap_nodes()

            # Start periodic tasks
            self.discovery_task = asyncio.create_task(self._periodic_discovery())
            self.heartbeat_task = asyncio.create_task(self._periodic_heartbeat())

            logger.info(
                f"Decentralized topology initialized with {len(self.transports)} transports"
            )
            return True
        except Exception as e:
            logger.error(f"Failed to initialize decentralized topology: {e}")
            return False

    async def shutdown(self) -> bool:
        """Shutdown the decentralized topology."""
        self.is_running = False

        if self.discovery_task:
            self.discovery_task.cancel()
        if self.heartbeat_task:
            self.heartbeat_task.cancel()

        try:
            if self.discovery_task:
                await self.discovery_task
        except asyncio.CancelledError:
            pass

        try:
            if self.heartbeat_task:
                await self.heartbeat_task
        except asyncio.CancelledError:
            pass

        # Shutdown all transports (make a copy to avoid modification during iteration)
        for transport_type, transport in list(self.transports.items()):
            try:
                await transport.shutdown()
                logger.info(f"Shutdown {transport_type} transport")
            except Exception as e:
                logger.error(f"Error shutting down {transport_type} transport: {e}")

        self.transports.clear()
        logger.info("Decentralized topology shutdown")
        return True

    async def register_agent(
        self,
        agent_info: AgentConnection,
        password_hash: Optional[str] = None,
        requested_group: Optional[str] = None
    ) -> bool:
        """Register an agent in the decentralized network."""
        try:
            # Add to local DHT
            self.dht_table[agent_info.agent_id] = agent_info
            self.agent_registry[agent_info.agent_id] = agent_info

            # Assign agent to group based on metadata, requested_group and password_hash
            assigned_group = self._assign_agent_to_group(
                agent_info.agent_id,
                agent_info.metadata,
                requested_group=requested_group,
                password_hash=password_hash
            )

            # Announce to connected peers
            await self._announce_agent(agent_info)

            logger.info(
                f"Registered agent {agent_info.agent_id} in decentralized network (group: {assigned_group})"
            )
            return True
        except Exception as e:
            logger.error(f"Failed to register agent {agent_info.agent_id}: {e}")
            return False

    async def unregister_agent(self, agent_id: str) -> bool:
        """Unregister an agent from the decentralized network."""
        try:
            if agent_id in self.dht_table:
                del self.dht_table[agent_id]
            if agent_id in self.agent_registry:
                del self.agent_registry[agent_id]

            # Announce removal to connected peers
            await self._announce_agent_removal(agent_id)

            logger.info(f"Unregistered agent {agent_id} from decentralized network")
            return True
        except Exception as e:
            logger.error(f"Failed to unregister agent {agent_id}: {e}")
            return False

    async def discover_peers(
        self, capabilities: Optional[List[str]] = None
    ) -> List[AgentConnection]:
        """Discover peers in the decentralized network."""
        try:
            # Query local DHT and connected peers
            agents = list(self.dht_table.values())

            if capabilities:
                # Filter by capabilities (agent must have ALL required capabilities)
                filtered_agents = []
                for agent in agents:
                    if all(cap in agent.capabilities for cap in capabilities):
                        filtered_agents.append(agent)
                return filtered_agents

            return agents
        except Exception as e:
            logger.error(f"Failed to discover peers: {e}")
            return []

    async def route_message(self, message: Message) -> bool:
        """Route message through decentralized topology."""
        try:
            if not self.transports:
                logger.error("No transports available for message routing")
                return False

            # Use the first available transport for routing
            # TODO: Implement transport selection strategy
            transport = next(iter(self.transports.values()))

            if message.target_id:
                # Direct message - find route to target
                if message.target_id in self.connected_peers:
                    return await transport.send(message)
                else:
                    # TODO: Implement DHT routing
                    logger.warning(
                        f"Target {message.target_id} not directly connected, DHT routing not implemented"
                    )
                    return False
            else:
                # Broadcast message - send to all connected peers
                return await transport.send(message)
        except Exception as e:
            logger.error(f"Failed to route message: {e}")
            return False

    async def _connect_to_bootstrap_nodes(self):
        """Connect to bootstrap nodes to join the network."""
        if not self.transports:
            return

        # Use the first available transport for bootstrap connections
        # TODO: Implement transport selection strategy
        transport = next(iter(self.transports.values()))

        for node_address in self.bootstrap_nodes:
            try:
                # Extract peer ID from address (simplified)
                peer_id = f"bootstrap-{uuid.uuid4().hex[:8]}"
                if await transport.connect(peer_id, node_address):
                    self.connected_peers.add(peer_id)
                    logger.info(f"Connected to bootstrap node {node_address}")
            except Exception as e:
                logger.error(f"Failed to connect to bootstrap node {node_address}: {e}")

    async def _announce_agent(self, agent_info: AgentConnection):
        """Announce an agent to connected peers."""
        if not self.transports:
            return

        announcement = Message(
            sender_id=self.node_id,
            target_id=None,  # Broadcast
            message_type="agent_announcement",
            payload={
                "agent_id": agent_info.agent_id,
                "metadata": agent_info.metadata,
                "capabilities": agent_info.capabilities,
                "address": agent_info.address,
            },
            timestamp=int(time.time()),
        )

        # Broadcast to all transports
        for transport in self.transports.values():
            try:
                await transport.send(announcement)
            except Exception as e:
                logger.error(f"Failed to send agent announcement via transport: {e}")

    async def _announce_agent_removal(self, agent_id: str):
        """Announce agent removal to connected peers."""
        if not self.transports:
            return

        announcement = Message(
            sender_id=self.node_id,
            target_id=None,  # Broadcast
            message_type="agent_removal",
            payload={"agent_id": agent_id},
            timestamp=int(time.time()),
        )

        # Broadcast to all transports
        for transport in self.transports.values():
            try:
                await transport.send(announcement)
            except Exception as e:
                logger.error(
                    f"Failed to send agent removal announcement via transport: {e}"
                )

    async def _periodic_discovery(self):
        """Periodically discover new peers."""
        while self.is_running:
            try:
                # TODO: Implement peer discovery using mDNS or DHT
                await asyncio.sleep(self.discovery_interval)
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in periodic discovery: {e}")
                await asyncio.sleep(self.discovery_interval)

    async def _periodic_heartbeat(self):
        """Send periodic heartbeats to maintain connections."""
        while self.is_running:
            try:
                if self.transports:
                    heartbeat = Message(
                        sender_id=self.node_id,
                        target_id=None,  # Broadcast
                        message_type="heartbeat",
                        payload={"timestamp": int(time.time())},
                        timestamp=int(time.time()),
                    )

                    # Send heartbeat via all transports
                    for transport in self.transports.values():
                        try:
                            await transport.send(heartbeat)
                        except Exception as e:
                            logger.error(f"Failed to send heartbeat via transport: {e}")

                await asyncio.sleep(30)  # Heartbeat every 30 seconds
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in periodic heartbeat: {e}")
                await asyncio.sleep(30)


def create_topology(
    mode: NetworkMode, node_id: str, config: NetworkConfig
) -> NetworkTopology:
    """Factory function to create network topology based on mode.

    Args:
        mode: Network operation mode
        node_id: ID of this network node
        config: Configuration for the topology

    Returns:
        NetworkTopology: Appropriate topology implementation
    """
    if mode == NetworkMode.CENTRALIZED:
        return CentralizedTopology(node_id, config)
    elif mode == NetworkMode.DECENTRALIZED:
        return DecentralizedTopology(node_id, config)
    else:
        raise ValueError(f"Unsupported network mode: {mode}")
