"""
AgentWorld Network-level Mod for OpenAgents framework.

This mod manages global game state and coordinates multi-agent interactions.
"""

import logging
from typing import Dict, Any, List, Optional, Set
from openagents.core.base_mod import BaseMod, mod_event_handler
from openagents.models.event import Event, EventVisibility
from openagents.models.event_response import EventResponse

logger = logging.getLogger(__name__)


class AgentWorldNetworkMod(BaseMod):
    """
    AgentWorld network-level mod.
    
    Manages game sessions for all agents, coordinates events,
    and maintains global game state.
    """
    
    # Mod metadata
    requires_adapter = True  # This mod requires an agent adapter
    description = "AgentWorld game integration mod for OpenAgents"
    version = "1.0.0"
    
    def __init__(self, mod_name: str = "openagents.mods.games.agentworld"):
        super().__init__(mod_name=mod_name)
        
        # Game session tracking
        self.agent_sessions: Dict[str, Dict[str, Any]] = {}  # agent_id -> session_info
        self.game_tokens: Dict[str, str] = {}  # agent_id -> game_token
        self.username_to_agent: Dict[str, str] = {}  # username -> agent_id
        
        # Configuration
        self.game_server_host = "localhost"
        self.game_server_port = 7031
        self.game_client_port = 7032
        
        # Statistics
        self.total_logins = 0
        self.total_actions = 0
    
    def initialize(self) -> bool:
        """Initialize the mod with configuration."""
        config = self.config or {}
        
        self.game_server_host = config.get("game_server_host", "localhost")
        self.game_server_port = config.get("game_server_port", 7031)
        self.game_client_port = config.get("game_client_port", 7032)
        
        logger.info(
            f"AgentWorld NetworkMod initialized - "
            f"Server: {self.game_server_host}:{self.game_server_port}, "
            f"Client: {self.game_client_port}"
        )
        return True
    
    @mod_event_handler("agentworld.login")
    async def handle_login(self, event: Event) -> EventResponse:
        """Handle agent login events."""
        agent_id = event.source_id
        payload = event.payload
        
        username = payload.get("username")
        token = payload.get("token")
        
        if not username or not token:
            return EventResponse(
                success=False,
                message="Invalid login event: missing username or token"
            )
        
        # Record session information
        self.agent_sessions[agent_id] = {
            "username": username,
            "token": token,
            "login_time": event.timestamp,
            "online": True
        }
        self.game_tokens[agent_id] = token
        self.username_to_agent[username] = agent_id
        self.total_logins += 1
        
        logger.info(
            f"Agent {agent_id} logged into game as {username} "
            f"(total online: {self.get_online_count()})"
        )
        
        # Broadcast agent online notification
        notification = Event(
            event_name="agentworld.notification",
            source_id="system",
            payload={
                "notification_type": "agent_online",
                "data": {
                    "agent_id": agent_id,
                    "username": username
                }
            },
            relevant_mod=self.mod_name,
            visibility=EventVisibility.MOD_ONLY
        )
        
        if self.network:
            await self.network.broadcast_event(notification)
        
        return EventResponse(
            success=True,
            data={
                "message": f"Agent {agent_id} logged in as {username}",
                "online_count": self.get_online_count()
            }
        )
    
    @mod_event_handler("agentworld.logout")
    async def handle_logout(self, event: Event) -> EventResponse:
        """Handle agent logout events."""
        agent_id = event.source_id
        
        if agent_id in self.agent_sessions:
            session = self.agent_sessions[agent_id]
            username = session.get("username")
            
            # Mark as offline
            session["online"] = False
            
            logger.info(
                f"Agent {agent_id} ({username}) logged out "
                f"(remaining online: {self.get_online_count()})"
            )
            
            # Broadcast agent offline notification
            notification = Event(
                event_name="agentworld.notification",
                source_id="system",
                payload={
                    "notification_type": "agent_offline",
                    "data": {
                        "agent_id": agent_id,
                        "username": username
                    }
                },
                relevant_mod=self.mod_name,
                visibility=EventVisibility.MOD_ONLY
            )
            
            if self.network:
                await self.network.broadcast_event(notification)
        
        return EventResponse(success=True)
    
    @mod_event_handler("agentworld.notification")
    async def handle_notification(self, event: Event) -> EventResponse:
        """Handle game notification events."""
        payload = event.payload
        notification_type = payload.get("notification_type")
        data = payload.get("data", {})
        
        logger.debug(
            f"Game notification: {notification_type} - {data}"
        )
        
        # Forward to relevant agents
        # (notifications are typically broadcast by the game server)
        
        return EventResponse(success=True)
    
    @mod_event_handler("agentworld.received_message")
    async def handle_received_message(self, event: Event) -> EventResponse:
        """Handle in-game message events."""
        payload = event.payload
        sender = payload.get("sender")
        recipient = payload.get("recipient")
        message = payload.get("message")
        
        logger.info(
            f"Game message: {sender} -> {recipient}: {message}"
        )
        
        # Forward to recipient agent
        if recipient in self.username_to_agent:
            recipient_agent_id = self.username_to_agent[recipient]
            
            message_event = Event(
                event_name="agentworld.received_message",
                source_id=sender,
                payload={
                    "sender": sender,
                    "message": message
                },
                relevant_mod=self.mod_name,
                visibility=EventVisibility.MOD_ONLY,
                target_agent_id=recipient_agent_id
            )
            
            if self.network:
                await self.network.send_event_to_agent(
                    recipient_agent_id, 
                    message_event
                )
        
        return EventResponse(success=True)
    
    @mod_event_handler("agentworld.state_update")
    async def handle_state_update(self, event: Event) -> EventResponse:
        """Handle game state update events."""
        agent_id = event.source_id
        payload = event.payload
        
        # Update agent session state
        if agent_id in self.agent_sessions:
            self.agent_sessions[agent_id].update(payload)
        
        self.total_actions += 1
        
        return EventResponse(success=True)
    
    def get_agent_session(self, agent_id: str) -> Optional[Dict[str, Any]]:
        """Get agent's game session information."""
        return self.agent_sessions.get(agent_id)
    
    def get_agent_by_username(self, username: str) -> Optional[str]:
        """Get agent ID by game username."""
        return self.username_to_agent.get(username)
    
    def get_online_agents(self) -> List[str]:
        """Get list of online agent IDs."""
        return [
            agent_id 
            for agent_id, session in self.agent_sessions.items()
            if session.get("online", False)
        ]
    
    def get_online_count(self) -> int:
        """Get count of online agents."""
        return len(self.get_online_agents())
    
    def get_all_usernames(self) -> List[str]:
        """Get all game usernames."""
        return list(self.username_to_agent.keys())
    
    def get_statistics(self) -> Dict[str, Any]:
        """Get mod statistics."""
        return {
            "total_sessions": len(self.agent_sessions),
            "online_agents": self.get_online_count(),
            "total_logins": self.total_logins,
            "total_actions": self.total_actions,
            "usernames": self.get_all_usernames()
        }

