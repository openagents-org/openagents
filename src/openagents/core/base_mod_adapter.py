from typing import Dict, Any, Optional, List
from abc import ABC, abstractmethod
from openagents.core.connectors.grpc_connector import GRPCNetworkConnector
from openagents.models.messages import Event, EventNames
from openagents.models.event import Event
from openagents.models.tool import AgentTool
from openagents.models.event_thread import EventThread


class BaseModAdapter(ABC):
    """Base class for agent adapter level mods in OpenAgents.

    Agent adapter mods define behaviors and capabilities for individual agents
    within the network.
    """

    def __init__(self, mod_name: str):
        """Initialize the mod adapter.

        Args:
            name: The name of the mod adapter
        """
        self._mod_name = mod_name
        self._agent_id = None
        self._connector = None
        self._agent_client = None

    def bind_agent(self, agent_id: str) -> None:
        """Bind this mod adapter to an agent.

        Args:
            agent_id: Unique identifier for the agent to bind to
        """
        self._agent_id = agent_id

    def bind_connector(self, connector: GRPCNetworkConnector) -> None:
        """Bind this mod adapter to a connector.

        Args:
            connector: The connector to bind to
        """
        self._connector = connector

    def bind_client(self, client) -> None:
        """Bind this mod adapter to an agent client.

        Args:
            client: The AgentClient to bind to
        """
        self._agent_client = client

    @property
    def agent_client(self):
        """Get the agent client for the mod adapter.

        Returns:
            AgentClient: The agent client for the mod adapter
        """
        return self._agent_client

    @property
    def connector(self) -> GRPCNetworkConnector:
        """Get the connector for the mod adapter.

        Returns:
            GRPCNetworkConnector: The connector for the mod adapter
        """
        return self._connector

    @property
    def mod_name(self) -> str:
        """Get the name of the mod adapter.

        Returns:
            str: The name of the mod adapter
        """
        return self._mod_name

    @property
    def agent_id(self) -> Optional[str]:
        """Get the agent ID of the mod adapter.

        Returns:
            Optional[str]: The agent ID of the mod adapter
        """
        return self._agent_id

    def on_connect(self) -> None:
        """Called when the mod adapter is connected to the network."""

    def on_disconnect(self) -> None:
        """Called when the mod adapter is disconnected from the network."""

    def initialize(self) -> bool:
        """Initialize the mod.

        Returns:
            bool: True if initialization was successful, False otherwise
        """
        return True

    def shutdown(self) -> bool:
        """Shutdown the mod gracefully.

        Returns:
            bool: True if shutdown was successful, False otherwise
        """
        return True

    async def process_incoming_event(self, event: Event) -> Optional[Event]:
        """
        Process an incoming event.

        Args:
            event: The event to process

        Returns:
            Optional[Event]: The processed event, or None for stopping the event from being processed further by other adapters.
            If this function returns None, the event will also not be added to the event thread, preventing a worker agent to respond to the event.
        """
        return event

    async def process_outgoing_event(self, event: Event) -> Optional[Event]:
        """
        Process an outgoing event.

        Args:
            event: The event to process

        Returns:
            Optional[Event]: The processed event, or None for stopping the event from being processed further by other adapters
        """
        return event

    def get_tools(self) -> List[AgentTool]:
        """Get the tools for the mod adapter.

        Returns:
            List[AgentAdapterTool]: The tools for the mod adapter
        """
        return []
