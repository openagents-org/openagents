"""
MCP (Model Context Protocol) Transport Implementation for OpenAgents.

This module provides an MCP server transport that exposes network tools
and instructions to external agents via Streamable HTTP (MCP 2025-03-26).
"""

import asyncio
import json
import os
import logging
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, Any, Optional, List, TYPE_CHECKING

from aiohttp import web

from .base import Transport
from openagents.models.network_context import NetworkContext
from openagents.models.transport import TransportType
from openagents.models.event import Event
from openagents.utils.network_tool_collector import NetworkToolCollector
from openagents.models.external_access import ExternalAccessConfig

if TYPE_CHECKING:
    from openagents.core.network import AgentNetwork

logger = logging.getLogger(__name__)

# MCP Protocol version
MCP_PROTOCOL_VERSION = "2025-03-26"


@dataclass
class MCPSession:
    """Represents an MCP client session."""

    session_id: str
    is_active: bool = True
    initialized: bool = False
    sse_response: Optional[web.StreamResponse] = None
    pending_notifications: List[Dict[str, Any]] = field(default_factory=list)


class MCPTransport(Transport):
    """
    MCP transport implementation using Streamable HTTP (MCP 2025-03-26).

    This transport exposes network tools and instructions to external agents
    via the Model Context Protocol. It runs an HTTP server with a single /mcp
    endpoint supporting POST (requests), GET (SSE notifications), and DELETE
    (session termination).
    """

    def __init__(
        self,
        config: Optional[Dict[str, Any]] = None,
        network: Optional["AgentNetwork"] = None,
        context: Optional[NetworkContext] = None,
    ):
        """Initialize MCP transport.

        Args:
            config: Transport configuration including:
                - port: Port to listen on (default: 8800)
                - endpoint: MCP endpoint path (default: /mcp)
                - auth_token: Optional bearer token for authentication
                - auth_token_env: Optional env var name for auth token
            network: DEPRECATED - Use context instead. The network instance to collect tools from.
            context: NetworkContext providing shared network data and callbacks.
        """
        super().__init__(TransportType.MCP, config, is_notifiable=False)
        self.context = context
        # Keep network reference for backward compatibility
        self._network = network
        self.port = self.config.get("port", 8800)
        self.endpoint = self.config.get("endpoint", "/mcp")

        self.app = web.Application(middlewares=[self._cors_middleware])
        self.site = None
        self.runner = None
        self.tool_collector: Optional[NetworkToolCollector] = None

        # Session management
        self._sessions: Dict[str, MCPSession] = {}

        # MCP server state
        self._mcp_available = False

        self._setup_routes()

    def _get_auth_token(self) -> Optional[str]:
        """Get auth token from external_access config or environment.

        Priority: external_access.auth_token → external_access.auth_token_env → None
        If auth_token is set, authentication is required for MCP access.
        """
        external_access = self._get_external_access_config()
        if external_access:
            if external_access.auth_token:
                return external_access.auth_token
            if external_access.auth_token_env:
                return os.environ.get(external_access.auth_token_env)
        return None

    def _get_network_name(self) -> str:
        """Get network name from context or network."""
        if self.context and self.context.network_name:
            return self.context.network_name
        if self._network:
            return self._network.network_name
        return "OpenAgents"

    def _get_external_access_config(self) -> Optional[ExternalAccessConfig]:
        """Get external_access configuration from context or network config."""
        # Prefer context if available
        if self.context:
            external_access = self.context.external_access
            if external_access is None:
                return None
            # Handle both dict and ExternalAccessConfig - Pydantic v2 may not auto-convert
            if isinstance(external_access, dict):
                return ExternalAccessConfig(**external_access)
            return external_access

        # Fallback to legacy network access
        if not self._network:
            return None
        config = getattr(self._network, "config", None)
        if config:
            external_access = getattr(config, "external_access", None)
            if external_access is None:
                return None
            # Handle both dict and ExternalAccessConfig - Pydantic v2 may not auto-convert
            if isinstance(external_access, dict):
                return ExternalAccessConfig(**external_access)
            return external_access
        return None

    @web.middleware
    async def _cors_middleware(self, request: web.Request, handler):
        """CORS middleware for browser compatibility."""
        if request.method == "OPTIONS":
            response = web.Response()
        else:
            response = await handler(request)

        response.headers["Access-Control-Allow-Origin"] = "*"
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, DELETE, OPTIONS"
        response.headers["Access-Control-Allow-Headers"] = (
            "Content-Type, Authorization, Accept, Mcp-Session-Id"
        )
        response.headers["Access-Control-Expose-Headers"] = "Mcp-Session-Id"
        response.headers["Access-Control-Max-Age"] = "86400"
        return response

    def _setup_routes(self):
        """Setup HTTP routes for MCP Streamable HTTP transport."""
        # Single /mcp endpoint for Streamable HTTP (MCP 2025-03-26)
        self.app.router.add_post(self.endpoint, self._handle_post)
        self.app.router.add_get(self.endpoint, self._handle_get)
        self.app.router.add_delete(self.endpoint, self._handle_delete)
        # Info endpoint for debugging
        self.app.router.add_get("/", self._handle_root)
        # Tools list endpoint for debugging
        self.app.router.add_get("/tools", self._handle_tools_list)

    def _check_auth(self, request: web.Request) -> Optional[web.Response]:
        """Check authentication if required.

        Authentication is required only if auth_token is configured in external_access.

        Returns:
            Error response if auth fails, None if auth passes
        """
        expected_token = self._get_auth_token()
        if not expected_token:
            # No auth configured - allow access
            return None

        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            return web.Response(
                status=401,
                text="Unauthorized: Missing Bearer token",
                headers={"WWW-Authenticate": "Bearer"},
            )

        token = auth_header[7:]
        if token != expected_token:
            return web.Response(
                status=401,
                text="Unauthorized: Invalid token",
                headers={"WWW-Authenticate": "Bearer"},
            )

        return None

    async def _handle_root(self, request: web.Request) -> web.Response:
        """Handle root path with MCP server info."""
        network_name = self._get_network_name()
        tool_count = self.tool_collector.tool_count if self.tool_collector else 0

        info = {
            "server": "OpenAgents MCP Server",
            "network": network_name,
            "protocol": "MCP",
            "protocol_version": MCP_PROTOCOL_VERSION,
            "transport": "Streamable HTTP",
            "tools_count": tool_count,
            "endpoints": {
                "mcp": self.endpoint,
                "tools": "/tools",
            },
        }
        return web.json_response(info)

    async def _handle_tools_list(self, request: web.Request) -> web.Response:
        """Handle tools list request (debugging endpoint)."""
        auth_error = self._check_auth(request)
        if auth_error:
            return auth_error

        if not self.tool_collector:
            return web.json_response({"tools": [], "error": "Tool collector not initialized"})

        # Use filtered tools based on external_access config
        external_access = self._get_external_access_config()
        exposed_tools = external_access.exposed_tools if external_access else None
        excluded_tools = external_access.excluded_tools if external_access else None

        tools = self.tool_collector.to_mcp_tools_filtered(exposed_tools, excluded_tools)
        return web.json_response({"tools": tools})

    async def _handle_post(self, request: web.Request) -> web.Response:
        """Handle POST requests (JSON-RPC messages) for Streamable HTTP."""
        auth_error = self._check_auth(request)
        if auth_error:
            return auth_error

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
                self._jsonrpc_error(None, -32700, "Parse error"),
                status=400,
            )

        # Get or validate session
        session_id = request.headers.get("Mcp-Session-Id")
        method = body.get("method", "")

        # Initialize request creates new session
        if method == "initialize":
            session_id = str(uuid.uuid4())
            self._sessions[session_id] = MCPSession(session_id=session_id)
            logger.info(f"Created new MCP session: {session_id}")
        elif session_id and session_id not in self._sessions:
            # Invalid session ID for non-initialize request
            return web.Response(status=404, text="Invalid session ID")

        # Process JSON-RPC request
        response_data = await self._process_jsonrpc(body, session_id)

        # Build response headers
        headers = {}
        if method == "initialize" and session_id:
            headers["Mcp-Session-Id"] = session_id

        return web.json_response(response_data, headers=headers)

    async def _handle_get(self, request: web.Request) -> web.Response:
        """Handle GET requests (SSE stream for server notifications)."""
        auth_error = self._check_auth(request)
        if auth_error:
            return auth_error

        session_id = request.headers.get("Mcp-Session-Id")
        if not session_id or session_id not in self._sessions:
            return web.Response(status=404, text="Invalid or missing session")

        session = self._sessions[session_id]

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
                    await self._send_sse_event(response, notification)

                # Wait a bit before checking again
                await asyncio.sleep(0.1)

                # Check if client disconnected
                if response.task and response.task.done():
                    break

        except (ConnectionResetError, asyncio.CancelledError):
            logger.debug(f"SSE connection closed for session {session_id}")
        finally:
            session.sse_response = None

        return response

    async def _handle_delete(self, request: web.Request) -> web.Response:
        """Handle DELETE requests (session termination)."""
        session_id = request.headers.get("Mcp-Session-Id")
        if session_id and session_id in self._sessions:
            session = self._sessions[session_id]
            session.is_active = False
            del self._sessions[session_id]
            logger.info(f"Terminated MCP session: {session_id}")
            return web.Response(status=200, text="Session terminated")
        return web.Response(status=404, text="Session not found")

    async def _send_sse_event(self, response: web.StreamResponse, data: Dict[str, Any]):
        """Send an SSE event to the client."""
        event_data = f"data: {json.dumps(data)}\n\n"
        await response.write(event_data.encode("utf-8"))

    def _jsonrpc_error(
        self, id: Optional[Any], code: int, message: str, data: Any = None
    ) -> Dict[str, Any]:
        """Create a JSON-RPC error response."""
        error = {"code": code, "message": message}
        if data is not None:
            error["data"] = data
        return {"jsonrpc": "2.0", "id": id, "error": error}

    def _jsonrpc_result(self, id: Any, result: Any) -> Dict[str, Any]:
        """Create a JSON-RPC result response."""
        return {"jsonrpc": "2.0", "id": id, "result": result}

    async def _process_jsonrpc(
        self, body: Dict[str, Any], session_id: Optional[str]
    ) -> Dict[str, Any]:
        """Process a JSON-RPC request and return the response."""
        request_id = body.get("id")
        method = body.get("method", "")
        params = body.get("params", {})

        try:
            if method == "initialize":
                return await self._handle_initialize(request_id, params)
            elif method == "initialized":
                # Client notification that initialization is complete
                if session_id and session_id in self._sessions:
                    self._sessions[session_id].initialized = True
                return self._jsonrpc_result(request_id, {})
            elif method == "tools/list":
                return await self._handle_tools_list_rpc(request_id)
            elif method == "tools/call":
                return await self._handle_tools_call(request_id, params)
            elif method == "ping":
                return self._jsonrpc_result(request_id, {})
            else:
                return self._jsonrpc_error(
                    request_id, -32601, f"Method not found: {method}"
                )
        except Exception as e:
            logger.error(f"Error processing JSON-RPC request: {e}")
            return self._jsonrpc_error(request_id, -32603, f"Internal error: {str(e)}")

    async def _handle_initialize(
        self, request_id: Any, params: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Handle MCP initialize request."""
        network_name = self._get_network_name()
        instructions = self._get_instructions()

        result = {
            "protocolVersion": MCP_PROTOCOL_VERSION,
            "capabilities": {
                "tools": {"listChanged": False},
            },
            "serverInfo": {
                "name": network_name,
                "version": "1.0.0",
            },
            "instructions": instructions,
        }
        return self._jsonrpc_result(request_id, result)

    async def _handle_tools_list_rpc(self, request_id: Any) -> Dict[str, Any]:
        """Handle tools/list JSON-RPC request."""
        if not self.tool_collector:
            return self._jsonrpc_result(request_id, {"tools": []})

        # Use filtered tools based on external_access config
        external_access = self._get_external_access_config()
        exposed_tools = external_access.exposed_tools if external_access else None
        excluded_tools = external_access.excluded_tools if external_access else None

        tools = []
        for tool_dict in self.tool_collector.to_mcp_tools_filtered(exposed_tools, excluded_tools):
            tools.append({
                "name": tool_dict["name"],
                "description": tool_dict["description"],
                "inputSchema": tool_dict["inputSchema"],
            })

        return self._jsonrpc_result(request_id, {"tools": tools})

    async def _handle_tools_call(
        self, request_id: Any, params: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Handle tools/call JSON-RPC request."""
        tool_name = params.get("name")
        arguments = params.get("arguments", {})

        if not tool_name:
            return self._jsonrpc_error(request_id, -32602, "Missing tool name")

        if not self.tool_collector:
            return self._jsonrpc_error(
                request_id, -32603, "Tool collector not initialized"
            )

        # Check if tool is in the filtered (allowed) list
        external_access = self._get_external_access_config()
        exposed_tools = external_access.exposed_tools if external_access else None
        excluded_tools = external_access.excluded_tools if external_access else None
        filtered_tools = self.tool_collector.filter_tools(exposed_tools, excluded_tools)
        allowed_tool_names = {t.name for t in filtered_tools}

        if tool_name not in allowed_tool_names:
            return self._jsonrpc_error(
                request_id, -32602, f"Tool not found: {tool_name}"
            )

        tool = self.tool_collector.get_tool_by_name(tool_name)
        if not tool:
            return self._jsonrpc_error(
                request_id, -32602, f"Tool not found: {tool_name}"
            )

        try:
            result = await tool.execute(**arguments)
            return self._jsonrpc_result(
                request_id,
                {
                    "content": [{"type": "text", "text": str(result)}],
                    "isError": False,
                },
            )
        except Exception as e:
            logger.error(f"Error executing tool '{tool_name}': {e}")
            return self._jsonrpc_result(
                request_id,
                {
                    "content": [{"type": "text", "text": f"Error: {str(e)}"}],
                    "isError": True,
                },
            )

    def _get_instructions(self) -> str:
        """Get instructions with priority: external_access.instruction → network_profile.readme → description."""
        network_name = self._get_network_name()

        # 1. Check external_access.instruction (highest priority)
        external_access = self._get_external_access_config()
        if external_access and external_access.instruction:
            instruction = external_access.instruction
            # If it's a file path, read it
            if instruction.endswith(".md") or instruction.endswith(".txt"):
                path = Path(instruction)
                workspace_path = self._get_workspace_path()
                if not path.is_absolute() and workspace_path:
                    path = Path(workspace_path) / instruction
                if path.exists():
                    try:
                        return path.read_text()
                    except Exception as e:
                        logger.warning(f"Failed to read instruction file {path}: {e}")
            else:
                return instruction

        # Get network_profile from context or network
        network_profile = None
        if self.context:
            network_profile = self.context.network_profile
        elif self._network:
            network_profile = getattr(self._network.config, "network_profile", None)
            if not network_profile and hasattr(self._network, "network_profile"):
                network_profile = self._network.network_profile

        if network_profile:
            # 2. Check readme (second priority)
            readme = getattr(network_profile, "readme", None)
            if readme:
                return readme

            # 3. Fall back to description (third priority)
            description = getattr(network_profile, "description", None)
            if description:
                return description

        # 4. Default
        return f"OpenAgents Network: {network_name}"

    async def initialize(self) -> bool:
        """Initialize MCP transport."""
        if not self.context and not self._network:
            logger.error("Cannot initialize MCP transport without context or network reference")
            return False

        # Get workspace path from context or network (for workspace tools and event tools)
        workspace_path = self._get_workspace_path()

        # Initialize tool collector with context (preferred) or network
        self.tool_collector = NetworkToolCollector(
            network=self._network,
            workspace_path=workspace_path,
            context=self.context,
        )

        # Collect tools (this will fail on conflicts)
        try:
            self.tool_collector.collect_all_tools()
            logger.info(
                f"MCP transport collected {self.tool_collector.tool_count} tools: "
                f"{self.tool_collector.tool_names}"
            )
        except ValueError as e:
            logger.error(f"Tool collection failed: {e}")
            raise

        self._mcp_available = True
        self.is_initialized = True
        logger.info(f"MCP Streamable HTTP transport initialized (protocol {MCP_PROTOCOL_VERSION})")
        return True

    def _get_workspace_path(self) -> Optional[str]:
        """Get the workspace path for loading tools and events.

        Priority:
        1. Context workspace_path (if context provided)
        2. Network config_path parent directory (original workspace)
        3. Network workspace_manager path
        """
        # Prefer context if available
        if self.context:
            return self.context.workspace_path

        # Fallback to legacy network access
        if not self._network:
            return None

        # Try config_path first (original workspace where network.yaml is located)
        config_path = getattr(self._network, "config_path", None)
        if config_path:
            return str(Path(config_path).parent)

        # Fallback to workspace_manager
        workspace_manager = getattr(self._network, "workspace_manager", None)
        if workspace_manager:
            return str(workspace_manager.workspace_path)

        return None

    async def shutdown(self) -> bool:
        """Shutdown MCP transport."""
        self.is_initialized = False
        self.is_listening = False

        # Close all active sessions
        for session_id, session in list(self._sessions.items()):
            session.is_active = False
        self._sessions.clear()

        if self.site:
            await self.site.stop()
            self.site = None

        if self.runner:
            await self.runner.cleanup()
            self.runner = None

        logger.info("MCP transport shutdown complete")
        return True

    async def listen(self, address: str) -> bool:
        """Start listening for MCP connections.

        Args:
            address: Address in format "host:port" (port from config takes precedence)
        """
        # If port is None/null, skip standalone server binding
        # MCP can still be served via HTTP transport's serve_mcp option
        if self.port is None:
            logger.info("MCP transport: standalone port disabled (port: null), skipping listen")
            self.is_listening = False
            return True

        try:
            host = "0.0.0.0"
            if ":" in address:
                host, _ = address.split(":", 1)

            self.runner = web.AppRunner(self.app)
            await self.runner.setup()
            self.site = web.TCPSite(self.runner, host, self.port)
            await self.site.start()

            self.is_listening = True
            logger.info(f"MCP Streamable HTTP transport listening on {host}:{self.port}")
            logger.info(f"MCP endpoint: http://{host}:{self.port}{self.endpoint}")
            logger.info(f"Tools debug endpoint: http://{host}:{self.port}/tools")

            return True

        except Exception as e:
            logger.error(f"Failed to start MCP transport: {e}")
            return False

    async def send(self, message: Event) -> bool:
        """Send an event (not applicable for MCP transport)."""
        # MCP transport is for external tool access, not event routing
        return True

    async def peer_connect(self, peer_id: str, address: str) -> bool:
        """Connect to a peer (not applicable for MCP transport)."""
        return False

    async def peer_disconnect(self, peer_id: str) -> bool:
        """Disconnect from a peer (not applicable for MCP transport)."""
        return False


def create_mcp_transport(
    config: Optional[Dict[str, Any]] = None,
    network: Optional["AgentNetwork"] = None,
    context: Optional[NetworkContext] = None,
) -> MCPTransport:
    """Create an MCP transport instance.

    Args:
        config: Transport configuration
        network: DEPRECATED - Use context instead. Network instance for backward compatibility.
        context: NetworkContext providing shared network data and callbacks.

    Returns:
        Configured MCPTransport instance
    """
    return MCPTransport(config=config, network=network, context=context)
