"""
HTTP Network Connector for OpenAgents

Provides HTTP-based connectivity for agents to connect to HTTP networks.
This is an alternative to the gRPC-based NetworkConnector for web clients.
"""

import asyncio
import json
import logging
import time
from typing import Dict, Any, Optional, Callable, Awaitable, List

from openagents.config.globals import SYSTEM_EVENT_POLL_MESSAGES
from openagents.models.event_response import EventResponse
from openagents.models.event import Event
from openagents.core.connectors.base import NetworkConnector

logger = logging.getLogger(__name__)


class HTTPNetworkConnector(NetworkConnector):
    """Handles HTTP network connections and message passing for agents.
    
    This connector allows agents to connect to HTTP-based networks using
    REST API endpoints.
    """
    
    def __init__(self, host: str, port: int, agent_id: str, metadata: Optional[Dict[str, Any]] = None, timeout: int = 30):
        """Initialize an HTTP network connector.
        
        Args:
            host: Server host address
            port: Server port
            agent_id: Agent identifier
            metadata: Agent metadata to send during registration
            timeout: Request timeout in seconds (default 30)
        """
        # Initialize base connector
        super().__init__(host, port, agent_id, metadata)
        
        self.timeout = timeout
        self.is_polling = True  # HTTP uses polling for message retrieval
        
        # HTTP client session
        self.session = None
        self.base_url = f"http://{host}:{port}/api"
        
        # HTTP modules (loaded on demand)
        self.aiohttp = None
    
    async def _load_http_modules(self):
        """Load HTTP modules on demand."""
        if self.aiohttp is None:
            try:
                import aiohttp
                self.aiohttp = aiohttp
                logger.debug("HTTP modules loaded successfully")
                return True
            except ImportError as e:
                logger.error(f"Failed to load HTTP modules: {e}")
                return False
        return True
    
    async def connect_to_server(self) -> bool:
        """Connect to an HTTP network server.
        
        Returns:
            bool: True if connection successful
        """
        try:
            # Load HTTP modules
            if not await self._load_http_modules():
                return False
            
            # Create HTTP session
            connector = self.aiohttp.TCPConnector(
                limit=100,
                limit_per_host=30,
                ttl_dns_cache=300,
                use_dns_cache=True,
            )
            
            timeout = self.aiohttp.ClientTimeout(total=self.timeout)
            self.session = self.aiohttp.ClientSession(
                connector=connector,
                timeout=timeout,
                headers={'Content-Type': 'application/json'}
            )
            
            # Test connection with health check
            try:
                async with self.session.get(f"{self.base_url}/health") as response:
                    if response.status != 200:
                        logger.error(f"Server health check failed with status {response.status}")
                        return False
                    
                    health_data = await response.json()
                    if not health_data.get('success', False):
                        logger.error("Server health check failed")
                        return False
                        
            except Exception as e:
                logger.error(f"Failed to send health check to HTTP server: {e}")
                return False
            
            # Register with server
            register_data = {
                'agent_id': self.agent_id,
                'metadata': self.metadata
            }
            
            try:
                async with self.session.post(f"{self.base_url}/register", json=register_data) as response:
                    if response.status != 200:
                        logger.error(f"Agent registration failed with status {response.status}")
                        return False
                    
                    register_response = await response.json()
                    if not register_response.get('success', False):
                        logger.error(f"Agent registration failed: {register_response.get('error_message', 'Unknown error')}")
                        return False
                        
            except Exception as e:
                logger.error(f"Failed to register with HTTP server: {e}")
                return False
            
            logger.info(f"Connected to HTTP network successfully")
            self.is_connected = True
            logger.debug("HTTP connection established")
            
            return True
            
        except Exception as e:
            logger.error(f"HTTP connection error: {e}")
            return False
    
    async def disconnect(self) -> bool:
        """Disconnect from the HTTP network server.
        
        Returns:
            bool: True if disconnection was successful
        """
        try:
            self.is_connected = False
            
            # Cancel message listener task if exists
            if hasattr(self, 'event_listener_task') and self.event_listener_task and not self.event_listener_task.done():
                self.event_listener_task.cancel()
                try:
                    await self.event_listener_task
                except asyncio.CancelledError:
                    pass
            
            # Unregister from server
            if self.session:
                try:
                    unregister_data = {
                        'agent_id': self.agent_id
                    }
                    async with self.session.post(f"{self.base_url}/unregister", json=unregister_data) as response:
                        if response.status != 200:
                            logger.warning(f"Failed to unregister agent: HTTP {response.status}")
                except Exception as e:
                    logger.warning(f"Failed to unregister agent: {e}")
            
            # Close session
            if self.session:
                await self.session.close()
                self.session = None
            
            logger.info(f"Agent {self.agent_id} disconnected from HTTP network")
            return True
            
        except Exception as e:
            logger.error(f"Error disconnecting from HTTP network: {e}")
            return False
    
    async def send_event(self, message: Event) -> EventResponse:
        """Send an event via HTTP.
        
        Args:
            message: Event to send
            
        Returns:
            EventResponse: The response from the server
        """
        if not self.is_connected:
            logger.debug(f"Agent {self.agent_id} is not connected to HTTP network")
            return self._create_error_response("Agent is not connected to HTTP network")
            
        try:
            # Validate event using base class method
            if not self._validate_event(message):
                return self._create_error_response("Event validation failed")
            
            # Prepare HTTP request data
            event_data = {
                'event_id': message.event_id,
                'event_name': message.event_name,
                'source_id': message.source_id,
                'target_agent_id': message.destination_id or '',
                'payload': message.payload or {},
                'metadata': message.metadata or {},
                'visibility': getattr(message, 'visibility', 'network')
            }
            
            # Send the event to the server
            async with self.session.post(f"{self.base_url}/send_event", json=event_data) as response:
                if response.status != 200:
                    error_message = f"HTTP request failed with status {response.status}"
                    logger.error(error_message)
                    return self._create_error_response(error_message)
                
                response_data = await response.json()
                
                if response_data.get('success', False):
                    logger.debug(f"Successfully sent HTTP event {message.event_id}")
                    return self._create_success_response(
                        response_data.get('message', 'Success'),
                        response_data.get('data')
                    )
                else:
                    logger.error(f"Failed to send HTTP event {message.event_id}: {response_data.get('message', 'Unknown error')}")
                    return self._create_error_response(response_data.get('message', 'Unknown error'))
                
        except Exception as e:
            # Handle HTTP-specific errors
            error_message = f"Failed to send HTTP message: {str(e)}"
            
            # Check for common HTTP errors
            if hasattr(e, 'status'):
                error_message = f"HTTP error {e.status}: {str(e)}"
            elif "timeout" in str(e).lower():
                error_message = f"HTTP timeout error: {str(e)}"
            elif "connection" in str(e).lower():
                error_message = f"HTTP connection error: {str(e)}"
            
            logger.error(error_message)
            return self._create_error_response(error_message)
     
    async def poll_messages(self) -> List[Event]:
        """Poll for queued messages from the HTTP network server.
        
        Returns:
            List of Event objects waiting for this agent
        """
        if not self.is_connected:
            logger.debug(f"Agent {self.agent_id} is not connected to HTTP network")
            return []
        
        try:
            # Send poll request
            params = {'agent_id': self.agent_id}
            async with self.session.get(f"{self.base_url}/poll", params=params) as response:
                if response.status != 200:
                    logger.warning(f"Poll messages request failed with status {response.status}")
                    return []
                
                response_data = await response.json()
                
                if not response_data.get('success', False):
                    logger.warning(f"Poll messages request failed: {response_data.get('error_message', 'Unknown error')}")
                    return []
                
                # Extract messages from response
                messages = []
                response_messages = response_data.get('messages', [])
                
                logger.info(f"🔧 HTTP: Processing {len(response_messages)} polled messages for {self.agent_id}")
                
                # Convert each message to Event object
                for message_data in response_messages:
                    try:
                        if isinstance(message_data, dict):
                            if 'event_name' in message_data:
                                # This is already an Event structure
                                event = Event(**message_data)
                                messages.append(event)
                                logger.debug(f"🔧 HTTP: Successfully converted message to Event: {event.event_id}")
                            else:
                                # This might be a legacy message format - try to parse it
                                from openagents.utils.message_util import parse_message_dict
                                event = parse_message_dict(message_data)
                                if event:
                                    messages.append(event)
                                    logger.debug(f"🔧 HTTP: Successfully parsed legacy message to Event: {event.event_id}")
                                else:
                                    logger.warning(f"🔧 HTTP: Failed to parse message data: {message_data}")
                        else:
                            logger.warning(f"🔧 HTTP: Invalid message format in poll response: {message_data}")
                            
                    except Exception as e:
                        logger.error(f"🔧 HTTP: Error processing polled message: {e}")
                        logger.debug(f"🔧 HTTP: Problematic message data: {message_data}")
                
                logger.info(f"🔧 HTTP: Successfully converted {len(messages)} messages to Events")
                for event in messages:
                    await self.consume_message(event)
                return messages
                
        except Exception as e:
            logger.error(f"Failed to poll messages: {e}")
            return []
