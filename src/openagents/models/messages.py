"""Message models for OpenAgents - now based on unified Event system."""

from typing import Dict, List, Optional, Any, Union, Set
from dataclasses import dataclass, field
import uuid
import time

from .event import Event, EventVisibility, EventNames


# BaseMessage has been completely removed - use Event instead


@dataclass
class DirectMessage(Event):
    """A direct message from one agent to another - now based on Event."""
    
    def __init__(self, event_name: str = EventNames.AGENT_DIRECT_MESSAGE_SENT, 
                 source_id: str = "", **kwargs):
        """Initialize DirectMessage with default event name."""
        # Handle backward compatibility for source_agent_id and sender_id
        if 'source_agent_id' in kwargs:
            source_id = kwargs.pop('source_agent_id')
        elif 'sender_id' in kwargs:
            source_id = kwargs.pop('sender_id')
        
        # Extract DirectMessage-specific fields and map to Event fields
        if 'content' in kwargs:
            kwargs['payload'] = kwargs.pop('content')
        
        # Set default visibility for direct messages if not specified
        if 'visibility' not in kwargs:
            kwargs['visibility'] = EventVisibility.DIRECT
        
        # Call parent constructor
        super().__init__(event_name=event_name, source_id=source_id, **kwargs)
    
    # Backward compatibility properties
    @property
    def message_id(self) -> str:
        """Backward compatibility: message_id maps to event_id."""
        return self.event_id
    
    @message_id.setter
    def message_id(self, value: str):
        """Backward compatibility: message_id maps to event_id."""
        self.event_id = value
    
    @property
    def sender_id(self) -> str:
        """Backward compatibility: sender_id maps to source_id."""
        return self.source_id
    
    @sender_id.setter
    def sender_id(self, value: str):
        """Backward compatibility: sender_id maps to source_id."""
        self.source_id = value
    
    @property
    def source_agent_id(self) -> str:
        """Backward compatibility: source_agent_id maps to source_id."""
        return self.source_id
    
    @source_agent_id.setter
    def source_agent_id(self, value: str):
        """Backward compatibility: source_agent_id maps to source_id."""
        self.source_id = value
    
    @property
    def content(self) -> Dict[str, Any]:
        """Backward compatibility: content maps to payload."""
        return self.payload
    
    @content.setter
    def content(self, value: Dict[str, Any]):
        """Backward compatibility: content maps to payload."""
        self.payload = value
    
    @property
    def message_type(self) -> str:
        """Backward compatibility: message_type derived from event_name."""
        return "direct_message"
    



@dataclass
class BroadcastMessage(Event):
    """Message for broadcasting to all agents in a network - now based on Event."""
    
    # Broadcast-specific fields
    exclude_agent_ids: List[str] = field(default_factory=list)
    
    def __init__(self, event_name: str = EventNames.NETWORK_BROADCAST_SENT, 
                 source_id: str = "", **kwargs):
        """Initialize BroadcastMessage with default event name."""
        # Handle backward compatibility for source_agent_id and sender_id
        if 'source_agent_id' in kwargs:
            source_id = kwargs.pop('source_agent_id')
        elif 'sender_id' in kwargs:
            source_id = kwargs.pop('sender_id')
        
        # Extract BroadcastMessage-specific fields and map to Event fields
        if 'content' in kwargs:
            kwargs['payload'] = kwargs.pop('content')
        
        # Extract exclude_agent_ids field
        exclude_agent_ids = kwargs.pop('exclude_agent_ids', [])
        
        # Set default visibility for broadcast messages if not specified
        if 'visibility' not in kwargs:
            kwargs['visibility'] = EventVisibility.NETWORK
        
        # Call parent constructor
        super().__init__(event_name=event_name, source_id=source_id, **kwargs)
        
        # Set BroadcastMessage-specific fields after parent initialization
        self.exclude_agent_ids = exclude_agent_ids
    
    # Backward compatibility properties
    @property
    def message_id(self) -> str:
        """Backward compatibility: message_id maps to event_id."""
        return self.event_id
    
    @message_id.setter
    def message_id(self, value: str):
        """Backward compatibility: message_id maps to event_id."""
        self.event_id = value
    
    @property
    def sender_id(self) -> str:
        """Backward compatibility: sender_id maps to source_id."""
        return self.source_id
    
    @sender_id.setter
    def sender_id(self, value: str):
        """Backward compatibility: sender_id maps to source_id."""
        self.source_id = value
    
    @property
    def source_agent_id(self) -> str:
        """Backward compatibility: source_agent_id maps to source_id."""
        return self.source_id
    
    @source_agent_id.setter
    def source_agent_id(self, value: str):
        """Backward compatibility: source_agent_id maps to source_id."""
        self.source_id = value
    
    @property
    def content(self) -> Dict[str, Any]:
        """Backward compatibility: content maps to payload."""
        return self.payload
    
    @content.setter
    def content(self, value: Dict[str, Any]):
        """Backward compatibility: content maps to payload."""
        self.payload = value
    
    @property
    def message_type(self) -> str:
        """Backward compatibility: message_type derived from event_name."""
        return "broadcast_message"
    



