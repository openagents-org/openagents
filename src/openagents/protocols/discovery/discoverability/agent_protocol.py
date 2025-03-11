"""
Agent-level discoverability protocol for OpenAgents.

This protocol enables agents to advertise and discover services.
"""

import logging
from typing import Dict, Any, List, Optional, Set

from openagents.core.agent_protocol_base import AgentProtocolBase

logger = logging.getLogger(__name__)


class DiscoverabilityAgentProtocol(AgentProtocolBase):
    """Agent-level discoverability protocol implementation.
    
    This protocol enables agents to:
    - Advertise services they provide
    - Discover services provided by other agents
    - Query service metadata
    """
    
    def __init__(self, agent_id: str, config: Optional[Dict[str, Any]] = None):
        """Initialize the discoverability protocol for an agent.
        
        Args:
            agent_id: Unique identifier for the agent
            config: Optional configuration dictionary
        """
        super().__init__(agent_id, config)
        
        # Default configuration
        self.default_config = {
            "service_refresh_interval": 300.0  # seconds
        }
        
        # Apply configuration
        self.config = {**self.default_config, **(config or {})}
        
        # Initialize protocol state
        self.advertised_services: Dict[str, Dict[str, Any]] = {}
        self.discovered_services: Dict[str, List[str]] = {}  # service_name -> list of provider agent_ids
        self.service_metadata: Dict[str, Dict[str, Dict[str, Any]]] = {}  # service_name -> agent_id -> metadata
        
        # Set capabilities
        self._capabilities = [
            "service-advertisement",
            "service-discovery",
            "service-metadata",
            "agent-discovery",
            "capability-discovery"
        ]
        
        logger.info(f"Initializing Discoverability agent protocol for agent {agent_id}")
    
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
        # Unadvertise all services
        for service_name in list(self.advertised_services.keys()):
            self.unadvertise_service(service_name)
        
        return True
    
    def handle_message(self, message: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Handle an incoming message.
        
        Args:
            message: The message to handle
            
        Returns:
            Optional[Dict[str, Any]]: Optional response message
        """
        action = message.get("action")
        
        if action == "service_update":
            return self._handle_service_update(message)
        elif action == "service_query":
            return self._handle_service_query(message)
        else:
            logger.warning(f"Unknown action: {action}")
            return None
    
    def _handle_service_update(self, message: Dict[str, Any]) -> None:
        """Handle a service update message.
        
        Args:
            message: The service update message
        """
        service_name = message.get("service_name")
        provider_id = message.get("provider_id")
        metadata = message.get("metadata", {})
        is_removal = message.get("is_removal", False)
        
        if not service_name or not provider_id:
            logger.warning("Service update missing service_name or provider_id")
            return None
        
        if is_removal:
            # Remove service provider
            if service_name in self.discovered_services and provider_id in self.discovered_services[service_name]:
                self.discovered_services[service_name].remove(provider_id)
                
                if service_name in self.service_metadata and provider_id in self.service_metadata[service_name]:
                    self.service_metadata[service_name].pop(provider_id)
                
                logger.debug(f"Removed provider {provider_id} for service {service_name}")
                
                # Remove service if no more providers
                if not self.discovered_services[service_name]:
                    self.discovered_services.pop(service_name)
                    self.service_metadata.pop(service_name, None)
                    logger.debug(f"Removed service {service_name} with no providers")
        else:
            # Add or update service provider
            if service_name not in self.discovered_services:
                self.discovered_services[service_name] = []
            
            if provider_id not in self.discovered_services[service_name]:
                self.discovered_services[service_name].append(provider_id)
            
            if service_name not in self.service_metadata:
                self.service_metadata[service_name] = {}
            
            self.service_metadata[service_name][provider_id] = metadata
            logger.debug(f"Updated provider {provider_id} for service {service_name}")
        
        return None
    
    def _handle_service_query(self, message: Dict[str, Any]) -> Dict[str, Any]:
        """Handle a service query message.
        
        Args:
            message: The service query message
            
        Returns:
            Dict[str, Any]: Response with service metadata
        """
        from_agent = message.get("from_agent")
        service_name = message.get("service_name")
        
        if not service_name or service_name not in self.advertised_services:
            return {
                "protocol": "DiscoverabilityAgentProtocol",
                "action": "service_response",
                "from_agent": self.agent_id,
                "to_agent": from_agent,
                "service_name": service_name,
                "available": False
            }
        
        return {
            "protocol": "DiscoverabilityAgentProtocol",
            "action": "service_response",
            "from_agent": self.agent_id,
            "to_agent": from_agent,
            "service_name": service_name,
            "available": True,
            "metadata": self.advertised_services[service_name]
        }
    
    def advertise_service(self, service_name: str, metadata: Dict[str, Any]) -> bool:
        """Advertise a service provided by this agent.
        
        Args:
            service_name: Name of the service
            metadata: Service metadata
            
        Returns:
            bool: True if advertisement was successful, False otherwise
        """
        if not self.network:
            logger.error("Agent not connected to a network")
            return False
        
        # Store locally
        self.advertised_services[service_name] = metadata
        
        # Advertise through the network's discoverability protocol
        if "DiscoverabilityNetworkProtocol" in self.network.protocols:
            discoverability_protocol = self.network.protocols["DiscoverabilityNetworkProtocol"]
            success = discoverability_protocol.register_service(self.agent_id, service_name, metadata)
            
            if not success:
                # Rollback local change
                self.advertised_services.pop(service_name)
                logger.error(f"Failed to advertise service {service_name}")
                return False
            
            logger.info(f"Advertised service {service_name}")
            return True
        else:
            # Rollback local change
            self.advertised_services.pop(service_name)
            logger.error("Network does not have a DiscoverabilityNetworkProtocol")
            return False
    
    def unadvertise_service(self, service_name: str) -> bool:
        """Unadvertise a service provided by this agent.
        
        Args:
            service_name: Name of the service
            
        Returns:
            bool: True if unadvertisement was successful, False otherwise
        """
        if not self.network:
            logger.error("Agent not connected to a network")
            return False
        
        if service_name not in self.advertised_services:
            logger.warning(f"Service {service_name} not advertised")
            return True
        
        # Unadvertise through the network's discoverability protocol
        if "DiscoverabilityNetworkProtocol" in self.network.protocols:
            discoverability_protocol = self.network.protocols["DiscoverabilityNetworkProtocol"]
            success = discoverability_protocol.unregister_service(self.agent_id, service_name)
            
            if success:
                # Remove from local state
                self.advertised_services.pop(service_name)
                logger.info(f"Unadvertised service {service_name}")
                return True
            else:
                logger.error(f"Failed to unadvertise service {service_name}")
                return False
        else:
            logger.error("Network does not have a DiscoverabilityNetworkProtocol")
            return False
    
    def discover_services(self) -> Dict[str, List[str]]:
        """Discover all available services in the network.
        
        Returns:
            Dict[str, List[str]]: Dictionary of service names to lists of provider agent IDs
        """
        if not self.network:
            logger.error("Agent not connected to a network")
            return {}
        
        if "DiscoverabilityNetworkProtocol" in self.network.protocols:
            discoverability_protocol = self.network.protocols["DiscoverabilityNetworkProtocol"]
            services = discoverability_protocol.get_all_services()
            
            # Update local cache
            self.discovered_services = services
            
            # Update metadata cache
            for service_name, providers in services.items():
                if service_name not in self.service_metadata:
                    self.service_metadata[service_name] = {}
                
                for provider_id in providers:
                    if provider_id not in self.service_metadata[service_name]:
                        metadata = discoverability_protocol.get_service_metadata(provider_id, service_name)
                        if metadata:
                            self.service_metadata[service_name][provider_id] = metadata
            
            return services
        else:
            logger.error("Network does not have a DiscoverabilityNetworkProtocol")
            return {}
    
    def get_service_providers(self, service_name: str) -> List[str]:
        """Get all providers for a service.
        
        Args:
            service_name: Name of the service
            
        Returns:
            List[str]: List of provider agent IDs
        """
        return self.discovered_services.get(service_name, [])
    
    def get_service_metadata(self, service_name: str, provider_id: str) -> Optional[Dict[str, Any]]:
        """Get metadata for a service from a specific provider.
        
        Args:
            service_name: Name of the service
            provider_id: ID of the provider agent
            
        Returns:
            Optional[Dict[str, Any]]: Service metadata if available, None otherwise
        """
        if service_name not in self.service_metadata or provider_id not in self.service_metadata[service_name]:
            if not self.network:
                logger.error("Agent not connected to a network")
                return None
            
            if "DiscoverabilityNetworkProtocol" in self.network.protocols:
                discoverability_protocol = self.network.protocols["DiscoverabilityNetworkProtocol"]
                metadata = discoverability_protocol.get_service_metadata(provider_id, service_name)
                
                if metadata:
                    if service_name not in self.service_metadata:
                        self.service_metadata[service_name] = {}
                    
                    self.service_metadata[service_name][provider_id] = metadata
                    return metadata
                else:
                    return None
            else:
                logger.error("Network does not have a DiscoverabilityNetworkProtocol")
                return None
        
        return self.service_metadata[service_name].get(provider_id)
    
    def get_agent_state(self) -> Dict[str, Any]:
        """Get the current state of the discoverability protocol for this agent.
        
        Returns:
            Dict[str, Any]: Current protocol state
        """
        return {
            "advertised_services": list(self.advertised_services.keys()),
            "discovered_services": {k: len(v) for k, v in self.discovered_services.items()}
        }
    
    def some_method(self):
        """Implementation of the abstract method from the base class."""
        logger.debug("DiscoverabilityAgentProtocol.some_method called")
        return True
    
    def discover_agents(self) -> Dict[str, Dict[str, Any]]:
        """Discover all agents in the network.
        
        Returns:
            Dict[str, Dict[str, Any]]: Dictionary of agent IDs to agent metadata
        """
        if not self.network:
            logger.error("Agent not connected to a network")
            return {}
        
        if "AgentRegistrationNetworkProtocol" in self.network.protocols:
            registration_protocol = self.network.protocols["AgentRegistrationNetworkProtocol"]
            agents = registration_protocol.get_all_agents()
            return agents
        else:
            logger.error("Network does not have an AgentRegistrationNetworkProtocol")
            return {}
    
    def get_agent_capabilities(self, agent_id: str) -> List[str]:
        """Get the capabilities of an agent.
        
        Args:
            agent_id: ID of the agent to query
            
        Returns:
            List[str]: List of agent capabilities
        """
        if not self.network:
            logger.error("Agent not connected to a network")
            return []
        
        if "AgentRegistrationNetworkProtocol" in self.network.protocols:
            registration_protocol = self.network.protocols["AgentRegistrationNetworkProtocol"]
            metadata = registration_protocol.get_agent_metadata(agent_id)
            if metadata:
                return metadata.get("capabilities", [])
            return []
        else:
            logger.error("Network does not have an AgentRegistrationNetworkProtocol")
            return []
    
    def get_agent_metadata(self, agent_id: str) -> Optional[Dict[str, Any]]:
        """Get metadata for an agent.
        
        Args:
            agent_id: ID of the agent to query
            
        Returns:
            Optional[Dict[str, Any]]: Agent metadata if available, None otherwise
        """
        if not self.network:
            logger.error("Agent not connected to a network")
            return None
        
        if "AgentRegistrationNetworkProtocol" in self.network.protocols:
            registration_protocol = self.network.protocols["AgentRegistrationNetworkProtocol"]
            return registration_protocol.get_agent_metadata(agent_id)
        else:
            logger.error("Network does not have an AgentRegistrationNetworkProtocol")
            return None 