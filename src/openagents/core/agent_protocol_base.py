from typing import Dict, Any, Optional, List
from openagents.core.protocol_base import ProtocolBase
from abc import ABC, abstractmethod


class AgentProtocolBase(ProtocolBase):
    """Base class for agent-level protocols in OpenAgents.
    
    Agent protocols define behaviors and capabilities for individual agents
    within the network.
    """
    
    def __init__(self, agent_id: str, config: Optional[Dict[str, Any]] = None):
        """Initialize the agent protocol with agent ID and optional configuration.
        
        Args:
            agent_id: Unique identifier for the agent
            config: Optional configuration dictionary for the protocol
        """
        super().__init__(config)
        self.agent_id = agent_id
    
    @property
    def protocol_type(self) -> str:
        """Get the type of this protocol.
        
        Returns:
            str: 'agent' indicating this is an agent-level protocol
        """
        return "agent"
    
    @abstractmethod
    def handle_message(self, message: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Handle an incoming message for this protocol.
        
        Args:
            message: The message to handle
            
        Returns:
            Optional[Dict[str, Any]]: Optional response message
        """
        pass
    
    @abstractmethod
    def get_agent_state(self) -> Dict[str, Any]:
        """Get the current state of this protocol for the agent.
        
        Returns:
            Dict[str, Any]: Current agent protocol state
        """
        pass

    @abstractmethod
    def some_method(self):
        pass 