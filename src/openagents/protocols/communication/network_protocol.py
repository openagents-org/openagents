from typing import Dict, Any, Optional, List, Set, Deque
import logging
import uuid
from collections import deque
from openagents.core.network_protocol_base import NetworkProtocolBase

logger = logging.getLogger(__name__)


class CommunicationNetworkProtocol(NetworkProtocolBase):
    """Network-level implementation of the Communication protocol.
    
    This protocol manages message routing, delivery, and different communication
    patterns across the network.
    """
    
    def __init__(self, config: Optional[Dict[str, Any]] = None):
        """Initialize the Communication network protocol.
        
        Args:
            config: Optional configuration dictionary
        """
        super().__init__(config)
        self.message_queues: Dict[str, Deque[Dict[str, Any]]] = {}  # agent_id -> queue of messages
        self.subscriptions: Dict[str, Set[str]] = {}  # topic -> set of agent_ids
        self.message_history: Dict[str, Dict[str, Any]] = {}  # message_id -> message
        self.max_history_size = config.get("max_history_size", 1000) if config else 1000
    
    def initialize(self) -> bool:
        """Initialize the Communication protocol.
        
        Returns:
            bool: True if initialization was successful
        """
        logger.info("Initializing Communication network protocol")
        return True
    
    def shutdown(self) -> bool:
        """Shutdown the Communication protocol.
        
        Returns:
            bool: True if shutdown was successful
        """
        logger.info("Shutting down Communication network protocol")
        self.message_queues.clear()
        self.subscriptions.clear()
        self.message_history.clear()
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
            "reliable-delivery",
            "message-history"
        ]
    
    def register_agent(self, agent_id: str, metadata: Dict[str, Any]) -> bool:
        """Register an agent with the Communication protocol.
        
        Args:
            agent_id: Unique identifier for the agent
            metadata: Agent metadata
            
        Returns:
            bool: True if registration was successful
        """
        if agent_id in self.message_queues:
            logger.warning(f"Agent {agent_id} already registered with Communication protocol")
            return False
        
        self.message_queues[agent_id] = deque()
        self.active_agents.add(agent_id)
        
        # Subscribe to topics based on agent capabilities
        capabilities = metadata.get("capabilities", set())
        for capability in capabilities:
            topic = f"capability:{capability}"
            if topic not in self.subscriptions:
                self.subscriptions[topic] = set()
            self.subscriptions[topic].add(agent_id)
        
        logger.info(f"Registered agent {agent_id} with Communication protocol")
        return True
    
    def unregister_agent(self, agent_id: str) -> bool:
        """Unregister an agent from the Communication protocol.
        
        Args:
            agent_id: Unique identifier for the agent
            
        Returns:
            bool: True if unregistration was successful
        """
        if agent_id not in self.message_queues:
            logger.warning(f"Agent {agent_id} not registered with Communication protocol")
            return False
        
        # Remove agent's message queue
        self.message_queues.pop(agent_id)
        self.active_agents.remove(agent_id)
        
        # Unsubscribe agent from all topics
        for topic, subscribers in list(self.subscriptions.items()):
            if agent_id in subscribers:
                subscribers.remove(agent_id)
                if not subscribers:
                    del self.subscriptions[topic]
        
        logger.info(f"Unregistered agent {agent_id} from Communication protocol")
        return True
    
    def send_message(self, from_agent_id: str, to_agent_id: str, 
                    message_content: Dict[str, Any]) -> Optional[str]:
        """Send a direct message from one agent to another.
        
        Args:
            from_agent_id: ID of the sending agent
            to_agent_id: ID of the receiving agent
            message_content: Content of the message
            
        Returns:
            Optional[str]: Message ID if sending was successful, None otherwise
        """
        if from_agent_id not in self.active_agents:
            logger.error(f"Sending agent {from_agent_id} not registered with Communication protocol")
            return None
        
        if to_agent_id not in self.message_queues:
            logger.error(f"Receiving agent {to_agent_id} not registered with Communication protocol")
            return None
        
        message_id = str(uuid.uuid4())
        message = {
            "id": message_id,
            "from": from_agent_id,
            "to": to_agent_id,
            "content": message_content,
            "timestamp": self._get_timestamp()
        }
        
        # Add message to recipient's queue
        self.message_queues[to_agent_id].append(message)
        
        # Store in message history
        self._add_to_history(message_id, message)
        
        logger.info(f"Message {message_id} sent from {from_agent_id} to {to_agent_id}")
        return message_id
    
    def publish_message(self, from_agent_id: str, topic: str, 
                       message_content: Dict[str, Any]) -> Optional[str]:
        """Publish a message to a topic.
        
        Args:
            from_agent_id: ID of the publishing agent
            topic: Topic to publish to
            message_content: Content of the message
            
        Returns:
            Optional[str]: Message ID if publishing was successful, None otherwise
        """
        if from_agent_id not in self.active_agents:
            logger.error(f"Publishing agent {from_agent_id} not registered with Communication protocol")
            return None
        
        subscribers = self.subscriptions.get(topic, set())
        if not subscribers:
            logger.warning(f"No subscribers for topic {topic}")
            return None
        
        message_id = str(uuid.uuid4())
        message = {
            "id": message_id,
            "from": from_agent_id,
            "topic": topic,
            "content": message_content,
            "timestamp": self._get_timestamp()
        }
        
        # Add message to each subscriber's queue
        for subscriber_id in subscribers:
            if subscriber_id in self.message_queues:
                self.message_queues[subscriber_id].append(message)
        
        # Store in message history
        self._add_to_history(message_id, message)
        
        logger.info(f"Message {message_id} published to topic {topic} by {from_agent_id}")
        return message_id
    
    def subscribe(self, agent_id: str, topic: str) -> bool:
        """Subscribe an agent to a topic.
        
        Args:
            agent_id: ID of the subscribing agent
            topic: Topic to subscribe to
            
        Returns:
            bool: True if subscription was successful, False otherwise
        """
        if agent_id not in self.active_agents:
            logger.error(f"Agent {agent_id} not registered with Communication protocol")
            return False
        
        if topic not in self.subscriptions:
            self.subscriptions[topic] = set()
        
        self.subscriptions[topic].add(agent_id)
        logger.info(f"Agent {agent_id} subscribed to topic {topic}")
        return True
    
    def unsubscribe(self, agent_id: str, topic: str) -> bool:
        """Unsubscribe an agent from a topic.
        
        Args:
            agent_id: ID of the unsubscribing agent
            topic: Topic to unsubscribe from
            
        Returns:
            bool: True if unsubscription was successful, False otherwise
        """
        if topic not in self.subscriptions:
            logger.warning(f"Topic {topic} does not exist")
            return False
        
        if agent_id not in self.subscriptions[topic]:
            logger.warning(f"Agent {agent_id} not subscribed to topic {topic}")
            return False
        
        self.subscriptions[topic].remove(agent_id)
        if not self.subscriptions[topic]:
            del self.subscriptions[topic]
        
        logger.info(f"Agent {agent_id} unsubscribed from topic {topic}")
        return True
    
    def get_messages(self, agent_id: str, max_count: int = 10) -> List[Dict[str, Any]]:
        """Get pending messages for an agent.
        
        Args:
            agent_id: ID of the agent
            max_count: Maximum number of messages to retrieve
            
        Returns:
            List[Dict[str, Any]]: List of messages
        """
        if agent_id not in self.message_queues:
            logger.error(f"Agent {agent_id} not registered with Communication protocol")
            return []
        
        messages = []
        queue = self.message_queues[agent_id]
        
        for _ in range(min(max_count, len(queue))):
            messages.append(queue.popleft())
        
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
        """Get the current state of the Communication protocol.
        
        Returns:
            Dict[str, Any]: Current protocol state
        """
        return {
            "active_agents": len(self.active_agents),
            "topics": len(self.subscriptions),
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