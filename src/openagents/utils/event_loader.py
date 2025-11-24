"""
Event loader utility for custom event definitions in AsyncAPI format.

This module provides functions to discover and parse AsyncAPI event definitions
from the network workspace events/ directory.
"""

import os
import yaml
import logging
from typing import Dict, List, Any, Optional
from pathlib import Path

logger = logging.getLogger(__name__)


def discover_event_definition_files(workspace_path: str) -> List[str]:
    """
    Discover AsyncAPI event definition files in the workspace events/ directory.
    
    Args:
        workspace_path: Path to the network workspace directory
        
    Returns:
        List of paths to .yaml files in the events/ directory
    """
    events_dir = Path(workspace_path) / "events"
    
    if not events_dir.exists() or not events_dir.is_dir():
        logger.debug(f"No events directory found at {events_dir}")
        return []
    
    yaml_files = []
    for file_path in events_dir.glob("*.yaml"):
        if file_path.is_file():
            yaml_files.append(str(file_path))
    
    # Also check for .yml extension
    for file_path in events_dir.glob("*.yml"):
        if file_path.is_file():
            yaml_files.append(str(file_path))
    
    logger.info(f"Found {len(yaml_files)} event definition files in {events_dir}")
    return yaml_files


def parse_asyncapi_event_definition(file_path: str) -> Optional[Dict[str, Any]]:
    """
    Parse an AsyncAPI event definition file.
    
    Args:
        file_path: Path to the AsyncAPI YAML file
        
    Returns:
        Parsed AsyncAPI definition or None if invalid
    """
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = yaml.safe_load(f)
        
        # Basic validation - ensure it's an AsyncAPI document
        if not isinstance(content, dict):
            logger.warning(f"Invalid YAML structure in {file_path}")
            return None
        
        if 'asyncapi' not in content:
            logger.warning(f"Missing 'asyncapi' field in {file_path}")
            return None
        
        # Validate AsyncAPI version (support 3.0.x)
        version = content.get('asyncapi', '')
        if not version.startswith('3.0'):
            logger.warning(f"Unsupported AsyncAPI version '{version}' in {file_path}")
            return None
        
        logger.debug(f"Successfully parsed AsyncAPI definition from {file_path}")
        return content
        
    except yaml.YAMLError as e:
        logger.error(f"YAML parsing error in {file_path}: {e}")
        return None
    except Exception as e:
        logger.error(f"Error reading {file_path}: {e}")
        return None


def extract_events_from_definition(definition: Dict[str, Any], source_file: str) -> List[Dict[str, Any]]:
    """
    Extract event information from an AsyncAPI definition.
    
    Args:
        definition: Parsed AsyncAPI definition
        source_file: Name of the source file (for reference)
        
    Returns:
        List of event information dictionaries
    """
    events = []
    
    # Get channels (which define event addresses/names)
    channels = definition.get('channels', {})
    components = definition.get('components', {})
    messages = components.get('messages', {})
    schemas = components.get('schemas', {})
    
    for channel_key, channel_info in channels.items():
        if not isinstance(channel_info, dict):
            continue
        
        # Get the event name from channel address
        event_name = channel_info.get('address', channel_key)
        description = channel_info.get('description', 'No description available')
        
        # Extract message information for this channel
        channel_messages = channel_info.get('messages', {})
        
        # Build payload schema information
        payload_schema = {}
        for msg_key, msg_ref in channel_messages.items():
            if isinstance(msg_ref, dict) and '$ref' in msg_ref:
                # Resolve message reference
                ref_path = msg_ref['$ref']
                if ref_path.startswith('#/components/messages/'):
                    msg_name = ref_path.split('/')[-1]
                    message_def = messages.get(msg_name, {})
                    
                    # Get payload schema
                    payload = message_def.get('payload', {})
                    if '$ref' in payload and payload['$ref'].startswith('#/components/schemas/'):
                        schema_name = payload['$ref'].split('/')[-1]
                        schema_def = schemas.get(schema_name, {})
                        payload_schema = _extract_schema_info(schema_def)
                    elif 'properties' in payload:
                        payload_schema = _extract_schema_info(payload)
        
        events.append({
            'event_name': event_name,
            'description': description,
            'source_file': source_file,
            'payload_schema': payload_schema,
            'channel_key': channel_key
        })
    
    return events


def _extract_schema_info(schema: Dict[str, Any]) -> Dict[str, str]:
    """
    Extract simplified schema information for display.
    
    Args:
        schema: JSON schema definition
        
    Returns:
        Simplified schema info for display
    """
    if not isinstance(schema, dict):
        return {}
    
    schema_info = {}
    properties = schema.get('properties', {})
    required = schema.get('required', [])
    
    for prop_name, prop_def in properties.items():
        if isinstance(prop_def, dict):
            prop_type = prop_def.get('type', 'unknown')
            prop_desc = prop_def.get('description', '')
            is_required = prop_name in required
            
            type_str = f"{prop_type} ({'required' if is_required else 'optional'})"
            if prop_desc:
                type_str += f" - {prop_desc}"
            
            schema_info[prop_name] = type_str
    
    return schema_info


def load_custom_events(workspace_path: str) -> Dict[str, Any]:
    """
    Load all custom event definitions from the workspace.
    
    Args:
        workspace_path: Path to the network workspace directory
        
    Returns:
        Dictionary with event information and metadata
    """
    event_files = discover_event_definition_files(workspace_path)
    
    if not event_files:
        return {
            'success': True,
            'custom_events': [],
            'total_events': 0,
            'definition_files': [],
            'message': 'No custom event definition files found'
        }
    
    all_events = []
    valid_files = []
    
    for file_path in event_files:
        definition = parse_asyncapi_event_definition(file_path)
        if definition:
            source_file = Path(file_path).name
            events = extract_events_from_definition(definition, source_file)
            all_events.extend(events)
            valid_files.append(source_file)
        else:
            logger.warning(f"Skipping invalid event definition file: {file_path}")
    
    return {
        'success': True,
        'custom_events': all_events,
        'total_events': len(all_events),
        'definition_files': valid_files,
        'message': f'Loaded {len(all_events)} custom events from {len(valid_files)} files'
    }