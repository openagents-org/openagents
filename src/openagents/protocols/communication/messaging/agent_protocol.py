"""
Agent-level messaging protocol for OpenAgents.

This protocol enables agents to send and receive direct messages.
"""

import logging
import time
import uuid
from typing import Dict, Any, List, Optional, Callable

from openagents.core.agent_protocol_base import AgentProtocolBase

logger = logging.getLogger(__name__)


class MessagingAgentProtocol(AgentProtocolBase):
    """Agent-level messaging protocol implementation.
    
    This protocol enables agents to:
    - Send direct messages to other agents
    - Register handlers for different message types
    - Send and receive responses to messages
    """
    
    def __init__(self, agent_id: str, config: Optional[Dict[str, Any]] = None):
        """Initialize the messaging protocol for an agent.
        
        Args:
            agent_id: Unique identifier for the agent
            config: Optional configuration dictionary
        """
        super().__init__(agent_id, config)
        
        # Default configuration
        self.default_config = {
            "message_timeout": 30.0,  # seconds
            "max_message_size": 1048576  # 1MB
        }
        
        # Apply configuration
        self.config = {**self.default_config, **(config or {})}
        
        # Initialize protocol state
        self.message_handlers: Dict[str, Callable] = {}
        self.pending_responses: Dict[str, Dict[str, Any]] = {}
        
        # Set capabilities
        self._capabilities = [
            "direct-messaging",
            "request-response",
            "reliable-delivery",
            "message-history"
        ]
        
        logger.info(f"Initializing Messaging agent protocol for agent {agent_id}")
    
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
        return True
    
    def handle_message(self, message: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Handle a message sent to this protocol.
        
        Args:
            message: The message to handle
            
        Returns:
            Optional[Dict[str, Any]]: Optional response message
        """
        logger.debug(f"Agent {self.agent_id} received message: {message}")
        
        message_type = message.get("type")
        
        if message_type == "direct":
            from_agent = message.get("from_agent")
            message_type = message.get("message_type")
            content = message.get("content")
            
            if message_type in self.message_handlers:
                handler = self.message_handlers[message_type]
                success = handler(from_agent, message_type, content)
                return {"success": success}
            else:
                logger.warning(f"No handler registered for message type {message_type}")
                return {"success": False, "error": f"No handler for message type {message_type}"}
        
        # For other message types, delegate to parent class
        return super().handle_message(message)
    
    def _handle_direct_message(self, message: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Handle a direct message.
        
        Args:
            message: The direct message to handle
            
        Returns:
            Optional[Dict[str, Any]]: Optional response message
        """
        content = message.get("content", {})
        message_type = content.get("type")
        
        if message_type in self.message_handlers:
            try:
                response = self.message_handlers[message_type](message)
                return response
            except Exception as e:
                logger.error(f"Error handling message: {e}")
                return {
                    "status": "error",
                    "error": str(e)
                }
        else:
            logger.warning(f"No handler for message type: {message_type}")
            return {
                "status": "error",
                "error": f"No handler for message type: {message_type}"
            }
    
    def _handle_response_message(self, message: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Handle a response message.
        
        Args:
            message: The response message to handle
            
        Returns:
            Optional[Dict[str, Any]]: Optional response message
        """
        in_response_to = message.get("in_response_to")
        
        if not in_response_to:
            logger.warning("Response message missing in_response_to field")
            return None
        
        if in_response_to in self.pending_responses:
            # Get the callback for this response
            callback = self.pending_responses[in_response_to].get("callback")
            
            if callback:
                try:
                    callback(message)
                except Exception as e:
                    logger.error(f"Error in response callback: {e}")
            
            # Remove from pending responses
            self.pending_responses.pop(in_response_to)
        else:
            logger.warning(f"Received response for unknown request: {in_response_to}")
        
        return None
    
    def register_message_handler(self, message_type: str, handler: Callable) -> bool:
        """Register a handler for a specific message type.
        
        Args:
            message_type: Type of message to handle
            handler: Function to call when a message of this type is received
            
        Returns:
            bool: True if registration was successful, False otherwise
        """
        if message_type in self.message_handlers:
            logger.warning(f"Handler for message type {message_type} already registered")
            return False
        
        self.message_handlers[message_type] = handler
        logger.info(f"Registered handler for message type {message_type}")
        return True
    
    def unregister_message_handler(self, message_type: str) -> bool:
        """Unregister a message handler.
        
        Args:
            message_type: Type of message to stop handling
            
        Returns:
            bool: True if unregistration was successful, False otherwise
        """
        if message_type not in self.message_handlers:
            logger.warning(f"No handler registered for message type {message_type}")
            return False
        
        self.message_handlers.pop(message_type)
        return True
    
    def send_message(self, to_agent: str, message_type: str, content: Any) -> bool:
        """Send a message to another agent.
        
        Args:
            to_agent: ID of the recipient agent
            message_type: Type of message
            content: Message content
            
        Returns:
            bool: True if message was sent successfully, False otherwise
        """
        if not self.network:
            logger.error("Agent not connected to a network")
            return False
        
        message_id = str(uuid.uuid4())
        timestamp = self._get_timestamp()
        
        message = {
            "protocol": "MessagingAgentProtocol",
            "type": "direct",
            "message_id": message_id,
            "from_agent": self.agent_id,
            "to_agent": to_agent,
            "message_type": message_type,
            "timestamp": timestamp,
            "content": content
        }
        
        # Find the messaging protocol in the network
        if "MessagingNetworkProtocol" in self.network.protocols:
            messaging_protocol = self.network.protocols["MessagingNetworkProtocol"]
            return messaging_protocol.route_message(message)
        else:
            logger.error("Network does not support messaging protocol")
            return False
    
    def send_response(self, original_message: Dict[str, Any], content: Dict[str, Any]) -> str:
        """Send a response to a message.
        
        Args:
            original_message: The message to respond to
            content: Response content
            
        Returns:
            str: Message ID
        """
        if not self.network:
            logger.error("Agent not connected to a network")
            raise RuntimeError("Agent not connected to a network")
        
        message_id = str(uuid.uuid4())
        original_id = original_message.get("message_id")
        from_agent = original_message.get("from_agent")
        
        if not original_id or not from_agent:
            logger.error("Original message missing message_id or from_agent")
            raise ValueError("Original message missing message_id or from_agent")
        
        timestamp = self._get_timestamp()
        
        message = {
            "protocol": "MessagingAgentProtocol",
            "type": "response",
            "message_id": message_id,
            "in_response_to": original_id,
            "from_agent": self.agent_id,
            "to_agent": from_agent,
            "timestamp": timestamp,
            "content": content
        }
        
        # Send the message through the network's messaging protocol
        if "MessagingNetworkProtocol" in self.network.protocols:
            messaging_protocol = self.network.protocols["MessagingNetworkProtocol"]
            messaging_protocol.route_message(message)
        else:
            logger.error("Network does not have a MessagingNetworkProtocol")
            raise RuntimeError("Network does not have a MessagingNetworkProtocol")
        
        return message_id
    
    def get_agent_state(self) -> Dict[str, Any]:
        """Get the current state of the Messaging protocol for this agent.
        
        Returns:
            Dict[str, Any]: Current protocol state
        """
        return {
            "message_handlers": list(self.message_handlers.keys()),
            "pending_responses": len(self.pending_responses)
        }
    
    def _clean_expired_requests(self) -> None:
        """Clean up expired request tracking."""
        current_time = self._get_timestamp()
        expired = []
        
        for request_id, info in self.pending_responses.items():
            if current_time - info["timestamp"] > info["timeout"] * 1000:
                expired.append(request_id)
        
        for request_id in expired:
            logger.warning(f"Request {request_id} timed out")
            self.pending_responses.pop(request_id)
    
    def _get_timestamp(self) -> int:
        """Get the current timestamp.
        
        Returns:
            int: Current timestamp in milliseconds
        """
        import time
        return int(time.time() * 1000)
    
    def some_method(self):
        """Implementation of the abstract method from the base class."""
        logger.debug("MessagingAgentProtocol.some_method called")
        return True 