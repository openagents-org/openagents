"""
Network-level messaging protocol for OpenAgents.

This protocol enables message routing between agents.
"""

import logging
import time
import uuid
from typing import Dict, Any, List, Optional, Set

from openagents.core.network_protocol_base import NetworkProtocolBase

logger = logging.getLogger(__name__)


class MessagingNetworkProtocol(NetworkProtocolBase):
    """Network-level messaging protocol implementation.
    
    This protocol enables:
    - Direct message routing between agents
    - Message history tracking
    """
    
    def __init__(self, config: Optional[Dict[str, Any]] = None):
        """Initialize the messaging protocol for a network.
        
        Args:
            config: Optional configuration dictionary
        """
        super().__init__(config)
        
        # Default configuration
        self.default_config = {
            "max_message_size": 1048576,  # 1MB
            "max_history_size": 1000,     # Number of messages to keep in history
            "cleanup_interval": 300.0     # Seconds between cleanup runs
        }
        
        # Apply configuration
        self.config = {**self.default_config, **(config or {})}
        
        # Initialize protocol state
        self.active_agents: Set[str] = set()
        self.message_queues: Dict[str, List[Dict[str, Any]]] = {}  # agent_id -> list of messages
        self.message_history: Dict[str, Dict[str, Any]] = {}  # message_id -> message
        
        # Set capabilities
        self._capabilities = [
            "direct-messaging",
            "request-response",
            "reliable-delivery",
            "message-history"
        ]
        
        # Configuration
        self.max_history_size = self.config["max_history_size"]
        
        # Add a callback for message handling
        self.on_message_received = None
        
        logger.info("Initializing Messaging network protocol")
    
    @property
    def capabilities(self) -> List[str]:
        """Get the capabilities of this protocol.
        
        Returns:
            List[str]: List of capabilities
        """
        return self._capabilities
    
    def initialize(self) -> bool:
        """Initialize the protocol.
        
        Returns:
            bool: True if initialization was successful, False otherwise
        """
        return True
    
    def shutdown(self) -> bool:
        """Shutdown the protocol.
        
        Returns:
            bool: True if shutdown was successful, False otherwise
        """
        # Clear all state
        self.active_agents.clear()
        self.message_queues.clear()
        self.message_history.clear()
        
        return True
    
    def register_agent(self, agent_id: str, metadata: Dict[str, Any]) -> bool:
        """Register an agent with this protocol.
        
        Args:
            agent_id: Unique identifier for the agent
            metadata: Agent metadata
            
        Returns:
            bool: True if registration was successful, False otherwise
        """
        self.active_agents.add(agent_id)
        self.message_queues[agent_id] = []
        logger.info(f"Registered agent {agent_id} with Messaging protocol")
        return True
    
    def unregister_agent(self, agent_id: str) -> bool:
        """Unregister an agent from this protocol.
        
        Args:
            agent_id: ID of the agent to unregister
            
        Returns:
            bool: True if unregistration was successful, False otherwise
        """
        if agent_id not in self.active_agents:
            logger.warning(f"Agent {agent_id} not registered with Messaging protocol")
            return False
        
        # Remove message queue
        if agent_id in self.message_queues:
            self.message_queues.pop(agent_id)
        
        self.active_agents.remove(agent_id)
        logger.info(f"Unregistered agent {agent_id} from Messaging protocol")
        return True
    
    def route_message(self, message: Dict[str, Any]) -> bool:
        """Route a message to its destination.
        
        Args:
            message: Message to route
            
        Returns:
            bool: True if routing was successful, False otherwise
        """
        if not self.network:
            logger.error("Network not available")
            return False
        
        to_agent = message.get("to_agent")
        from_agent = message.get("from_agent", "network")
        
        if not to_agent:
            logger.error("Message missing to_agent field")
            return False
        
        # Add the message to history
        message_id = message.get("message_id")
        if message_id:
            self._add_to_history(message_id, message)
        
        # Use the network's route_message method
        return self.network.route_message(from_agent, to_agent, message)
    
    def get_messages_for_agent(self, agent_id: str) -> List[Dict[str, Any]]:
        """Get all pending messages for an agent.
        
        Args:
            agent_id: ID of the agent
            
        Returns:
            List[Dict[str, Any]]: List of pending messages
        """
        if agent_id not in self.active_agents:
            logger.error(f"Agent {agent_id} not registered")
            return []
        
        messages = self.message_queues[agent_id]
        self.message_queues[agent_id] = []
        return messages
    
    def get_message_by_id(self, message_id: str) -> Optional[Dict[str, Any]]:
        """Get a message by its ID.
        
        Args:
            message_id: ID of the message
            
        Returns:
            Optional[Dict[str, Any]]: Message if found, None otherwise
        """
        return self.message_history.get(message_id)
    
    def get_network_state(self) -> Dict[str, Any]:
        """Get the current state of the Messaging protocol.
        
        Returns:
            Dict[str, Any]: Current protocol state
        """
        return {
            "active_agents": len(self.active_agents),
            "pending_messages": sum(len(queue) for queue in self.message_queues.values()),
            "message_history_size": len(self.message_history)
        }
    
    def _add_to_history(self, message_id: str, message: Dict[str, Any]) -> None:
        """Add a message to the history.
        
        Args:
            message_id: ID of the message
            message: The message to add
        """
        self.message_history[message_id] = message
        
        # Trim history if it exceeds the maximum size
        if len(self.message_history) > self.max_history_size:
            # Remove oldest messages
            oldest_ids = sorted(self.message_history.keys(), 
                               key=lambda k: self.message_history[k]["timestamp"])[:100]
            for old_id in oldest_ids:
                del self.message_history[old_id]
    
    def _get_timestamp(self) -> int:
        """Get the current timestamp.
        
        Returns:
            int: Current timestamp
        """
        import time
        return int(time.time() * 1000)
    
    def some_method(self):
        """Implementation of the abstract method from the base class."""
        logger.debug("MessagingNetworkProtocol.some_method called")
        return True
    
    def handle_message(self, message: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Handle a message sent to this protocol.
        
        Args:
            message: The message to handle
            
        Returns:
            Optional[Dict[str, Any]]: Optional response message
        """
        message_type = message.get("type")
        
        if message_type == "direct":
            # Route the message to its destination
            self.route_message(message)
            return None
        
        # For other message types, delegate to parent class
        return super().handle_message(message)
    
    async def handle_remote_message(self, message_data):
        """Handle a message received from a remote agent.
        
        Args:
            message_data (dict): The message data
        """
        # Call the message handler if registered
        if self.on_message_received:
            await self.on_message_received(message_data)
        
        if message_data.get("message_type") != "agent_message":
            return
            
        target_id = message_data.get("target_agent_id")
        source_id = message_data.get("source_agent_id")
        content = message_data.get("content")
        
        # Find the target agent in the network
        target_agent = self.network.agents.get(target_id)
        if target_agent:
            # Deliver the message to the local agent
            await self.deliver_message(source_id, target_id, content)
    
    async def deliver_message(self, source_id, target_id, content):
        """Deliver a message to a local agent.
        
        Args:
            source_id (str): ID of the source agent
            target_id (str): ID of the target agent
            content (Any): Message content
        """
        # Find the target agent
        target_agent = self.network.agents.get(target_id)
        if not target_agent:
            print(f"Target agent {target_id} not found in network")
            return False
        
        # Create a message object
        message = {
            "type": "direct",
            "from_agent": source_id,
            "to_agent": target_id,
            "content": content,
            "timestamp": int(time.time() * 1000)
        }
        
        # Deliver the message to the agent
        if hasattr(target_agent, "handle_message"):
            target_agent.handle_message(message)
            return True
        
        return False
    
    async def send_message(self, source_id, target_id, content):
        """Send a message from one agent to another.
        
        Args:
            source_id (str): ID of the source agent
            target_id (str): ID of the target agent
            content (Any): Message content
        """
        # Check if target agent is in the local network
        if target_id in self.network.agents:
            # Use existing local delivery
            await self.deliver_message(source_id, target_id, content)
        else:
            # Try to send to a remote agent
            await self.send_remote_message(target_id, "agent_message", content) 