"""
Network-level discoverability protocol for OpenAgents.

This protocol enables service advertisement and discovery within a network.
"""

import logging
import time
from typing import Dict, Any, List, Optional, Set

from openagents.core.network_protocol_base import NetworkProtocolBase

logger = logging.getLogger(__name__)


class DiscoverabilityNetworkProtocol(NetworkProtocolBase):
    """Network-level discoverability protocol implementation.
    
    This protocol enables:
    - Service registration and advertisement
    - Service discovery
    - Service metadata retrieval
    """
    
    def __init__(self, config: Optional[Dict[str, Any]] = None):
        """Initialize the discoverability protocol for a network.
        
        Args:
            config: Optional configuration dictionary
        """
        super().__init__(config)
        
        # Default configuration
        self.default_config = {
            "cleanup_interval": 300.0,  # seconds
            "max_inactive_time": 600.0  # seconds
        }
        
        # Apply configuration
        self.config = {**self.default_config, **(config or {})}
        
        # Initialize protocol state
        self.service_registry: Dict[str, Set[str]] = {}  # service_name -> set of provider agent_ids
        self.service_metadata: Dict[str, Dict[str, Dict[str, Any]]] = {}  # service_name -> agent_id -> metadata
        self.last_active: Dict[str, float] = {}  # agent_id -> timestamp
        
        # Set capabilities
        self._capabilities = [
            "service-advertisement",
            "service-discovery",
            "service-metadata"
        ]
        
        logger.info("Initializing Discoverability network protocol")
    
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
        self.service_registry.clear()
        self.service_metadata.clear()
        self.last_active.clear()
        
        return True
    
    def register_agent(self, agent_id: str, metadata: Dict[str, Any]) -> bool:
        """Register an agent with this protocol.
        
        Args:
            agent_id: Unique identifier for the agent
            metadata: Agent metadata
            
        Returns:
            bool: True if registration was successful, False otherwise
        """
        self.last_active[agent_id] = time.time()
        logger.info(f"Registered agent {agent_id} with Discoverability protocol")
        return True
    
    def unregister_agent(self, agent_id: str) -> bool:
        """Unregister an agent from this protocol.
        
        Args:
            agent_id: ID of the agent to unregister
            
        Returns:
            bool: True if unregistration was successful, False otherwise
        """
        # Remove agent from last active
        if agent_id in self.last_active:
            self.last_active.pop(agent_id)
        
        # Remove agent from service registry
        for service_name in list(self.service_registry.keys()):
            if agent_id in self.service_registry[service_name]:
                self.service_registry[service_name].remove(agent_id)
                # If no providers left for this service, remove the service
                if not self.service_registry[service_name]:
                    self.service_registry.pop(service_name)
                # Notify other agents about the service removal
                service_metadata = self.service_metadata.get(service_name, {}).get(agent_id, {})
                self._notify_service_update(service_name, agent_id, service_metadata, True)
        
        # Remove agent from service metadata
        for service_name in list(self.service_metadata.keys()):
            if agent_id in self.service_metadata[service_name]:
                self.service_metadata[service_name].pop(agent_id)
                # If no providers left for this service, remove the service
                if not self.service_metadata[service_name]:
                    self.service_metadata.pop(service_name)
        
        logger.info(f"Unregistered agent {agent_id} from DiscoverabilityNetworkProtocol")
        return True
    
    def register_service(self, agent_id: str, service_name: str, metadata: Dict[str, Any]) -> bool:
        """Register a service provided by an agent.
        
        Args:
            agent_id: ID of the provider agent
            service_name: Name of the service
            metadata: Service metadata
            
        Returns:
            bool: True if registration was successful, False otherwise
        """
        if agent_id not in self.last_active:
            logger.warning(f"Agent {agent_id} not registered with Discoverability protocol")
            return False
        
        # Update last active timestamp
        self.last_active[agent_id] = time.time()
        
        # Add service to registry
        if service_name not in self.service_registry:
            self.service_registry[service_name] = set()
        
        self.service_registry[service_name].add(agent_id)
        
        # Add service metadata
        if service_name not in self.service_metadata:
            self.service_metadata[service_name] = {}
        
        self.service_metadata[service_name][agent_id] = metadata
        
        # Notify other agents of the service update
        self._notify_service_update(service_name, agent_id, metadata, False)
        
        logger.info(f"Registered service {service_name} provided by agent {agent_id}")
        return True
    
    def unregister_service(self, agent_id: str, service_name: str) -> bool:
        """Unregister a service provided by an agent.
        
        Args:
            agent_id: ID of the provider agent
            service_name: Name of the service
            
        Returns:
            bool: True if unregistration was successful, False otherwise
        """
        if service_name not in self.service_registry:
            logger.warning(f"Service {service_name} not registered")
            return False
        
        if agent_id not in self.service_registry[service_name]:
            logger.warning(f"Agent {agent_id} not registered as provider for service {service_name}")
            return False
        
        # Remove agent from service providers
        self.service_registry[service_name].remove(agent_id)
        
        # Remove service metadata
        if service_name in self.service_metadata and agent_id in self.service_metadata[service_name]:
            self.service_metadata[service_name].pop(agent_id)
        
        # Notify other agents of the service removal
        self._notify_service_update(service_name, agent_id, {}, True)
        
        # Remove service if no more providers
        if not self.service_registry[service_name]:
            self.service_registry.pop(service_name)
            self.service_metadata.pop(service_name, None)
        
        logger.info(f"Unregistered service {service_name} provided by agent {agent_id}")
        return True
    
    def get_all_services(self) -> Dict[str, List[str]]:
        """Get all registered services.
        
        Returns:
            Dict[str, List[str]]: Dictionary of service names to lists of provider agent IDs
        """
        # Clean up inactive agents
        self._clean_inactive_agents()
        
        # Convert sets to lists for return value
        return {service_name: list(providers) for service_name, providers in self.service_registry.items()}
    
    def get_service_providers(self, service_name: str) -> List[str]:
        """Get all providers for a service.
        
        Args:
            service_name: Name of the service
            
        Returns:
            List[str]: List of provider agent IDs
        """
        if service_name not in self.service_registry:
            return []
        
        return list(self.service_registry[service_name])
    
    def get_service_metadata(self, agent_id: str, service_name: str) -> Optional[Dict[str, Any]]:
        """Get metadata for a service from a specific provider.
        
        Args:
            agent_id: ID of the provider agent
            service_name: Name of the service
            
        Returns:
            Optional[Dict[str, Any]]: Service metadata if available, None otherwise
        """
        if service_name not in self.service_metadata or agent_id not in self.service_metadata[service_name]:
            return None
        
        return self.service_metadata[service_name][agent_id]
    
    def get_network_state(self) -> Dict[str, Any]:
        """Get the current state of the discoverability protocol.
        
        Returns:
            Dict[str, Any]: Current protocol state
        """
        return {
            "registered_services": len(self.service_registry),
            "total_providers": sum(len(providers) for providers in self.service_registry.values())
        }
    
    def _notify_service_update(self, service_name: str, provider_id: str, metadata: Dict[str, Any], is_removal: bool) -> None:
        """Notify all agents of a service update.
        
        Args:
            service_name: Name of the service
            provider_id: ID of the provider agent
            metadata: Service metadata
            is_removal: Whether this is a service removal
        """
        message = {
            "protocol": "DiscoverabilityAgentProtocol",
            "action": "service_update",
            "service_name": service_name,
            "provider_id": provider_id,
            "metadata": metadata,
            "is_removal": is_removal
        }
        
        # Send to all agents except the provider
        for agent_id in self.last_active:
            if agent_id != provider_id:
                self._send_message_to_agent(agent_id, message)
    
    def _send_message_to_agent(self, agent_id: str, message: Dict[str, Any]) -> None:
        """Send a message to an agent.
        
        Args:
            agent_id: ID of the recipient agent
            message: Message to send
        """
        if not self.network:
            logger.error("Network not available")
            return
        
        # Add sender_id to the message
        message["sender_id"] = "network"
        
        # Use the send_message_to_agent method
        self.network.send_message_to_agent(agent_id, message)
    
    def _clean_inactive_agents(self) -> None:
        """Clean up inactive agents."""
        current_time = time.time()
        inactive_agents = []
        
        for agent_id, last_active in self.last_active.items():
            if current_time - last_active > self.config["max_inactive_time"]:
                inactive_agents.append(agent_id)
        
        for agent_id in inactive_agents:
            logger.info(f"Removing inactive agent {agent_id}")
            self.unregister_agent(agent_id)
    
    def some_method(self):
        """Implementation of the abstract method from the base class."""
        logger.debug("DiscoverabilityNetworkProtocol.some_method called")
        return True 