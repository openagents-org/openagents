"""
HTTP Transport Implementation for OpenAgents.

This module provides the HTTP transport implementation for agent communication.
Optionally serves MCP protocol at /mcp and Studio frontend at /studio.
Optionally connects to relay server for public access without port forwarding.
"""

import asyncio
import json
import logging
import mimetypes
import time
import html
import base64
import os
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, Any, Optional, List, Callable, TYPE_CHECKING
from urllib.parse import urlencode

import aiohttp
from aiohttp import web

from openagents.config.globals import (
    SYSTEM_EVENT_REGISTER_AGENT,
    SYSTEM_EVENT_HEALTH_CHECK,
    SYSTEM_EVENT_POLL_MESSAGES,
    SYSTEM_EVENT_UNREGISTER_AGENT,
)
from openagents.models.network_management import ImportMode
from openagents.utils.network_export import NetworkExporter
from openagents.utils.network_import import NetworkImporter
from io import BytesIO
from aiohttp import web

# No need for external CORS library, implement manually

from .base import Transport
from openagents.models.transport import TransportType, ConnectionState, ConnectionInfo
from openagents.models.event import Event, EventVisibility

if TYPE_CHECKING:
    from openagents.core.network import AgentNetwork

logger = logging.getLogger(__name__)

# Default relay server URL
DEFAULT_RELAY_URL = "wss://relay.openagents.org"

# MCP Protocol version (when serve_mcp is enabled)
MCP_PROTOCOL_VERSION = "2025-03-26"


@dataclass
class MCPSession:
    """Represents an MCP client session (used when serve_mcp is enabled)."""

    session_id: str
    is_active: bool = True
    initialized: bool = False
    sse_response: Optional[web.StreamResponse] = None
    pending_notifications: List[Dict[str, Any]] = field(default_factory=list)

# Maximum file size for uploads (50 MB)
MAX_FILE_SIZE = 50 * 1024 * 1024


