"""
Event tool loader for discovering tools from AsyncAPI event definitions.

This module provides functionality to auto-discover and load tools defined
via the `x-agent-tool` extension in AsyncAPI 3.0 event definitions.
"""

import logging
from pathlib import Path
from typing import Any, Awaitable, Callable, Dict, List, Optional, TYPE_CHECKING

import yaml

if TYPE_CHECKING:
    from openagents.core.network import AgentNetwork
    from openagents.models.network_context import NetworkContext

from openagents.models.event import Event
from openagents.models.tool import AgentTool

logger = logging.getLogger(__name__)


class EventToolLoader:
    """
    Loads tools from AsyncAPI event definitions in the workspace `events/` folder.

    Discovers AsyncAPI 3.0 YAML files and converts operations marked with
    `x-agent-tool.enabled: true` into AgentTool instances.

    When an event tool is called, it emits the corresponding event to the network.
    """

    def __init__(
        self,
        workspace_path: str,
        network: Optional["AgentNetwork"] = None,
        context: Optional["NetworkContext"] = None,
    ):
        """
        Initialize the event tool loader.

        Args:
            workspace_path: Path to the workspace root directory
            network: DEPRECATED - Use context instead. Network reference for event emission.
            context: NetworkContext providing emit_event callback.
        """
        self.workspace_path = Path(workspace_path)
        self.events_dir = self.workspace_path / "events"
        self.context = context
        self._network = network  # Keep for backward compatibility
        self._event_tools: Dict[str, Dict[str, Any]] = {}  # tool_name -> event metadata

    def load_tools(self) -> List[AgentTool]:
        """
        Load all event tools from the workspace events directory.

        Returns:
            List of AgentTool instances from event definitions
        """
        tools: List[AgentTool] = []
        self._event_tools = {}

        if not self.events_dir.exists():
            logger.debug(f"Events directory not found: {self.events_dir}")
            return tools

        if not self.events_dir.is_dir():
            logger.warning(f"Events path is not a directory: {self.events_dir}")
            return tools

        # Find all YAML files in events directory
        yaml_files = list(self.events_dir.glob("*.yaml")) + list(self.events_dir.glob("*.yml"))

        for yaml_file in yaml_files:
            # Skip private files
            if yaml_file.name.startswith("_"):
                continue

            try:
                file_tools = self._load_tools_from_file(yaml_file)
                tools.extend(file_tools)
            except Exception as e:
                logger.error(f"Error loading event tools from {yaml_file}: {e}")

        logger.info(f"Loaded {len(tools)} event tools from {self.events_dir}")
        return tools

    def _load_tools_from_file(self, file_path: Path) -> List[AgentTool]:
        """
        Load event tools from a single AsyncAPI YAML file.

        Args:
            file_path: Path to the AsyncAPI YAML file

        Returns:
            List of AgentTool instances from the file
        """
        tools: List[AgentTool] = []

        with open(file_path, "r") as f:
            try:
                spec = yaml.safe_load(f)
            except yaml.YAMLError as e:
                logger.error(f"Invalid YAML in {file_path}: {e}")
                return tools

        if not spec or not isinstance(spec, dict):
            logger.warning(f"Empty or invalid AsyncAPI spec in {file_path}")
            return tools

        # Validate AsyncAPI version
        asyncapi_version = spec.get("asyncapi", "")
        if not asyncapi_version.startswith("3."):
            logger.debug(f"Skipping {file_path}: not AsyncAPI 3.x (found: {asyncapi_version})")
            return tools

        # Get operations
        operations = spec.get("operations", {})
        if not operations:
            return tools

        # Get channels and components for reference resolution
        channels = spec.get("channels", {})
        components = spec.get("components", {})

        for op_id, operation in operations.items():
            if not isinstance(operation, dict):
                continue

            # Check for x-agent-tool extension
            agent_tool_ext = operation.get("x-agent-tool", {})
            if not agent_tool_ext.get("enabled", False):
                continue

            try:
                tool = self._create_tool_from_operation(
                    op_id=op_id,
                    operation=operation,
                    agent_tool_ext=agent_tool_ext,
                    channels=channels,
                    components=components,
                    file_path=file_path,
                )
                if tool:
                    tools.append(tool)
                    logger.debug(f"Loaded event tool '{tool.name}' from {file_path}")
            except Exception as e:
                logger.error(f"Error creating tool from operation '{op_id}' in {file_path}: {e}")

        return tools

    def _create_tool_from_operation(
        self,
        op_id: str,
        operation: Dict[str, Any],
        agent_tool_ext: Dict[str, Any],
        channels: Dict[str, Any],
        components: Dict[str, Any],
        file_path: Path,
    ) -> Optional[AgentTool]:
        """
        Create an AgentTool from an AsyncAPI operation.

        Args:
            op_id: Operation ID
            operation: Operation definition
            agent_tool_ext: x-agent-tool extension data
            channels: Channels from the spec
            components: Components from the spec
            file_path: Source file path

        Returns:
            AgentTool instance or None
        """
        # Get tool name: x-agent-tool.name → operation ID
        tool_name = agent_tool_ext.get("name", op_id)

        # Get description: x-agent-tool.description → operation summary
        tool_description = agent_tool_ext.get("description")
        if not tool_description:
            tool_description = operation.get("summary", f"Event tool: {tool_name}")

        # Get channel reference to find event address
        channel_ref = operation.get("channel", {})
        event_address = self._resolve_channel_address(channel_ref, channels)

        # Get input schema from message payload
        input_schema = self._resolve_input_schema(operation, channels, components)

        # Store event metadata for execution
        self._event_tools[tool_name] = {
            "event_address": event_address,
            "operation_id": op_id,
            "source_file": str(file_path),
        }

        # Create the tool with event emission function
        func = self._create_event_emitter(tool_name, event_address)

        return AgentTool(
            name=tool_name,
            description=tool_description,
            input_schema=input_schema,
            func=func,
        )

    def _resolve_channel_address(
        self, channel_ref: Dict[str, Any], channels: Dict[str, Any]
    ) -> str:
        """Resolve channel reference to get the event address."""
        if isinstance(channel_ref, str):
            # Direct reference like "#/channels/task~1delegate"
            ref_path = channel_ref
        elif isinstance(channel_ref, dict):
            ref_path = channel_ref.get("$ref", "")
        else:
            return "unknown"

        # Parse $ref path
        if ref_path.startswith("#/channels/"):
            # Handle URL-encoded path separators (~ is escape char in JSON Pointer)
            channel_key = ref_path[len("#/channels/") :]
            channel_key = channel_key.replace("~1", "/").replace("~0", "~")

            channel = channels.get(channel_key, {})
            return channel.get("address", channel_key)

        return "unknown"

    def _resolve_input_schema(
        self,
        operation: Dict[str, Any],
        channels: Dict[str, Any],
        components: Dict[str, Any],
    ) -> Dict[str, Any]:
        """Resolve message payload schema for input parameters."""
        default_schema = {"type": "object", "properties": {}, "required": []}

        # Get channel reference
        channel_ref = operation.get("channel", {})
        if isinstance(channel_ref, dict):
            ref_path = channel_ref.get("$ref", "")
        else:
            return default_schema

        # Resolve channel
        if ref_path.startswith("#/channels/"):
            channel_key = ref_path[len("#/channels/") :]
            channel_key = channel_key.replace("~1", "/").replace("~0", "~")
            channel = channels.get(channel_key, {})
        else:
            return default_schema

        # Get messages from channel
        messages = channel.get("messages", {})
        if not messages:
            return default_schema

        # Get first message (typically there's only one)
        for msg_key, msg_ref in messages.items():
            if isinstance(msg_ref, dict) and "$ref" in msg_ref:
                message = self._resolve_ref(msg_ref["$ref"], components)
            else:
                message = msg_ref

            if message:
                payload_ref = message.get("payload", {})
                if isinstance(payload_ref, dict) and "$ref" in payload_ref:
                    schema = self._resolve_ref(payload_ref["$ref"], components)
                    if schema:
                        return schema
                elif isinstance(payload_ref, dict):
                    return payload_ref

        return default_schema

    def _resolve_ref(self, ref_path: str, components: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Resolve a $ref path within components."""
        if not ref_path.startswith("#/components/"):
            return None

        # Parse path: #/components/messages/TaskDelegate or #/components/schemas/Payload
        parts = ref_path[len("#/components/") :].split("/")
        if len(parts) < 2:
            return None

        section = parts[0]  # "messages" or "schemas"
        name = "/".join(parts[1:])  # Handle nested paths
        name = name.replace("~1", "/").replace("~0", "~")

        return components.get(section, {}).get(name)

    def _create_event_emitter(self, tool_name: str, event_address: str) -> Callable:
        """Create a function that emits an event when called."""

        async def emit_event(**kwargs) -> Dict[str, Any]:
            """Emit the event to the network."""
            # Check for emit_event callback in context first
            emit_callback = None
            if self.context and self.context.emit_event:
                emit_callback = self.context.emit_event
            elif self._network:
                # Fallback to legacy network access
                emit_callback = lambda event, enable_delivery: self._network.event_gateway.process_event(event, enable_delivery)

            if emit_callback is None:
                return {
                    "success": False,
                    "error": "No network configured for event emission",
                }

            try:
                # Create an Event object and emit via callback
                event = Event(
                    event_name=event_address,
                    source_id="system:mcp",
                    source_type="system",
                    payload=kwargs,
                    destination_id="system",
                )
                await emit_callback(event, True)
                return {
                    "success": True,
                    "message": f"Event '{event_address}' emitted successfully",
                    "event": event_address,
                    "payload": kwargs,
                }
            except Exception as e:
                logger.error(f"Error emitting event '{event_address}': {e}")
                return {
                    "success": False,
                    "error": str(e),
                    "event": event_address,
                }

        return emit_event

    def get_event_metadata(self, tool_name: str) -> Optional[Dict[str, Any]]:
        """Get event metadata for a tool."""
        return self._event_tools.get(tool_name)


def load_event_tools(
    workspace_path: str, network: Optional["AgentNetwork"] = None
) -> List[AgentTool]:
    """
    Convenience function to load event tools from a workspace.

    Args:
        workspace_path: Path to the workspace root directory
        network: Optional network reference for event emission

    Returns:
        List of AgentTool instances
    """
    loader = EventToolLoader(workspace_path, network)
    return loader.load_tools()
