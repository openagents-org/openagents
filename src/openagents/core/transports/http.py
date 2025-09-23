"""
HTTP Transport Implementation for OpenAgents.

This module provides the HTTP transport implementation for agent communication.
"""

import json
import logging
import time
from typing import Dict, Any, Optional

from openagents.config.globals import SYSTEM_EVENT_REGISTER_AGENT, SYSTEM_EVENT_HEALTH_CHECK, SYSTEM_EVENT_POLL_MESSAGES, SYSTEM_EVENT_UNREGISTER_AGENT
from aiohttp import web
# No need for external CORS library, implement manually

from .base import Transport
from openagents.models.transport import TransportType, ConnectionState, ConnectionInfo
from openagents.models.event import Event

logger = logging.getLogger(__name__)


class HttpTransport(Transport):
    """
    HTTP transport implementation.

    This transport implementation uses HTTP to communicate with the network.
    It is used to communicate with the network from the browser and easily obtain claim information.
    """

    def __init__(self, config: Optional[Dict[str, Any]] = None):
        super().__init__(TransportType.HTTP, config, is_notifiable=False)
        self.app = web.Application(middlewares=[self.cors_middleware])
        self.site = None
        self.network_instance = None  # Reference to network instance
        self.setup_routes()

    def setup_routes(self):
        """Setup HTTP routes."""
        # Add both /health and /api/health for compatibility
        self.app.router.add_get('/api/health', self.health_check)
        self.app.router.add_post('/api/register', self.register_agent)
        self.app.router.add_post('/api/unregister', self.unregister_agent)
        self.app.router.add_get('/api/poll', self.poll_messages)
        self.app.router.add_post('/api/send_event', self.send_message)
        
    @web.middleware
    async def cors_middleware(self, request, handler):
        """CORS middleware for browser compatibility."""
        # Handle preflight OPTIONS requests
        if request.method == 'OPTIONS':
            response = web.Response()
        else:
            response = await handler(request)
        
        # Add CORS headers
        response.headers['Access-Control-Allow-Origin'] = '*'
        response.headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
        response.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization, Accept'
        response.headers['Access-Control-Max-Age'] = '86400'  # 24 hours
        
        return response
    
    async def initialize(self) -> bool:
        """Initialize HTTP transport."""
        self.is_initialized = True
        return True
    
    async def shutdown(self) -> bool:
       """Shutdown HTTP transport."""
       self.is_initialized = False
       self.is_listening = False
       if self.site:
           await self.site.stop()
           self.site = None
       return True
    
    async def send(self, message: Event) -> bool:
        return True
    
    async def health_check(self, request):
        """Handle health check requests."""
        logger.debug("HTTP health check requested")
        
        # Create a system health check event
        health_check_event = Event(
            event_name=SYSTEM_EVENT_HEALTH_CHECK,
            source_id="http_transport",
            destination_id="system:system",
            payload={}
        )
        
        # Send the health check event and get response using the event handler
        try:
            # Process the health check event through the registered event handler
            event_response = await self.call_event_handler(health_check_event)
            
            if event_response and event_response.success and event_response.data:
                network_stats = event_response.data
                logger.debug("Successfully retrieved network stats via health check event")
            else:
                logger.warning(f"Health check event failed: {event_response.message if event_response else 'No response'}")
                raise Exception("Health check event failed")
                
        except Exception as e:
            logger.warning(f"Failed to process health check event: {e}")
            # Provide minimal stats if health check event fails
            network_stats = {
                "network_id": "unknown",
                "network_name": "Unknown Network",
                "is_running": False,
                "uptime_seconds": 0,
                "agent_count": 0,
                "agents": {},
                "mods": [],
                "topology_mode": "centralized",
                "transports": [],
                "manifest_transport": "http",
                "recommended_transport": "grpc",
                "max_connections": 100
            }
        
        return web.json_response({
            'success': True,
            'status': 'healthy',
            'data': network_stats
        })
    
    async def register_agent(self, request):
        """Handle agent registration via HTTP."""
        try:
            data = await request.json()
            agent_id = data.get('agent_id')
            metadata = data.get('metadata', {})
            
            if not agent_id:
                return web.json_response({
                    'success': False,
                    'error_message': 'agent_id is required'
                }, status=400)
            
            logger.info(f"HTTP Agent registration: {agent_id}")
            
            # Register with network instance if available
            register_event = Event(
                event_name=SYSTEM_EVENT_REGISTER_AGENT,
                source_id=agent_id,
                payload={
                    "agent_id": agent_id,
                    "metadata": metadata,
                    "transport_type": TransportType.HTTP,
                    "certificate": data.get('certificate', None),
                    "force_reconnect": True
                }
            )
            # Process the registration event through the event handler
            event_response = await self.call_event_handler(register_event)
            
            if event_response and event_response.success:
                # Extract network information from the response
                network_name = event_response.data.get('network_name', 'Unknown Network') if event_response.data else 'Unknown Network'
                network_id = event_response.data.get('network_id', 'unknown') if event_response.data else 'unknown'
                
                logger.info(f"✅ Successfully registered HTTP agent {agent_id} with network {network_name}")
                return web.json_response({
                    'success': True,
                    'network_name': network_name,
                    'network_id': network_id
                })
            else:
                error_message = event_response.message if event_response else 'No response from event handler'
                logger.error(f"❌ Network registration failed for HTTP agent {agent_id}: {error_message}")
                return web.json_response({
                    'success': False,
                    'error_message': f'Registration failed: {error_message}'
                }, status=500)
                
        except Exception as e:
            logger.error(f"Error in HTTP register_agent: {e}")
            return web.json_response({
                'success': False,
                'error_message': str(e)
            }, status=500)
    
    async def unregister_agent(self, request):
        """Handle agent unregistration via HTTP."""
        try:
            data = await request.json()
            agent_id = data.get('agent_id')
            
            if not agent_id:
                return web.json_response({
                    'success': False,
                    'error_message': 'agent_id is required'
                }, status=400)
            
            logger.info(f"HTTP Agent unregistration: {agent_id}")
            
            # Create unregister event
            unregister_event = Event(
                event_name=SYSTEM_EVENT_UNREGISTER_AGENT,
                source_id=agent_id,
                payload={
                    "agent_id": agent_id
                }
            )
            
            # Process the unregistration event through the event handler
            event_response = await self.call_event_handler(unregister_event)
            
            if event_response and event_response.success:
                logger.info(f"✅ Successfully unregistered HTTP agent {agent_id}")
                return web.json_response({'success': True})
            else:
                error_message = event_response.message if event_response else 'No response from event handler'
                logger.error(f"❌ Unregistration failed for HTTP agent {agent_id}: {error_message}")
                return web.json_response({
                    'success': False,
                    'error_message': f'Unregistration failed: {error_message}'
                }, status=500)
            
        except Exception as e:
            logger.error(f"Error in HTTP unregister_agent: {e}")
            return web.json_response({
                'success': False,
                'error_message': str(e)
            }, status=500)
    
    async def poll_messages(self, request):
        """Handle message polling for HTTP agents."""
        try:
            agent_id = request.query.get('agent_id')
            
            if not agent_id:
                return web.json_response({
                    'success': False,
                    'error_message': 'agent_id query parameter is required'
                }, status=400)
            
            logger.debug(f"HTTP polling messages for agent: {agent_id}")
            
            # Create poll messages event
            poll_event = Event(
                event_name=SYSTEM_EVENT_POLL_MESSAGES,
                source_id=agent_id,
                destination_id="system:system",
                payload={"agent_id": agent_id}
            )
            
            # Send the poll request through event handler
            response = await self.call_event_handler(poll_event)
            
            if not response or not response.success:
                logger.warning(f"Poll messages request failed: {response.message if response else 'No response'}")
                return web.json_response({
                    'success': False,
                    'messages': [],
                    'agent_id': agent_id,
                    'error_message': response.message if response else 'No response from event handler'
                })
            
            # Extract messages from response data
            messages = []
            if response.data:
                try:
                    # Handle different response data structures
                    response_messages = []
                    
                    if isinstance(response.data, list):
                        # Direct list of messages
                        response_messages = response.data
                        logger.debug(f"🔧 HTTP: Received direct list of {len(response_messages)} messages")
                    elif isinstance(response.data, dict):
                        if 'messages' in response.data:
                            # Response wrapped in a dict with 'messages' key
                            response_messages = response.data['messages']
                            logger.debug(f"🔧 HTTP: Extracted {len(response_messages)} messages from response dict")
                        else:
                            logger.warning(f"🔧 HTTP: Dict response missing 'messages' key: {list(response.data.keys())}")
                            response_messages = []
                    else:
                        logger.warning(f"🔧 HTTP: Unexpected poll_messages response format: {type(response.data)} - {response.data}")
                        response_messages = []
                    
                    logger.info(f"🔧 HTTP: Processing {len(response_messages)} polled messages for {agent_id}")
                    
                    # Convert each message to dict format for HTTP response
                    for message_data in response_messages:
                        try:
                            if isinstance(message_data, dict):
                                if 'event_name' in message_data:
                                    # This is already an Event structure - use as is
                                    messages.append(message_data)
                                    logger.debug(f"🔧 HTTP: Successfully included message: {message_data.get('event_id', 'no-id')}")
                                else:
                                    # This might be a legacy message format - try to parse it
                                    from openagents.utils.message_util import parse_message_dict
                                    event = parse_message_dict(message_data)
                                    if event:
                                        # Convert Event object to dict
                                        event_dict = {
                                            'event_id': event.event_id,
                                            'event_name': event.event_name,
                                            'source_id': event.source_id,
                                            'destination_id': event.destination_id,
                                            'payload': event.payload,
                                            'timestamp': event.timestamp,
                                            'metadata': event.metadata,
                                            'visibility': getattr(event, 'visibility', 'network')
                                        }
                                        messages.append(event_dict)
                                        logger.debug(f"🔧 HTTP: Successfully parsed legacy message to Event: {event.event_id}")
                                    else:
                                        logger.warning(f"🔧 HTTP: Failed to parse message data: {message_data}")
                            else:
                                logger.warning(f"🔧 HTTP: Invalid message format in poll response: {message_data}")
                                
                        except Exception as e:
                            logger.error(f"🔧 HTTP: Error processing polled message: {e}")
                            logger.debug(f"🔧 HTTP: Problematic message data: {message_data}")
                    
                    logger.info(f"🔧 HTTP: Successfully converted {len(messages)} messages for HTTP response")
                    
                except Exception as e:
                    logger.error(f"🔧 HTTP: Error parsing poll_messages response: {e}")
                    messages = []
            else:
                logger.debug(f"🔧 HTTP: No messages in poll response")
                messages = []
            
            return web.json_response({
                'success': True,
                'messages': messages,
                'agent_id': agent_id
            })
            
        except Exception as e:
            logger.error(f"Error in HTTP poll_messages: {e}")
            return web.json_response({
                'success': False,
                'error_message': str(e)
            }, status=500)
    
    async def send_message(self, request):
        """Handle sending events/messages via HTTP."""
        try:
            data = await request.json()
            
            # Extract event data similar to gRPC SendEvent
            event_name = data.get('event_name')
            source_id = data.get('source_id')
            target_agent_id = data.get('target_agent_id')
            payload = data.get('payload', {})
            event_id = data.get('event_id')
            metadata = data.get('metadata', {})
            visibility = data.get('visibility', 'network')
            
            if not event_name or not source_id:
                return web.json_response({
                    'success': False,
                    'error_message': 'event_name and source_id are required'
                }, status=400)
            
            logger.debug(f"HTTP unified event: {event_name} from {source_id}")
            
            # Create internal Event from HTTP request
            event = Event(
                event_name=event_name,
                source_id=source_id,
                destination_id=target_agent_id,
                payload=payload,
                event_id=event_id,
                timestamp=int(time.time()),
                metadata=metadata,
                visibility=visibility
            )
            
            # Route through unified handler (similar to gRPC)
            event_response = await self._handle_sent_event(event)
            
            # Extract response data from EventResponse
            response_data = None
            if event_response and hasattr(event_response, 'data') and event_response.data:
                response_data = event_response.data
            
            return web.json_response({
                'success': event_response.success if event_response else True,
                'message': event_response.message if event_response else '',
                'event_id': event_id,
                'data': response_data,
                'event_name': event_name
            })
            
        except Exception as e:
            logger.error(f"Error handling HTTP send_message: {e}")
            return web.json_response({
                'success': False,
                'error_message': str(e)
            }, status=500)
    
    async def _handle_sent_event(self, event):
        """Unified event handler that routes both regular messages and system commands."""
        logger.debug(f"Processing HTTP unified event: {event.event_name} from {event.source_id}")
        
        # Notify registered event handlers and return the response
        response = await self.call_event_handler(event)
        return response
    
    async def peer_connect(self, peer_id: str, metadata: Dict[str, Any] = None) -> bool:
        """Connect to a peer (HTTP doesn't maintain persistent connections)."""
        logger.debug(f"HTTP transport peer_connect called for {peer_id}")
        return True
    
    async def peer_disconnect(self, peer_id: str) -> bool:
        """Disconnect from a peer (HTTP doesn't maintain persistent connections)."""
        logger.debug(f"HTTP transport peer_disconnect called for {peer_id}")
        return True

    async def listen(self, address: str) -> bool:
        runner = web.AppRunner(self.app)
        await runner.setup()
        
        # Use a different port for HTTP (gRPC port + 1000)
        if ":" in address:
            host, port = address.split(":")
        else:
            host = "0.0.0.0"
            port = address
        site = web.TCPSite(runner, host, port)
        await site.start()
        
        logger.info(f"HTTP transport listening on {host}:{port}")
        self.is_listening = True
        self.site = site  # Store the site for shutdown
        return True


# Convenience function for creating HTTP transport
def create_http_transport(host: str = '0.0.0.0', port: int = 8080, **kwargs) -> HttpTransport:
    """Create an HTTP transport with given configuration.""" 
    config = {'host': host, 'port': port, **kwargs}
    return HttpTransport(config)