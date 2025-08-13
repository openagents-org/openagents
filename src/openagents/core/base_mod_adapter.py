from typing import Dict, Any, Optional, List
from abc import ABC, abstractmethod
from openagents.models.messages import BaseMessage, DirectMessage, BroadcastMessage, ModMessage
from openagents.models.tool import AgentAdapterTool
from openagents.core.connector import NetworkConnector
from openagents.models.message_thread import MessageThread

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
        self._message_threads: Dict[str, MessageThread] = {}

    def bind_agent(self, agent_id: str) -> None:
        """Bind this mod adapter to an agent.
        
        Args:
            agent_id: Unique identifier for the agent to bind to
        """
        self._agent_id = agent_id
    
    def bind_connector(self, connector: NetworkConnector) -> None:
        """Bind this mod adapter to a connector.
        
        Args:
            connector: The connector to bind to
        """
        self._connector = connector
    
    @property
    def message_threads(self) -> Dict[str, MessageThread]:
        """Get the message threads for the mod adapter.
        
        Returns:
            Dict[str, MessageThread]: Dictionary of message threads
        """
        return self._message_threads
        
    @property
    def connector(self) -> NetworkConnector:
        """Get the connector for the mod adapter.
        
        Returns:
            NetworkConnector: The connector for the mod adapter
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
        """Called when the mod adapter is connected to the network.
        """
    
    def on_disconnect(self) -> None:
        """Called when the mod adapter is disconnected from the network.
        """
    
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
    
    def add_message_to_thread(self, thread_id: str, message: BaseMessage, requires_response: bool = True, text_representation: str = None) -> None:
        """Add a message to a conversation thread.
        
        Args:
            thread_id: The ID of the thread to add the message to
            message: The message to add to the thread
            requires_response: Whether the message requires a response
            text_representation: The text representation of the message
        """
        if thread_id not in self._message_threads:
            self._message_threads[thread_id] = MessageThread()
        
        # Set the fields directly on the message
        message.requires_response = requires_response
        if text_representation:
            message.text_representation = text_representation
            
        self._message_threads[thread_id].add_message(message)
    
    async def process_incoming_direct_message(self, message: DirectMessage) -> Optional[DirectMessage]:
        """Process an incoming message sent to this agent.
        
        Args:
            message: The message to handle
        
        Returns:
            Optional[DirectMessage]: The processed message, or None for stopping the message from being processed further by other adapters
        """
        return message
    
    async def process_incoming_broadcast_message(self, message: BroadcastMessage) -> Optional[BroadcastMessage]:
        """Process an incoming broadcast message.
        
        Args:
            message: The message to handle
        
        Returns:
            Optional[BroadcastMessage]: The processed message, or None for stopping the message from being processed further by other adapters
        """
        return message
    
    async def process_incoming_mod_message(self, message: ModMessage) -> Optional[ModMessage]:
        """Process an incoming mod message.
        
        Args:
            message: The message to handle
        
        Returns:
            Optional[ModMessage]: The processed message, or None for stopping the message from being processed further by other adapters
        """
        return message
    
    async def process_outgoing_direct_message(self, message: DirectMessage) -> Optional[DirectMessage]:
        """Process an outgoing message sent to another agent.
        
        Args:
            message: The message to handle
        
        Returns:
            Optional[DirectMessage]: The processed message, or None for stopping the message from being processed further by other adapters
        """
        return message
        
    async def process_outgoing_broadcast_message(self, message: BroadcastMessage) -> Optional[BroadcastMessage]:
        """Process an outgoing broadcast message.
        
        Args:
            message: The message to handle
        
        Returns:
            Optional[BroadcastMessage]: The processed message, or None for stopping the message from being processed further by other adapters
        """
        return message

    async def process_outgoing_mod_message(self, message: ModMessage) -> Optional[ModMessage]:
        """Process an outgoing mod message.
        
        Args:
            message: The message to handle
        
        Returns:
            Optional[ModMessage]: The processed message, or None for stopping the message from being processed further by other adapters
        """
        return message
    
    async def get_tools(self) -> List[AgentAdapterTool]:
        """Get the tools for the mod adapter.
        
        Returns:
            List[AgentAdapterTool]: The tools for the mod adapter
        """
        return []