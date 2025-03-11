"""
Agent-level topic subscription protocol for OpenAgents.

This protocol enables agents to subscribe to topics and receive messages published to those topics.
"""

import logging
from typing import Dict, Any, List, Optional, Set, Callable

from openagents.core.agent_protocol_base import AgentProtocolBase

logger = logging.getLogger(__name__)


class TopicSubscriptionAgentProtocol(AgentProtocolBase):
    """Agent-level topic subscription protocol implementation.
    
    This protocol enables agents to:
    - Subscribe to topics
    - Unsubscribe from topics
    - Receive messages published to subscribed topics
    """
    
    def __init__(self, agent_id: str, config: Optional[Dict[str, Any]] = None):
        """Initialize the topic subscription protocol for an agent.
        
        Args:
            agent_id: Unique identifier for the agent
            config: Optional configuration dictionary
        """
        super().__init__(agent_id, config)
        
        # Default configuration
        self.default_config = {
            "max_subscriptions": 100  # Maximum number of topics an agent can subscribe to
        }
        
        # Apply configuration
        self.config = {**self.default_config, **(config or {})}
        
        # Initialize protocol state
        self.subscriptions: Set[str] = set()
        self.topic_handlers: Dict[str, Callable] = {}
        
        # Set capabilities
        self._capabilities = [
            "topic-subscription",
            "topic-unsubscription",
            "topic-message-handling"
        ]
        
        logger.info(f"Initializing TopicSubscription agent protocol for agent {agent_id}")
    
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
        # Unsubscribe from all topics
        for topic in list(self.subscriptions):
            self.unsubscribe(topic)
        
        return True
    
    def handle_message(self, message: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Handle an incoming message.
        
        Args:
            message: The message to handle
            
        Returns:
            Optional[Dict[str, Any]]: Optional response message
        """
        message_type = message.get("type")
        
        if message_type == "topic":
            return self._handle_topic_message(message)
        else:
            logger.warning(f"Unknown message type: {message_type}")
            return None
    
    def _handle_topic_message(self, message: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Handle a topic message.
        
        Args:
            message: The topic message to handle
            
        Returns:
            Optional[Dict[str, Any]]: Optional response message
        """
        topic = message.get("topic")
        content = message.get("content", {})
        
        if topic in self.topic_handlers:
            try:
                response = self.topic_handlers[topic](message)
                return response
            except Exception as e:
                logger.error(f"Error handling topic message: {e}")
                return None
        else:
            # If no specific handler for this topic, log the message
            logger.info(f"Received message on topic {topic} with no handler")
            return None
    
    def register_topic_handler(self, topic: str, handler: Callable) -> bool:
        """Register a handler for a specific topic.
        
        Args:
            topic: Topic to handle messages for
            handler: Function to call when a message on this topic is received
            
        Returns:
            bool: True if registration was successful, False otherwise
        """
        if topic in self.topic_handlers:
            logger.warning(f"Handler for topic {topic} already registered")
            return False
        
        self.topic_handlers[topic] = handler
        
        # Subscribe to the topic if not already subscribed
        if topic not in self.subscriptions:
            self.subscribe(topic)
        
        return True
    
    def unregister_topic_handler(self, topic: str) -> bool:
        """Unregister a topic handler.
        
        Args:
            topic: Topic to stop handling
            
        Returns:
            bool: True if unregistration was successful, False otherwise
        """
        if topic not in self.topic_handlers:
            logger.warning(f"No handler registered for topic {topic}")
            return False
        
        self.topic_handlers.pop(topic)
        
        # Unsubscribe from the topic if no longer needed
        if topic in self.subscriptions and topic not in self.topic_handlers:
            self.unsubscribe(topic)
        
        return True
    
    def subscribe(self, topic: str) -> bool:
        """Subscribe to a topic.
        
        Args:
            topic: Topic to subscribe to
            
        Returns:
            bool: True if subscription was successful, False otherwise
        """
        if not self.network:
            logger.error("Agent not connected to a network")
            return False
        
        if topic in self.subscriptions:
            logger.warning(f"Already subscribed to topic {topic}")
            return True
        
        # Check if we've reached the maximum number of subscriptions
        if len(self.subscriptions) >= self.config["max_subscriptions"]:
            logger.error(f"Maximum number of subscriptions reached ({self.config['max_subscriptions']})")
            return False
        
        # Subscribe through the network's topic subscription protocol
        if "TopicSubscriptionNetworkProtocol" in self.network.protocols:
            topic_protocol = self.network.protocols["TopicSubscriptionNetworkProtocol"]
            success = topic_protocol.subscribe_to_topic(self.agent_id, topic)
            
            if success:
                self.subscriptions.add(topic)
                logger.info(f"Subscribed to topic {topic}")
                return True
            else:
                logger.error(f"Failed to subscribe to topic {topic}")
                return False
        else:
            logger.error("Network does not have a TopicSubscriptionNetworkProtocol")
            return False
    
    def unsubscribe(self, topic: str) -> bool:
        """Unsubscribe from a topic.
        
        Args:
            topic: Topic to unsubscribe from
            
        Returns:
            bool: True if unsubscription was successful, False otherwise
        """
        if not self.network:
            logger.error("Agent not connected to a network")
            return False
        
        if topic not in self.subscriptions:
            logger.warning(f"Not subscribed to topic {topic}")
            return True
        
        # Unsubscribe through the network's topic subscription protocol
        if "TopicSubscriptionNetworkProtocol" in self.network.protocols:
            topic_protocol = self.network.protocols["TopicSubscriptionNetworkProtocol"]
            success = topic_protocol.unsubscribe_from_topic(self.agent_id, topic)
            
            if success:
                self.subscriptions.remove(topic)
                logger.info(f"Unsubscribed from topic {topic}")
                return True
            else:
                logger.error(f"Failed to unsubscribe from topic {topic}")
                return False
        else:
            logger.error("Network does not have a TopicSubscriptionNetworkProtocol")
            return False
    
    def get_subscriptions(self) -> List[str]:
        """Get the list of topics this agent is subscribed to.
        
        Returns:
            List[str]: List of subscribed topics
        """
        return list(self.subscriptions)
    
    def get_agent_state(self) -> Dict[str, Any]:
        """Get the current state of the topic subscription protocol for this agent.
        
        Returns:
            Dict[str, Any]: Current protocol state
        """
        return {
            "subscriptions": list(self.subscriptions),
            "topic_handlers": list(self.topic_handlers.keys())
        }
    
    @property
    def capabilities(self) -> List[str]:
        """Get the capabilities of this protocol.
        
        Returns:
            List[str]: List of capabilities
        """
        return self._capabilities
    
    def some_method(self):
        """Implementation of the abstract method from the base class."""
        logger.debug("TopicSubscriptionAgentProtocol.some_method called")
        return True 