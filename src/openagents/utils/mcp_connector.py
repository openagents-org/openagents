"""
MCP (Model Context Protocol) connector utilities.

This module provides utilities for connecting to and managing MCP servers,
including stdio, SSE, and HTTP streaming-based servers.
"""

import logging
import os
from typing import Any, Dict, List

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from mcp.client.streamable_http import streamablehttp_client
from mcp.client.sse import sse_client

from openagents.models.mcp_config import MCPServerConfig
from openagents.models.tool import AgentTool

logger = logging.getLogger(__name__)


class MCPConnector:
    """Manages connections to MCP (Model Context Protocol) servers."""
    
    def __init__(self):
        """Initialize the MCP connector."""
        self._mcp_clients: Dict[str, Any] = {}
        self._mcp_tools: List[AgentTool] = []
        self._mcp_sessions: Dict[str, ClientSession] = {}

    async def setup_mcp_clients(self, mcp_configs: List[MCPServerConfig]) -> List[AgentTool]:
        """Setup MCP clients based on configuration.
        
        Args:
            mcp_configs: List of MCP server configurations
            
        Returns:
            List of tools from all connected MCP servers
        """
        if not mcp_configs:
            return []

        logger.info(f"Setting up {len(mcp_configs)} MCP clients")
        
        for mcp_config in mcp_configs:
            try:
                await self._setup_mcp_client(mcp_config)
                logger.info(f"Successfully connected to MCP server: {mcp_config.name}")
            except Exception as e:
                logger.error(f"Failed to setup MCP client '{mcp_config.name}': {e}")
                # Continue with other MCP clients even if one fails

        return self._mcp_tools.copy()

    async def _setup_mcp_client(self, mcp_config: MCPServerConfig):
        """Setup a single MCP client."""
        try:
            if mcp_config.type == "stdio":
                await self._setup_stdio_mcp_client(mcp_config)
            elif mcp_config.type == "sse":
                await self._setup_sse_mcp_client(mcp_config)
            elif mcp_config.type == "streamable_http":
                await self._setup_streamable_http_mcp_client(mcp_config)
            else:
                logger.warning(f"Unsupported MCP server type: {mcp_config.type}")
        except Exception as e:
            logger.error(f"Error setting up MCP client '{mcp_config.name}': {e}")
            raise

    async def _setup_stdio_mcp_client(self, mcp_config: MCPServerConfig):
        """Setup a stdio-based MCP client."""
        if not mcp_config.command:
            raise ValueError(f"Command is required for stdio MCP server '{mcp_config.name}'")

        # Set up environment variables
        env = os.environ.copy()
        if mcp_config.env:
            env.update(mcp_config.env)
        
        if mcp_config.api_key_env:
            api_key = os.getenv(mcp_config.api_key_env)
            if api_key:
                env[mcp_config.api_key_env] = api_key

        try:
            # Create stdio server parameters
            server_params = StdioServerParameters(
                command=mcp_config.command[0],
                args=mcp_config.command[1:] if len(mcp_config.command) > 1 else None,
                env=env
            )
            
            # Use the stdio client from the MCP library
            transport = await stdio_client(server_params).__aenter__()
            read_stream, write_stream = transport
            
            # Create a session over those streams
            session = ClientSession(read_stream, write_stream)
            await session.__aenter__()
            
            # Initialize the session
            await session.initialize()
            
            logger.info(f"Connected to stdio MCP server '{mcp_config.name}'")
            
            # Store the session and transport info
            mcp_client = {
                "name": mcp_config.name,
                "type": "stdio",
                "session": session,
                "transport": transport,
                "config": mcp_config
            }
            
            self._mcp_clients[mcp_config.name] = mcp_client
            self._mcp_sessions[mcp_config.name] = session
            
            # Add tools from this MCP server
            await self._add_mcp_tools(mcp_config.name, session)
            
        except Exception as e:
            logger.error(f"Failed to start stdio MCP server '{mcp_config.name}': {e}")
            raise

    async def _setup_sse_mcp_client(self, mcp_config: MCPServerConfig):
        """Setup an SSE-based MCP client."""
        if not mcp_config.url:
            raise ValueError(f"URL is required for sse MCP server '{mcp_config.name}'")

        try:
            # Use the SSE client from the MCP library
            transport = await sse_client(mcp_config.url).__aenter__()
            read_stream, write_stream = transport
            
            # Create a session over those streams
            session = ClientSession(read_stream, write_stream)
            await session.__aenter__()
            
            # Initialize the session
            await session.initialize()
            
            logger.info(f"Connected to SSE MCP server '{mcp_config.name}'")
            
            # Store the session and transport info
            mcp_client = {
                "name": mcp_config.name,
                "type": "sse",
                "url": mcp_config.url,
                "session": session,
                "transport": transport,
                "config": mcp_config
            }
            
            self._mcp_clients[mcp_config.name] = mcp_client
            self._mcp_sessions[mcp_config.name] = session
            
            # Add tools from this MCP server
            await self._add_mcp_tools(mcp_config.name, session)
            
        except Exception as e:
            logger.error(f"Failed to setup SSE MCP server '{mcp_config.name}': {e}")
            raise

    async def _setup_streamable_http_mcp_client(self, mcp_config: MCPServerConfig):
        """Setup a streamable HTTP-based MCP client."""
        if not mcp_config.url:
            raise ValueError(f"URL is required for streamable_http MCP server '{mcp_config.name}'")

        try:
            # Use the streamable HTTP client from the MCP library
            transport = await streamablehttp_client(mcp_config.url).__aenter__()
            read_stream, write_stream, get_session_id = transport
            
            # Create a session over those streams
            session = ClientSession(read_stream, write_stream)
            await session.__aenter__()
            
            # Initialize the session
            await session.initialize()
            
            session_id = get_session_id()
            logger.info(f"Connected to streamable HTTP MCP server '{mcp_config.name}' with session ID: {session_id}")
            
            # Store the session and transport info
            mcp_client = {
                "name": mcp_config.name,
                "type": "streamable_http",
                "url": mcp_config.url,
                "session": session,
                "transport": transport,
                "session_id": session_id,
                "config": mcp_config
            }
            
            self._mcp_clients[mcp_config.name] = mcp_client
            self._mcp_sessions[mcp_config.name] = session
            
            # Add tools from this MCP server
            await self._add_mcp_tools(mcp_config.name, session)
            
        except Exception as e:
            logger.error(f"Failed to setup streamable HTTP MCP server '{mcp_config.name}': {e}")
            raise

    async def _add_mcp_tools(self, server_name: str, session: 'ClientSession'):
        """Add tools from an MCP session."""
        try:
            # List available tools from the MCP server
            tools_response = await session.list_tools()
            
            for tool in tools_response.tools:
                tool_name = tool.name
                tool_description = tool.description or f"Tool from MCP server {server_name}"
                tool_parameters = tool.inputSchema or {}
                
                # Create AgentAdapterTool for each MCP tool
                adapter_tool = AgentTool(
                    name=f"mcp_{server_name}_{tool_name}",
                    description=tool_description,
                    func=self._create_mcp_session_tool_function(server_name, tool_name),
                    parameters=tool_parameters
                )
                
                self._mcp_tools.append(adapter_tool)
                logger.debug(f"Added MCP tool: {adapter_tool.name}")
                
        except Exception as e:
            logger.error(f"Failed to add MCP tools for '{server_name}': {e}")
            raise

    def _create_mcp_session_tool_function(self, server_name: str, tool_name: str):
        """Create a function for an MCP tool that uses the session."""
        async def mcp_session_tool_function(**kwargs):
            """Execute an MCP tool function via session."""
            logger.info(f"Executing MCP tool '{tool_name}' on server '{server_name}' with args: {kwargs}")
            
            try:
                session = self._mcp_sessions.get(server_name)
                if not session:
                    raise Exception(f"MCP session '{server_name}' not available")
                
                # Call the tool via the MCP session
                result = await session.call_tool(tool_name, kwargs)
                return result.content
                    
            except Exception as e:
                logger.error(f"Error executing MCP tool '{tool_name}': {e}")
                return {
                    "success": False,
                    "error": str(e),
                    "server": server_name,
                    "tool": tool_name
                }
        
        return mcp_session_tool_function

    async def cleanup_mcp_clients(self):
        """Cleanup all MCP clients and processes."""
        logger.info("Cleaning up MCP clients")
        
        # Cleanup MCP sessions
        for name, session in self._mcp_sessions.items():
            try:
                await session.__aexit__(None, None, None)
                logger.debug(f"Closed MCP session: {name}")
            except Exception as e:
                logger.error(f"Error closing MCP session '{name}': {e}")
        
        # Cleanup MCP transport connections
        for name, client in self._mcp_clients.items():
            if client.get("transport") and hasattr(client["transport"], "__aexit__"):
                try:
                    await client["transport"].__aexit__(None, None, None)
                    logger.debug(f"Closed MCP transport: {name}")
                except Exception as e:
                    logger.error(f"Error closing MCP transport '{name}': {e}")
        
        # Clear all MCP data
        self._mcp_clients.clear()
        self._mcp_tools.clear()
        self._mcp_sessions.clear()

    def get_mcp_tools(self) -> List[AgentTool]:
        """Get all tools from connected MCP servers."""
        return self._mcp_tools.copy()

    def get_mcp_clients(self) -> Dict[str, Any]:
        """Get all connected MCP clients."""
        return self._mcp_clients.copy()