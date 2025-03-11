from abc import ABC, abstractmethod
from typing import Dict, Any, Optional, List


class ProtocolBase(ABC):
    """Base class for all protocols in OpenAgents.
    
    This abstract class defines the interface that all protocols must implement,
    whether they are agent-level or network-level protocols.
    """
    
    def __init__(self, config: Optional[Dict[str, Any]] = None):
        """Initialize the protocol with optional configuration.
        
        Args:
            config: Optional configuration dictionary for the protocol
        """
        self.config = config or {}
        self.name = self.__class__.__name__
        
    @abstractmethod
    def initialize(self) -> bool:
        """Initialize the protocol.
        
        Returns:
            bool: True if initialization was successful, False otherwise
        """
        pass
    
    @abstractmethod
    def shutdown(self) -> bool:
        """Shutdown the protocol gracefully.
        
        Returns:
            bool: True if shutdown was successful, False otherwise
        """
        pass
    
    @property
    @abstractmethod
    def capabilities(self) -> List[str]:
        """Get the capabilities provided by this protocol.
        
        Returns:
            List[str]: List of capability identifiers
        """
        pass
    
    @property
    def protocol_type(self) -> str:
        """Get the type of this protocol.
        
        Returns:
            str: The protocol type, to be implemented by subclasses
        """
        raise NotImplementedError("Subclasses must implement protocol_type") 