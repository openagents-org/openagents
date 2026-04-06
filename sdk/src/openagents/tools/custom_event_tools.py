"""
Tools for working with custom event definitions in the network workspace.

This module provides agent tools for discovering and working with custom events
defined in AsyncAPI format in the network's events/ directory.
"""

import os
import logging
from typing import Dict, Any
from openagents.utils.event_loader import load_custom_events

logger = logging.getLogger(__name__)


async def list_available_custom_events(workspace_path: str = None) -> Dict[str, Any]:
    """
    List all available custom events defined in the network workspace.
    
    This tool discovers and lists custom event definitions from AsyncAPI files
    in the network's events/ directory. It provides event names, descriptions,
    payload schemas, and source files.
    
    Args:
        workspace_path: Path to the network workspace (auto-detected if not provided)
        
    Returns:
        dict: Dictionary containing:
            - success: Boolean indicating if operation succeeded
            - custom_events: List of available events with details
            - total_events: Number of custom events found
            - definition_files: List of AsyncAPI definition files
            - message: Status message
    """
    try:
        # Auto-detect workspace path if not provided
        if workspace_path is None:
            # Try to get current working directory and look for events folder
            cwd = os.getcwd()
            potential_paths = [
                cwd,
                os.path.join(cwd, "private_networks", "yaml_coordinator_test_network"),
                os.path.dirname(cwd),
            ]
            
            workspace_path = None
            for path in potential_paths:
                events_dir = os.path.join(path, "events")
                if os.path.exists(events_dir):
                    workspace_path = path
                    break
            
            if workspace_path is None:
                return {
                    "success": True,
                    "custom_events": [],
                    "total_events": 0,
                    "definition_files": [],
                    "message": "No custom event definitions found in workspace"
                }
        
        logger.info(f"Scanning for custom events in workspace: {workspace_path}")
        result = load_custom_events(workspace_path)
        
        # Enhance the result with additional formatting for better readability
        if result["custom_events"]:
            logger.info(f"Found {result['total_events']} custom events from {len(result['definition_files'])} files")
            
            # Add formatted display information
            result["formatted_summary"] = _format_events_summary(result["custom_events"])
        
        return result
        
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


def _format_events_summary(events: list) -> str:
    """
    Format events list into a readable summary string.
    
    Args:
        events: List of event dictionaries
        
    Returns:
        Formatted string summarizing the events
    """
    if not events:
        return "No custom events available."
    
    lines = ["📋 Available Custom Events:", ""]
    
    # Group events by source file
    by_file = {}
    for event in events:
        source_file = event["source_file"]
        if source_file not in by_file:
            by_file[source_file] = []
        by_file[source_file].append(event)
    
    for file_name, file_events in by_file.items():
        lines.append(f"📄 From {file_name}:")
        
        for event in file_events:
            lines.append(f"  🔸 {event['event_name']}")
            lines.append(f"     {event['description']}")
            
            # Add schema summary if available
            if event.get("payload_schema"):
                schema_items = []
                for field, field_info in event["payload_schema"].items():
                    schema_items.append(f"{field}: {field_info}")
                
                if schema_items:
                    lines.append(f"     Payload: {', '.join(schema_items[:3])}")
                    if len(schema_items) > 3:
                        lines.append(f"              ...and {len(schema_items) - 3} more fields")
            
            lines.append("")  # Empty line between events
    
    return "\n".join(lines)


def is_custom_events_tool_available(workspace_path: str = None) -> bool:
    """
    Check if custom events are available in the workspace.
    
    This function is used to conditionally register the custom events tool
    only when custom event definitions are actually available.
    
    Args:
        workspace_path: Path to the network workspace
        
    Returns:
        True if custom events are available, False otherwise
    """
    try:
        if workspace_path is None:
            # Auto-detect workspace path
            cwd = os.getcwd()
            potential_paths = [
                cwd,
                os.path.join(cwd, "private_networks", "yaml_coordinator_test_network"),
                os.path.dirname(cwd),
            ]
            
            for path in potential_paths:
                events_dir = os.path.join(path, "events")
                if os.path.exists(events_dir) and os.path.isdir(events_dir):
                    # Check if there are any .yaml/.yml files
                    for file in os.listdir(events_dir):
                        if file.endswith(('.yaml', '.yml')):
                            return True
            return False
        
        else:
            events_dir = os.path.join(workspace_path, "events")
            if not os.path.exists(events_dir) or not os.path.isdir(events_dir):
                return False
            
            # Check for .yaml or .yml files
            for file in os.listdir(events_dir):
                if file.endswith(('.yaml', '.yml')):
                    return True
            return False
        
    except Exception as e:
        logger.debug(f"Error checking custom events availability: {e}")
        return False