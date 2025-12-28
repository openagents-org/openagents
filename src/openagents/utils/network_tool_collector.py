"""Tool collector for aggregating tools from network mods and workspace for MCP exposure."""

from typing import Dict, List, Optional, Any, Set, TYPE_CHECKING, Union
import logging

if TYPE_CHECKING:
    from openagents.core.network import AgentNetwork

from openagents.models.tool import AgentTool
from openagents.models.event import Event
from openagents.models.event_response import EventResponse
from openagents.utils.workspace_tool_loader import WorkspaceToolLoader
from openagents.utils.event_tool_loader import EventToolLoader
from openagents.utils.mod_loaders import load_mod_adapter
from openagents.models.network_context import NetworkContext

logger = logging.getLogger(__name__)


class MCPConnectorWrapper:
    """Wrapper that allows adapters to send events via the network context.

    This wrapper bridges adapters (which expect a connector) with the MCP context
    (which has direct access to the network's emit_event callback).
    """

    def __init__(self, emit_event_callback):
        """Initialize the MCP connector wrapper.

        Args:
            emit_event_callback: The network's emit_event callback function
        """
        self._emit_event = emit_event_callback

    async def send_event(self, message: Event) -> EventResponse:
        """Send an event via the network's emit_event callback.

        Args:
            message: Event to send

        Returns:
            EventResponse from the network
        """
        if self._emit_event is None:
            return EventResponse(
                success=False,
                message="MCP connector not properly initialized - no emit_event callback",
            )

        try:
            result = await self._emit_event(message, True)
            return result
        except Exception as e:
            logger.error(f"Error sending event via MCP connector: {e}")
            return EventResponse(
                success=False,
                message=f"Error sending event: {str(e)}",
            )


class MCPClientWrapper:
    """Wrapper that acts as an AgentClient for MCP tool execution.

    This wrapper bridges adapters (which expect an agent_client) with the MCP context
    (which has direct access to the network's emit_event callback).
    Some adapters use self.agent_client.send_event() instead of self.connector.send_event().
    """

    def __init__(self, emit_event_callback, agent_id: str = "mcp_client"):
        """Initialize the MCP client wrapper.

        Args:
            emit_event_callback: The network's emit_event callback function
            agent_id: The agent ID to use for MCP client (default: "mcp_client")
        """
        self._emit_event = emit_event_callback
        self.agent_id = agent_id

    async def send_event(self, message: Event) -> EventResponse:
        """Send an event via the network's emit_event callback.

        Args:
            message: Event to send

        Returns:
            EventResponse from the network
        """
        if self._emit_event is None:
            return EventResponse(
                success=False,
                message="MCP client not properly initialized - no emit_event callback",
            )

        try:
            result = await self._emit_event(message, True)
            return result
        except Exception as e:
            logger.error(f"Error sending event via MCP client: {e}")
            return EventResponse(
                success=False,
                message=f"Error sending event: {str(e)}",
            )


