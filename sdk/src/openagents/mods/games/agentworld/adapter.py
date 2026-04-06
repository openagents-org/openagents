"""
AgentWorld Adapter for OpenAgents framework.

This adapter provides agent-level interface to the AgentWorld game server.
"""

import logging
import requests
from typing import Dict, Any, Optional, List
from openagents.core.base_mod_adapter import BaseModAdapter
from openagents.models.event import Event, EventVisibility
from openagents.models.tool import AgentTool

logger = logging.getLogger(__name__)


class AgentWorldAdapter(BaseModAdapter):
    """
    AgentWorld agent-level adapter.
    
    Provides tools for agents to interact with the AgentWorld game server.
    Each agent has its own adapter instance with independent game session.
    """
    
    def __init__(self):
        super().__init__(mod_name="agentworld")
        
        # Game server configuration
        self.game_server_host = "localhost"
        self.game_server_port = 7031

        # Username prefix configuration
        self.username_prefix: Optional[str] = None
        self.default_channel: Optional[str] = None

        # Game session state
        self.game_token = None  # Authentication token from game server
        self.username = None
        self.session = requests.Session()  # HTTP session for API calls
        
        logger.info("AgentWorld adapter created")
    
    def initialize(self) -> bool:
        """Initialize the adapter with configuration."""
        config = self.config or {}

        self.game_server_host = config.get("game_server_host", "localhost")
        self.game_server_port = config.get("game_server_port", 7031)

        # Username prefix: if not specified, defaults to channel name
        self.default_channel = config.get("channel")
        self.username_prefix = config.get("username_prefix", self.default_channel)

        logger.info(
            f"AgentWorld adapter initialized for agent {self.agent_id}, "
            f"game server: {self.game_server_host}:{self.game_server_port}, "
            f"username_prefix: {self.username_prefix}"
        )
        return True
    
    def shutdown(self) -> bool:
        """Shutdown the adapter and clean up resources."""
        if self.session:
            self.session.close()
        logger.info(f"AgentWorld adapter shutdown for agent {self.agent_id}")
        return True
    
    def get_tools(self) -> List[AgentTool]:
        """Return list of tools provided by this mod."""
        return [
            AgentTool(
                name="agentworld_login",
                description="Login to AgentWorld game. Required before any other game actions.",
                input_schema={
                    "type": "object",
                    "properties": {
                        "username": {"type": "string", "description": "Game username"},
                        "password": {"type": "string", "description": "Game password"},
                        "channel": {"type": "string", "description": "Game channel to join"}
                    },
                    "required": ["username", "password", "channel"]
                },
                func=self.agentworld_login
            ),
            AgentTool(
                name="agentworld_observe",
                description="Observe the game environment around your character. Returns nearby entities, items, and terrain.",
                input_schema={
                    "type": "object",
                    "properties": {
                        "radius": {
                            "type": "integer", 
                            "description": "Observation radius in tiles (default: 32)",
                            "default": 32
                        }
                    }
                },
                func=self.agentworld_observe
            ),
            AgentTool(
                name="agentworld_move",
                description="Move your character to specified coordinates.",
                input_schema={
                    "type": "object",
                    "properties": {
                        "x": {"type": "integer", "description": "Target X coordinate"},
                        "y": {"type": "integer", "description": "Target Y coordinate"}
                    },
                    "required": ["x", "y"]
                },
                func=self.agentworld_move
            ),
            AgentTool(
                name="agentworld_chat",
                description="Send a chat message to a game channel.",
                input_schema={
                    "type": "object",
                    "properties": {
                        "channel": {"type": "string", "description": "Game channel name"},
                        "message": {"type": "string", "description": "Chat message"}
                    },
                    "required": ["channel", "message"]
                },
                func=self.agentworld_chat
            ),
            AgentTool(
                name="agentworld_attack",
                description="Attack a target entity (mob or player).",
                input_schema={
                    "type": "object",
                    "properties": {
                        "target_instance": {
                            "type": "string", 
                            "description": "Instance ID of target (from observation)"
                        }
                    },
                    "required": ["target_instance"]
                },
                func=self.agentworld_attack
            ),
            AgentTool(
                name="agentworld_harvest",
                description="Harvest a resource node (tree, rock, etc.).",
                input_schema={
                    "type": "object",
                    "properties": {
                        "resource_instance": {
                            "type": "string", 
                            "description": "Instance ID of resource (from observation)"
                        }
                    },
                    "required": ["resource_instance"]
                },
                func=self.agentworld_harvest
            ),
            AgentTool(
                name="agentworld_craft",
                description="Craft an item using inventory materials.",
                input_schema={
                    "type": "object",
                    "properties": {
                        "item_key": {
                            "type": "string", 
                            "description": "Item key to craft (e.g., 'ironbar')"
                        },
                        "count": {
                            "type": "integer", 
                            "description": "Number to craft (default: 1)",
                            "default": 1
                        }
                    },
                    "required": ["item_key"]
                },
                func=self.agentworld_craft
            ),
            AgentTool(
                name="agentworld_transfer_items",
                description="Transfer items to another player.",
                input_schema={
                    "type": "object",
                    "properties": {
                        "target_username": {
                            "type": "string", 
                            "description": "Username of target player"
                        },
                        "item_key": {"type": "string", "description": "Item key"},
                        "count": {
                            "type": "integer", 
                            "description": "Number of items (default: 1)",
                            "default": 1
                        }
                    },
                    "required": ["target_username", "item_key"]
                },
                func=self.agentworld_transfer_items
            )
        ]
    
    async def process_incoming_mod_message(self, message: Event) -> None:
        """Process incoming mod messages from the network."""
        event_name = message.event_name
        
        if event_name == "agentworld.notification":
            await self._handle_game_notification(message)
        elif event_name == "agentworld.received_message":
            await self._handle_game_message(message)
        elif event_name.endswith("_response"):
            await self._handle_response(message)
    
    async def _handle_game_notification(self, message: Event):
        """Handle game notification events."""
        payload = message.payload
        notification_type = payload.get("notification_type")
        data = payload.get("data", {})
        
        logger.info(
            f"[{self.agent_id}] Game notification: {notification_type} - {data}"
        )
        
        # Auto-response logic can be added here
        if notification_type == "under_attack":
            attacker = data.get("attacker_instance")
            logger.warning(f"[{self.agent_id}] Under attack from {attacker}!")
    
    async def _handle_game_message(self, message: Event):
        """Handle in-game private messages."""
        payload = message.payload
        sender = payload.get("sender")
        content = payload.get("message")
        
        logger.info(f"[{self.agent_id}] Message from {sender}: {content}")
    
    async def _handle_response(self, message: Event):
        """Handle response messages."""
        request_id = message.payload.get("request_id")
        success = message.payload.get("success", False)
        
        logger.debug(
            f"[{self.agent_id}] Response for {request_id}: success={success}"
        )
    
    def _make_game_api_request(
        self, 
        endpoint: str, 
        method: str = "POST",
        data: Optional[Dict] = None
    ) -> Dict[str, Any]:
        """Make HTTP request to AgentWorld game server.
        
        Note: AgentWorld API expects token in request body, not in Authorization header.
        """
        url = f"http://{self.game_server_host}:{self.game_server_port}{endpoint}"
        
        headers = {"Content-Type": "application/json"}
        
        try:
            if method == "GET":
                response = self.session.get(url, headers=headers, params=data, timeout=10)
            elif method == "POST":
                response = self.session.post(url, headers=headers, json=data, timeout=10)
            else:
                return {"error": f"Unsupported HTTP method: {method}"}
            
            response.raise_for_status()
            result = response.json()
            
            logger.debug(f"[{self.agent_id}] API {method} {endpoint}: OK")
            return result
            
        except requests.exceptions.HTTPError as e:
            error_msg = f"HTTP error: {e.response.status_code}"
            if e.response.text:
                error_msg += f" - {e.response.text[:200]}"
            logger.error(f"[{self.agent_id}] {error_msg}")
            return {"error": error_msg}
            
        except Exception as e:
            error_msg = f"Request failed: {str(e)}"
            logger.error(f"[{self.agent_id}] {error_msg}")
            return {"error": error_msg}
    
    # ==================== Game Action Methods ====================
    
    def _apply_username_prefix(self, username: str) -> str:
        """Apply username prefix if configured.

        Args:
            username: Original username

        Returns:
            Prefixed username (e.g., "team_alpha.agent001") or original if no prefix
        """
        if self.username_prefix:
            return f"{self.username_prefix}.{username}"
        return username

    async def agentworld_login(self, username: str, password: str, channel: str) -> Dict[str, Any]:
        """Login to AgentWorld game."""
        # Apply username prefix if configured
        prefixed_username = self._apply_username_prefix(username)

        result = self._make_game_api_request(
            "/ai/login",
            method="POST",
            data={"username": prefixed_username, "password": password, "channel": channel}
        )

        if "token" in result:
            self.game_token = result["token"]
            self.username = prefixed_username
            logger.info(f"[{self.agent_id}] Logged in as {prefixed_username}")
            
            # Send login event to network
            if self.connector:
                login_event = Event(
                    event_name="agentworld.login",
                    source_id=self.agent_id,
                    payload={
                        "username": prefixed_username,
                        "token": self.game_token,
                        "agent_id": self.agent_id
                    },
                    relevant_mod="openagents.mods.games.agentworld",
                    visibility=EventVisibility.MOD_ONLY
                )
                await self.connector.send_event(login_event)

            return {
                "success": True,
                "message": f"Logged in as {prefixed_username}",
                "token": self.game_token
            }
        else:
            error = result.get("error", "Unknown error")
            logger.error(f"[{self.agent_id}] Login failed: {error}")
            return {"success": False, "error": error}
    
    async def agentworld_observe(self, radius: int = 32) -> Dict[str, Any]:
        """Observe game environment."""
        if not self.game_token:
            return {"error": "Not logged in. Call agentworld_login first."}
        
        return self._make_game_api_request(
            "/ai/observe",
            method="GET",
            data={"token": self.game_token, "radius": radius}
        )
    
    async def agentworld_move(self, x: int, y: int) -> Dict[str, Any]:
        """Move character to coordinates."""
        if not self.game_token:
            return {"error": "Not logged in"}
        
        return self._make_game_api_request(
            "/ai/move",
            method="POST",
            data={"token": self.game_token, "x": x, "y": y}
        )
    
    async def agentworld_chat(self, channel: str, message: str) -> Dict[str, Any]:
        """Send chat message to a channel."""
        if not self.game_token:
            return {"error": "Not logged in"}
        
        return self._make_game_api_request(
            "/ai/chat",
            method="POST",
            data={"token": self.game_token, "channel": channel, "message": message}
        )
    
    async def agentworld_attack(self, target_instance: str) -> Dict[str, Any]:
        """Attack target entity."""
        if not self.game_token:
            return {"error": "Not logged in"}
        
        return self._make_game_api_request(
            "/ai/attack",
            method="POST",
            data={"token": self.game_token, "target": target_instance}
        )
    
    async def agentworld_harvest(self, resource_instance: str) -> Dict[str, Any]:
        """Harvest resource (uses /ai/collect endpoint)."""
        if not self.game_token:
            return {"error": "Not logged in"}
        
        return self._make_game_api_request(
            "/ai/collect",
            method="POST",
            data={"token": self.game_token, "target": resource_instance}
        )
    
    async def agentworld_craft(self, item_key: str, count: int = 1) -> Dict[str, Any]:
        """Craft item."""
        if not self.game_token:
            return {"error": "Not logged in"}
        
        return self._make_game_api_request(
            "/ai/craft",
            method="POST",
            data={"token": self.game_token, "item": item_key, "count": count}
        )
    
    async def agentworld_transfer_items(
        self,
        target_username: str,
        item_key: str,
        count: int = 1
    ) -> Dict[str, Any]:
        """Transfer items to another player.
        
        Note: This feature is not currently implemented in AgentWorld API.
        """
        return {
            "success": False,
            "error": "Transfer items feature is not yet implemented in AgentWorld API"
        }

