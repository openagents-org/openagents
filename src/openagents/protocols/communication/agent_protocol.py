from typing import Dict, Any, Optional, List, Callable, Set
import logging
import uuid
from openagents.core.agent_protocol_base import AgentProtocolBase

logger = logging.getLogger(__name__)


class CommunicationAgentProtocol(AgentProtocolBase):
    """Agent-level implementation of the Communication protocol.
    
    This protocol enables an agent to send and receive messages using different
    communication patterns.
    """
    
    def __init__(self, agent_id: str, config: Optional[Dict[str, Any]] = None):
        """Initialize the Communication agent protocol.
        
        Args:
            agent_id: Unique identifier for the agent
            config: Optional configuration dictionary
        """
        super().__init__(agent_id, config)
        self.message_handlers: Dict[str, Callable] = {}
        self.subscribed_topics: Set[str] = set()
        self.pending_responses: Dict[str, Dict[str, Any]] = {}  # message_id -> response info
    
    def initialize(self) -> bool:
        """Initialize the Communication agent protocol.
        
        Returns:
            bool: True if initialization was successful
        """
        logger.info(f"Initializing Communication agent protocol for agent {self.agent_id}")
        return True
    
    def shutdown(self) -> bool:
        """Shutdown the Communication agent protocol.
        
        Returns:
            bool: True if shutdown was successful
        """
        logger.info(f"Shutting down Communication agent protocol for agent {self.agent_id}")
        return True
    
    @property
    def capabilities(self) -> List[str]:
        """Get the capabilities provided by this protocol.
        
        Returns:
            List[str]: List of capability identifiers
        """
        return [
            "direct-messaging",
            "publish-subscribe",
            "request-response"
        ]
    
    def register_message_handler(self, message_type: str, handler: Callable) -> bool:
        """Register a handler for a specific message type.
        
        Args:
            message_type: Type of message to handle
            handler: Function to call when a message of this type is received
            
        Returns:
            bool: True if registration was successful
        """
        self.message_handlers[message_type] = handler
        logger.info(f"Registered handler for message type {message_type}")
        return True
    
    def send_message(self, to_agent_id: str, message_content: Dict[str, Any]) -> Optional[str]:
        """Send a direct message to another agent.
        
        Args:
            to_agent_id: ID of the receiving agent
            message_content: Content of the message
            
        Returns:
            Optional[str]: Message ID if sending was successful, None otherwise
        """
        if not self.network:
            logger.error(f"Agent {self.agent_id} not connected to a network")
            return None
        
        # In a real implementation, this would use the network's communication protocol
        # This is a simplified implementation
        message = {
            "protocol": "communication",
            "action": "send_message",
            "from": self.agent_id,
            "to": to_agent_id,
            "content": message_content
        }
        
        # Generate a message ID
        message_id = str(uuid.uuid4())
        
        logger.info(f"Sending message to agent {to_agent_id}")
        return message_id
    
    def send_request(self, to_agent_id: str, request_content: Dict[str, Any], 
                    timeout: float = 30.0) -> Optional[str]:
        """Send a request to another agent and expect a response.
        
        Args:
            to_agent_id: ID of the receiving agent
            request_content: Content of the request
            timeout: Timeout in seconds
            
        Returns:
            Optional[str]: Request ID if sending was successful, None otherwise
        """
        request_id = str(uuid.uuid4())
        
        # Add request-specific fields
        request_content["request_id"] = request_id
        request_content["requires_response"] = True
        
        # Track pending response
        self.pending_responses[request_id] = {
            "to": to_agent_id,
            "timestamp": self._get_timestamp(),
            "timeout": timeout
        }
        
        # Send the request as a regular message
        message_id = self.send_message(to_agent_id, request_content)
        if not message_id:
            self.pending_responses.pop(request_id, None)
            return None
        
        logger.info(f"Sent request {request_id} to agent {to_agent_id}")
        return request_id
    
    def publish_message(self, topic: str, message_content: Dict[str, Any]) -> Optional[str]:
        """Publish a message to a topic.
        
        Args:
            topic: Topic to publish to
            message_content: Content of the message
            
        Returns:
            Optional[str]: Message ID if publishing was successful, None otherwise
        """
        if not self.network:
            logger.error(f"Agent {self.agent_id} not connected to a network")
            return None
        
        # In a real implementation, this would use the network's communication protocol
        # This is a simplified implementation
        message = {
            "protocol": "communication",
            "action": "publish_message",
            "from": self.agent_id,
            "topic": topic,
            "content": message_content
        }
        
        # Generate a message ID
        message_id = str(uuid.uuid4())
        
        logger.info(f"Publishing message to topic {topic}")
        return message_id
    
    def subscribe(self, topic: str) -> bool:
        """Subscribe to a topic.
        
        Args:
            topic: Topic to subscribe to
            
        Returns:
            bool: True if subscription was successful
        """
        if not self.network:
            logger.error(f"Agent {self.agent_id} not connected to a network")
            return False
        
        # In a real implementation, this would use the network's communication protocol
        # This is a simplified implementation
        self.subscribed_topics.add(topic)
        
        logger.info(f"Subscribed to topic {topic}")
        return True
    
    def unsubscribe(self, topic: str) -> bool:
        """Unsubscribe from a topic.
        
        Args:
            topic: Topic to unsubscribe from
            
        Returns:
            bool: True if unsubscription was successful
        """
        if topic not in self.subscribed_topics:
            logger.warning(f"Not subscribed to topic {topic}")
            return False
        
        self.subscribed_topics.remove(topic)
        
        logger.info(f"Unsubscribed from topic {topic}")
        return True
    
    def handle_message(self, message: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Handle an incoming message for the Communication protocol.
        
        Args:
            message: The message to handle
            
        Returns:
            Optional[Dict[str, Any]]: Optional response message
        """
        message_type = message.get("type")
        content = message.get("content", {})
        
        # Check if this is a response to a pending request
        request_id = content.get("request_id")
        if request_id in self.pending_responses:
            # This is a response to a previous request
            logger.info(f"Received response for request {request_id}")
            self.pending_responses.pop(request_id)
            return None
        
        # Handle based on message type
        if message_type in self.message_handlers:
            try:
                response = self.message_handlers[message_type](content)
                return response
            except Exception as e:
                logger.error(f"Error handling message of type {message_type}: {e}")
                return {
                    "status": "error",
                    "error": f"Error handling message: {str(e)}"
                }
        else:
            logger.warning(f"No handler for message type {message_type}")
            return {
                "status": "error",
                "error": f"No handler for message type: {message_type}"
            }
    
    def get_agent_state(self) -> Dict[str, Any]:
        """Get the current state of the Communication protocol for this agent.
        
        Returns:
            Dict[str, Any]: Current protocol state
        """
        return {
            "subscribed_topics": list(self.subscribed_topics),
            "pending_responses": len(self.pending_responses),
            "registered_handlers": list(self.message_handlers.keys())
        }
    
    def _get_timestamp(self) -> int:
        """Get the current timestamp.
        
        Returns:
            int: Current timestamp
        """
        import time
        return int(time.time() * 1000)
    
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