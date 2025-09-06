"""
Simplified Agent Identity Management for OpenAgents.

This module provides simple, lightweight agent ID management without
complex certificate systems. Suitable for development and research use.
"""

import uuid
import time
import logging
from typing import Dict, Any, Optional, Set
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)


class AgentIdentity:
    """Represents a simple agent identity."""
    
    def __init__(self, agent_id: str, created_at: float, last_seen: float):
        """Initialize an agent identity.
        
        Args:
            agent_id: The unique agent identifier
            created_at: Unix timestamp when identity was created
            last_seen: Unix timestamp when agent was last active
        """
        self.agent_id = agent_id
        self.created_at = created_at
        self.last_seen = last_seen
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert identity to dictionary."""
        return {
            "agent_id": self.agent_id,
            "created_at": self.created_at,
            "last_seen": self.last_seen
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "AgentIdentity":
        """Create identity from dictionary."""
        return cls(
            agent_id=data["agent_id"],
            created_at=data["created_at"],
            last_seen=data["last_seen"]
        )
    
    def is_active(self, timeout_seconds: float = 300) -> bool:
        """Check if the agent is still active (seen recently).
        
        Args:
            timeout_seconds: Seconds after which agent is considered inactive
            
        Returns:
            True if agent was seen within timeout period
        """
        return (time.time() - self.last_seen) < timeout_seconds
    
    def touch(self):
        """Update the last_seen timestamp to current time."""
        self.last_seen = time.time()


class AgentIdentityManager:
    """Simplified agent identity management system."""
    
    def __init__(self, session_timeout_hours: int = 24):
        """Initialize the identity manager.
        
        Args:
            session_timeout_hours: Hours after which inactive agents are cleaned up
        """
        self.session_timeout = session_timeout_hours * 3600  # Convert to seconds
        self.active_agents: Dict[str, AgentIdentity] = {}
        self.reserved_ids: Set[str] = {"system", "network", "admin", "root", "anonymous"}
        logger.info(f"AgentIdentityManager initialized with session timeout={session_timeout_hours}h")
    
    def claim_agent_id(self, agent_id: str, force: bool = False) -> Optional[AgentIdentity]:
        """Claim an agent ID.
        
        Args:
            agent_id: The agent ID to claim
            force: If True, forcefully reclaim even if already claimed
            
        Returns:
            AgentIdentity if successful, None if agent ID unavailable
        """
        # Validate agent ID
        if not self._is_valid_agent_id(agent_id):
            logger.error(f"Invalid agent ID: {agent_id}")
            return None
        
        # Check if agent ID is reserved
        if agent_id in self.reserved_ids:
            logger.error(f"Agent ID {agent_id} is reserved")
            return None
        
        # Clean up inactive agents first
        self._cleanup_inactive_agents()
        
        # Check if agent ID is already claimed by an active agent
        if agent_id in self.active_agents:
            existing_identity = self.active_agents[agent_id]
            if existing_identity.is_active() and not force:
                logger.warning(f"Agent ID {agent_id} is already claimed by an active agent")
                return None
            else:
                # Reclaim from inactive agent or force reclaim
                logger.info(f"Reclaiming agent ID {agent_id} (force={force})")
        
        # Create new identity
        current_time = time.time()
        identity = AgentIdentity(
            agent_id=agent_id,
            created_at=current_time,
            last_seen=current_time
        )
        
        self.active_agents[agent_id] = identity
        logger.info(f"Successfully claimed agent ID: {agent_id}")
        return identity
    
    def release_agent_id(self, agent_id: str) -> bool:
        """Release a claimed agent ID.
        
        Args:
            agent_id: The agent ID to release
            
        Returns:
            True if successfully released, False if not found
        """
        if agent_id in self.active_agents:
            del self.active_agents[agent_id]
            logger.info(f"Released agent ID: {agent_id}")
            return True
        else:
            logger.warning(f"Attempted to release unknown agent ID: {agent_id}")
            return False
    
    def update_agent_activity(self, agent_id: str) -> bool:
        """Update an agent's last activity timestamp.
        
        Args:
            agent_id: The agent ID to update
            
        Returns:
            True if successful, False if agent not found
        """
        if agent_id in self.active_agents:
            self.active_agents[agent_id].touch()
            logger.debug(f"Updated activity for agent: {agent_id}")
            return True
        else:
            logger.warning(f"Attempted to update activity for unknown agent: {agent_id}")
            return False
    
    def get_agent_identity(self, agent_id: str) -> Optional[AgentIdentity]:
        """Get the identity for an agent.
        
        Args:
            agent_id: The agent ID to look up
            
        Returns:
            AgentIdentity if found, None otherwise
        """
        return self.active_agents.get(agent_id)
    
    def is_agent_active(self, agent_id: str) -> bool:
        """Check if an agent is currently active.
        
        Args:
            agent_id: The agent ID to check
            
        Returns:
            True if agent is active, False otherwise
        """
        identity = self.get_agent_identity(agent_id)
        return identity.is_active() if identity else False
    
    def get_active_agents(self) -> Dict[str, AgentIdentity]:
        """Get all active agents.
        
        Returns:
            Dictionary of agent_id -> AgentIdentity for all active agents
        """
        # Clean up first to ensure we return only truly active agents
        self._cleanup_inactive_agents()
        return self.active_agents.copy()
    
    def generate_unique_agent_id(self, prefix: str = "agent") -> str:
        """Generate a unique agent ID.
        
        Args:
            prefix: Prefix for the generated ID
            
        Returns:
            A unique agent ID
        """
        while True:
            # Generate a short UUID-based ID
            unique_suffix = str(uuid.uuid4()).split('-')[0]  # First 8 characters
            agent_id = f"{prefix}_{unique_suffix}"
            
            # Check if it's available
            if (agent_id not in self.active_agents and 
                agent_id not in self.reserved_ids):
                return agent_id
    
    def add_reserved_id(self, agent_id: str):
        """Add an agent ID to the reserved list.
        
        Args:
            agent_id: The agent ID to reserve
        """
        self.reserved_ids.add(agent_id)
        logger.info(f"Added reserved agent ID: {agent_id}")
    
    def remove_reserved_id(self, agent_id: str):
        """Remove an agent ID from the reserved list.
        
        Args:
            agent_id: The agent ID to unreserve
        """
        self.reserved_ids.discard(agent_id)
        logger.info(f"Removed reserved agent ID: {agent_id}")
    
    def get_statistics(self) -> Dict[str, Any]:
        """Get identity manager statistics.
        
        Returns:
            Dictionary with statistics about the identity manager
        """
        self._cleanup_inactive_agents()
        
        active_count = len(self.active_agents)
        reserved_count = len(self.reserved_ids)
        
        # Calculate activity statistics
        now = time.time()
        recently_active = sum(1 for identity in self.active_agents.values() 
                            if (now - identity.last_seen) < 300)  # Active in last 5 minutes
        
        return {
            "total_active_agents": active_count,
            "reserved_ids": reserved_count,
            "recently_active": recently_active,
            "session_timeout_hours": self.session_timeout / 3600,
            "oldest_agent_age_hours": self._get_oldest_agent_age() / 3600 if active_count > 0 else 0
        }
    
    def _is_valid_agent_id(self, agent_id: str) -> bool:
        """Validate an agent ID format.
        
        Args:
            agent_id: The agent ID to validate
            
        Returns:
            True if valid, False otherwise
        """
        if not agent_id or not isinstance(agent_id, str):
            return False
        
        # Basic validation rules
        if len(agent_id) < 3 or len(agent_id) > 64:
            return False
        
        # Allow alphanumeric, hyphens, underscores
        if not all(c.isalnum() or c in '-_' for c in agent_id):
            return False
        
        # Must start with alphanumeric
        if not agent_id[0].isalnum():
            return False
        
        return True
    
    def _cleanup_inactive_agents(self):
        """Remove agents that have been inactive for too long."""
        current_time = time.time()
        inactive_agents = []
        
        for agent_id, identity in self.active_agents.items():
            if (current_time - identity.last_seen) > self.session_timeout:
                inactive_agents.append(agent_id)
        
        for agent_id in inactive_agents:
            del self.active_agents[agent_id]
            logger.info(f"Cleaned up inactive agent: {agent_id}")
        
        if inactive_agents:
            logger.info(f"Cleaned up {len(inactive_agents)} inactive agents")
    
    def _get_oldest_agent_age(self) -> float:
        """Get the age in seconds of the oldest active agent.
        
        Returns:
            Age in seconds of the oldest agent, or 0 if no agents
        """
        if not self.active_agents:
            return 0
        
        current_time = time.time()
        oldest_age = min(current_time - identity.created_at 
                        for identity in self.active_agents.values())
        return oldest_age


# Global instance for easy access
_global_identity_manager: Optional[AgentIdentityManager] = None


def get_global_identity_manager() -> AgentIdentityManager:
    """Get the global identity manager instance.
    
    Returns:
        The global AgentIdentityManager instance
    """
    global _global_identity_manager
    if _global_identity_manager is None:
        _global_identity_manager = AgentIdentityManager()
    return _global_identity_manager


def set_global_identity_manager(manager: AgentIdentityManager):
    """Set the global identity manager instance.
    
    Args:
        manager: The AgentIdentityManager instance to use globally
    """
    global _global_identity_manager
    _global_identity_manager = manager


# Convenience functions that use the global manager
def claim_agent_id(agent_id: str, force: bool = False) -> Optional[AgentIdentity]:
    """Convenience function to claim an agent ID using the global manager."""
    return get_global_identity_manager().claim_agent_id(agent_id, force)


def release_agent_id(agent_id: str) -> bool:
    """Convenience function to release an agent ID using the global manager."""
    return get_global_identity_manager().release_agent_id(agent_id)


def generate_unique_agent_id(prefix: str = "agent") -> str:
    """Convenience function to generate a unique agent ID using the global manager."""
    return get_global_identity_manager().generate_unique_agent_id(prefix)