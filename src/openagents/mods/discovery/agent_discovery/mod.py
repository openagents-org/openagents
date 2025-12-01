"""
Network-level agent discovery mod for OpenAgents.

This mod allows agents to announce their capabilities to the network
and for other agents to discover agents with specific capabilities.

Features:
- Capability management (set/get capabilities)
- Agent search by capability filter
- Agent listing
- Connection/disconnection notifications
"""

import logging
import time
import copy
from dataclasses import dataclass, field
from typing import Dict, Any, Optional, List

from openagents.core.base_mod import BaseMod, mod_event_handler
from openagents.models.event import Event
from openagents.models.event_response import EventResponse

logger = logging.getLogger(__name__)

# Mod constants
MOD_NAME = "openagents.mods.discovery.agent_discovery"


@dataclass
class AgentInfo:
    """Information about a registered agent."""
    agent_id: str
    agent_group: Optional[str] = None
    capabilities: Dict[str, Any] = field(default_factory=dict)
    connected_at: float = field(default_factory=time.time)


class AgentDiscoveryMod(BaseMod):
    """Network mod for agent capability discovery.

    This mod allows agents to announce their capabilities to the network
    and for other agents to discover agents with specific capabilities.
    """

    def __init__(self, network=None):
        """Initialize the agent discovery mod.

        Args:
            network: The network to bind to
        """
        super().__init__(MOD_NAME)
        # Store agent info: {agent_id: AgentInfo}
        self._agent_registry: Dict[str, AgentInfo] = {}
        self._network = network
        logger.info("Initializing agent_discovery mod")

    def initialize(self) -> bool:
        """Initialize the mod.

        Returns:
            bool: True if initialization was successful
        """
        logger.info(f"Initializing {self.mod_name} mod")
        return True

    def shutdown(self) -> bool:
        """Shutdown the mod gracefully.

        Returns:
            bool: True if shutdown was successful
        """
        logger.info(f"Shutting down {self.mod_name} mod")
        self._agent_registry.clear()
        return True

    def get_state(self) -> Dict[str, Any]:
        """Get the current state of the mod.

        Returns:
            Dict[str, Any]: Current mod state
        """
        return {
            "agent_count": len(self._agent_registry),
            "agents": {
                agent_id: {
                    "agent_group": info.agent_group,
                    "capabilities": copy.deepcopy(info.capabilities),
                    "connected_at": info.connected_at
                }
                for agent_id, info in self._agent_registry.items()
            }
        }

    def _get_agent_group(self, agent_id: str) -> Optional[str]:
        """Get agent group from network topology.

        Args:
            agent_id: The agent ID to get group for

        Returns:
            Optional[str]: The agent's group or None
        """
        if self.network and hasattr(self.network, 'topology'):
            return self.network.topology.agent_group_membership.get(agent_id)
        return None

    async def handle_register_agent(
        self, agent_id: str, metadata: Dict[str, Any]
    ) -> Optional[EventResponse]:
        """Handle agent registration with this network mod.

        Args:
            agent_id: Unique identifier for the agent
            metadata: Agent metadata including capabilities

        Returns:
            Optional[EventResponse]: Response to the event
        """
        # Get agent group from network topology if available
        agent_group = self._get_agent_group(agent_id)

        # Extract capabilities from metadata
        capabilities = metadata.get("capabilities", {})

        # Create agent info
        agent_info = AgentInfo(
            agent_id=agent_id,
            agent_group=agent_group,
            capabilities=copy.deepcopy(capabilities),
            connected_at=time.time()
        )
        self._agent_registry[agent_id] = agent_info

        logger.info(f"Agent {agent_id} registered with discovery mod")

        # Send agent connected notification
        await self._send_agent_connected_notification(agent_info)

        return None

    async def handle_unregister_agent(self, agent_id: str) -> Optional[EventResponse]:
        """Handle agent unregistration from this network mod.

        Args:
            agent_id: Unique identifier for the agent

        Returns:
            Optional[EventResponse]: Response to the event
        """
        if agent_id in self._agent_registry:
            del self._agent_registry[agent_id]
            logger.info(f"Agent {agent_id} unregistered from discovery mod")

            # Send agent disconnected notification
            await self._send_agent_disconnected_notification(agent_id, "disconnected")

        return None

    # Event handlers using the modern decorator pattern

    @mod_event_handler("discovery.capabilities.set")
    async def _handle_capabilities_set(self, event: Event) -> Optional[EventResponse]:
        """Handle setting agent capabilities.

        Args:
            event: The event containing capabilities to set

        Returns:
            EventResponse with success status
        """
        source_id = event.source_id
        payload = event.payload or {}
        capabilities = payload.get("capabilities", {})

        if not isinstance(capabilities, dict):
            return EventResponse(
                success=False,
                message="Capabilities must be a dictionary",
                data={"error": "Invalid capabilities format"}
            )

        # Get or create agent info
        if source_id not in self._agent_registry:
            agent_group = self._get_agent_group(source_id)
            
            self._agent_registry[source_id] = AgentInfo(
                agent_id=source_id,
                agent_group=agent_group,
                capabilities={},
                connected_at=time.time()
            )

        # Update capabilities (full replace)
        self._agent_registry[source_id].capabilities = copy.deepcopy(capabilities)

        logger.info(f"Agent {source_id} updated capabilities")

        # Send capabilities updated notification
        await self._send_capabilities_updated_notification(source_id, capabilities)

        return EventResponse(
            success=True,
            message="Capabilities updated",
            data={
                "agent_id": source_id,
                "capabilities": capabilities
            }
        )

    @mod_event_handler("discovery.capabilities.get")
    async def _handle_capabilities_get(self, event: Event) -> Optional[EventResponse]:
        """Handle getting agent capabilities.

        Args:
            event: The event containing agent_id to get capabilities for

        Returns:
            EventResponse with capabilities data
        """
        payload = event.payload or {}
        agent_id = payload.get("agent_id")

        if not agent_id:
            return EventResponse(
                success=False,
                message="agent_id is required",
                data={"error": "Missing agent_id"}
            )

        if agent_id not in self._agent_registry:
            return EventResponse(
                success=True,
                message="Agent not found or has no capabilities",
                data={
                    "agent_id": agent_id,
                    "capabilities": None
                }
            )

        agent_info = self._agent_registry[agent_id]
        return EventResponse(
            success=True,
            message="Capabilities retrieved",
            data={
                "agent_id": agent_id,
                "capabilities": copy.deepcopy(agent_info.capabilities)
            }
        )

    @mod_event_handler("discovery.agents.search")
    async def _handle_agents_search(self, event: Event) -> Optional[EventResponse]:
        """Handle searching for agents by capability filter.

        Args:
            event: The event containing search filter

        Returns:
            EventResponse with matching agents
        """
        payload = event.payload or {}
        filter_query = payload.get("filter", {})

        matching_agents = []
        for agent_id, agent_info in self._agent_registry.items():
            if self._match_capabilities(filter_query, agent_info.capabilities):
                matching_agents.append({
                    "agent_id": agent_id,
                    "agent_group": agent_info.agent_group,
                    "capabilities": copy.deepcopy(agent_info.capabilities)
                })

        return EventResponse(
            success=True,
            message=f"Found {len(matching_agents)} matching agents",
            data={
                "agents": matching_agents,
                "count": len(matching_agents)
            }
        )

    @mod_event_handler("discovery.agents.list")
    async def _handle_agents_list(self, event: Event) -> Optional[EventResponse]:
        """Handle listing all connected agents.

        Args:
            event: The event containing optional filter

        Returns:
            EventResponse with all agents
        """
        payload = event.payload or {}
        filter_query = payload.get("filter")

        agents = []
        for agent_id, agent_info in self._agent_registry.items():
            # Apply filter if provided
            if filter_query:
                if not self._match_capabilities(filter_query, agent_info.capabilities):
                    continue

            agents.append({
                "agent_id": agent_id,
                "agent_group": agent_info.agent_group,
                "capabilities": copy.deepcopy(agent_info.capabilities)
            })

        return EventResponse(
            success=True,
            message=f"Found {len(agents)} agents",
            data={
                "agents": agents,
                "count": len(agents)
            }
        )

    def _match_capabilities(
        self, query: Dict[str, Any], capabilities: Dict[str, Any]
    ) -> bool:
        """Match capabilities against a query filter.

        Supports flexible matching:
        - List matching: Check if any query item exists in agent's list
        - Dict matching: Recursive matching for nested structures
        - Scalar matching: Equality check

        Args:
            query: Query parameters for capability matching
            capabilities: Agent capabilities to match against

        Returns:
            bool: True if capabilities match the query
        """
        if not query:
            return True

        for key, value in query.items():
            if key not in capabilities:
                return False

            agent_value = capabilities[key]

            if isinstance(value, list):
                # For lists, check if any item in the query list is in the agent's list
                if not isinstance(agent_value, list):
                    return False
                if not any(item in agent_value for item in value):
                    return False
            elif isinstance(value, dict):
                # For dicts, recursively check nested structure
                if not isinstance(agent_value, dict):
                    return False
                if not self._match_capabilities(value, agent_value):
                    return False
            else:
                # For simple values, check for equality
                if agent_value != value:
                    return False

        return True

    async def _send_agent_connected_notification(self, agent_info: AgentInfo) -> None:
        """Send notification when an agent connects.

        Args:
            agent_info: Information about the connected agent
        """
        if not self.network:
            return

        notification = Event(
            event_name="discovery.notification.agent_connected",
            source_id=f"mod:{self.mod_name}",
            destination_id="broadcast",
            payload={
                "agent_id": agent_info.agent_id,
                "agent_group": agent_info.agent_group,
                "capabilities": copy.deepcopy(agent_info.capabilities),
                "connected_at": agent_info.connected_at
            }
        )
        await self.send_event(notification)

    async def _send_agent_disconnected_notification(
        self, agent_id: str, reason: str
    ) -> None:
        """Send notification when an agent disconnects.

        Args:
            agent_id: ID of the disconnected agent
            reason: Reason for disconnection
        """
        if not self.network:
            return

        notification = Event(
            event_name="discovery.notification.agent_disconnected",
            source_id=f"mod:{self.mod_name}",
            destination_id="broadcast",
            payload={
                "agent_id": agent_id,
                "reason": reason
            }
        )
        await self.send_event(notification)

    async def _send_capabilities_updated_notification(
        self, agent_id: str, capabilities: Dict[str, Any]
    ) -> None:
        """Send notification when an agent's capabilities are updated.

        Args:
            agent_id: ID of the agent
            capabilities: Updated capabilities
        """
        if not self.network:
            return

        notification = Event(
            event_name="discovery.notification.capabilities_updated",
            source_id=f"mod:{self.mod_name}",
            destination_id="broadcast",
            payload={
                "agent_id": agent_id,
                "capabilities": copy.deepcopy(capabilities)
            }
        )
        await self.send_event(notification)
