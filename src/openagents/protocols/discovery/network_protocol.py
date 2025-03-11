from typing import Dict, Any, Optional, List, Set
import logging
from openagents.core.network_protocol_base import NetworkProtocolBase

logger = logging.getLogger(__name__)


class DiscoveryNetworkProtocol(NetworkProtocolBase):
    """Network-level implementation of the Discovery protocol.
    
    This protocol manages agent registration, discovery, and capability advertisements
    across the network.
    """
    
    def __init__(self, config: Optional[Dict[str, Any]] = None):
        """Initialize the Discovery network protocol.
        
        Args:
            config: Optional configuration dictionary
        """
        super().__init__(config)
        self.agent_registry: Dict[str, Dict[str, Any]] = {}
        self.service_registry: Dict[str, Set[str]] = {}  # service -> set of agent_ids
        self.capability_registry: Dict[str, Set[str]] = {}  # capability -> set of agent_ids
    
    def initialize(self) -> bool:
        """Initialize the Discovery protocol.
        
        Returns:
            bool: True if initialization was successful
        """
        logger.info("Initializing Discovery network protocol")
        return True
    
    def shutdown(self) -> bool:
        """Shutdown the Discovery protocol.
        
        Returns:
            bool: True if shutdown was successful
        """
        logger.info("Shutting down Discovery network protocol")
        self.agent_registry.clear()
        self.service_registry.clear()
        self.capability_registry.clear()
        return True
    
    @property
    def capabilities(self) -> List[str]:
        """Get the capabilities provided by this protocol.
        
        Returns:
            List[str]: List of capability identifiers
        """
        return [
            "agent-registration",
            "agent-discovery",
            "service-discovery",
            "capability-discovery"
        ]
    
    def register_agent(self, agent_id: str, metadata: Dict[str, Any]) -> bool:
        """Register an agent with the Discovery protocol.
        
        Args:
            agent_id: Unique identifier for the agent
            metadata: Agent metadata including capabilities and services
            
        Returns:
            bool: True if registration was successful
        """
        if agent_id in self.agent_registry:
            logger.warning(f"Agent {agent_id} already registered with Discovery protocol")
            return False
        
        self.agent_registry[agent_id] = metadata
        self.active_agents.add(agent_id)
        
        # Register agent capabilities
        capabilities = metadata.get("capabilities", set())
        for capability in capabilities:
            if capability not in self.capability_registry:
                self.capability_registry[capability] = set()
            self.capability_registry[capability].add(agent_id)
        
        # Register agent services
        services = metadata.get("services", set())
        for service in services:
            if service not in self.service_registry:
                self.service_registry[service] = set()
            self.service_registry[service].add(agent_id)
        
        logger.info(f"Registered agent {agent_id} with Discovery protocol")
        return True
    
    def unregister_agent(self, agent_id: str) -> bool:
        """Unregister an agent from the Discovery protocol.
        
        Args:
            agent_id: Unique identifier for the agent
            
        Returns:
            bool: True if unregistration was successful
        """
        if agent_id not in self.agent_registry:
            logger.warning(f"Agent {agent_id} not registered with Discovery protocol")
            return False
        
        metadata = self.agent_registry.pop(agent_id)
        self.active_agents.remove(agent_id)
        
        # Unregister agent capabilities
        capabilities = metadata.get("capabilities", set())
        for capability in capabilities:
            if capability in self.capability_registry:
                self.capability_registry[capability].remove(agent_id)
                if not self.capability_registry[capability]:
                    del self.capability_registry[capability]
        
        # Unregister agent services
        services = metadata.get("services", set())
        for service in services:
            if service in self.service_registry:
                self.service_registry[service].remove(agent_id)
                if not self.service_registry[service]:
                    del self.service_registry[service]
        
        logger.info(f"Unregistered agent {agent_id} from Discovery protocol")
        return True
    
    def discover_agents(self, filter_criteria: Optional[Dict[str, Any]] = None) -> List[str]:
        """Discover agents based on optional filter criteria.
        
        Args:
            filter_criteria: Optional criteria to filter agents by
            
        Returns:
            List[str]: List of agent IDs matching the criteria
        """
        if not filter_criteria:
            return list(self.agent_registry.keys())
        
        result = set(self.agent_registry.keys())
        
        # Filter by capabilities
        if "capabilities" in filter_criteria:
            required_capabilities = set(filter_criteria["capabilities"])
            capability_matches = set()
            for capability in required_capabilities:
                if capability in self.capability_registry:
                    if not capability_matches:
                        capability_matches = self.capability_registry[capability].copy()
                    else:
                        capability_matches &= self.capability_registry[capability]
            result &= capability_matches
        
        # Filter by services
        if "services" in filter_criteria:
            required_services = set(filter_criteria["services"])
            service_matches = set()
            for service in required_services:
                if service in self.service_registry:
                    if not service_matches:
                        service_matches = self.service_registry[service].copy()
                    else:
                        service_matches &= self.service_registry[service]
            result &= service_matches
        
        return list(result)
    
    def get_agent_metadata(self, agent_id: str) -> Optional[Dict[str, Any]]:
        """Get metadata for a specific agent.
        
        Args:
            agent_id: Unique identifier for the agent
            
        Returns:
            Optional[Dict[str, Any]]: Agent metadata if found, None otherwise
        """
        return self.agent_registry.get(agent_id)
    
    def get_agents_by_capability(self, capability: str) -> List[str]:
        """Get agents that provide a specific capability.
        
        Args:
            capability: Capability identifier
            
        Returns:
            List[str]: List of agent IDs providing the capability
        """
        return list(self.capability_registry.get(capability, set()))
    
    def get_agents_by_service(self, service: str) -> List[str]:
        """Get agents that provide a specific service.
        
        Args:
            service: Service identifier
            
        Returns:
            List[str]: List of agent IDs providing the service
        """
        return list(self.service_registry.get(service, set()))
    
    def get_network_state(self) -> Dict[str, Any]:
        """Get the current state of the Discovery protocol.
        
        Returns:
            Dict[str, Any]: Current protocol state
        """
        return {
            "agent_count": len(self.agent_registry),
            "active_agents": len(self.active_agents),
            "service_count": len(self.service_registry),
            "capability_count": len(self.capability_registry)
        } 