class HttpTransport(Transport):
    """
    HTTP transport implementation.

    This transport implementation uses HTTP to communicate with the network.
    It is used to communicate with the network from the browser and easily obtain claim information.

    Optional features (configured via transport config):
    - serve_mcp: true - Serve MCP protocol at /mcp endpoint
    - serve_studio: true - Serve Studio frontend at /studio endpoint
    """

    def __init__(
        self,
        config: Optional[Dict[str, Any]] = None,
        workspace_path: Optional[str] = None,
    ):
        super().__init__(TransportType.HTTP, config, is_notifiable=False)
        self.app = web.Application(middlewares=[self.cors_middleware])
        self.site = None
        self.runner = None  # AppRunner instance for proper cleanup
        self.network_instance: Optional["AgentNetwork"] = None  # Reference to network instance

        # MCP serving configuration (enabled via serve_mcp: true)
        self._serve_mcp = self.config.get("serve_mcp", False)
        self._mcp_sessions: Dict[str, MCPSession] = {}
        self._mcp_tool_collector = None  # Initialized when network context is available
        self.network_context = None  # Set by topology when serve_mcp is enabled

        # Studio serving configuration (enabled via serve_studio: true)
        self._serve_studio = self.config.get("serve_studio", False)
        self._studio_build_dir: Optional[str] = None

        self.workspace_path = workspace_path  # Workspace path for LLM logs API

        # Relay configuration (enabled via relay: {url: "wss://..."} or relay: true)
        relay_config = self.config.get("relay", None)
        if relay_config is True:
            self._relay_url = DEFAULT_RELAY_URL
        elif isinstance(relay_config, dict):
            self._relay_url = relay_config.get("url", DEFAULT_RELAY_URL)
        elif isinstance(relay_config, str):
            self._relay_url = relay_config
        else:
            self._relay_url = None

        self._relay_ws: Optional[aiohttp.ClientWebSocketResponse] = None
        self._relay_session: Optional[aiohttp.ClientSession] = None
        self._relay_tunnel_id: Optional[str] = None
        self._relay_public_url: Optional[str] = None
        self._relay_running = False
        self._relay_task: Optional[asyncio.Task] = None
        self._relay_heartbeat_task: Optional[asyncio.Task] = None

        # Listen address (set in listen())
        self._listen_host: str = "0.0.0.0"
        self._listen_port: int = 8080

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

        # Network management endpoints (admin only)
        self.app.router.add_get("/api/network/export", self.export_network)
        self.app.router.add_post("/api/network/import/validate", self.validate_import)
        self.app.router.add_post("/api/network/import/apply", self.apply_import)

        # Network initialization endpoints (only work when network is not initialized)
        self.app.router.add_post("/api/network/initialize/admin-password", self.initialize_admin_password)
        self.app.router.add_post("/api/network/initialize/template", self.initialize_network_with_template)
        self.app.router.add_post("/api/network/initialize/model-config", self.initialize_model_config)
        self.app.router.add_get("/api/templates", self.list_templates)

        # Admin default model configuration endpoints
        self.app.router.add_get("/api/admin/default-model", self.get_default_model)
        self.app.router.add_post("/api/admin/default-model", self.save_default_model)
        self.app.router.add_delete("/api/admin/default-model", self.delete_default_model)
        self.app.router.add_post("/api/admin/default-model/test", self.test_default_model)
        # LLM Logs API endpoints
        self.app.router.add_get("/api/agents/service/{agent_id}/llm-logs", self.get_llm_logs)
        self.app.router.add_get("/api/agents/service/{agent_id}/llm-logs/{log_id}", self.get_llm_log_entry)

        # Cache file upload/download endpoints
        self.app.router.add_post("/api/cache/upload", self.cache_upload)
        self.app.router.add_get("/api/cache/download/{cache_id}", self.cache_download)
        self.app.router.add_get("/api/cache/info/{cache_id}", self.cache_info)
        # Agent management endpoints
        self.app.router.add_get("/api/agents/service", self.get_service_agents)
        self.app.router.add_post("/api/agents/service/{agent_id}/start", self.start_service_agent)
        self.app.router.add_post("/api/agents/service/{agent_id}/stop", self.stop_service_agent)
        self.app.router.add_post("/api/agents/service/{agent_id}/restart", self.restart_service_agent)
        self.app.router.add_get("/api/agents/service/{agent_id}/status", self.get_service_agent_status)
        self.app.router.add_get("/api/agents/service/{agent_id}/logs/screen", self.get_service_agent_logs)
        self.app.router.add_get("/api/agents/service/{agent_id}/source", self.get_service_agent_source)
        self.app.router.add_put("/api/agents/service/{agent_id}/source", self.save_service_agent_source)
        self.app.router.add_get("/api/agents/service/{agent_id}/env", self.get_service_agent_env)
        self.app.router.add_put("/api/agents/service/{agent_id}/env", self.save_service_agent_env)
        # Global environment variables for all service agents
        self.app.router.add_get("/api/agents/service/env/global", self.get_global_env)
        self.app.router.add_put("/api/agents/service/env/global", self.save_global_env)

        # Assets upload endpoint
        self.app.router.add_post("/api/assets/upload", self.upload_asset)
        self.app.router.add_get("/assets/{filename:.*}", self.serve_asset)

        # Event Explorer API endpoints
        self.app.router.add_get("/api/events/sync", self.sync_events)
        self.app.router.add_get("/api/events", self.list_events)
        self.app.router.add_get("/api/events/mods", self.list_mods)
        self.app.router.add_get("/api/events/search", self.search_events)
        self.app.router.add_get("/api/events/{event_name}", self.get_event_detail)

        # Relay control endpoints
        self.app.router.add_post("/api/relay/connect", self.relay_connect_handler)
        self.app.router.add_post("/api/relay/disconnect", self.relay_disconnect_handler)
        self.app.router.add_get("/api/relay/status", self.relay_status_handler)

        # MCP routes (if serve_mcp: true)
        if self._serve_mcp:
            self.app.router.add_post("/mcp", self._handle_mcp_post)
            self.app.router.add_get("/mcp", self._handle_mcp_get)
            self.app.router.add_delete("/mcp", self._handle_mcp_delete)
            self.app.router.add_get("/mcp/tools", self._handle_mcp_tools_list)
            logger.info("HTTP transport: MCP protocol enabled at /mcp")

        # Studio routes (if serve_studio: true)
        if self._serve_studio:
            # Studio static files - catch-all for /studio paths
            self.app.router.add_get("/studio", self._handle_studio_redirect)
            self.app.router.add_get("/studio/{path:.*}", self._handle_studio_static)
            # Also serve /static/* and root-level assets for React app compatibility
            # (React builds reference /static/js/... not /studio/static/js/...)
            self.app.router.add_get("/static/{path:.*}", self._handle_studio_root_static)
            self.app.router.add_get("/favicon.ico", self._handle_studio_root_asset)
            self.app.router.add_get("/manifest.json", self._handle_studio_root_asset)
            self.app.router.add_get("/logo192.png", self._handle_studio_root_asset)
            self.app.router.add_get("/logo512.png", self._handle_studio_root_asset)
            self.app.router.add_get("/robots.txt", self._handle_studio_root_asset)
            logger.info("HTTP transport: Studio frontend enabled at /studio")

    @web.middleware
    async def cors_middleware(self, request, handler):
        """CORS middleware for browser compatibility."""
        # Handle preflight OPTIONS requests
        if request.method == "OPTIONS":
            response = web.Response()
        else:
            response = await handler(request)

        # Add MCP-specific headers if serve_mcp is enabled
        if self._serve_mcp:
            response.headers["Access-Control-Expose-Headers"] = "Mcp-Session-Id"

        # Add CORS headers
        response.headers["Access-Control-Allow-Origin"] = "*"
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, DELETE, OPTIONS"
        response.headers["Access-Control-Allow-Headers"] = (
            "Content-Type, Authorization, Accept, Mcp-Session-Id"
        )
        response.headers["Access-Control-Max-Age"] = "86400"  # 24 hours

        return response

    async def initialize(self) -> bool:
        """Initialize HTTP transport."""
        # Initialize Studio build directory if serve_studio is enabled
        if self._serve_studio:
            self._studio_build_dir = self._find_studio_build_dir()
            if self._studio_build_dir:
                logger.info(f"HTTP transport: Studio build directory found at {self._studio_build_dir}")
            else:
                logger.warning("HTTP transport: Studio build directory not found, /studio will return 404")

        self.is_initialized = True
        return True

    def initialize_mcp(self) -> bool:
        """Initialize MCP tool collector. Called after network_context is set."""
        if not self._serve_mcp:
            return True

        if not self.network_context:
            logger.warning("HTTP transport: Cannot initialize MCP without network context")
            return False

        try:
            from openagents.utils.network_tool_collector import NetworkToolCollector

            # Get workspace path from network context
            workspace_path = self.network_context.workspace_path

            self._mcp_tool_collector = NetworkToolCollector(
                network=None,  # Not needed when context is provided
                workspace_path=workspace_path,
                context=self.network_context,
            )
            self._mcp_tool_collector.collect_all_tools()
            logger.info(
                f"HTTP transport MCP: Collected {self._mcp_tool_collector.tool_count} tools: "
                f"{self._mcp_tool_collector.tool_names}"
            )
            return True
        except Exception as e:
            logger.error(f"HTTP transport: Failed to initialize MCP tool collector: {e}")
            return False

    async def shutdown(self) -> bool:
        """Shutdown HTTP transport."""
        self.is_initialized = False
        self.is_listening = False

        # Stop relay connection if active
        if self._relay_url:
            await self._stop_relay()

        # Clean up MCP sessions if serve_mcp is enabled
        if self._serve_mcp:
            for session_id, session in list(self._mcp_sessions.items()):
                session.is_active = False
            self._mcp_sessions.clear()

        if self.site:
            await self.site.stop()
            self.site = None

        if self.runner:
            await self.runner.cleanup()
            self.runner = None

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
                "network_uuid": "unknown",
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

        # Add relay info if connected
        if self._relay_public_url:
            network_stats["relay_url"] = self._relay_public_url
            network_stats["relay_connected"] = self.relay_connected

        return web.json_response(
            {"success": True, "status": "healthy", "data": network_stats}
        )

    async def root_handler(self, request):
        """Handle requests to root path with a welcome page."""
        logger.debug("HTTP root path requested")

        # If studio is enabled and network is not initialized, redirect to onboarding
        if self._serve_studio and self.network_instance:
            try:
                if not self.network_instance.config.initialized:
                    raise web.HTTPFound('/studio/onboarding')
            except AttributeError:
                pass  # Config might not have initialized attribute

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

        website = network_profile.get("website") or "https://openagents.org"
        tags = network_profile.get("tags") or []

        # Validate and escape additional fields for security
        # Validate website URL - only allow http/https schemes to prevent javascript: or data: injection
        if not website or not website.startswith(('http://', 'https://')):
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
        .studio-button {{
            display: inline-block;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 16px 40px;
            border-radius: 12px;
            font-size: 1.2em;
            font-weight: 600;
            text-decoration: none;
            margin: 30px 0;
            transition: all 0.3s ease;
            box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);
        }}
        .studio-button:hover {{
            transform: translateY(-3px);
            box-shadow: 0 6px 20px rgba(102, 126, 234, 0.5);
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

        {f'<a href="/studio/" class="studio-button">🎨 Open Studio</a>' if self._serve_studio else ''}

        {f'''<div class="tags">
            {''.join([f'<span class="tag">{html.escape(tag)}</span>' for tag in tags[:MAX_DISPLAYED_TAGS]])}
        </div>''' if tags else ''}

        <div class="footer">
            <div class="footer-text">Powered by OpenAgents</div>
            <div class="links">
                <a href="{website_escaped}" target="_blank" class="link">🌐 Website</a>
                <a href="https://openagents.org/docs/" target="_blank" class="link">📚 Documentation</a>
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

    async def get_llm_logs(self, request):
        """Handle GET request for LLM logs for a service agent.

        GET /api/agents/service/{agent_id}/llm-logs

        Query Parameters:
            limit: Number of entries to return (default: 50, max: 200)
            offset: Pagination offset
            model: Filter by model name
            since: Only entries after this timestamp
            has_error: Filter by error status (true/false)
            search: Search in messages/completion
        """
        try:
            agent_id = request.match_info.get("agent_id")
            if not agent_id:
                return web.json_response(
                    {"success": False, "error": "agent_id is required"},
                    status=400,
                )

            # Check if workspace_path is available
            if not self.workspace_path:
                return web.json_response(
                    {"success": False, "error": "Workspace not configured"},
                    status=500,
                )

            # Parse query parameters
            limit = int(request.query.get("limit", 50))
            offset = int(request.query.get("offset", 0))
            model = request.query.get("model")
            since_str = request.query.get("since")
            since = float(since_str) if since_str else None
            has_error_str = request.query.get("has_error")
            has_error = None
            if has_error_str is not None:
                has_error = has_error_str.lower() == "true"
            search = request.query.get("search")

            # Create LLM log reader and get logs
            from openagents.lms.llm_log_reader import LLMLogReader
            reader = LLMLogReader(self.workspace_path)

            logs, total_count = reader.get_logs(
                agent_id=agent_id,
                limit=limit,
                offset=offset,
                model=model,
                since=since,
                has_error=has_error,
                search=search,
            )

            return web.json_response({
                "agent_id": agent_id,
                "logs": logs,
                "total_count": total_count,
                "has_more": offset + len(logs) < total_count,
            })

        except ValueError as e:
            return web.json_response(
                {"success": False, "error": f"Invalid parameter: {str(e)}"},
                status=400,
            )
        except Exception as e:
            logger.error(f"Error getting LLM logs: {e}")
            return web.json_response(
                {"success": False, "error": str(e)},
                status=500,
            )

    async def get_llm_log_entry(self, request):
        """Handle GET request for a specific LLM log entry.

        GET /api/agents/service/{agent_id}/llm-logs/{log_id}
        """
        try:
            agent_id = request.match_info.get("agent_id")
            log_id = request.match_info.get("log_id")

            if not agent_id or not log_id:
                return web.json_response(
                    {"success": False, "error": "agent_id and log_id are required"},
                    status=400,
                )

            # Check if workspace_path is available
            if not self.workspace_path:
                return web.json_response(
                    {"success": False, "error": "Workspace not configured"},
                    status=500,
                )

            # Create LLM log reader and get the entry
            from openagents.lms.llm_log_reader import LLMLogReader
            reader = LLMLogReader(self.workspace_path)

            entry = reader.get_log_entry(agent_id, log_id)

            if entry is None:
                return web.json_response(
                    {"success": False, "error": "Log entry not found"},
                    status=404,
                )

            return web.json_response(entry)

        except Exception as e:
            logger.error(f"Error getting LLM log entry: {e}")
            return web.json_response(
                {"success": False, "error": str(e)},
                status=500,
            )

    async def listen(self, address: str) -> bool:
        self.runner = web.AppRunner(self.app)
        await self.runner.setup()

        # Use a different port for HTTP (gRPC port + 1000)
        if ":" in address:
            host, port = address.split(":")
        else:
            host = "0.0.0.0"
            port = address
        self.site = web.TCPSite(self.runner, host, port)
        await self.site.start()

        logger.info(f"HTTP transport listening on {host}:{port}")
        self.is_listening = True
        self._listen_host = host
        self._listen_port = int(port)  # Store port for relay request handling

        # Start relay connection if configured
        if self._relay_url:
            self._relay_task = asyncio.create_task(self._start_relay())

        return True

    # ============================================================
    # Relay Client Methods
    # ============================================================

    @property
    def relay_url(self) -> Optional[str]:
        """Get the public relay URL if connected."""
        return self._relay_public_url

    @property
    def relay_connected(self) -> bool:
        """Check if connected to relay and registration completed."""
        return (
            self._relay_ws is not None
            and not self._relay_ws.closed
            and self._relay_public_url is not None
        )

    async def _start_relay(self):
        """Start the relay connection."""
        self._relay_running = True

        # Get network info for registration
        network_id = "unknown"
        network_name = "Unknown Network"
        if self.network_instance:
            network_id = getattr(self.network_instance, 'network_id', 'unknown')
            network_name = getattr(self.network_instance, 'network_name', 'Unknown Network')

        try:
            await self._connect_to_relay(network_id, network_name)
        except Exception as e:
            logger.error(f"Failed to connect to relay: {e}")
            # Attempt reconnection
            await self._relay_reconnect(network_id, network_name)

    async def _connect_to_relay(self, network_id: str, network_name: str):
        """Connect to the relay server."""
        if self._relay_session is None:
            self._relay_session = aiohttp.ClientSession()

        ws_url = self._relay_url
        if not ws_url.startswith("ws"):
            ws_url = ws_url.replace("https://", "wss://").replace("http://", "ws://")

        # Ensure we connect to the /register WebSocket endpoint
        if not ws_url.endswith("/register"):
            ws_url = ws_url.rstrip("/") + "/register"

        logger.info(f"Connecting to relay: {ws_url}")

        try:
            self._relay_ws = await self._relay_session.ws_connect(ws_url)
        except Exception as e:
            logger.error(f"Failed to connect to relay WebSocket: {e}")
            raise

        # Send registration message
        # Use network_uuid for relay registration to ensure uniqueness per session
        relay_network_id = network_id
        if self.network_instance:
            network_uuid = getattr(self.network_instance, 'network_uuid', None)
            if network_uuid:
                relay_network_id = network_uuid

        register_msg = {
            "type": "register",
            "network_id": relay_network_id,
            "info": {
                "name": network_name,
            }
        }
        logger.info(f"Registering with relay: network_id={relay_network_id}, name={network_name}")
        await self._relay_ws.send_json(register_msg)

        # Wait for registration response
        try:
            msg = await asyncio.wait_for(self._relay_ws.receive(), timeout=10.0)
        except asyncio.TimeoutError:
            raise ConnectionError("Timeout waiting for relay registration response")

        logger.debug(f"Received relay message type: {msg.type}")

        if msg.type == aiohttp.WSMsgType.TEXT:
            data = json.loads(msg.data)
            logger.debug(f"Relay registration response: {data}")
            if data.get("type") == "registered":
                self._relay_tunnel_id = data.get("tunnel_id")
                self._relay_public_url = data.get("relay_url")
                logger.info(f"Connected to relay: {self._relay_public_url}, tunnel_id: {self._relay_tunnel_id}")

                # Start message loop and heartbeat
                asyncio.create_task(self._relay_message_loop())
                self._relay_heartbeat_task = asyncio.create_task(self._relay_heartbeat_loop())
                return
            elif data.get("type") == "error":
                raise ConnectionError(f"Relay registration failed: {data.get('message')}")

        raise ConnectionError("Unexpected response from relay")

    async def _relay_message_loop(self):
        """Process incoming relay messages."""
        while self._relay_running and self._relay_ws and not self._relay_ws.closed:
            try:
                msg = await self._relay_ws.receive()

                if msg.type == aiohttp.WSMsgType.TEXT:
                    data = json.loads(msg.data)
                    await self._handle_relay_message(data)
                elif msg.type == aiohttp.WSMsgType.CLOSED:
                    logger.warning("Relay WebSocket closed by server")
                    break
                elif msg.type == aiohttp.WSMsgType.ERROR:
                    logger.error(f"Relay WebSocket error: {self._relay_ws.exception()}")
                    break

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in relay message loop: {e}")
                break

        # Connection lost - attempt reconnect
        if self._relay_running:
            network_id = getattr(self.network_instance, 'network_id', 'unknown') if self.network_instance else 'unknown'
            network_name = getattr(self.network_instance, 'network_name', 'Unknown') if self.network_instance else 'Unknown'
            await self._relay_reconnect(network_id, network_name)

    async def _handle_relay_message(self, data: Dict[str, Any]):
        """Handle an incoming message from the relay."""
        msg_type = data.get("type")

        if msg_type == "http_request":
            await self._handle_relay_http_request(data)
        elif msg_type == "heartbeat_ack":
            pass  # Heartbeat acknowledged
        elif msg_type == "error":
            logger.error(f"Relay error: {data.get('message')}")
        else:
            logger.debug(f"Unknown relay message type: {msg_type}")

    async def _handle_relay_http_request(self, request: Dict[str, Any]):
        """
        Handle an HTTP request from the relay.

        Makes a real HTTP request to localhost and sends the response back.
        """
        request_id = request.get("requestId")
        method = request.get("method", "GET")
        path = request.get("path", "/")
        query = request.get("query", {})
        headers = request.get("headers", {})
        body = request.get("body")

        try:
            # Build the local URL
            local_url = f"http://127.0.0.1:{self._listen_port}{path}"
            if query:
                query_string = urlencode(query)
                local_url = f"{local_url}?{query_string}"

            # Prepare headers (filter out hop-by-hop headers)
            hop_by_hop = {'connection', 'keep-alive', 'proxy-authenticate',
                         'proxy-authorization', 'te', 'trailers', 'transfer-encoding', 'upgrade'}
            req_headers = {k: v for k, v in headers.items()
                          if k.lower() not in hop_by_hop}

            # Prepare body
            body_data = None
            if body:
                if isinstance(body, str):
                    body_data = body.encode('utf-8')
                elif isinstance(body, dict):
                    body_data = json.dumps(body).encode('utf-8')
                elif isinstance(body, bytes):
                    body_data = body

            # Make real HTTP request to localhost
            async with aiohttp.ClientSession() as session:
                async with session.request(
                    method=method,
                    url=local_url,
                    headers=req_headers,
                    data=body_data,
                    timeout=aiohttp.ClientTimeout(total=30),
                ) as response:
                    # Read response body
                    response_body_bytes = await response.read()

                    # Try to decode as JSON, otherwise as text
                    response_body = None
                    content_type = response.headers.get('Content-Type', '')
                    if 'application/json' in content_type:
                        try:
                            response_body = json.loads(response_body_bytes)
                        except json.JSONDecodeError:
                            response_body = response_body_bytes.decode('utf-8', errors='replace')
                    else:
                        response_body = response_body_bytes.decode('utf-8', errors='replace')

                    # Filter response headers
                    response_headers = {}
                    for key, value in response.headers.items():
                        if key.lower() not in hop_by_hop:
                            response_headers[key] = value

                    response_msg = {
                        "type": "http_response",
                        "requestId": request_id,
                        "status": response.status,
                        "headers": response_headers,
                        "body": response_body,
                    }

            if self._relay_ws and not self._relay_ws.closed:
                await self._relay_ws.send_json(response_msg)

        except Exception as e:
            logger.error(f"Error handling relay request {request_id}: {e}")

            error_response = {
                "type": "http_response",
                "requestId": request_id,
                "status": 500,
                "headers": {"Content-Type": "application/json"},
                "body": {"error": str(e)},
            }

            if self._relay_ws and not self._relay_ws.closed:
                await self._relay_ws.send_json(error_response)

    async def _relay_heartbeat_loop(self):
        """Send periodic heartbeats to keep relay connection alive."""
        while self._relay_running:
            try:
                await asyncio.sleep(25)  # Send heartbeat every 25 seconds

                if self._relay_ws and not self._relay_ws.closed:
                    await self._relay_ws.send_json({"type": "heartbeat"})

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Relay heartbeat error: {e}")

    async def _relay_reconnect(self, network_id: str, network_name: str):
        """Attempt to reconnect to the relay."""
        max_attempts = 5
        attempts = 0

        while self._relay_running and attempts < max_attempts:
            attempts += 1
            delay = 5.0 * attempts

            logger.info(f"Reconnecting to relay in {delay}s (attempt {attempts})")
            await asyncio.sleep(delay)

            try:
                await self._connect_to_relay(network_id, network_name)
                logger.info("Reconnected to relay")
                return
            except Exception as e:
                logger.error(f"Relay reconnection failed: {e}")

        logger.error("Max relay reconnection attempts reached")
        self._relay_running = False

    async def _stop_relay(self):
        """Stop the relay connection."""
        self._relay_running = False

        if self._relay_heartbeat_task:
            self._relay_heartbeat_task.cancel()
            try:
                await self._relay_heartbeat_task
            except asyncio.CancelledError:
                pass

        if self._relay_task:
            self._relay_task.cancel()
            try:
                await self._relay_task
            except asyncio.CancelledError:
                pass

        if self._relay_ws and not self._relay_ws.closed:
            try:
                await self._relay_ws.send_json({"type": "unregister"})
            except:
                pass
            await self._relay_ws.close()

        if self._relay_session:
            await self._relay_session.close()
            self._relay_session = None

        self._relay_public_url = None
        self._relay_tunnel_id = None
        logger.info("Relay connection stopped")

    async def relay_connect_handler(self, request):
        """API endpoint to connect to relay server."""
        try:
            # Parse optional relay URL from request body
            try:
                data = await request.json()
                relay_url = data.get("relay_url", DEFAULT_RELAY_URL)
            except:
                relay_url = DEFAULT_RELAY_URL

            # Check if already connected
            if self.relay_connected:
                return web.json_response({
                    "success": True,
                    "message": "Already connected to relay",
                    "relay_url": self._relay_public_url,
                    "tunnel_id": self._relay_tunnel_id,
                    "connected": True,
                })

            # Clean up any stale connection (WebSocket open but registration incomplete)
            if self._relay_ws is not None and not self._relay_ws.closed:
                logger.warning("Cleaning up stale relay WebSocket connection")
                try:
                    await self._relay_ws.close()
                except Exception:
                    pass
                self._relay_ws = None

            # Set relay URL and start connection
            self._relay_url = relay_url
            self._relay_running = True

            # Get network info for registration
            network_id = "unknown"
            network_name = "Unknown Network"
            if self.network_instance:
                network_id = getattr(self.network_instance, 'network_id', 'unknown')
                network_name = getattr(self.network_instance, 'network_name', 'Unknown Network')

            try:
                await self._connect_to_relay(network_id, network_name)
                return web.json_response({
                    "success": True,
                    "message": "Connected to relay",
                    "relay_url": self._relay_public_url,
                    "tunnel_id": self._relay_tunnel_id,
                    "connected": True,
                })
            except Exception as e:
                logger.error(f"Failed to connect to relay: {e}")
                self._relay_running = False
                return web.json_response({
                    "success": False,
                    "error": str(e),
                    "connected": False,
                }, status=502)

        except Exception as e:
            logger.error(f"Error in relay connect handler: {e}")
            return web.json_response({
                "success": False,
                "error": str(e),
            }, status=500)

    async def relay_disconnect_handler(self, request):
        """API endpoint to disconnect from relay server."""
        try:
            if not self.relay_connected:
                return web.json_response({
                    "success": True,
                    "message": "Not connected to relay",
                    "connected": False,
                })

            await self._stop_relay()

            return web.json_response({
                "success": True,
                "message": "Disconnected from relay",
                "connected": False,
            })

        except Exception as e:
            logger.error(f"Error in relay disconnect handler: {e}")
            return web.json_response({
                "success": False,
                "error": str(e),
            }, status=500)

    async def relay_status_handler(self, request):
        """API endpoint to get relay connection status."""
        try:
            return web.json_response({
                "success": True,
                "connected": self.relay_connected,
                "relay_url": self._relay_public_url,
                "tunnel_id": self._relay_tunnel_id,
            })
        except Exception as e:
            logger.error(f"Error in relay status handler: {e}")
            return web.json_response({
                "success": False,
                "error": str(e),
            }, status=500)

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

    # Agent Management API handlers

    async def get_service_agents(self, request):
        """Get list of all service agents with their status."""
        try:
            if not self.network_instance or not hasattr(self.network_instance, "agent_manager"):
                return web.json_response(
                    {"success": False, "error": "Agent manager not available"},
                    status=503,
                )

            agent_manager = self.network_instance.agent_manager
            agents_status = agent_manager.get_all_agents_status()

            return web.json_response({
                "success": True,
                "agents": agents_status
            })

        except Exception as e:
            logger.error(f"Error getting service agents: {e}")
            return web.json_response(
                {"success": False, "error": str(e)},
                status=500,
            )

    async def start_service_agent(self, request):
        """Start a specific service agent."""
        try:
            agent_id = request.match_info.get("agent_id")

            if not agent_id:
                return web.json_response(
                    {"success": False, "error": "agent_id is required"},
                    status=400,
                )

            if not self.network_instance or not hasattr(self.network_instance, "agent_manager"):
                return web.json_response(
                    {"success": False, "error": "Agent manager not available"},
                    status=503,
                )

            agent_manager = self.network_instance.agent_manager
            result = await agent_manager.start_agent(agent_id)

            if result["success"]:
                return web.json_response(result)
            else:
                return web.json_response(result, status=400)

        except Exception as e:
            logger.error(f"Error starting service agent: {e}")
            return web.json_response(
                {"success": False, "error": str(e)},
                status=500,
            )

    async def stop_service_agent(self, request):
        """Stop a specific service agent."""
        try:
            agent_id = request.match_info.get("agent_id")

            if not agent_id:
                return web.json_response(
                    {"success": False, "error": "agent_id is required"},
                    status=400,
                )

            if not self.network_instance or not hasattr(self.network_instance, "agent_manager"):
                return web.json_response(
                    {"success": False, "error": "Agent manager not available"},
                    status=503,
                )

            agent_manager = self.network_instance.agent_manager
            result = await agent_manager.stop_agent(agent_id)

            if result["success"]:
                return web.json_response(result)
            else:
                return web.json_response(result, status=400)

        except Exception as e:
            logger.error(f"Error stopping service agent: {e}")
            return web.json_response(
                {"success": False, "error": str(e)},
                status=500,
            )

    async def restart_service_agent(self, request):
        """Restart a specific service agent."""
        try:
            agent_id = request.match_info.get("agent_id")

            if not agent_id:
                return web.json_response(
                    {"success": False, "error": "agent_id is required"},
                    status=400,
                )

            if not self.network_instance or not hasattr(self.network_instance, "agent_manager"):
                return web.json_response(
                    {"success": False, "error": "Agent manager not available"},
                    status=503,
                )

            agent_manager = self.network_instance.agent_manager
            result = await agent_manager.restart_agent(agent_id)

            if result["success"]:
                return web.json_response(result)
            else:
                return web.json_response(result, status=400)

        except Exception as e:
            logger.error(f"Error restarting service agent: {e}")
            return web.json_response(
                {"success": False, "error": str(e)},
                status=500,
            )

    async def get_service_agent_status(self, request):
        """Get status of a specific service agent."""
        try:
            agent_id = request.match_info.get("agent_id")

            if not agent_id:
                return web.json_response(
                    {"success": False, "error": "agent_id is required"},
                    status=400,
                )

            if not self.network_instance or not hasattr(self.network_instance, "agent_manager"):
                return web.json_response(
                    {"success": False, "error": "Agent manager not available"},
                    status=503,
                )

            agent_manager = self.network_instance.agent_manager
            status = agent_manager.get_agent_status(agent_id)

            if status:
                return web.json_response({
                    "success": True,
                    "status": status
                })
            else:
                return web.json_response(
                    {"success": False, "error": "Agent not found"},
                    status=404,
                )

        except Exception as e:
            logger.error(f"Error getting service agent status: {e}")
            return web.json_response(
                {"success": False, "error": str(e)},
                status=500,
            )

    async def get_service_agent_logs(self, request):
        """Get recent log lines for a specific service agent."""
        try:
            agent_id = request.match_info.get("agent_id")
            lines = int(request.query.get("lines", "100"))

            if not agent_id:
                return web.json_response(
                    {"success": False, "error": "agent_id is required"},
                    status=400,
                )

            # Validate lines parameter
            if lines < 1 or lines > 10000:
                return web.json_response(
                    {"success": False, "error": "lines must be between 1 and 10000"},
                    status=400,
                )

            if not self.network_instance or not hasattr(self.network_instance, "agent_manager"):
                return web.json_response(
                    {"success": False, "error": "Agent manager not available"},
                    status=503,
                )

            agent_manager = self.network_instance.agent_manager
            log_lines = agent_manager.get_agent_logs(agent_id, lines)

            if log_lines is not None:
                return web.json_response({
                    "success": True,
                    "logs": log_lines
                })
            else:
                return web.json_response(
                    {"success": False, "error": "Agent not found or no logs available"},
                    status=404,
                )

        except ValueError:
            return web.json_response(
                {"success": False, "error": "Invalid lines parameter"},
                status=400,
            )
        except Exception as e:
            logger.error(f"Error getting service agent logs: {e}")
            return web.json_response(
                {"success": False, "error": str(e)},
                status=500,
            )

    async def get_service_agent_source(self, request):
        """Get the source code of a service agent."""
        try:
            agent_id = request.match_info.get("agent_id")
            if not agent_id:
                return web.json_response(
                    {"success": False, "error": "Agent ID required"},
                    status=400,
                )

            if not self.network_instance or not hasattr(self.network_instance, "agent_manager"):
                return web.json_response(
                    {"success": False, "error": "Agent manager not available"},
                    status=503,
                )

            agent_manager = self.network_instance.agent_manager
            source_info = agent_manager.get_agent_source(agent_id)

            if source_info:
                return web.json_response({
                    "success": True,
                    "source": source_info
                })
            else:
                return web.json_response(
                    {"success": False, "error": "Agent not found or unable to read source"},
                    status=404,
                )

        except Exception as e:
            logger.error(f"Error getting service agent source: {e}")
            return web.json_response(
                {"success": False, "error": str(e)},
                status=500,
            )

    async def save_service_agent_source(self, request):
        """Save the source code of a service agent."""
        try:
            agent_id = request.match_info.get("agent_id")
            if not agent_id:
                return web.json_response(
                    {"success": False, "error": "Agent ID required"},
                    status=400,
                )

            if not self.network_instance or not hasattr(self.network_instance, "agent_manager"):
                return web.json_response(
                    {"success": False, "error": "Agent manager not available"},
                    status=503,
                )

            # Parse request body
            try:
                data = await request.json()
            except Exception:
                return web.json_response(
                    {"success": False, "error": "Invalid JSON body"},
                    status=400,
                )

            content = data.get("content")
            if content is None:
                return web.json_response(
                    {"success": False, "error": "Content field required"},
                    status=400,
                )

            agent_manager = self.network_instance.agent_manager
            result = agent_manager.save_agent_source(agent_id, content)

            if result["success"]:
                return web.json_response(result)
            else:
                return web.json_response(result, status=400)

        except Exception as e:
            logger.error(f"Error saving service agent source: {e}")
            return web.json_response(
                {"success": False, "error": str(e)},
                status=500,
            )

    async def get_service_agent_env(self, request):
        """Get environment variables for a service agent."""
        try:
            agent_id = request.match_info.get("agent_id")
            if not agent_id:
                return web.json_response(
                    {"success": False, "error": "Agent ID required"},
                    status=400,
                )

            if not self.network_instance or not hasattr(self.network_instance, "agent_manager"):
                return web.json_response(
                    {"success": False, "error": "Agent manager not available"},
                    status=503,
                )

            agent_manager = self.network_instance.agent_manager
            env_vars = agent_manager.get_agent_env_vars(agent_id)

            if env_vars is None:
                return web.json_response(
                    {"success": False, "error": f"Agent '{agent_id}' not found"},
                    status=404,
                )

            return web.json_response({
                "success": True,
                "env_vars": env_vars
            })

        except Exception as e:
            logger.error(f"Error getting service agent env vars: {e}")
            return web.json_response(
                {"success": False, "error": str(e)},
                status=500,
            )

    async def save_service_agent_env(self, request):
        """Save environment variables for a service agent."""
        try:
            agent_id = request.match_info.get("agent_id")
            if not agent_id:
                return web.json_response(
                    {"success": False, "error": "Agent ID required"},
                    status=400,
                )

            if not self.network_instance or not hasattr(self.network_instance, "agent_manager"):
                return web.json_response(
                    {"success": False, "error": "Agent manager not available"},
                    status=503,
                )

            # Parse request body
            try:
                data = await request.json()
            except Exception:
                return web.json_response(
                    {"success": False, "error": "Invalid JSON body"},
                    status=400,
                )

            env_vars = data.get("env_vars")
            if env_vars is None:
                return web.json_response(
                    {"success": False, "error": "env_vars field required"},
                    status=400,
                )

            if not isinstance(env_vars, dict):
                return web.json_response(
                    {"success": False, "error": "env_vars must be an object"},
                    status=400,
                )

            agent_manager = self.network_instance.agent_manager
            result = agent_manager.set_agent_env_vars(agent_id, env_vars)

            if result["success"]:
                return web.json_response(result)
            else:
                return web.json_response(result, status=400)

        except Exception as e:
            logger.error(f"Error saving service agent env vars: {e}")
            return web.json_response(
                {"success": False, "error": str(e)},
                status=500,
            )

    async def get_global_env(self, request):
        """Get global environment variables for all service agents."""
        try:
            if not self.network_instance or not hasattr(self.network_instance, "agent_manager"):
                return web.json_response(
                    {"success": False, "error": "Agent manager not available"},
                    status=503,
                )

            agent_manager = self.network_instance.agent_manager
            env_vars = agent_manager.get_global_env_vars()

            return web.json_response({
                "success": True,
                "env_vars": env_vars
            })

        except Exception as e:
            logger.error(f"Error getting global env vars: {e}")
            return web.json_response(
                {"success": False, "error": str(e)},
                status=500,
            )

    async def save_global_env(self, request):
        """Save global environment variables for all service agents."""
        try:
            if not self.network_instance or not hasattr(self.network_instance, "agent_manager"):
                return web.json_response(
                    {"success": False, "error": "Agent manager not available"},
                    status=503,
                )

            # Parse request body
            try:
                data = await request.json()
            except Exception:
                return web.json_response(
                    {"success": False, "error": "Invalid JSON body"},
                    status=400,
                )

            env_vars = data.get("env_vars")
            if env_vars is None:
                return web.json_response(
                    {"success": False, "error": "env_vars field required"},
                    status=400,
                )

            if not isinstance(env_vars, dict):
                return web.json_response(
                    {"success": False, "error": "env_vars must be an object"},
                    status=400,
                )

            agent_manager = self.network_instance.agent_manager
            result = agent_manager.set_global_env_vars(env_vars)

            if result["success"]:
                return web.json_response(result)
            else:
                return web.json_response(result, status=400)

        except Exception as e:
            logger.error(f"Error saving global env vars: {e}")
            return web.json_response(
                {"success": False, "error": str(e)},
                status=500,
            )

    async def upload_asset(self, request):
        """Upload an asset file (icon, image, etc.) to the workspace assets folder."""
        try:
            if not self.workspace_path:
                return web.json_response(
                    {"success": False, "error": "Workspace not configured"},
                    status=503,
                )

            # Parse multipart form data
            reader = await request.multipart()

            file_data = None
            file_name = None
            asset_type = "general"  # default type

            async for field in reader:
                if field.name == "file":
                    file_name = field.filename
                    file_data = await field.read()
                elif field.name == "type":
                    asset_type = (await field.read()).decode("utf-8")

            if not file_data or not file_name:
                return web.json_response(
                    {"success": False, "error": "No file provided"},
                    status=400,
                )

            # Validate file size (max 5MB for assets)
            if len(file_data) > 5 * 1024 * 1024:
                return web.json_response(
                    {"success": False, "error": "File too large (max 5MB)"},
                    status=400,
                )

            # Sanitize filename
            safe_filename = os.path.basename(file_name)

            # Generate unique filename to avoid conflicts
            file_ext = os.path.splitext(safe_filename)[1]
            unique_id = str(uuid.uuid4())[:8]
            final_filename = f"{asset_type}_{unique_id}{file_ext}"

            # Create assets directory if it doesn't exist
            assets_dir = Path(self.workspace_path) / "assets"
            assets_dir.mkdir(parents=True, exist_ok=True)

            # Save the file
            file_path = assets_dir / final_filename
            with open(file_path, "wb") as f:
                f.write(file_data)

            # Generate URL for the asset
            # The asset will be served at /assets/{filename}
            asset_url = f"/assets/{final_filename}"

            logger.info(f"Uploaded asset: {final_filename} ({len(file_data)} bytes)")

            return web.json_response({
                "success": True,
                "url": asset_url,
                "filename": final_filename,
                "size": len(file_data)
            })

        except Exception as e:
            logger.error(f"Error uploading asset: {e}")
            return web.json_response(
                {"success": False, "error": str(e)},
                status=500,
            )

    async def serve_asset(self, request):
        """Serve an asset file from the workspace assets folder."""
        try:
            if not self.workspace_path:
                return web.Response(status=503, text="Workspace not configured")

            filename = request.match_info.get("filename", "")

            # Sanitize to prevent path traversal
            safe_filename = os.path.basename(filename)
            if safe_filename != filename:
                return web.Response(status=400, text="Invalid filename")

            assets_dir = Path(self.workspace_path) / "assets"
            file_path = assets_dir / safe_filename

            if not file_path.exists() or not file_path.is_file():
                return web.Response(status=404, text="Asset not found")

            # Determine content type
            content_type, _ = mimetypes.guess_type(str(file_path))
            if not content_type:
                content_type = "application/octet-stream"

            # Read and return file
            with open(file_path, "rb") as f:
                content = f.read()

            return web.Response(
                body=content,
                content_type=content_type,
                headers={
                    "Cache-Control": "public, max-age=86400"  # Cache for 24 hours
                }
            )

        except Exception as e:
            logger.error(f"Error serving asset: {e}")
            return web.Response(status=500, text=str(e))

    async def sync_events(self, request):
        """Handle event index sync from GitHub."""
        try:
            from openagents.utils.event_indexer import get_event_indexer

            indexer = get_event_indexer()
            result = indexer.sync_from_github()

            return web.json_response({
                "success": True,
                "data": result
            })
        except Exception as e:
            logger.error(f"Error syncing events: {e}")
            return web.json_response(
                {"success": False, "error_message": str(e)},
                status=500
            )

    async def list_events(self, request):
        """List all indexed events with optional filters."""
        try:
            from openagents.utils.event_indexer import get_event_indexer

            indexer = get_event_indexer()

            # Get query parameters
            mod_filter = request.query.get("mod")
            type_filter = request.query.get("type")

            events = indexer.get_all_events(
                mod_filter=mod_filter if mod_filter else None,
                type_filter=type_filter if type_filter else None
            )

            return web.json_response({
                "success": True,
                "data": {
                    "events": events,
                    "total": len(events)
                }
            })
        except Exception as e:
            logger.error(f"Error listing events: {e}")
            return web.json_response(
                {"success": False, "error_message": str(e)},
                status=500
            )

    async def list_mods(self, request):
        """List all indexed mods."""
        try:
            from openagents.utils.event_indexer import get_event_indexer

            indexer = get_event_indexer()
            mods = indexer.get_mods()

            return web.json_response({
                "success": True,
                "data": {
                    "mods": mods,
                    "total": len(mods)
                }
            })
        except Exception as e:
            logger.error(f"Error listing mods: {e}")
            return web.json_response(
                {"success": False, "error_message": str(e)},
                status=500
            )

    async def search_events(self, request):
        """Search events by query string."""
        try:
            from openagents.utils.event_indexer import get_event_indexer

            indexer = get_event_indexer()

            query = request.query.get("q", "")
            if not query:
                return web.json_response(
                    {"success": False, "error_message": "Query parameter 'q' is required"},
                    status=400
                )

            results = indexer.search_events(query)

            return web.json_response({
                "success": True,
                "data": {
                    "events": results,
                    "total": len(results),
                    "query": query
                }
            })
        except Exception as e:
            logger.error(f"Error searching events: {e}")
            return web.json_response(
                {"success": False, "error_message": str(e)},
                status=500
            )

    async def get_event_detail(self, request):
        """Get detailed information about a specific event."""
        try:
            from openagents.utils.event_indexer import get_event_indexer
            import urllib.parse

            indexer = get_event_indexer()

            event_name = request.match_info.get("event_name")
            if not event_name:
                return web.json_response(
                    {"success": False, "error_message": "Event name is required"},
                    status=400
                )

            # Decode URL-encoded event name
            event_name = urllib.parse.unquote(event_name)

            event = indexer.get_event(event_name)

            if not event:
                return web.json_response(
                    {"success": False, "error_message": f"Event '{event_name}' not found"},
                    status=404
                )

            # Generate example code
            examples = _generate_event_examples(event)
            event_with_examples = {**event, "examples": examples}

            return web.json_response({
                "success": True,
                "data": event_with_examples
            })
        except Exception as e:
            logger.error(f"Error getting event detail: {e}")
            return web.json_response(
                {"success": False, "error_message": str(e)},
                status=500
            )

    # ========================================================================
    # MCP Protocol Handlers (enabled via serve_mcp: true)
    # ========================================================================

    async def _handle_mcp_post(self, request: web.Request) -> web.Response:
        """Handle POST requests (JSON-RPC messages) for MCP Streamable HTTP."""
        # Check Accept header
        accept = request.headers.get("Accept", "")
        if "application/json" not in accept and "text/event-stream" not in accept and "*/*" not in accept:
            return web.Response(
                status=406,
                text="Must accept application/json or text/event-stream",
            )

        try:
            body = await request.json()
        except json.JSONDecodeError:
            return web.json_response(
                self._mcp_jsonrpc_error(None, -32700, "Parse error"),
                status=400,
            )

        # Get or validate session
        session_id = request.headers.get("Mcp-Session-Id")
        method = body.get("method", "")

        # Initialize request creates new session
        if method == "initialize":
            session_id = str(uuid.uuid4())
            self._mcp_sessions[session_id] = MCPSession(session_id=session_id)
            logger.info(f"HTTP MCP: Created new session: {session_id}")
        elif session_id and session_id not in self._mcp_sessions:
            # Invalid session ID for non-initialize request
            return web.Response(status=404, text="Invalid session ID")

        # Process JSON-RPC request
        response_data = await self._mcp_process_jsonrpc(body, session_id)

        # Build response headers
        headers = {}
        if method == "initialize" and session_id:
            headers["Mcp-Session-Id"] = session_id

        return web.json_response(response_data, headers=headers)

    async def _handle_mcp_get(self, request: web.Request) -> web.Response:
        """Handle GET requests (SSE stream for server notifications)."""
        session_id = request.headers.get("Mcp-Session-Id")
        if not session_id or session_id not in self._mcp_sessions:
            return web.Response(status=404, text="Invalid or missing session")

        session = self._mcp_sessions[session_id]

        # Create SSE response
        response = web.StreamResponse(
            status=200,
            headers={
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
            },
        )
        await response.prepare(request)

        # Store SSE response for sending notifications
        session.sse_response = response

        try:
            # Keep connection open for notifications
            while session.is_active:
                # Send any pending notifications
                while session.pending_notifications:
                    notification = session.pending_notifications.pop(0)
                    await self._mcp_send_sse_event(response, notification)

                # Wait a bit before checking again
                await asyncio.sleep(0.1)

                # Check if client disconnected
                if response.task and response.task.done():
                    break

        except (ConnectionResetError, asyncio.CancelledError):
            logger.debug(f"HTTP MCP: SSE connection closed for session {session_id}")
        finally:
            session.sse_response = None

        return response

    async def _handle_mcp_delete(self, request: web.Request) -> web.Response:
        """Handle DELETE requests (session termination)."""
        session_id = request.headers.get("Mcp-Session-Id")
        if session_id and session_id in self._mcp_sessions:
            session = self._mcp_sessions[session_id]
            session.is_active = False
            del self._mcp_sessions[session_id]
            logger.info(f"HTTP MCP: Terminated session: {session_id}")
            return web.Response(status=200, text="Session terminated")
        return web.Response(status=404, text="Session not found")

    def _get_external_access_config(self):
        """Get external_access configuration for tool filtering."""
        # Try network_context first
        if self.network_context:
            return getattr(self.network_context, 'external_access', None)
        # Fallback to network_instance.config
        if self.network_instance:
            config = getattr(self.network_instance, 'config', None)
            if config:
                return getattr(config, 'external_access', None)
        return None

    async def _handle_mcp_tools_list(self, request: web.Request) -> web.Response:
        """Handle tools list request (admin UI endpoint).

        This endpoint returns ALL tools without filtering so admin UI
        can display and manage them. MCP clients use the JSON-RPC endpoint
        which applies external_access filtering.
        """
        if not self._mcp_tool_collector:
            return web.json_response({"tools": [], "error": "Tool collector not initialized"})

        # Return all tools without filtering for admin UI
        # Include source information for display
        tools = self._mcp_tool_collector.to_mcp_tools_filtered(None, None, include_source=True)
        return web.json_response({"tools": tools})

    async def _mcp_send_sse_event(self, response: web.StreamResponse, data: Dict[str, Any]):
        """Send an SSE event to the client."""
        event_data = f"data: {json.dumps(data)}\n\n"
        await response.write(event_data.encode("utf-8"))

    def _mcp_jsonrpc_error(
        self, id: Optional[Any], code: int, message: str, data: Any = None
    ) -> Dict[str, Any]:
        """Create a JSON-RPC error response."""
        error = {"code": code, "message": message}
        if data is not None:
            error["data"] = data
        return {"jsonrpc": "2.0", "id": id, "error": error}

    def _mcp_jsonrpc_result(self, id: Any, result: Any) -> Dict[str, Any]:
        """Create a JSON-RPC result response."""
        return {"jsonrpc": "2.0", "id": id, "result": result}

    async def _mcp_process_jsonrpc(
        self, body: Dict[str, Any], session_id: Optional[str]
    ) -> Dict[str, Any]:
        """Process a JSON-RPC request and return the response."""
        request_id = body.get("id")
        method = body.get("method", "")
        params = body.get("params", {})

        try:
            if method == "initialize":
                return await self._mcp_handle_initialize(request_id, params)
            elif method == "initialized":
                # Client notification that initialization is complete
                if session_id and session_id in self._mcp_sessions:
                    self._mcp_sessions[session_id].initialized = True
                return self._mcp_jsonrpc_result(request_id, {})
            elif method == "tools/list":
                return await self._mcp_handle_tools_list_rpc(request_id)
            elif method == "tools/call":
                return await self._mcp_handle_tools_call(request_id, params)
            elif method == "ping":
                return self._mcp_jsonrpc_result(request_id, {})
            else:
                return self._mcp_jsonrpc_error(
                    request_id, -32601, f"Method not found: {method}"
                )
        except Exception as e:
            logger.error(f"HTTP MCP: Error processing JSON-RPC request: {e}")
            return self._mcp_jsonrpc_error(request_id, -32603, f"Internal error: {str(e)}")

    async def _mcp_handle_initialize(
        self, request_id: Any, params: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Handle MCP initialize request."""
        network_name = "OpenAgents"
        if self.network_context and self.network_context.network_name:
            network_name = self.network_context.network_name

        result = {
            "protocolVersion": MCP_PROTOCOL_VERSION,
            "capabilities": {
                "tools": {"listChanged": False},
            },
            "serverInfo": {
                "name": network_name,
                "version": "1.0.0",
            },
        }
        return self._mcp_jsonrpc_result(request_id, result)

    async def _mcp_handle_tools_list_rpc(self, request_id: Any) -> Dict[str, Any]:
        """Handle tools/list JSON-RPC request."""
        if not self._mcp_tool_collector:
            return self._mcp_jsonrpc_result(request_id, {"tools": []})

        # Apply external_access filtering
        external_access = self._get_external_access_config()
        exposed_tools = external_access.exposed_tools if external_access else None
        excluded_tools = external_access.excluded_tools if external_access else None

        tools = []
        for tool_dict in self._mcp_tool_collector.to_mcp_tools_filtered(exposed_tools, excluded_tools):
            tools.append({
                "name": tool_dict["name"],
                "description": tool_dict["description"],
                "inputSchema": tool_dict["inputSchema"],
            })

        return self._mcp_jsonrpc_result(request_id, {"tools": tools})

    async def _mcp_handle_tools_call(
        self, request_id: Any, params: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Handle tools/call JSON-RPC request."""
        tool_name = params.get("name")
        arguments = params.get("arguments", {})

        if not tool_name:
            return self._mcp_jsonrpc_error(request_id, -32602, "Missing tool name")

        if not self._mcp_tool_collector:
            return self._mcp_jsonrpc_error(
                request_id, -32603, "Tool collector not initialized"
            )

        tool = self._mcp_tool_collector.get_tool_by_name(tool_name)
        if not tool:
            return self._mcp_jsonrpc_error(
                request_id, -32602, f"Tool not found: {tool_name}"
            )

        try:
            result = await tool.execute(**arguments)
            return self._mcp_jsonrpc_result(
                request_id,
                {
                    "content": [{"type": "text", "text": str(result)}],
                    "isError": False,
                },
            )
        except Exception as e:
            logger.error(f"HTTP MCP: Error executing tool '{tool_name}': {e}")
            return self._mcp_jsonrpc_result(
                request_id,
                {
                    "content": [{"type": "text", "text": f"Error: {str(e)}"}],
                    "isError": True,
                },
            )

    # ========================================================================
    # Studio Static File Handlers (enabled via serve_studio: true)
    # ========================================================================

    def _find_studio_build_dir(self) -> Optional[str]:
        """Find the studio build directory from the installed package."""
        try:
            from importlib.resources import files
            studio_resources = files("openagents").joinpath("studio", "build")
            if studio_resources.is_dir():
                try:
                    index_file = studio_resources.joinpath("index.html")
                    if index_file.is_file():
                        return str(studio_resources)
                except (AttributeError, TypeError):
                    pass
        except (ModuleNotFoundError, AttributeError, TypeError):
            pass

        # Try to find build directory in multiple locations
        script_dir = os.path.dirname(os.path.abspath(__file__))  # core/transports
        core_dir = os.path.dirname(script_dir)  # core
        package_dir = os.path.dirname(core_dir)  # src/openagents
        src_dir = os.path.dirname(package_dir)  # src
        project_root = os.path.dirname(src_dir)  # actual project root

        possible_paths = [
            # In development: project_root/studio/build
            os.path.join(project_root, "studio", "build"),
            # In installed package (src/openagents/studio/build)
            os.path.join(package_dir, "studio", "build"),
            # Alternative: relative to src
            os.path.join(src_dir, "studio", "build"),
        ]

        for path in possible_paths:
            if path and os.path.exists(path) and os.path.isdir(path):
                index_html = os.path.join(path, "index.html")
                if os.path.exists(index_html):
                    return path

        return None

    async def _handle_studio_redirect(self, request: web.Request) -> web.Response:
        """Redirect /studio to /studio/ for proper relative path handling."""
        return web.HTTPFound("/studio/")

    async def _handle_studio_static(self, request: web.Request) -> web.Response:
        """Handle Studio static file requests with SPA routing support."""
        if not self._studio_build_dir:
            return web.Response(
                status=404,
                text="Studio build directory not found. Run 'npm run build' in the studio directory.",
            )

        # Get the requested path
        path = request.match_info.get("path", "")

        # Handle empty path or just "/" - serve index.html
        if not path or path == "/":
            file_path = os.path.join(self._studio_build_dir, "index.html")
        else:
            # Remove leading slash and construct full path
            path = path.lstrip("/")
            file_path = os.path.join(self._studio_build_dir, path)

        # Security check: ensure the resolved path is within the build directory
        real_build_dir = os.path.realpath(self._studio_build_dir)
        real_file_path = os.path.realpath(file_path)
        if not real_file_path.startswith(real_build_dir):
            return web.Response(status=403, text="Forbidden")

        # Check if file exists
        if os.path.exists(file_path) and os.path.isfile(file_path):
            # Serve the actual file
            content_type, _ = mimetypes.guess_type(file_path)
            if content_type is None:
                content_type = "application/octet-stream"

            try:
                with open(file_path, "rb") as f:
                    content = f.read()

                response = web.Response(body=content, content_type=content_type)
                # Add cache headers for static assets
                if any(path.startswith(prefix) for prefix in ["static/", "assets/"]):
                    response.headers["Cache-Control"] = "public, max-age=31536000"
                else:
                    response.headers["Cache-Control"] = "no-cache"
                return response
            except IOError as e:
                logger.error(f"HTTP Studio: Error reading file {file_path}: {e}")
                return web.Response(status=500, text="Internal server error")
        else:
            # For SPA routing: serve index.html for non-existent paths
            # This allows React Router to handle client-side routing
            index_path = os.path.join(self._studio_build_dir, "index.html")
            if os.path.exists(index_path):
                try:
                    with open(index_path, "rb") as f:
                        content = f.read()
                    return web.Response(
                        body=content,
                        content_type="text/html",
                        headers={"Cache-Control": "no-cache"},
                    )
                except IOError as e:
                    logger.error(f"HTTP Studio: Error reading index.html: {e}")
                    return web.Response(status=500, text="Internal server error")
            else:
                return web.Response(status=404, text="Not found")

    async def _handle_studio_root_static(self, request: web.Request) -> web.Response:
        """Handle /static/* requests for React app assets."""
        if not self._studio_build_dir:
            return web.Response(status=404, text="Studio build not found")

        path = request.match_info.get("path", "")
        file_path = os.path.join(self._studio_build_dir, "static", path.lstrip("/"))

        # Security check
        real_build_dir = os.path.realpath(self._studio_build_dir)
        real_file_path = os.path.realpath(file_path)
        if not real_file_path.startswith(real_build_dir):
            return web.Response(status=403, text="Forbidden")

        if os.path.exists(file_path) and os.path.isfile(file_path):
            content_type, _ = mimetypes.guess_type(file_path)
            if content_type is None:
                content_type = "application/octet-stream"
            try:
                with open(file_path, "rb") as f:
                    content = f.read()
                response = web.Response(body=content, content_type=content_type)
                response.headers["Cache-Control"] = "public, max-age=31536000"
                return response
            except IOError as e:
                logger.error(f"HTTP Studio: Error reading static file {file_path}: {e}")
                return web.Response(status=500, text="Internal server error")
        return web.Response(status=404, text="Not found")

    async def _handle_studio_root_asset(self, request: web.Request) -> web.Response:
        """Handle root-level asset requests (favicon.ico, manifest.json, etc.)."""
        if not self._studio_build_dir:
            return web.Response(status=404, text="Studio build not found")

        # Get filename from request path
        filename = request.path.lstrip("/")
        file_path = os.path.join(self._studio_build_dir, filename)

        # Security check
        real_build_dir = os.path.realpath(self._studio_build_dir)
        real_file_path = os.path.realpath(file_path)
        if not real_file_path.startswith(real_build_dir):
            return web.Response(status=403, text="Forbidden")

        if os.path.exists(file_path) and os.path.isfile(file_path):
            content_type, _ = mimetypes.guess_type(file_path)
            if content_type is None:
                content_type = "application/octet-stream"
            try:
                with open(file_path, "rb") as f:
                    content = f.read()
                return web.Response(body=content, content_type=content_type)
            except IOError as e:
                logger.error(f"HTTP Studio: Error reading asset {file_path}: {e}")
                return web.Response(status=500, text="Internal server error")
        return web.Response(status=404, text="Not found")

    def _require_admin(self, request) -> bool:
        """Check if request is from an agent in the 'admin' group.

        Validates agent credentials (X-Agent-ID and X-Agent-Secret headers)
        and checks if the agent belongs to the 'admin' group.

        This uses the same approach as SystemCommandProcessor._check_admin_access,
        checking topology.agent_group_membership.

        Args:
            request: aiohttp request object
        Returns:
            bool: True if agent is in admin group, False otherwise
        """
        # return True
        if not self.network_instance:
            logger.warning("Admin check failed: network instance not available")
            return False

        # Extract agent credentials from headers
        agent_id = request.headers.get('X-Agent-ID')
        agent_secret = request.headers.get('X-Agent-Secret')

        if not agent_id or not agent_secret:
            logger.warning("Admin check failed: missing X-Agent-ID or X-Agent-Secret headers")
            return False

        # Validate agent secret
        if hasattr(self.network_instance, 'secret_manager'):
            if not self.network_instance.secret_manager.validate_secret(agent_id, agent_secret):
                logger.warning(f"Admin check failed: invalid secret for agent {agent_id}")
                return False
        else:
            logger.warning("Admin check failed: secret_manager not available")
            return False

        # Check if agent is in admin group (using topology.agent_group_membership)
        # This is consistent with SystemCommandProcessor._check_admin_access
        if not self.network_instance.topology:
            logger.warning("Admin check failed: topology not available")
            return False

        agent_group = self.network_instance.topology.agent_group_membership.get(agent_id)
        if agent_group == "admin":
            logger.info(f"Admin access granted for agent: {agent_id} (group: {agent_group})")
            return True
        else:
            logger.warning(f"Admin check failed: agent {agent_id} is in group '{agent_group}', not 'admin'")
            return False

    async def export_network(self, request):
        """Export network configuration (admin only)."""
        try:
            # Check admin permissions
            if not self._require_admin(request):
                return web.json_response(
                    {"success": False, "error_message": "Admin access required"},
                    status=403
                )

            # Get query parameters
            include_passwords = request.query.get("include_password_hashes", "false").lower() == "true"
            include_sensitive = request.query.get("include_sensitive_config", "false").lower() == "true"
            notes = request.query.get("notes")

            logger.info(f"Network export requested (passwords={include_passwords}, sensitive={include_sensitive})")

            # Get network instance from event handler
            # The network_instance is set when transport is bound to network
            if not self.network_instance:
                return web.json_response(
                    {"success": False, "error_message": "Network instance not available"},
                    status=500
                )

            # Export network
            exporter = NetworkExporter(self.network_instance)
            zip_buffer = exporter.export_to_zip(
                include_password_hashes=include_passwords,
                include_sensitive_config=include_sensitive,
                notes=notes
            )

            # Generate filename
            filename = f"{self.network_instance.network_name}_export.zip"

            # Return as streaming response
            return web.Response(
                body=zip_buffer.getvalue(),
                headers={
                    'Content-Type': 'application/zip',
                    'Content-Disposition': f'attachment; filename="{filename}"'
                }
            )

        except Exception as e:
            logger.error(f"Network export failed: {e}", exc_info=True)
            return web.json_response(
                {"success": False, "error_message": "Export failed"},
                status=500
            )

    async def validate_import(self, request):
        """Validate network import file (admin only)."""
        try:
            # Check admin permissions
            if not self._require_admin(request):
                return web.json_response(
                    {"success": False, "error_message": "Admin access required"},
                    status=403
                )

            logger.info("Import validation requested")

            # Read multipart/form-data
            reader = await request.multipart()
            zip_data = None

            async for field in reader:
                if field.name == 'file':
                    zip_data = await field.read()
                    break

            if not zip_data:
                return web.json_response(
                    {"success": False, "error_message": "No file provided"},
                    status=400
                )

            # Validate import
            zip_buffer = BytesIO(zip_data)
            importer = NetworkImporter()
            validation_result = importer.validate(zip_buffer)

            # Return validation result
            return web.json_response(validation_result.model_dump())

        except Exception as e:
            logger.error(f"Import validation failed: {e}", exc_info=True)
            return web.json_response(
                {
                    "valid": False,
                    "errors": ["Validation error occurred"],
                    "warnings": []
                },
                status=200  # Return 200 with error in body, not 500
            )

    async def apply_import(self, request):
        """Apply network import (admin only)."""
        try:
            # Check admin permissions
            if not self._require_admin(request):
                return web.json_response(
                    {"success": False, "error_message": "Admin access required"},
                    status=403
                )

            logger.info("Import apply requested")

            if not self.network_instance:
                return web.json_response(
                    {
                        "success": False,
                        "message": "Network instance not available",
                        "errors": ["Network not initialized"]
                    },
                    status=500
                )

            # Read multipart/form-data
            reader = await request.multipart()
            zip_data = None
            mode = ImportMode.OVERWRITE  # Default
            new_name = None

            async for field in reader:
                if field.name == 'file':
                    zip_data = await field.read()
                elif field.name == 'mode':
                    mode_str = (await field.read()).decode('utf-8')
                    try:
                        mode = ImportMode(mode_str)
                    except ValueError:
                        logger.warning(f"Invalid import mode: {mode_str}, using OVERWRITE")
                elif field.name == 'new_name':
                    new_name = (await field.read()).decode('utf-8')

            if not zip_data:
                return web.json_response(
                    {
                        "success": False,
                        "message": "No file provided",
                        "errors": ["File is required"]
                    },
                    status=400
                )

            # Apply import asynchronously to avoid deadlock
            # (network restart will shutdown HTTP transport which would wait for this request)
            zip_buffer = BytesIO(zip_data)
            importer = NetworkImporter(self.network_instance)

            # Execute import in background to avoid blocking the response
            async def _do_import():
                """Execute import in background."""
                try:
                    result = await importer.apply(
                        zip_buffer,
                        mode=mode,
                        network=self.network_instance,
                        new_name=new_name
                    )
                    if result.success:
                        logger.info(f"Import completed successfully: {result.message}")
                    else:
                        logger.error(f"Import failed: {result.message}, errors: {result.errors}")
                except Exception as e:
                    logger.error(f"Import background task failed: {e}", exc_info=True)

            # Schedule the import task but don't await it
            asyncio.create_task(_do_import())

            # Return immediate success response (actual result will be in logs)
            return web.json_response({
                "success": True,
                "message": f"Import initiated (mode: {mode}). Network will restart in background. Check logs for status.",
                "warnings": ["Import is executing asynchronously. Monitor logs for completion status."],
                "network_restarted": False,  # Not yet, will happen in background
                "applied_config": None
            })

        except Exception as e:
            logger.error(f"Import apply failed: {e}", exc_info=True)
            return web.json_response(
                {
                    "success": False,
                    "message": "Import failed",
                    "errors": [str(e)]
                },
                status=200  # Return 200 with error in body, not 500
            )

    async def initialize_admin_password(self, request):
        """Initialize the admin password for the network.

        This endpoint only works when the network is not yet initialized.
        After initialization, this endpoint will return an error.

        Request body:
            {
                "password": "secure_password_123"
            }

        Returns:
            JSON response with success status
        """
        try:
            if not self.network_instance:
                return web.json_response(
                    {"success": False, "message": "Network instance not available"},
                    status=500
                )

            # Check if network is already initialized
            if getattr(self.network_instance.config, 'initialized', False):
                return web.json_response(
                    {"success": False, "message": "Network already initialized"},
                    status=400
                )

            # Parse request body
            try:
                data = await request.json()
            except json.JSONDecodeError:
                return web.json_response(
                    {"success": False, "message": "Invalid JSON in request body"},
                    status=400
                )

            password = data.get("password")
            if not password:
                return web.json_response(
                    {"success": False, "message": "Password is required"},
                    status=400
                )

            # Validate password strength
            from openagents.utils.password_utils import hash_password, validate_password_strength
            is_valid, error_msg = validate_password_strength(password)
            if not is_valid:
                return web.json_response(
                    {"success": False, "message": error_msg},
                    status=400
                )

            # Hash the password
            password_hash = hash_password(password)

            # Create admin group if it doesn't exist
            from openagents.models.network_config import AgentGroupConfig
            if 'admin' not in self.network_instance.config.agent_groups:
                self.network_instance.config.agent_groups['admin'] = AgentGroupConfig(
                    password_hash=password_hash,
                    description="Administrator agents with full permissions",
                    metadata={"permissions": ["all"]}
                )
            else:
                # Update existing admin group password
                self.network_instance.config.agent_groups['admin'].password_hash = password_hash

            # Mark network as initialized
            self.network_instance.config.initialized = True

            # Save configuration to file
            if not self.network_instance.save_config():
                return web.json_response(
                    {"success": False, "message": "Failed to save configuration"},
                    status=500
                )

            logger.info("Admin password initialized successfully")
            return web.json_response({
                "success": True,
                "message": "Admin password initialized successfully"
            })

        except Exception as e:
            logger.error(f"Failed to initialize admin password: {e}", exc_info=True)
            return web.json_response(
                {"success": False, "message": f"Failed to initialize admin password: {str(e)}"},
                status=500
            )

    async def initialize_network_with_template(self, request):
        """Initialize the network with a template.

        This endpoint only works when the network is not yet initialized.
        It copies template files to the workspace directory.

        Request body:
            {
                "template_name": "research_team"
            }

        Returns:
            JSON response with success status
        """
        try:
            if not self.network_instance:
                return web.json_response(
                    {"success": False, "message": "Network instance not available"},
                    status=500
                )

            # Check if network is already initialized
            if getattr(self.network_instance.config, 'initialized', False):
                return web.json_response(
                    {"success": False, "message": "Network already initialized"},
                    status=400
                )

            # Parse request body
            try:
                data = await request.json()
            except json.JSONDecodeError:
                return web.json_response(
                    {"success": False, "message": "Invalid JSON in request body"},
                    status=400
                )

            template_name = data.get("template_name")
            if not template_name:
                return web.json_response(
                    {"success": False, "message": "template_name is required"},
                    status=400
                )

            # Find template directory
            try:
                from importlib.resources import files
                templates_pkg = files("openagents.templates")
                template_path = templates_pkg / template_name

                # Check if template exists
                if not template_path.is_dir():
                    return web.json_response(
                        {"success": False, "message": f"Template '{template_name}' not found"},
                        status=404
                    )
            except (ModuleNotFoundError, FileNotFoundError):
                # Fallback to file system path
                import openagents
                pkg_path = Path(openagents.__file__).parent
                template_path = pkg_path / "templates" / template_name
                if not template_path.exists() or not template_path.is_dir():
                    return web.json_response(
                        {"success": False, "message": f"Template '{template_name}' not found"},
                        status=404
                    )

            # Get workspace directory from config path
            if not self.network_instance.config_path:
                return web.json_response(
                    {"success": False, "message": "Network config path not available"},
                    status=500
                )

            workspace_dir = Path(self.network_instance.config_path).parent

            # Preserve admin password hash before applying template
            # (template has a default password that we need to replace)
            admin_password_hash = None
            if 'admin' in self.network_instance.config.agent_groups:
                admin_password_hash = self.network_instance.config.agent_groups['admin'].password_hash

            # Copy template files to workspace
            import shutil
            for item in template_path.iterdir():
                if item.name.startswith('__'):  # Skip __pycache__, __init__.py, etc.
                    continue

                dest_path = workspace_dir / item.name
                if item.is_file():
                    # Read content from package resource and write to file
                    if hasattr(item, 'read_text'):
                        content = item.read_text()
                        with open(dest_path, 'w') as f:
                            f.write(content)
                    else:
                        shutil.copy2(item, dest_path)
                elif item.is_dir():
                    if dest_path.exists():
                        shutil.rmtree(dest_path)
                    if hasattr(item, 'iterdir'):
                        # Package resource - copy recursively
                        dest_path.mkdir(parents=True, exist_ok=True)
                        self._copy_package_dir(item, dest_path)
                    else:
                        shutil.copytree(item, dest_path, dirs_exist_ok=True)

            logger.info(f"Template '{template_name}' applied to workspace: {workspace_dir}")

            # Restore admin password hash in the copied network.yaml
            if admin_password_hash:
                config_file = workspace_dir / "network.yaml"
                if config_file.exists():
                    import yaml
                    with open(config_file, 'r') as f:
                        config_data = yaml.safe_load(f)

                    # Update admin password hash in the config
                    if 'network' in config_data and 'agent_groups' in config_data['network']:
                        if 'admin' in config_data['network']['agent_groups']:
                            config_data['network']['agent_groups']['admin']['password_hash'] = admin_password_hash
                            logger.info("Restored admin password hash in network.yaml")

                    with open(config_file, 'w') as f:
                        yaml.dump(config_data, f, default_flow_style=False, sort_keys=False)

            # Full network restart (not hot reload) to ensure clean state
            # Run in background to avoid blocking the HTTP response
            logger.info("Scheduling full network restart with template configuration...")

            async def _do_restart():
                """Execute network restart in background."""
                try:
                    # Small delay to allow the HTTP response to be sent first
                    await asyncio.sleep(0.5)
                    restart_success = await self.network_instance.restart()
                    if restart_success:
                        logger.info(f"Network restart completed successfully with template '{template_name}'")
                    else:
                        logger.error(f"Network restart failed for template '{template_name}'")
                except Exception as e:
                    logger.error(f"Network restart background task failed: {e}", exc_info=True)

            # Schedule the restart task but don't await it
            asyncio.create_task(_do_restart())

            # Return immediately - client should expect to reconnect
            return web.json_response({
                "success": True,
                "message": f"Template '{template_name}' applied. Network is restarting - please reconnect.",
                "template": template_name,
                "network_restarting": True
            })

        except Exception as e:
            logger.error(f"Failed to apply template: {e}", exc_info=True)
            return web.json_response(
                {"success": False, "message": f"Failed to apply template: {str(e)}"},
                status=500
            )

    def _copy_package_dir(self, src_dir, dest_dir: Path):
        """Recursively copy a package resource directory to a filesystem path."""
        for item in src_dir.iterdir():
            if item.name.startswith('__'):
                continue
            dest_path = dest_dir / item.name
            if item.is_file():
                if hasattr(item, 'read_text'):
                    try:
                        content = item.read_text()
                        with open(dest_path, 'w') as f:
                            f.write(content)
                    except UnicodeDecodeError:
                        # Binary file
                        content = item.read_bytes()
                        with open(dest_path, 'wb') as f:
                            f.write(content)
                else:
                    import shutil
                    shutil.copy2(item, dest_path)
            elif item.is_dir():
                dest_path.mkdir(parents=True, exist_ok=True)
                self._copy_package_dir(item, dest_path)

    async def initialize_model_config(self, request):
        """Initialize default LLM model configuration.

        This endpoint saves the default LLM configuration to global environment
        variables that will be used by all agents.

        Request body:
            {
                "provider": "openai",
                "model_name": "gpt-4",
                "api_key": "sk-..."
            }

        Returns:
            JSON response with success status
        """
        try:
            if not self.network_instance:
                return web.json_response(
                    {"success": False, "message": "Network instance not available"},
                    status=500
                )

            if not hasattr(self.network_instance, "agent_manager") or not self.network_instance.agent_manager:
                return web.json_response(
                    {"success": False, "message": "Agent manager not available"},
                    status=503
                )

            # Parse request body
            try:
                data = await request.json()
            except json.JSONDecodeError:
                return web.json_response(
                    {"success": False, "message": "Invalid JSON in request body"},
                    status=400
                )

            provider = data.get("provider")
            model_name = data.get("model_name")
            api_key = data.get("api_key")

            if not provider:
                return web.json_response(
                    {"success": False, "message": "provider is required"},
                    status=400
                )

            # Build environment variables
            env_vars = {}

            if provider:
                env_vars["DEFAULT_LLM_PROVIDER"] = provider

            if model_name:
                env_vars["DEFAULT_LLM_MODEL_NAME"] = model_name

            if api_key:
                env_vars["DEFAULT_LLM_API_KEY"] = api_key

            # Get existing global env vars and merge
            agent_manager = self.network_instance.agent_manager
            existing_env = agent_manager.get_global_env_vars()
            existing_env.update(env_vars)

            # Save merged env vars
            result = agent_manager.set_global_env_vars(existing_env)

            if not result.get("success"):
                return web.json_response(
                    {"success": False, "message": result.get("message", "Failed to save model config")},
                    status=500
                )

            logger.info(f"Model config initialized: provider={provider}, model={model_name}")
            return web.json_response({
                "success": True,
                "message": "Model configuration saved successfully",
                "config": {
                    "provider": provider,
                    "model_name": model_name,
                    "api_key_set": bool(api_key)
                }
            })

        except Exception as e:
            logger.error(f"Failed to initialize model config: {e}", exc_info=True)
            return web.json_response(
                {"success": False, "message": f"Failed to initialize model config: {str(e)}"},
                status=500
            )

    async def get_default_model(self, request):
        """Get the current default LLM model configuration.

        Returns:
            JSON response with current model config
        """
        try:
            if not self.network_instance:
                return web.json_response(
                    {"success": False, "error_message": "Network instance not available"},
                    status=500
                )

            if not hasattr(self.network_instance, "agent_manager") or not self.network_instance.agent_manager:
                return web.json_response(
                    {"success": False, "error_message": "Agent manager not available"},
                    status=503
                )

            agent_manager = self.network_instance.agent_manager
            env_vars = agent_manager.get_global_env_vars()

            provider = env_vars.get("DEFAULT_LLM_PROVIDER", "")
            model_name = env_vars.get("DEFAULT_LLM_MODEL_NAME", "")
            api_key = env_vars.get("DEFAULT_LLM_API_KEY", "")
            base_url = env_vars.get("DEFAULT_LLM_BASE_URL", "")

            return web.json_response({
                "success": True,
                "config": {
                    "provider": provider,
                    "model_name": model_name,
                    "api_key": api_key,
                    "base_url": base_url
                }
            })

        except Exception as e:
            logger.error(f"Failed to get default model config: {e}", exc_info=True)
            return web.json_response(
                {"success": False, "error_message": f"Failed to get default model config: {str(e)}"},
                status=500
            )

    async def save_default_model(self, request):
        """Save the default LLM model configuration.

        Request body:
            {
                "provider": "openai",
                "model_name": "gpt-4",
                "api_key": "sk-...",
                "base_url": "https://..." (optional)
            }

        Returns:
            JSON response with success status
        """
        try:
            if not self.network_instance:
                return web.json_response(
                    {"success": False, "error_message": "Network instance not available"},
                    status=500
                )

            if not hasattr(self.network_instance, "agent_manager") or not self.network_instance.agent_manager:
                return web.json_response(
                    {"success": False, "error_message": "Agent manager not available"},
                    status=503
                )

            # Parse request body
            try:
                data = await request.json()
            except json.JSONDecodeError:
                return web.json_response(
                    {"success": False, "error_message": "Invalid JSON in request body"},
                    status=400
                )

            provider = data.get("provider")
            model_name = data.get("model_name")
            api_key = data.get("api_key")
            base_url = data.get("base_url")

            if not provider:
                return web.json_response(
                    {"success": False, "error_message": "provider is required"},
                    status=400
                )

            # Build environment variables
            env_vars = {}

            if provider:
                env_vars["DEFAULT_LLM_PROVIDER"] = provider

            if model_name:
                env_vars["DEFAULT_LLM_MODEL_NAME"] = model_name

            if api_key:
                env_vars["DEFAULT_LLM_API_KEY"] = api_key

            if base_url:
                env_vars["DEFAULT_LLM_BASE_URL"] = base_url

            # Get existing global env vars and merge
            agent_manager = self.network_instance.agent_manager
            existing_env = agent_manager.get_global_env_vars()
            existing_env.update(env_vars)

            # Save merged env vars
            result = agent_manager.set_global_env_vars(existing_env)

            if not result.get("success"):
                return web.json_response(
                    {"success": False, "error_message": result.get("message", "Failed to save model config")},
                    status=500
                )

            logger.info(f"Default model config saved: provider={provider}, model={model_name}")
            return web.json_response({
                "success": True,
                "message": "Model configuration saved successfully",
                "config": {
                    "provider": provider,
                    "model_name": model_name,
                    "api_key_set": bool(api_key),
                    "base_url": base_url or ""
                }
            })

        except Exception as e:
            logger.error(f"Failed to save default model config: {e}", exc_info=True)
            return web.json_response(
                {"success": False, "error_message": f"Failed to save default model config: {str(e)}"},
                status=500
            )

    async def delete_default_model(self, request):
        """Delete/clear the default LLM model configuration.

        Returns:
            JSON response with success status
        """
        try:
            if not self.network_instance:
                return web.json_response(
                    {"success": False, "error_message": "Network instance not available"},
                    status=500
                )

            if not hasattr(self.network_instance, "agent_manager") or not self.network_instance.agent_manager:
                return web.json_response(
                    {"success": False, "error_message": "Agent manager not available"},
                    status=503
                )

            agent_manager = self.network_instance.agent_manager
            existing_env = agent_manager.get_global_env_vars()

            # Remove default model keys
            keys_to_remove = ["DEFAULT_LLM_PROVIDER", "DEFAULT_LLM_MODEL_NAME", "DEFAULT_LLM_API_KEY", "DEFAULT_LLM_BASE_URL"]
            for key in keys_to_remove:
                existing_env.pop(key, None)

            # Save updated env vars
            result = agent_manager.set_global_env_vars(existing_env)

            if not result.get("success"):
                return web.json_response(
                    {"success": False, "error_message": result.get("message", "Failed to clear model config")},
                    status=500
                )

            logger.info("Default model config cleared")
            return web.json_response({
                "success": True,
                "message": "Model configuration cleared successfully"
            })

        except Exception as e:
            logger.error(f"Failed to clear default model config: {e}", exc_info=True)
            return web.json_response(
                {"success": False, "error_message": f"Failed to clear default model config: {str(e)}"},
                status=500
            )

    async def test_default_model(self, request):
        """Test the default LLM model configuration with a simple inference query.

        Request body:
            {
                "provider": "openai",
                "model_name": "gpt-4",
                "api_key": "sk-...",
                "base_url": "https://..." (optional)
            }

        Returns:
            JSON response with test results including:
            - success: whether the test was successful
            - inference_works: whether basic inference completed
            - supports_tool_use: whether the model supports tool calling
            - response: the model's response text
            - error_message: error details if failed
        """
        try:
            # Parse request body
            try:
                data = await request.json()
            except json.JSONDecodeError:
                return web.json_response(
                    {"success": False, "error_message": "Invalid JSON in request body"},
                    status=400
                )

            provider = data.get("provider")
            model_name = data.get("model_name")
            api_key = data.get("api_key")
            base_url = data.get("base_url")

            if not provider:
                return web.json_response(
                    {"success": False, "error_message": "provider is required"},
                    status=400
                )

            if not model_name:
                return web.json_response(
                    {"success": False, "error_message": "model_name is required"},
                    status=400
                )

            if not api_key:
                return web.json_response(
                    {"success": False, "error_message": "api_key is required"},
                    status=400
                )

            # Import the model provider creation function
            from openagents.config.llm_configs import create_model_provider, MODEL_CONFIGS

            # Determine the effective provider and api_base
            effective_provider = provider
            effective_api_base = base_url

            # For providers that have predefined API bases, use them
            if not effective_api_base and provider in MODEL_CONFIGS:
                effective_api_base = MODEL_CONFIGS[provider].get("api_base")

            # Test 1: Basic inference test
            inference_works = False
            inference_response = None
            inference_error = None

            try:
                model_provider = create_model_provider(
                    provider=effective_provider,
                    model_name=model_name,
                    api_base=effective_api_base,
                    api_key=api_key
                )

                # Simple test message
                test_messages = [
                    {"role": "user", "content": "Say 'Hello, OpenAgents!' and nothing else."}
                ]

                result = await model_provider.chat_completion(messages=test_messages)
                inference_response = result.get("content", "")
                inference_works = True
                logger.info(f"Model inference test passed for {provider}/{model_name}")

            except Exception as e:
                inference_error = str(e)
                logger.warning(f"Model inference test failed for {provider}/{model_name}: {e}")

            # Test 2: Tool use support test (only if basic inference works)
            supports_tool_use = False
            tool_use_response = None
            tool_use_error = None

            if inference_works:
                try:
                    # Define a simple test tool
                    test_tool = {
                        "name": "get_current_time",
                        "description": "Get the current time",
                        "parameters": {
                            "type": "object",
                            "properties": {},
                            "required": []
                        }
                    }

                    # Test message that should trigger tool use
                    tool_test_messages = [
                        {"role": "user", "content": "What time is it? Use the get_current_time tool."}
                    ]

                    result = await model_provider.chat_completion(
                        messages=tool_test_messages,
                        tools=[test_tool]
                    )

                    # Check if tool calls were made
                    tool_calls = result.get("tool_calls", [])
                    if tool_calls and len(tool_calls) > 0:
                        supports_tool_use = True
                        tool_use_response = f"Tool call detected: {tool_calls[0].get('name', 'unknown')}"
                        logger.info(f"Tool use test passed for {provider}/{model_name}")
                    else:
                        # Model responded but didn't use tools - might still support them
                        # Check if response mentions the tool or time
                        content = result.get("content", "")
                        tool_use_response = content[:200] if content else "No tool call made"
                        logger.info(f"Tool use test: model responded without using tools for {provider}/{model_name}")

                except Exception as e:
                    tool_use_error = str(e)
                    # Some models might not support tool use at all
                    logger.info(f"Tool use test failed for {provider}/{model_name}: {e}")

            # Build response
            response_data = {
                "success": inference_works,
                "inference_works": inference_works,
                "supports_tool_use": supports_tool_use,
            }

            if inference_works:
                response_data["response"] = inference_response
                response_data["tool_use_response"] = tool_use_response
            else:
                response_data["error_message"] = inference_error or "Unknown error during inference test"

            if tool_use_error and not supports_tool_use:
                response_data["tool_use_error"] = tool_use_error

            return web.json_response(response_data)

        except Exception as e:
            logger.error(f"Failed to test model config: {e}", exc_info=True)
            return web.json_response(
                {"success": False, "error_message": f"Failed to test model config: {str(e)}"},
                status=500
            )

    async def list_templates(self, request):
        """List available network templates.

        Returns:
            JSON response with list of templates and their descriptions
        """
        try:
            templates = []

            # Try to load templates from package resources
            try:
                from importlib.resources import files
                templates_pkg = files("openagents.templates")

                for item in templates_pkg.iterdir():
                    if item.is_dir() and not item.name.startswith('__'):
                        # Try to get description from README or network.yaml
                        description = f"{item.name} template"
                        try:
                            readme_file = item / "README.md"
                            if hasattr(readme_file, 'read_text'):
                                readme_content = readme_file.read_text()
                                # Get first non-empty, non-header line
                                for line in readme_content.split('\n'):
                                    line = line.strip()
                                    if line and not line.startswith('#'):
                                        description = line[:200]  # Truncate to 200 chars
                                        break
                        except (FileNotFoundError, TypeError):
                            pass

                        templates.append({
                            "name": item.name,
                            "description": description
                        })
            except (ModuleNotFoundError, FileNotFoundError):
                # Fallback to file system path
                import openagents
                pkg_path = Path(openagents.__file__).parent
                templates_dir = pkg_path / "templates"

                if templates_dir.exists():
                    for item in templates_dir.iterdir():
                        if item.is_dir() and not item.name.startswith('__'):
                            description = f"{item.name} template"
                            readme_path = item / "README.md"
                            if readme_path.exists():
                                try:
                                    with open(readme_path, 'r') as f:
                                        readme_content = f.read()
                                    for line in readme_content.split('\n'):
                                        line = line.strip()
                                        if line and not line.startswith('#'):
                                            description = line[:200]
                                            break
                                except Exception:
                                    pass

                            templates.append({
                                "name": item.name,
                                "description": description
                            })

            return web.json_response({
                "success": True,
                "templates": templates
            })

        except Exception as e:
            logger.error(f"Failed to list templates: {e}", exc_info=True)
            return web.json_response(
                {"success": False, "message": f"Failed to list templates: {str(e)}"},
                status=500
            )


def _generate_event_examples(event: Dict[str, Any]) -> Dict[str, str]:
    """Generate code examples for an event."""
    event_name = event.get('event_name', '')
    event_type = event.get('event_type', 'operation')
    request_schema = event.get('request_schema', {})

    # Python example
    python_example = f"""# Python example
from openagents import Agent

agent = Agent(agent_id="my_agent")
response = await agent.send_event(
    event_name="{event_name}",
    destination_id="mod:openagents.mods.{event.get('mod_id', 'unknown')}",
    payload={{
        # Add your payload here based on the schema
"""

    # Add payload fields from schema
    if request_schema and 'properties' in request_schema:
        for prop_name, prop_info in request_schema['properties'].items():
            if isinstance(prop_info, dict):
                prop_type = prop_info.get('type', 'string')
                is_required = prop_info.get('required', False)
                default = prop_info.get('default')

                if default is not None:
                    python_example += f'        "{prop_name}": {repr(default)},  # {prop_type}\n'
                elif is_required:
                    python_example += f'        "{prop_name}": "value",  # {prop_type} (required)\n'
                else:
                    python_example += f'        # "{prop_name}": "value",  # {prop_type} (optional)\n'

    python_example += """    }
)
print(response)
"""

    # JavaScript example
    js_example = f"""// JavaScript example
const response = await connector.sendEvent({{
    event_name: "{event_name}",
    destination_id: "mod:openagents.mods.{event.get('mod_id', 'unknown')}",
    payload: {{
        // Add your payload here based on the schema
"""

    if request_schema and 'properties' in request_schema:
        for prop_name, prop_info in request_schema['properties'].items():
            if isinstance(prop_info, dict):
                prop_type = prop_info.get('type', 'string')
                is_required = prop_info.get('required', False)
                default = prop_info.get('default')

                if default is not None:
                    js_example += f'        {prop_name}: {repr(default)},  // {prop_type}\n'
                elif is_required:
                    js_example += f'        {prop_name}: "value",  // {prop_type} (required)\n'
                else:
                    js_example += f'        // {prop_name}: "value",  // {prop_type} (optional)\n'

    js_example += """    }
});
console.log(response);
"""

    return {
        "python": python_example,
        "javascript": js_example,
    }


# Convenience function for creating HTTP transport
def create_http_transport(
    host: str = "0.0.0.0", port: int = 8080, **kwargs
) -> HttpTransport:
    """Create an HTTP transport with given configuration."""
    config = {"host": host, "port": port, **kwargs}
    return HttpTransport(config)