class NetworkToolCollector:
    """Collects tools from mod adapters, workspace, and events for MCP exposure.

    This class aggregates tools from:
    1. Mod adapters - via adapter.py get_tools() method (not mod.py)
    2. Workspace tools - from {workspace}/tools/ folder with @tool decorator
    3. Custom events - from {workspace}/events/ folder with x-agent-tool extension

    Tool names must be unique across all sources - conflicts cause startup failure.
    """

    def __init__(
        self,
        network: Optional["AgentNetwork"] = None,
        workspace_path: Optional[str] = None,
        context: Optional[NetworkContext] = None,
    ):
        """Initialize the tool collector.

        Args:
            network: DEPRECATED - Use context instead. The network to collect tools from.
            workspace_path: Optional path to the workspace root directory for workspace tools.
                           If not provided and context is given, uses context.workspace_path.
            context: NetworkContext providing mods and emit_event callback.
        """
        self.context = context
        self._network = network  # Keep for backward compatibility

        # Prefer context values over direct parameters
        if context:
            self.workspace_path = workspace_path or context.workspace_path
        else:
            self.workspace_path = workspace_path

        self._tools: Dict[str, AgentTool] = {}
        self._tool_sources: Dict[str, str] = {}  # tool_name -> source (mod_name or "workspace")

    def collect_all_tools(self) -> List[AgentTool]:
        """Aggregate tools from mod adapters, workspace, and events.

        Collects tools in order:
        1. Mod adapters - via adapter.py get_tools() method
        2. Workspace tools - from {workspace}/tools/ folder
        3. Event tools - from {workspace}/events/ folder with x-agent-tool

        Raises:
            ValueError: If tool name conflicts are detected between sources

        Returns:
            List[AgentTool]: All tools from all sources
        """
        self._tools = {}
        self._tool_sources = {}

        # 1. Collect from mod adapters
        self._collect_mod_tools()

        # 2. Collect from workspace tools folder
        self._collect_workspace_tools()

        # 3. Collect from event definitions
        self._collect_event_tools()

        logger.info(f"Collected {len(self._tools)} total tools")
        return list(self._tools.values())

    def _collect_mod_tools(self) -> None:
        """Collect tools from mod adapters.

        Tools are defined in adapter.py (BaseModAdapter subclasses), not in mod.py.
        This method loads the adapter for each mod and collects tools from it.
        For MCP exposure, adapters are bound to an MCPConnectorWrapper that routes
        events through the network's emit_event callback.
        """
        # Get mods from context or fall back to network
        mods = {}
        if self.context:
            mods = self.context.mods
        elif self._network:
            mods = self._network.mods

        # Create MCP connector and client wrappers for adapters
        emit_callback = None
        if self.context and self.context.emit_event:
            emit_callback = self.context.emit_event
        elif self._network and hasattr(self._network, "event_gateway"):
            emit_callback = self._network.event_gateway.process_event

        mcp_connector = MCPConnectorWrapper(emit_callback) if emit_callback else None
        mcp_client = MCPClientWrapper(emit_callback) if emit_callback else None

        for mod_name in mods.keys():
            try:
                # Load the adapter class for this mod
                adapter_class = load_mod_adapter(mod_name)
                if adapter_class is None:
                    logger.debug(f"No adapter found for mod '{mod_name}'")
                    continue

                # Instantiate the adapter - try different constructor patterns
                adapter_instance = None
                try:
                    # First try no arguments
                    adapter_instance = adapter_class()
                except TypeError:
                    try:
                        # Try with mod_name argument
                        adapter_instance = adapter_class(mod_name)
                    except Exception as e:
                        logger.error(f"Failed to instantiate adapter for {mod_name}: {e}")
                        continue
                except Exception as e:
                    logger.error(f"Failed to instantiate adapter for {mod_name}: {e}")
                    continue

                if adapter_instance is None:
                    continue

                # Bind the MCP connector wrapper to the adapter
                if mcp_connector and hasattr(adapter_instance, "bind_connector"):
                    adapter_instance.bind_connector(mcp_connector)
                    # Set agent ID to "mcp_client" for MCP tool calls
                    if hasattr(adapter_instance, "bind_agent"):
                        adapter_instance.bind_agent("mcp_client")

                # Bind the MCP client wrapper to the adapter
                # Some adapters use self.agent_client.send_event() instead of connector
                if mcp_client and hasattr(adapter_instance, "bind_client"):
                    adapter_instance.bind_client(mcp_client)

                # Bind the network mod to the adapter if supported
                # This allows adapters to access mod state (e.g., templates)
                if hasattr(adapter_instance, "bind_mod"):
                    mod_instance = mods.get(mod_name)
                    if mod_instance:
                        adapter_instance.bind_mod(mod_instance)
                        logger.debug(f"Bound mod '{mod_name}' to adapter")

                # Get tools from the adapter
                if hasattr(adapter_instance, "get_tools"):
                    mod_tools = adapter_instance.get_tools()
                    for tool in mod_tools:
                        self._add_tool(tool, source=f"mod:{mod_name}")
                        logger.debug(f"Collected tool '{tool.name}' from mod adapter '{mod_name}'")

            except Exception as e:
                if "Tool name conflict" in str(e):
                    raise
                logger.error(f"Error collecting tools from mod adapter '{mod_name}': {e}")

        logger.debug(f"Collected {len(self._tools)} tools from mod adapters")

    def _collect_workspace_tools(self) -> None:
        """Collect tools from workspace tools folder."""
        if not self.workspace_path:
            return

        try:
            loader = WorkspaceToolLoader(self.workspace_path)
            workspace_tools = loader.load_tools()

            for tool in workspace_tools:
                self._add_tool(tool, source="workspace")
                logger.debug(f"Collected tool '{tool.name}' from workspace")

            logger.debug(f"Collected {len(workspace_tools)} tools from workspace")
        except Exception as e:
            if "Tool name conflict" in str(e):
                raise
            logger.error(f"Error collecting workspace tools: {e}")

    def _collect_event_tools(self) -> None:
        """Collect tools from AsyncAPI event definitions."""
        if not self.workspace_path:
            return

        try:
            # Pass context or network to EventToolLoader
            loader = EventToolLoader(
                self.workspace_path,
                network=self._network,
                context=self.context,
            )
            event_tools = loader.load_tools()

            for tool in event_tools:
                self._add_tool(tool, source="event")
                logger.debug(f"Collected event tool '{tool.name}'")

            logger.debug(f"Collected {len(event_tools)} tools from event definitions")
        except Exception as e:
            if "Tool name conflict" in str(e):
                raise
            logger.error(f"Error collecting event tools: {e}")

    def _add_tool(self, tool: AgentTool, source: str) -> None:
        """Add a tool with conflict checking.

        Args:
            tool: The tool to add
            source: The source of the tool (e.g., "mod:my_mod" or "workspace")

        Raises:
            ValueError: If tool name conflicts with an existing tool
        """
        if tool.name in self._tools:
            existing_source = self._tool_sources[tool.name]
            raise ValueError(
                f"Tool name conflict: '{tool.name}' is defined in both "
                f"'{existing_source}' and '{source}'. Tool names must be unique."
            )
        self._tools[tool.name] = tool
        self._tool_sources[tool.name] = source

    def get_tool_by_name(self, name: str) -> Optional[AgentTool]:
        """Get a tool by name.

        Args:
            name: The name of the tool

        Returns:
            The tool if found, None otherwise
        """
        return self._tools.get(name)

    def get_tool_source(self, name: str) -> Optional[str]:
        """Get the mod name that provides a tool.

        Args:
            name: The name of the tool

        Returns:
            The mod name if found, None otherwise
        """
        return self._tool_sources.get(name)

    def to_mcp_tools(self) -> List[Dict[str, Any]]:
        """Convert AgentTools to MCP tool format.

        Returns:
            List of tools in MCP format (name, description, inputSchema)
        """
        mcp_tools = []
        for tool in self._tools.values():
            mcp_tool = {
                "name": tool.name,
                "description": tool.description or f"Tool: {tool.name}",
                "inputSchema": tool.input_schema or {"type": "object", "properties": {}},
            }
            mcp_tools.append(mcp_tool)
        return mcp_tools

    @property
    def tool_count(self) -> int:
        """Get the number of collected tools."""
        return len(self._tools)

    @property
    def tool_names(self) -> List[str]:
        """Get the names of all collected tools."""
        return list(self._tools.keys())

    def filter_tools(
        self,
        exposed_tools: Optional[List[str]] = None,
        excluded_tools: Optional[List[str]] = None,
    ) -> List[AgentTool]:
        """Filter tools based on whitelist and blacklist.

        The filtering logic is:
        1. If exposed_tools is set, start with only those tools (whitelist)
        2. If exposed_tools is None, start with all tools
        3. Remove any tools in excluded_tools (blacklist)

        Args:
            exposed_tools: Whitelist of tool names to include. If None, all tools are included.
            excluded_tools: Blacklist of tool names to exclude. Applied after whitelist.

        Returns:
            List[AgentTool]: Filtered list of tools
        """
        all_tool_names: Set[str] = set(self._tools.keys())

        # Step 1: Apply whitelist (exposed_tools)
        if exposed_tools is not None:
            exposed_set = set(exposed_tools)
            # Warn about invalid tool names in whitelist
            invalid_exposed = exposed_set - all_tool_names
            if invalid_exposed:
                logger.warning(
                    f"exposed_tools contains unknown tool names: {sorted(invalid_exposed)}"
                )
            # Start with whitelisted tools that exist
            result_names = exposed_set & all_tool_names
        else:
            # No whitelist, start with all tools
            result_names = all_tool_names.copy()

        # Step 2: Apply blacklist (excluded_tools)
        if excluded_tools is not None:
            excluded_set = set(excluded_tools)
            # Warn about invalid tool names in blacklist
            invalid_excluded = excluded_set - all_tool_names
            if invalid_excluded:
                logger.warning(
                    f"excluded_tools contains unknown tool names: {sorted(invalid_excluded)}"
                )
            # Remove blacklisted tools
            result_names -= excluded_set

        # Build the filtered tool list
        filtered_tools = [self._tools[name] for name in result_names if name in self._tools]

        logger.info(
            f"Filtered tools: {len(filtered_tools)} of {len(self._tools)} tools "
            f"(exposed={len(exposed_tools) if exposed_tools else 'all'}, "
            f"excluded={len(excluded_tools) if excluded_tools else 0})"
        )

        return filtered_tools

    def to_mcp_tools_filtered(
        self,
        exposed_tools: Optional[List[str]] = None,
        excluded_tools: Optional[List[str]] = None,
        include_source: bool = True,
    ) -> List[Dict[str, Any]]:
        """Convert filtered AgentTools to MCP tool format.

        Args:
            exposed_tools: Whitelist of tool names to include
            excluded_tools: Blacklist of tool names to exclude
            include_source: Whether to include the source field (for admin UI)

        Returns:
            List of filtered tools in MCP format (name, description, inputSchema, source)
        """
        filtered = self.filter_tools(exposed_tools, excluded_tools)
        mcp_tools = []
        for tool in filtered:
            mcp_tool = {
                "name": tool.name,
                "description": tool.description or f"Tool: {tool.name}",
                "inputSchema": tool.input_schema or {"type": "object", "properties": {}},
            }
            if include_source:
                mcp_tool["source"] = self._tool_sources.get(tool.name, "unknown")
            mcp_tools.append(mcp_tool)
        return mcp_tools
