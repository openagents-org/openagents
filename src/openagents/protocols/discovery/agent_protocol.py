from typing import Dict, Any, Optional, List
import logging
from openagents.core.agent_protocol_base import AgentProtocolBase

logger = logging.getLogger(__name__)


class DiscoveryAgentProtocol(AgentProtocolBase):
    """Agent-level implementation of the Discovery protocol.
    
    This protocol enables an agent to discover other agents, services, and
    capabilities in the network.
    """
    
    def __init__(self, agent_id: str, config: Optional[Dict[str, Any]] = None):
        """Initialize the Discovery agent protocol.
        
        Args:
            agent_id: Unique identifier for the agent
            config: Optional configuration dictionary
        """
        super().__init__(agent_id, config)
        self.services: Dict[str, Dict[str, Any]] = {}
        self.discovered_agents: Dict[str, Dict[str, Any]] = {}
        self.discovered_services: Dict[str, List[str]] = {}
    
    def initialize(self) -> bool:
        """Initialize the Discovery agent protocol.
        
        Returns:
            bool: True if initialization was successful
        """
        logger.info(f"Initializing Discovery agent protocol for agent {self.agent_id}")
        return True
    
    def shutdown(self) -> bool:
        """Shutdown the Discovery agent protocol.
        
        Returns:
            bool: True if shutdown was successful
        """
        logger.info(f"Shutting down Discovery agent protocol for agent {self.agent_id}")
        return True
    
    @property
    def capabilities(self) -> List[str]:
        """Get the capabilities provided by this protocol.
        
        Returns:
            List[str]: List of capability identifiers
        """
        return [
            "service-advertisement",
            "agent-discovery",
            "service-discovery"
        ]
    
    def advertise_service(self, service_name: str, service_details: Dict[str, Any]) -> bool:
        """Advertise a service provided by this agent.
        
        Args:
            service_name: Name of the service
            service_details: Details of the service
            
        Returns:
            bool: True if advertisement was successful
        """
        self.services[service_name] = service_details
        logger.info(f"Agent {self.agent_id} advertised service {service_name}")
        
        # In a real implementation, this would notify the network protocol
        # to update the service registry
        return True
    
    def withdraw_service(self, service_name: str) -> bool:
        """Withdraw a service advertisement.
        
        Args:
            service_name: Name of the service
            
        Returns:
            bool: True if withdrawal was successful
        """
        if service_name not in self.services:
            logger.warning(f"Service {service_name} not advertised by agent {self.agent_id}")
            return False
        
        self.services.pop(service_name)
        logger.info(f"Agent {self.agent_id} withdrew service {service_name}")
        
        # In a real implementation, this would notify the network protocol
        # to update the service registry
        return True
    
    def handle_message(self, message: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Handle an incoming message for the Discovery protocol.
        
        Args:
            message: The message to handle
            
        Returns:
            Optional[Dict[str, Any]]: Optional response message
        """
        action = message.get("action")
        if not action:
            logger.error(f"Message missing action field: {message}")
            return {"status": "error", "error": "Missing action field"}
        
        if action == "discover_agents":
            filter_criteria = message.get("filter_criteria", {})
            # In a real implementation, this would query the network protocol
            # This is a simplified implementation that returns cached data
            return {
                "status": "success",
                "agents": list(self.discovered_agents.keys())
            }
        
        elif action == "discover_services":
            service_type = message.get("service_type")
            # In a real implementation, this would query the network protocol
            # This is a simplified implementation that returns cached data
            if service_type:
                agents = self.discovered_services.get(service_type, [])
            else:
                agents = []
                for service_agents in self.discovered_services.values():
                    agents.extend(service_agents)
            
            return {
                "status": "success",
                "service_type": service_type,
                "agents": agents
            }
        
        elif action == "get_agent_info":
            target_agent_id = message.get("agent_id")
            if not target_agent_id:
                return {"status": "error", "error": "Missing agent_id field"}
            
            agent_info = self.discovered_agents.get(target_agent_id)
            if not agent_info:
                return {
                    "status": "error",
                    "error": f"Agent {target_agent_id} not found"
                }
            
            return {
                "status": "success",
                "agent_id": target_agent_id,
                "agent_info": agent_info
            }
        
        else:
            logger.error(f"Unknown action {action} in message: {message}")
            return {"status": "error", "error": f"Unknown action: {action}"}
    
    def get_agent_state(self) -> Dict[str, Any]:
        """Get the current state of the Discovery protocol for this agent.
        
        Returns:
            Dict[str, Any]: Current protocol state
        """
        return {
            "advertised_services": list(self.services.keys()),
            "discovered_agents": len(self.discovered_agents),
            "discovered_services": {
                service: len(agents) for service, agents in self.discovered_services.items()
            }
        } 