"""
Agent-level default workspace mod for OpenAgents.

This mod provides basic workspace functionality and integrates with
thread messaging for communication capabilities.
"""

import logging
import os
from typing import Dict, Any, List, Optional, Callable

from openagents.core.base_mod_adapter import BaseModAdapter
from openagents.models.messages import Event, EventNames
from openagents.models.tool import AgentTool
from openagents.tools.custom_event_tools import list_available_custom_events, is_custom_events_tool_available

logger = logging.getLogger(__name__)


class DefaultWorkspaceAgentAdapter(BaseModAdapter):
    """
    Agent adapter for the default workspace mod.

    This adapter provides basic workspace functionality and integrates
    with thread messaging capabilities for agent communication.
    """

    def __init__(self, agent_id: str, **kwargs):
        """Initialize the default workspace adapter."""
        super().__init__(agent_id, **kwargs)
        self.workspace_data: Dict[str, Any] = {}

    def get_tools(self) -> List[AgentTool]:
        """
        Get available tools for the default workspace.

        Returns:
            List of available tools, including conditional custom events tool
        """
        tools = []
        
        # Conditionally add custom events tool if custom events are available
        try:
            # Try to detect workspace path from current working directory
            workspace_path = self._detect_workspace_path()
            
            if workspace_path and is_custom_events_tool_available(workspace_path):
                logger.info(f"Custom events detected in workspace: {workspace_path}")
                
                custom_events_tool = AgentTool(
                    name="list_available_custom_events",
                    description="List all available custom events defined in the network workspace",
                    func=self._list_custom_events_wrapper,
                    input_schema={
                        "type": "object",
                        "properties": {
                            "workspace_path": {
                                "type": "string",
                                "description": "Optional path to workspace (auto-detected if not provided)"
                            }
                        },
                        "required": []
                    }
                )
                tools.append(custom_events_tool)
                logger.debug("Added custom events tool to workspace adapter")
            else:
                logger.debug("No custom events found, custom events tool not available")
        except Exception as e:
            logger.warning(f"Error checking for custom events availability: {e}")
        
        # Always add the send_event tool
        send_event_tool = AgentTool(
            name="send_event",
            description="Send any event to the network, including custom events defined in AsyncAPI format",
            func=self._send_event_wrapper,
            input_schema={
                "type": "object",
                "properties": {
                    "event_name": {
                        "type": "string",
                        "description": "The name of the event (e.g., 'my_event.abc_operation', 'workflow.status.updated')"
                    },
                    "destination_id": {
                        "type": "string", 
                        "description": "Target agent/channel (e.g., 'agent:pdf-counter-agent-b', 'group:developers', 'channel:general')"
                    },
                    "payload": {
                        "type": "object",
                        "description": "Event payload data (optional, should match AsyncAPI schema if custom event)",
                        "default": {}
                    }
                },
                "required": ["event_name", "destination_id"]
            }
        )
        tools.append(send_event_tool)
        
        return tools

    def _detect_workspace_path(self) -> Optional[str]:
        """
        Detect the workspace path from the current working directory.
        
        Returns:
            Path to workspace if detected, None otherwise
        """
        try:
            cwd = os.getcwd()
            potential_paths = [
                cwd,
                os.path.join(cwd, "private_networks", "yaml_coordinator_test_network"),
                os.path.dirname(cwd),
            ]
            
            for path in potential_paths:
                events_dir = os.path.join(path, "events")
                if os.path.exists(events_dir) and os.path.isdir(events_dir):
                    return path
            
            return None
        except Exception as e:
            logger.debug(f"Error detecting workspace path: {e}")
            return None

    async def _list_custom_events_wrapper(self, workspace_path: str = None) -> Dict[str, Any]:
        """
        Wrapper function for the custom events listing tool.
        
        Args:
            workspace_path: Optional workspace path
            
        Returns:
            Custom events information
        """
        try:
            if workspace_path is None:
                workspace_path = self._detect_workspace_path()
            
            return await list_available_custom_events(workspace_path)
        except Exception as e:
            logger.error(f"Error listing custom events: {e}")
            return {
                "success": False,
                "error": str(e),
                "custom_events": [],
                "total_events": 0,
                "definition_files": [],
                "message": f"Failed to list custom events: {e}"
            }

    async def _send_event_wrapper(self, event_name: str, destination_id: str, payload: dict = None) -> Dict[str, Any]:
        """
        Wrapper function for sending events to the network.
        
        Args:
            event_name: The name of the event to send
            destination_id: Target agent/channel/system
            payload: Optional event payload data
            
        Returns:
            Event sending result with validation information
        """
        try:
            # Import Event class
            from openagents.models.event import Event
            
            # Validate event name format
            if not event_name or len(event_name.strip()) < 3:
                return {
                    "success": False,
                    "error": "Event name must be at least 3 characters long",
                    "event_name": event_name
                }
            
            # Check if this is a custom event and provide validation
            workspace_path = self._detect_workspace_path()
            custom_events_info = None
            
            if workspace_path:
                try:
                    from openagents.utils.event_loader import load_custom_events
                    custom_events_result = load_custom_events(workspace_path)
                    
                    if custom_events_result["success"] and custom_events_result["custom_events"]:
                        custom_events_info = custom_events_result["custom_events"]
                        
                        # Check if this event name matches a custom event
                        matching_event = None
                        for event_def in custom_events_info:
                            if event_def["event_name"] == event_name:
                                matching_event = event_def
                                break
                        
                        if matching_event:
                            logger.info(f"Sending custom event '{event_name}' defined in {matching_event['source_file']}")
                        else:
                            logger.debug(f"Event '{event_name}' not found in custom definitions, sending as standard event")
                
                except Exception as e:
                    logger.warning(f"Could not load custom events for validation: {e}")
                    import traceback
                    logger.debug(f"Traceback: {traceback.format_exc()}")
            
            # Create the event object
            event = Event(
                event_name=event_name,
                destination_id=destination_id,
                payload=payload or {}
            )
            
            # Prepare result with custom event information
            result = {
                "event_id": event.event_id,
                "event_name": event_name,
                "destination_id": destination_id,
                "payload": payload or {}
            }
            
            # Add custom event information if available
            if custom_events_info:
                available_custom_events = [e["event_name"] for e in custom_events_info]
                result["available_custom_events"] = available_custom_events
                
                if event_name in available_custom_events:
                    result["custom_event"] = True
            
            # Check if connector is available
            if self.connector is None:
                result.update({
                    "success": False,
                    "error": "Connector not available - cannot send event",
                    "message": f"Cannot send event '{event_name}' - no network connection"
                })
                return result
            
            # Send event via connector
            response = await self.connector.send_event(event)
            
            # Update result with success information
            result.update({
                "success": True,
                "message": f"Event '{event_name}' sent successfully to {destination_id}"
            })
            
            if result.get("custom_event"):
                result["message"] += " (using custom event definition)"
            
            # Add network response information if available
            if response:
                result["network_response"] = {
                    "success": response.success if hasattr(response, 'success') else True,
                    "message": response.message if hasattr(response, 'message') else "Event delivered"
                }
            
            return result
        
        except Exception as e:
            logger.error(f"Error sending event '{event_name}': {e}")
            return {
                "success": False,
                "error": str(e),
                "event_name": event_name,
                "destination_id": destination_id,
                "message": f"Failed to send event: {e}"
            }

    def handle_message(self, message: Event) -> Optional[Event]:
        """
        Handle incoming messages for the workspace.

        Args:
            message: The incoming mod message

        Returns:
            Optional response message
        """
        logger.info(
            f"Default workspace adapter received message: {message.message_type}"
        )

        # For now, just log the message
        # Future implementation will handle workspace-specific messages
        return None

    def cleanup(self):
        """Clean up workspace resources."""
        logger.info(f"Cleaning up default workspace adapter for agent {self.agent_id}")
        self.workspace_data.clear()
        super().cleanup()