@dataclass
class ModMessage(Event):
    """A message for network mods to consume - now based on Event."""
    
    # Mod-specific fields (backward compatibility)
    direction: str = field(default="inbound")
    relevant_agent_id: str = field(default="")
    
    def __init__(self, event_name: str = "", source_id: str = "", **kwargs):
        """Initialize ModMessage with dynamic event name generation."""
        # Handle backward compatibility for source_agent_id and sender_id
        if 'source_agent_id' in kwargs:
            source_id = kwargs.pop('source_agent_id')
        elif 'sender_id' in kwargs:
            source_id = kwargs.pop('sender_id')
        
        # Extract ModMessage-specific fields
        mod = kwargs.pop('mod', '')  # For backward compatibility, still accept mod parameter
        direction = kwargs.pop('direction', 'inbound')
        relevant_agent_id = kwargs.pop('relevant_agent_id', '')
        payload = kwargs.get('payload', {})
        
        # Handle relevant_mod - use mod for backward compatibility if relevant_mod not provided
        if mod and 'relevant_mod' not in kwargs:
            kwargs['relevant_mod'] = mod
        elif 'relevant_mod' not in kwargs:
            kwargs['relevant_mod'] = ''
        
        relevant_mod = kwargs.get('relevant_mod', '')
        
        # Generate event name if not provided
        if not event_name:
            if relevant_mod:
                action = payload.get('action', 'message_received') if payload else 'message_received'
                # Convert mod name to event name format
                mod_parts = relevant_mod.split('.')
                if len(mod_parts) >= 2:
                    # e.g., "openagents.mods.project.default" -> "project"
                    mod_short = mod_parts[-2] if mod_parts[-1] == 'default' else mod_parts[-1]
                else:
                    mod_short = relevant_mod
                
                # Ensure action is meaningful
                if action in ['unknown', 'default', 'generic', 'placeholder']:
                    action = 'message_received'
                
                event_name = f"{mod_short}.{action}"
            else:
                # If no relevant_mod is specified, this is an error - ModMessage must have a relevant_mod
                raise ValueError("ModMessage must have a 'relevant_mod' field to generate meaningful event name")
        
        # Set default visibility for mod messages if not specified
        if 'visibility' not in kwargs:
            kwargs['visibility'] = EventVisibility.MOD_ONLY
        
        # Set relevant_agent_id as target if not set
        if relevant_agent_id and 'target_agent_id' not in kwargs:
            kwargs['target_agent_id'] = relevant_agent_id
        
        # Extract ModMessage-specific fields and map to Event fields
        if 'content' in kwargs:
            kwargs['payload'] = kwargs.pop('content')
        
        # Call parent constructor
        super().__init__(event_name=event_name, source_id=source_id, **kwargs)
        
        # Set ModMessage-specific fields after initialization
        self.direction = direction
        self.relevant_agent_id = relevant_agent_id
    
    # Backward compatibility properties
    @property
    def message_id(self) -> str:
        """Backward compatibility: message_id maps to event_id."""
        return self.event_id
    
    @message_id.setter
    def message_id(self, value: str):
        """Backward compatibility: message_id maps to event_id."""
        self.event_id = value
    
    @property
    def sender_id(self) -> str:
        """Backward compatibility: sender_id maps to source_id."""
        return self.source_id
    
    @sender_id.setter
    def sender_id(self, value: str):
        """Backward compatibility: sender_id maps to source_id."""
        self.source_id = value
    
    @property
    def source_agent_id(self) -> str:
        """Backward compatibility: source_agent_id maps to source_id."""
        return self.source_id
    
    @source_agent_id.setter
    def source_agent_id(self, value: str):
        """Backward compatibility: source_agent_id maps to source_id."""
        self.source_id = value
    
    @property
    def content(self) -> Dict[str, Any]:
        """Backward compatibility: content maps to payload."""
        return self.payload
    
    @content.setter
    def content(self, value: Dict[str, Any]):
        """Backward compatibility: content maps to payload."""
        self.payload = value
    
    @property
    def mod(self) -> str:
        """Backward compatibility: mod maps to relevant_mod."""
        return self.relevant_mod or ""
    
    @mod.setter
    def mod(self, value: str):
        """Backward compatibility: mod maps to relevant_mod."""
        self.relevant_mod = value
    
    @property
    def message_type(self) -> str:
        """Backward compatibility: message_type derived from event_name."""
        return "mod_message"
    

    
    def __setattr__(self, name, value):
        """Handle backward compatibility for mod field."""
        if name == 'mod' and hasattr(self, 'relevant_mod'):
            # When mod is set, also set relevant_mod
            super().__setattr__('relevant_mod', value)
        super().__setattr__(name, value)


# BaseMessage has been completely removed - use Event instead