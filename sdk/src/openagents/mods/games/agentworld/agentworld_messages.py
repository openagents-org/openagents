"""
AgentWorld message definitions for OpenAgents framework.

This module defines message types for communication between agents and the AgentWorld game server.
"""

from typing import Dict, Any, Optional, List


class AgentWorldMessage:
    """Base class for AgentWorld messages"""
    
    def __init__(self, source_id: str, action: str, **kwargs):
        self.source_id = source_id
        self.action = action
        self.data = kwargs
    
    @property
    def payload(self) -> Dict[str, Any]:
        """Get message payload"""
        return {
            "action": self.action,
            "source_id": self.source_id,
            "data": self.data
        }


class AgentWorldLoginMessage(AgentWorldMessage):
    """Login message for authenticating with the game server"""
    
    def __init__(self, source_id: str, username: str, password: str):
        super().__init__(source_id, "login", username=username, password=password)


class AgentWorldLogoutMessage(AgentWorldMessage):
    """Logout message for disconnecting from the game server"""
    
    def __init__(self, source_id: str):
        super().__init__(source_id, "logout")


class AgentWorldObserveMessage(AgentWorldMessage):
    """Observe environment message"""
    
    def __init__(self, source_id: str, radius: int = 32):
        super().__init__(source_id, "observe", radius=radius)


class AgentWorldMoveMessage(AgentWorldMessage):
    """Move character message"""
    
    def __init__(self, source_id: str, x: int, y: int):
        super().__init__(source_id, "move", x=x, y=y)


class AgentWorldChatMessage(AgentWorldMessage):
    """In-game chat message"""
    
    def __init__(self, source_id: str, message: str, channel: Optional[str] = None):
        super().__init__(source_id, "chat", message=message, channel=channel)


class AgentWorldAttackMessage(AgentWorldMessage):
    """Attack entity message"""
    
    def __init__(self, source_id: str, target_instance: str):
        super().__init__(source_id, "attack", target_instance=target_instance)


class AgentWorldHarvestMessage(AgentWorldMessage):
    """Harvest resource message"""
    
    def __init__(self, source_id: str, resource_instance: str):
        super().__init__(source_id, "harvest", resource_instance=resource_instance)


class AgentWorldCraftMessage(AgentWorldMessage):
    """Craft item message"""
    
    def __init__(self, source_id: str, item_key: str, count: int = 1):
        super().__init__(source_id, "craft", item_key=item_key, count=count)


class AgentWorldTransferMessage(AgentWorldMessage):
    """Transfer items to another player message"""
    
    def __init__(
        self, 
        source_id: str, 
        target_username: str, 
        item_key: str, 
        count: int = 1
    ):
        super().__init__(
            source_id, 
            "transfer", 
            target_username=target_username,
            item_key=item_key,
            count=count
        )


class AgentWorldEquipMessage(AgentWorldMessage):
    """Equip item message"""
    
    def __init__(self, source_id: str, item_key: str, slot: Optional[str] = None):
        super().__init__(source_id, "equip", item_key=item_key, slot=slot)


class AgentWorldUseItemMessage(AgentWorldMessage):
    """Use item message"""
    
    def __init__(self, source_id: str, item_key: str):
        super().__init__(source_id, "use_item", item_key=item_key)


class AgentWorldNotificationMessage(AgentWorldMessage):
    """Game notification message"""
    
    def __init__(
        self, 
        source_id: str, 
        notification_type: str, 
        data: Dict[str, Any]
    ):
        super().__init__(
            source_id, 
            "notification", 
            notification_type=notification_type,
            notification_data=data
        )

