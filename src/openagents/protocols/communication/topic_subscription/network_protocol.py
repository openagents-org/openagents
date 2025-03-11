"""
Network-level topic subscription protocol for OpenAgents.

This protocol enables topic-based publish-subscribe messaging between agents.
"""

import logging
from typing import Dict, Any, List, Optional, Set

from openagents.core.network_protocol_base import NetworkProtocolBase

logger = logging.getLogger(__name__)


class TopicSubscriptionNetworkProtocol(NetworkProtocolBase):
    """Network-level topic subscription protocol implementation.
    
    This protocol enables:
    - Topic-based publish-subscribe messaging
    - Topic subscription management
    """
    
    def __init__(self, config: Optional[Dict[str, Any]] = None):
        """Initialize the topic subscription protocol for a network.
        
        Args:
            config: Optional configuration dictionary
        """
        super().__init__(config)
        
        # Default configuration
        self.default_config = {
            "max_topics": 1000,        # Maximum number of topics
            "max_subscribers": 1000,   # Maximum number of subscribers per topic
            "max_message_size": 1048576  # 1MB
        }
        
        # Apply configuration
        self.config = {**self.default_config, **(config or {})}
        
        # Initialize protocol state
        self.active_agents: Set[str] = set()
        self.subscriptions: Dict[str, Set[str]] = {}  # topic -> set of agent_ids
        self.message_queues: Dict[str, List[Dict[str, Any]]] = {}  # agent_id -> list of messages
        
        # Set capabilities
        self._capabilities = [
            "topic-subscription",
            "topic-unsubscription",
            "topic-publishing"
        ]
        
        logger.info("Initializing TopicSubscription network protocol")
    
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
        self.subscriptions.clear()
        self.message_queues.clear()
        
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
        logger.info(f"Registered agent {agent_id} with TopicSubscription protocol")
        return True
    
    def unregister_agent(self, agent_id: str) -> bool:
        """Unregister an agent from this protocol.
        
        Args:
            agent_id: ID of the agent to unregister
            
        Returns:
            bool: True if unregistration was successful, False otherwise
        """
        if agent_id not in self.active_agents:
            logger.warning(f"Agent {agent_id} not registered with TopicSubscription protocol")
            return False
        
        # Unsubscribe from all topics
        for topic, subscribers in list(self.subscriptions.items()):
            if agent_id in subscribers:
                subscribers.remove(agent_id)
                logger.info(f"Removed agent {agent_id} from topic {topic}")
                
                # Remove topic if no more subscribers
                if not subscribers:
                    self.subscriptions.pop(topic)
                    logger.info(f"Removed empty topic {topic}")
        
        # Remove message queue
        if agent_id in self.message_queues:
            self.message_queues.pop(agent_id)
        
        self.active_agents.remove(agent_id)
        logger.info(f"Unregistered agent {agent_id} from TopicSubscription protocol")
        return True
    
    def publish_to_topic(self, message: Dict[str, Any]) -> bool:
        """Publish a message to a topic.
        
        Args:
            message: The message to publish
            
        Returns:
            bool: True if publishing was successful, False otherwise
        """
        from_agent = message.get("from_agent")
        topic = message.get("topic")
        
        if not from_agent or not topic:
            logger.error("Message missing from_agent or topic")
            return False
        
        if from_agent not in self.active_agents:
            logger.error(f"Publishing agent {from_agent} not registered")
            return False
        
        # Check message size
        import json
        message_size = len(json.dumps(message).encode('utf-8'))
        if message_size > self.config["max_message_size"]:
            logger.error(f"Message size ({message_size} bytes) exceeds maximum ({self.config['max_message_size']} bytes)")
            return False
        
        # Get subscribers for this topic
        subscribers = self.subscriptions.get(topic, set())
        
        if not subscribers:
            logger.warning(f"No subscribers for topic {topic}")
            return True
        
        # Add message to each subscriber's queue
        for subscriber_id in subscribers:
            if subscriber_id != from_agent:  # Don't send to self
                subscriber_message = message.copy()
                self.message_queues[subscriber_id].append(subscriber_message)
        
        logger.info(f"Published message from {from_agent} to topic {topic} with {len(subscribers)} subscribers")
        return True
    
    def subscribe_to_topic(self, agent_id: str, topic: str) -> bool:
        """Subscribe an agent to a topic.
        
        Args:
            agent_id: ID of the subscribing agent
            topic: Topic to subscribe to
            
        Returns:
            bool: True if subscription was successful, False otherwise
        """
        if agent_id not in self.active_agents:
            logger.error(f"Agent {agent_id} not registered")
            return False
        
        # Check if we've reached the maximum number of topics
        if topic not in self.subscriptions and len(self.subscriptions) >= self.config["max_topics"]:
            logger.error(f"Maximum number of topics reached ({self.config['max_topics']})")
            return False
        
        if topic not in self.subscriptions:
            self.subscriptions[topic] = set()
        
        # Check if we've reached the maximum number of subscribers for this topic
        if len(self.subscriptions[topic]) >= self.config["max_subscribers"]:
            logger.error(f"Maximum number of subscribers reached for topic {topic} ({self.config['max_subscribers']})")
            return False
        
        self.subscriptions[topic].add(agent_id)
        logger.info(f"Agent {agent_id} subscribed to topic {topic}")
        return True
    
    def unsubscribe_from_topic(self, agent_id: str, topic: str) -> bool:
        """Unsubscribe an agent from a topic.
        
        Args:
            agent_id: ID of the unsubscribing agent
            topic: Topic to unsubscribe from
            
        Returns:
            bool: True if unsubscription was successful, False otherwise
        """
        if agent_id not in self.active_agents:
            logger.error(f"Agent {agent_id} not registered")
            return False
        
        if topic not in self.subscriptions:
            logger.warning(f"Topic {topic} does not exist")
            return True
        
        if agent_id in self.subscriptions[topic]:
            self.subscriptions[topic].remove(agent_id)
            logger.info(f"Agent {agent_id} unsubscribed from topic {topic}")
        
        # Remove topic if no more subscribers
        if not self.subscriptions[topic]:
            self.subscriptions.pop(topic)
            logger.info(f"Removed empty topic {topic}")
        
        return True
    
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
    
    def get_topics(self) -> List[str]:
        """Get all active topics.
        
        Returns:
            List[str]: List of active topics
        """
        return list(self.subscriptions.keys())
    
    def get_topic_subscribers(self, topic: str) -> List[str]:
        """Get all subscribers for a topic.
        
        Args:
            topic: Topic to get subscribers for
            
        Returns:
            List[str]: List of subscriber agent IDs
        """
        return list(self.subscriptions.get(topic, set()))
    
    def get_network_state(self) -> Dict[str, Any]:
        """Get the current state of the topic subscription protocol.
        
        Returns:
            Dict[str, Any]: Current protocol state
        """
        return {
            "active_agents": len(self.active_agents),
            "topics": len(self.subscriptions),
            "total_subscriptions": sum(len(subscribers) for subscribers in self.subscriptions.values()),
            "pending_messages": sum(len(queue) for queue in self.message_queues.values())
        }
    
    def some_method(self):
        """Implementation of the abstract method from the base class."""
        logger.debug("TopicSubscriptionNetworkProtocol.some_method called")
        return True 