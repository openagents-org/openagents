"""
HTTP Transport Implementation for OpenAgents.

This module provides the HTTP transport implementation for agent communication.
"""

import json
import logging
import time
import html
import base64
import os
from typing import Dict, Any, Optional

from openagents.config.globals import (
    SYSTEM_EVENT_REGISTER_AGENT,
    SYSTEM_EVENT_HEALTH_CHECK,
    SYSTEM_EVENT_POLL_MESSAGES,
    SYSTEM_EVENT_UNREGISTER_AGENT,
)
from aiohttp import web

# No need for external CORS library, implement manually

from .base import Transport
from openagents.models.transport import TransportType, ConnectionState, ConnectionInfo
from openagents.models.event import Event, EventVisibility

logger = logging.getLogger(__name__)

# Maximum file size for uploads (50 MB)
MAX_FILE_SIZE = 50 * 1024 * 1024


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
        # Root path handler
        self.app.router.add_get("/", self.root_handler)
        # Add both /health and /api/health for compatibility
        self.app.router.add_get("/api/health", self.health_check)
        self.app.router.add_post("/api/register", self.register_agent)
        self.app.router.add_post("/api/unregister", self.unregister_agent)
        self.app.router.add_get("/api/poll", self.poll_messages)
        self.app.router.add_post("/api/send_event", self.send_message)
        # Cache file upload/download endpoints
        self.app.router.add_post("/api/cache/upload", self.cache_upload)
        self.app.router.add_get("/api/cache/download/{cache_id}", self.cache_download)
        self.app.router.add_get("/api/cache/info/{cache_id}", self.cache_info)

    @web.middleware
    async def cors_middleware(self, request, handler):
        """CORS middleware for browser compatibility."""
        # Handle preflight OPTIONS requests
        if request.method == "OPTIONS":
            response = web.Response()
        else:
            response = await handler(request)

        # Add CORS headers
        response.headers["Access-Control-Allow-Origin"] = "*"
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
        response.headers["Access-Control-Allow-Headers"] = (
            "Content-Type, Authorization, Accept"
        )
        response.headers["Access-Control-Max-Age"] = "86400"  # 24 hours

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
            payload={},
        )

        # Send the health check event and get response using the event handler
        try:
            # Process the health check event through the registered event handler
            event_response = await self.call_event_handler(health_check_event)

            if event_response and event_response.success and event_response.data:
                network_stats = event_response.data
                logger.debug(
                    "Successfully retrieved network stats via health check event"
                )
            else:
                logger.warning(
                    f"Health check event failed: {event_response.message if event_response else 'No response'}"
                )
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
                "max_connections": 100,
            }

        return web.json_response(
            {"success": True, "status": "healthy", "data": network_stats}
        )

    async def root_handler(self, request):
        """Handle requests to root path with a welcome page."""
        logger.debug("HTTP root path requested")

        # Try to get network stats for the welcome page
        try:
            health_check_event = Event(
                event_name=SYSTEM_EVENT_HEALTH_CHECK,
                source_id="http_transport",
                destination_id="system:system",
                payload={},
            )
            event_response = await self.call_event_handler(health_check_event)
            
            if event_response and event_response.success and event_response.data:
                network_stats = event_response.data
                network_name = network_stats.get("network_name", "OpenAgents Network")
                agent_count = network_stats.get("agent_count", 0)
                is_running = network_stats.get("is_running", False)
                uptime = network_stats.get("uptime_seconds", 0)
                network_profile = network_stats.get("network_profile", {})
                description = network_profile.get("description", "")
            else:
                network_name = "OpenAgents Network"
                agent_count = 0
                is_running = False
                uptime = 0
                description = ""
        except Exception as e:
            logger.warning(f"Failed to get network stats for root handler: {e}")
            network_name = "OpenAgents Network"
            agent_count = 0
            is_running = False
            uptime = 0
            description = ""

        # Escape HTML to prevent XSS attacks
        network_name_escaped = html.escape(network_name)
        description_escaped = html.escape(description)
        
        # Get additional network profile information safely
        network_profile = {}
        if 'network_stats' in locals() and network_stats is not None:
            try:
                network_profile = network_stats.get("network_profile", {})
            except (AttributeError, TypeError):
                network_profile = {}
        
        website = network_profile.get("website", "https://openagents.org")
        tags = network_profile.get("tags", [])
        
        # Validate and escape additional fields for security
        # Validate website URL - only allow http/https schemes to prevent javascript: or data: injection
        if not website.startswith(('http://', 'https://')):
            website = "https://openagents.org"
        website_escaped = html.escape(website)
        
        # Limit displayed tags to avoid cluttering the UI
        MAX_DISPLAYED_TAGS = 8

        # Build HTML welcome page - focused on network identity and profile
        html_content = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{network_name_escaped} - OpenAgents Agent Network</title>
    <style>
        * {{
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }}
        body {{
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }}
        .card {{
            background: white;
            border-radius: 20px;
            padding: 60px 50px;
            max-width: 600px;
            width: 100%;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            text-align: center;
        }}
        h1 {{
            font-size: 2.5em;
            color: #2d3748;
            margin-bottom: 10px;
            font-weight: 700;
        }}
        .subtitle {{
            font-size: 1.3em;
            color: #667eea;
            margin-bottom: 30px;
            font-weight: 600;
        }}
        .status-badge {{
            display: inline-flex;
            align-items: center;
            gap: 8px;
            padding: 10px 24px;
            border-radius: 50px;
            font-weight: 600;
            font-size: 1.1em;
            margin: 20px 0;
        }}
        .status-badge.online {{
            background: linear-gradient(135deg, #d4edda 0%, #c3e6cb 100%);
            color: #155724;
        }}
        .status-badge.offline {{
            background: linear-gradient(135deg, #f8d7da 0%, #f5c6cb 100%);
            color: #721c24;
        }}
        .description {{
            font-size: 1.1em;
            color: #4a5568;
            line-height: 1.8;
            margin: 30px 0;
            padding: 0 20px;
        }}
        .stats-grid {{
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 20px;
            margin: 40px 0;
        }}
        .stat-card {{
            background: linear-gradient(135deg, #f7fafc 0%, #edf2f7 100%);
            padding: 25px;
            border-radius: 15px;
            border: 2px solid #e2e8f0;
        }}
        .stat-value {{
            font-size: 2.5em;
            font-weight: 700;
            color: #667eea;
            margin-bottom: 5px;
        }}
        .stat-label {{
            font-size: 0.95em;
            color: #718096;
            font-weight: 500;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }}
        .tags {{
            margin: 30px 0;
        }}
        .tag {{
            display: inline-block;
            background: #e7f3ff;
            color: #667eea;
            padding: 8px 16px;
            border-radius: 20px;
            margin: 5px;
            font-size: 0.9em;
            font-weight: 500;
        }}
        .footer {{
            margin-top: 40px;
            padding-top: 30px;
            border-top: 2px solid #e2e8f0;
        }}
        .footer-text {{
            color: #718096;
            font-size: 0.95em;
            margin-bottom: 15px;
        }}
        .links {{
            display: flex;
            gap: 20px;
            justify-content: center;
            flex-wrap: wrap;
        }}
        .link {{
            color: #667eea;
            text-decoration: none;
            font-weight: 600;
            padding: 8px 16px;
            border-radius: 8px;
            transition: all 0.3s ease;
        }}
        .link:hover {{
            background: #f7fafc;
            transform: translateY(-2px);
        }}
        @media (max-width: 600px) {{
            .card {{
                padding: 40px 30px;
            }}
            h1 {{
                font-size: 2em;
            }}
            .stats-grid {{
                grid-template-columns: 1fr;
            }}
        }}
    </style>
</head>
<body>
    <div class="card">
        <h1>{network_name_escaped}</h1>
        <div class="subtitle">OpenAgents Agent Network</div>
        
        <div class="status-badge {'online' if is_running else 'offline'}">
            <span>{'🟢' if is_running else '🔴'}</span>
            <span>{'Online' if is_running else 'Offline'}</span>
        </div>
        
        {f'<div class="description">{description_escaped}</div>' if description_escaped else ''}
        
        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-value">{agent_count}</div>
                <div class="stat-label">Connected Agents</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">{int(uptime)}</div>
                <div class="stat-label">Uptime (seconds)</div>
            </div>
        </div>
        
        {f'''<div class="tags">
            {''.join([f'<span class="tag">{html.escape(tag)}</span>' for tag in tags[:MAX_DISPLAYED_TAGS]])}
        </div>''' if tags else ''}
        
        <div class="footer">
            <div class="footer-text">Powered by OpenAgents</div>
            <div class="links">
                <a href="{website_escaped}" target="_blank" class="link">🌐 Network Website</a>
                <a href="https://openagents.org" target="_blank" class="link">📚 Documentation</a>
                <a href="https://github.com/openagents-org/openagents" target="_blank" class="link">💻 GitHub</a>
            </div>
        </div>
    </div>
</body>
</html>"""

        return web.Response(text=html_content, content_type='text/html')

    async def register_agent(self, request):
        """Handle agent registration via HTTP."""
        try:
            data = await request.json()
            agent_id = data.get("agent_id")
            metadata = data.get("metadata", {})

            if not agent_id:
                return web.json_response(
                    {"success": False, "error_message": "agent_id is required"},
                    status=400,
                )

            logger.info(f"HTTP Agent registration: {agent_id}")

            # Register with network instance if available
            register_event = Event(
                event_name=SYSTEM_EVENT_REGISTER_AGENT,
                source_id=agent_id,
                payload={
                    "agent_id": agent_id,
                    "metadata": metadata,
                    "transport_type": TransportType.HTTP,
                    "certificate": data.get("certificate", None),
                    "force_reconnect": True,
                    "password_hash": data.get("password_hash", None),
                    "agent_group": data.get("agent_group", None),
                },
            )
            # Process the registration event through the event handler
            event_response = await self.call_event_handler(register_event)

            if event_response and event_response.success:
                # Extract network information from the response
                network_name = (
                    event_response.data.get("network_name", "Unknown Network")
                    if event_response.data
                    else "Unknown Network"
                )
                network_id = (
                    event_response.data.get("network_id", "unknown")
                    if event_response.data
                    else "unknown"
                )

                logger.info(
                    f"✅ Successfully registered HTTP agent {agent_id} with network {network_name}"
                )
                
                # Extract secret and assigned_group from response data
                secret = ""
                assigned_group = None
                if event_response.data and isinstance(event_response.data, dict):
                    secret = event_response.data.get("secret", "")
                    assigned_group = event_response.data.get("assigned_group")
                
                return web.json_response(
                    {
                        "success": True,
                        "network_name": network_name,
                        "network_id": network_id,
                        "secret": secret,
                        "assigned_group": assigned_group,
                    }
                )
            else:
                error_message = (
                    event_response.message
                    if event_response
                    else "No response from event handler"
                )
                logger.error(
                    f"❌ Network registration failed for HTTP agent {agent_id}: {error_message}"
                )
                return web.json_response(
                    {
                        "success": False,
                        "error_message": f"Registration failed: {error_message}",
                    },
                    status=500,
                )

        except Exception as e:
            logger.error(f"Error in HTTP register_agent: {e}")
            return web.json_response(
                {"success": False, "error_message": str(e)}, status=500
            )

    async def unregister_agent(self, request):
        """Handle agent unregistration via HTTP."""
        try:
            data = await request.json()
            agent_id = data.get("agent_id")
            secret = data.get("secret")

            if not agent_id:
                return web.json_response(
                    {"success": False, "error_message": "agent_id is required"},
                    status=400,
                )

            logger.info(f"HTTP Agent unregistration: {agent_id}")

            # Create unregister event with authentication
            unregister_event = Event(
                event_name=SYSTEM_EVENT_UNREGISTER_AGENT,
                source_id=agent_id,
                payload={"agent_id": agent_id},
                secret=secret,
            )

            # Process the unregistration event through the event handler
            event_response = await self.call_event_handler(unregister_event)

            if event_response and event_response.success:
                logger.info(f"✅ Successfully unregistered HTTP agent {agent_id}")
                return web.json_response({"success": True})
            else:
                error_message = (
                    event_response.message
                    if event_response
                    else "No response from event handler"
                )
                logger.error(
                    f"❌ Unregistration failed for HTTP agent {agent_id}: {error_message}"
                )
                return web.json_response(
                    {
                        "success": False,
                        "error_message": f"Unregistration failed: {error_message}",
                    },
                    status=500,
                )

        except Exception as e:
            logger.error(f"Error in HTTP unregister_agent: {e}")
            return web.json_response(
                {"success": False, "error_message": str(e)}, status=500
            )

    async def poll_messages(self, request):
        """Handle message polling for HTTP agents."""
        try:
            agent_id = request.query.get("agent_id")
            secret = request.query.get("secret")

            if not agent_id:
                return web.json_response(
                    {
                        "success": False,
                        "error_message": "agent_id query parameter is required",
                    },
                    status=400,
                )

            logger.debug(f"HTTP polling messages for agent: {agent_id}")

            # Create poll messages event with authentication
            poll_event = Event(
                event_name=SYSTEM_EVENT_POLL_MESSAGES,
                source_id=agent_id,
                destination_id="system:system",
                payload={"agent_id": agent_id},
                secret=secret,
            )

            # Send the poll request through event handler
            response = await self.call_event_handler(poll_event)

            if not response or not response.success:
                logger.warning(
                    f"Poll messages request failed: {response.message if response else 'No response'}"
                )
                return web.json_response(
                    {
                        "success": False,
                        "messages": [],
                        "agent_id": agent_id,
                        "error_message": (
                            response.message
                            if response
                            else "No response from event handler"
                        ),
                    }
                )

            # Extract messages from response data
            messages = []
            if response.data:
                try:
                    # Handle different response data structures
                    response_messages = []

                    if isinstance(response.data, list):
                        # Direct list of messages
                        response_messages = response.data
                        logger.debug(
                            f"🔧 HTTP: Received direct list of {len(response_messages)} messages"
                        )
                    elif isinstance(response.data, dict):
                        if "messages" in response.data:
                            # Response wrapped in a dict with 'messages' key
                            response_messages = response.data["messages"]
                            logger.debug(
                                f"🔧 HTTP: Extracted {len(response_messages)} messages from response dict"
                            )
                        else:
                            logger.warning(
                                f"🔧 HTTP: Dict response missing 'messages' key: {list(response.data.keys())}"
                            )
                            response_messages = []
                    else:
                        logger.warning(
                            f"🔧 HTTP: Unexpected poll_messages response format: {type(response.data)} - {response.data}"
                        )
                        response_messages = []

                    logger.info(
                        f"🔧 HTTP: Processing {len(response_messages)} polled messages for {agent_id}"
                    )

                    # Convert each message to dict format for HTTP response
                    for message_data in response_messages:
                        try:
                            if isinstance(message_data, dict):
                                if "event_name" in message_data:
                                    # This is already an Event structure - use as is
                                    messages.append(message_data)
                                    logger.debug(
                                        f"🔧 HTTP: Successfully included message: {message_data.get('event_id', 'no-id')}"
                                    )
                                else:
                                    # This might be a legacy message format - try to parse it
                                    from openagents.utils.message_util import (
                                        parse_message_dict,
                                    )

                                    event = parse_message_dict(message_data)
                                    if event:
                                        # Convert Event object to dict
                                        event_dict = {
                                            "event_id": event.event_id,
                                            "event_name": event.event_name,
                                            "source_id": event.source_id,
                                            "destination_id": event.destination_id,
                                            "payload": event.payload,
                                            "timestamp": event.timestamp,
                                            "metadata": event.metadata,
                                            "visibility": getattr(
                                                event, "visibility", "network"
                                            ),
                                        }
                                        messages.append(event_dict)
                                        logger.debug(
                                            f"🔧 HTTP: Successfully parsed legacy message to Event: {event.event_id}"
                                        )
                                    else:
                                        logger.warning(
                                            f"🔧 HTTP: Failed to parse message data: {message_data}"
                                        )
                            else:
                                logger.warning(
                                    f"🔧 HTTP: Invalid message format in poll response: {message_data}"
                                )

                        except Exception as e:
                            logger.error(
                                f"🔧 HTTP: Error processing polled message: {e}"
                            )
                            logger.debug(
                                f"🔧 HTTP: Problematic message data: {message_data}"
                            )

                    logger.info(
                        f"🔧 HTTP: Successfully converted {len(messages)} messages for HTTP response"
                    )

                except Exception as e:
                    logger.error(f"🔧 HTTP: Error parsing poll_messages response: {e}")
                    messages = []
            else:
                logger.debug(f"🔧 HTTP: No messages in poll response")
                messages = []

            return web.json_response(
                {"success": True, "messages": messages, "agent_id": agent_id}
            )

        except Exception as e:
            logger.error(f"Error in HTTP poll_messages: {e}")
            return web.json_response(
                {"success": False, "error_message": str(e)}, status=500
            )

    async def send_message(self, request):
        """Handle sending events/messages via HTTP."""
        try:
            data = await request.json()

            # Extract event data similar to gRPC SendEvent
            event_name = data.get("event_name")
            source_id = data.get("source_id")
            target_agent_id = data.get("target_agent_id")
            payload = data.get("payload", {})
            event_id = data.get("event_id")
            metadata = data.get("metadata", {})
            visibility = data.get("visibility", "network")
            secret = data.get("secret")

            if not event_name or not source_id:
                return web.json_response(
                    {
                        "success": False,
                        "error_message": "event_name and source_id are required",
                    },
                    status=400,
                )

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
                visibility=visibility,
                secret=secret,
            )

            # Route through unified handler (similar to gRPC)
            event_response = await self._handle_sent_event(event)

            # Extract response data from EventResponse
            response_data = None
            if (
                event_response
                and hasattr(event_response, "data")
                and event_response.data
            ):
                response_data = event_response.data

            return web.json_response(
                {
                    "success": event_response.success if event_response else True,
                    "message": event_response.message if event_response else "",
                    "event_id": event_id,
                    "data": response_data,
                    "event_name": event_name,
                }
            )

        except Exception as e:
            logger.error(f"Error handling HTTP send_message: {e}")
            return web.json_response(
                {"success": False, "error_message": str(e)}, status=500
            )

    async def _handle_sent_event(self, event):
        """Unified event handler that routes both regular messages and system commands."""
        logger.debug(
            f"Processing HTTP unified event: {event.event_name} from {event.source_id}"
        )

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

    async def cache_upload(self, request):
        """Handle file upload to shared cache via HTTP multipart form."""
        try:
            # Check content type
            content_type = request.content_type
            if not content_type or 'multipart/form-data' not in content_type:
                return web.json_response(
                    {"success": False, "error": "Content-Type must be multipart/form-data"},
                    status=400,
                )

            # Parse multipart form data
            reader = await request.multipart()

            file_data = None
            filename = None
            mime_type = "application/octet-stream"
            agent_id = None
            secret = None
            allowed_agent_groups = []

            async for part in reader:
                if part.name == "file":
                    filename = part.filename or "unnamed_file"
                    mime_type = part.headers.get("Content-Type", "application/octet-stream")
                    # Read file content
                    file_content = await part.read(decode=False)
                    if len(file_content) > MAX_FILE_SIZE:
                        return web.json_response(
                            {"success": False, "error": f"File size exceeds maximum allowed ({MAX_FILE_SIZE} bytes)"},
                            status=413,
                        )
                    file_data = base64.b64encode(file_content).decode("utf-8")
                elif part.name == "agent_id":
                    agent_id = (await part.read(decode=True)).decode("utf-8")
                elif part.name == "secret":
                    secret = (await part.read(decode=True)).decode("utf-8")
                elif part.name == "allowed_agent_groups":
                    groups_str = (await part.read(decode=True)).decode("utf-8")
                    if groups_str:
                        allowed_agent_groups = [g.strip() for g in groups_str.split(",") if g.strip()]
                elif part.name == "mime_type":
                    mime_type = (await part.read(decode=True)).decode("utf-8")

            if not file_data:
                return web.json_response(
                    {"success": False, "error": "No file provided"},
                    status=400,
                )

            if not agent_id:
                return web.json_response(
                    {"success": False, "error": "agent_id is required"},
                    status=400,
                )

            logger.info(f"HTTP cache upload: {filename} from {agent_id}")

            # Create file upload event for the shared cache mod
            upload_event = Event(
                event_name="shared_cache.file.upload",
                source_id=agent_id,
                relevant_mod="openagents.mods.core.shared_cache",
                visibility=EventVisibility.MOD_ONLY,
                payload={
                    "file_data": file_data,
                    "filename": filename,
                    "mime_type": mime_type,
                    "allowed_agent_groups": allowed_agent_groups,
                },
                secret=secret,
            )

            # Process the upload event through the event handler
            event_response = await self.call_event_handler(upload_event)

            if event_response and event_response.success:
                logger.info(f"✅ Successfully uploaded file {filename} to cache")
                return web.json_response({
                    "success": True,
                    "cache_id": event_response.data.get("cache_id") if event_response.data else None,
                    "filename": event_response.data.get("filename") if event_response.data else filename,
                    "file_size": event_response.data.get("file_size") if event_response.data else None,
                    "mime_type": event_response.data.get("mime_type") if event_response.data else mime_type,
                })
            else:
                error_message = event_response.message if event_response else "No response from event handler"
                logger.error(f"❌ Cache upload failed: {error_message}")
                return web.json_response(
                    {"success": False, "error": error_message},
                    status=500,
                )

        except Exception as e:
            logger.error(f"Error in HTTP cache_upload: {e}")
            return web.json_response(
                {"success": False, "error": str(e)},
                status=500,
            )

    async def cache_download(self, request):
        """Handle file download from shared cache via HTTP."""
        try:
            cache_id = request.match_info.get("cache_id")
            agent_id = request.query.get("agent_id")
            secret = request.query.get("secret")

            if not cache_id:
                return web.json_response(
                    {"success": False, "error": "cache_id is required"},
                    status=400,
                )

            logger.info(f"HTTP cache download: {cache_id} by {agent_id}")

            # Create file download event for the shared cache mod
            download_event = Event(
                event_name="shared_cache.file.download",
                source_id=agent_id or "anonymous",
                relevant_mod="openagents.mods.core.shared_cache",
                visibility=EventVisibility.MOD_ONLY,
                payload={"cache_id": cache_id},
                secret=secret,
            )

            # Process the download event through the event handler
            event_response = await self.call_event_handler(download_event)

            if event_response and event_response.success and event_response.data:
                data = event_response.data
                file_data_b64 = data.get("file_data")
                filename = data.get("filename", "download")
                mime_type = data.get("mime_type", "application/octet-stream")

                if file_data_b64:
                    file_bytes = base64.b64decode(file_data_b64)

                    # Return file as binary response
                    response = web.Response(
                        body=file_bytes,
                        content_type=mime_type,
                    )
                    # Set content-disposition to suggest filename
                    safe_filename = os.path.basename(filename)
                    response.headers["Content-Disposition"] = f'attachment; filename="{safe_filename}"'
                    response.headers["Content-Length"] = str(len(file_bytes))

                    logger.info(f"✅ Successfully downloaded file {cache_id}")
                    return response
                else:
                    return web.json_response(
                        {"success": False, "error": "File data not found in response"},
                        status=500,
                    )
            else:
                error_message = event_response.message if event_response else "No response from event handler"
                logger.error(f"❌ Cache download failed: {error_message}")
                return web.json_response(
                    {"success": False, "error": error_message},
                    status=404 if "not found" in error_message.lower() else 403,
                )

        except Exception as e:
            logger.error(f"Error in HTTP cache_download: {e}")
            return web.json_response(
                {"success": False, "error": str(e)},
                status=500,
            )

    async def cache_info(self, request):
        """Get cache entry metadata without downloading the file."""
        try:
            cache_id = request.match_info.get("cache_id")
            agent_id = request.query.get("agent_id")
            secret = request.query.get("secret")

            if not cache_id:
                return web.json_response(
                    {"success": False, "error": "cache_id is required"},
                    status=400,
                )

            logger.debug(f"HTTP cache info: {cache_id} by {agent_id}")

            # Create cache get event to retrieve metadata
            get_event = Event(
                event_name="shared_cache.get",
                source_id=agent_id or "anonymous",
                relevant_mod="openagents.mods.core.shared_cache",
                visibility=EventVisibility.MOD_ONLY,
                payload={"cache_id": cache_id},
                secret=secret,
            )

            # Process the get event through the event handler
            event_response = await self.call_event_handler(get_event)

            if event_response and event_response.success and event_response.data:
                data = event_response.data
                # Return metadata without the actual value/file_data
                return web.json_response({
                    "success": True,
                    "cache_id": data.get("cache_id"),
                    "is_file": data.get("is_file", False),
                    "filename": data.get("filename"),
                    "file_size": data.get("file_size"),
                    "mime_type": data.get("mime_type"),
                    "created_by": data.get("created_by"),
                    "created_at": data.get("created_at"),
                    "updated_at": data.get("updated_at"),
                    "allowed_agent_groups": data.get("allowed_agent_groups", []),
                })
            else:
                error_message = event_response.message if event_response else "No response from event handler"
                return web.json_response(
                    {"success": False, "error": error_message},
                    status=404 if "not found" in error_message.lower() else 403,
                )

        except Exception as e:
            logger.error(f"Error in HTTP cache_info: {e}")
            return web.json_response(
                {"success": False, "error": str(e)},
                status=500,
            )


# Convenience function for creating HTTP transport
def create_http_transport(
    host: str = "0.0.0.0", port: int = 8080, **kwargs
) -> HttpTransport:
    """Create an HTTP transport with given configuration."""
    config = {"host": host, "port": port, **kwargs}
    return HttpTransport(config)
