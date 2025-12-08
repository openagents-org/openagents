"""
Event Indexer Service for OpenAgents Event Explorer.

This module provides functionality to fetch, parse, and index event definitions
from GitHub repository and provide searchable event documentation.
"""

import json
import logging
import yaml
import re
from typing import Dict, List, Any, Optional
from pathlib import Path
from urllib.parse import urlparse

try:
    import requests
    REQUESTS_AVAILABLE = True
except ImportError:
    REQUESTS_AVAILABLE = False
    logging.warning("requests library not available, GitHub integration disabled")

logger = logging.getLogger(__name__)


class EventIndexer:
    """Indexes event definitions from GitHub repository."""
    
    def __init__(self, repo_owner: str = "openagents-org", repo_name: str = "openagents", branch: str = "main"):
        self.repo_owner = repo_owner
        self.repo_name = repo_name
        self.branch = branch
        self.github_base_url = f"https://api.github.com/repos/{repo_owner}/{repo_name}"
        self.indexed_events: Dict[str, Any] = {}
        self.indexed_mods: Dict[str, Any] = {}
        self.last_sync_time: Optional[float] = None
        
    def fetch_eventdef_files_from_github(self) -> List[Dict[str, Any]]:
        """Fetch all eventdef.yaml files from GitHub repository."""
        if not REQUESTS_AVAILABLE:
            logger.error("requests library not available")
            return []
            
        try:
            # Use GitHub API to search for eventdef.yaml files
            # First, get the repository tree recursively
            url = f"{self.github_base_url}/git/trees/{self.branch}?recursive=1"
            response = requests.get(url, timeout=30)
            response.raise_for_status()
            
            tree = response.json().get("tree", [])
            
            # Find all eventdef.yaml files
            eventdef_files = [
                file for file in tree
                if file.get("path", "").endswith("eventdef.yaml")
            ]
            
            logger.info(f"Found {len(eventdef_files)} eventdef.yaml files in repository")
            return eventdef_files
            
        except Exception as e:
            logger.error(f"Error fetching eventdef files from GitHub: {e}")
            return []
    
    def fetch_file_content_from_github(self, file_path: str) -> Optional[str]:
        """Fetch file content from GitHub."""
        if not REQUESTS_AVAILABLE:
            return None
            
        try:
            # Construct raw content URL
            raw_url = f"https://raw.githubusercontent.com/{self.repo_owner}/{self.repo_name}/{self.branch}/{file_path}"
            response = requests.get(raw_url, timeout=30)
            response.raise_for_status()
            return response.text
                
        except Exception as e:
            logger.error(f"Error fetching file content from GitHub: {e}")
            return None
    
    def parse_eventdef_file(self, content: str, file_path: str) -> Optional[Dict[str, Any]]:
        """Parse an eventdef.yaml file and extract event information."""
        try:
            definition = yaml.safe_load(content)
            
            if not isinstance(definition, dict) or 'asyncapi' not in definition:
                logger.warning(f"Invalid AsyncAPI definition in {file_path}")
                return None
            
            # Extract mod information
            info = definition.get('info', {})
            mod_name = info.get('title', 'Unknown Mod')
            mod_description = info.get('description', '')
            
            # Extract mod path from file path
            # e.g., src/openagents/mods/core/shared_cache/eventdef.yaml
            mod_path_match = re.search(r'mods/([^/]+/[^/]+)', file_path)
            if mod_path_match:
                mod_path_parts = mod_path_match.group(1).split('/')
                mod_id = mod_path_parts[-1]  # e.g., shared_cache
                mod_full_path = f"openagents.mods.{'.'.join(mod_path_parts)}"
            else:
                mod_id = mod_name.lower().replace(' ', '_')
                mod_full_path = f"openagents.mods.{mod_id}"
            
            # Extract channels and messages
            channels = definition.get('channels', {})
            components = definition.get('components', {})
            messages = components.get('messages', {})
            schemas = components.get('schemas', {})
            
            events = []
            
            for channel_key, channel_info in channels.items():
                if not isinstance(channel_info, dict):
                    continue
                
                event_address = channel_info.get('address', channel_key)
                channel_description = channel_info.get('description', '')
                
                # Get message reference from channel
                channel_messages = channel_info.get('messages', {})
                if not channel_messages:
                    continue
                
                # Get first message (usually there's only one)
                msg_key = list(channel_messages.keys())[0]
                msg_ref = channel_messages[msg_key]
                
                # Resolve message definition
                message_def = None
                if isinstance(msg_ref, dict) and '$ref' in msg_ref:
                    ref_path = msg_ref['$ref']
                    if ref_path.startswith('#/components/messages/'):
                        msg_name = ref_path.split('/')[-1]
                        message_def = messages.get(msg_name, {})
                elif isinstance(msg_ref, dict):
                    message_def = msg_ref
                
                if not message_def:
                    continue
                
                # Extract event type from x_event_type extension
                event_type = message_def.get('x_event_type', 'operation')
                if event_type not in ['operation', 'response', 'notification']:
                    event_type = 'operation'  # Default
                
                # Get description
                event_description = (
                    message_def.get('summary') or 
                    message_def.get('description') or 
                    channel_description or 
                    'No description available'
                )
                
                # Extract payload schema
                payload = message_def.get('payload', {})
                request_schema = self._extract_schema(payload, schemas)
                
                # For operation events, find corresponding response
                response_schema = None
                related_events = []
                
                if event_type == 'operation':
                    # Find response event
                    response_address = f"{event_address}.response"
                    for resp_channel_key, resp_channel_info in channels.items():
                        if isinstance(resp_channel_info, dict):
                            resp_address = resp_channel_info.get('address', '')
                            if resp_address == response_address:
                                related_events.append(response_address)
                                # Extract response schema
                                resp_messages = resp_channel_info.get('messages', {})
                                if resp_messages:
                                    resp_msg_key = list(resp_messages.keys())[0]
                                    resp_msg_ref = resp_messages[resp_msg_key]
                                    if isinstance(resp_msg_ref, dict) and '$ref' in resp_msg_ref:
                                        resp_ref_path = resp_msg_ref['$ref']
                                        if resp_ref_path.startswith('#/components/messages/'):
                                            resp_msg_name = resp_ref_path.split('/')[-1]
                                            resp_message_def = messages.get(resp_msg_name, {})
                                            resp_payload = resp_message_def.get('payload', {})
                                            response_schema = self._extract_schema(resp_payload, schemas)
                                break
                    
                    # Find notification events
                    notification_pattern = event_address.replace('.', r'\.')
                    for notif_channel_key, notif_channel_info in channels.items():
                        if isinstance(notif_channel_info, dict):
                            notif_address = notif_channel_info.get('address', '')
                            if 'notification' in notif_address and re.search(notification_pattern, notif_address):
                                related_events.append(notif_address)
                
                events.append({
                    'event_name': event_address,
                    'address': event_address,
                    'mod_id': mod_id,
                    'mod_name': mod_name,
                    'mod_path': mod_full_path,
                    'event_type': event_type,
                    'description': event_description,
                    'request_schema': request_schema,
                    'response_schema': response_schema,
                    'related_events': related_events,
                    'source_file': file_path,
                })
            
            return {
                'mod_id': mod_id,
                'mod_name': mod_name,
                'mod_path': mod_full_path,
                'mod_description': mod_description,
                'events': events,
                'source_file': file_path,
            }
            
        except Exception as e:
            logger.error(f"Error parsing eventdef file {file_path}: {e}")
            return None
    
    def _extract_schema(self, payload: Any, schemas: Dict[str, Any]) -> Dict[str, Any]:
        """Extract schema information from payload definition."""
        if not isinstance(payload, dict):
            return {}
        
        # Handle $ref
        if '$ref' in payload:
            ref_path = payload['$ref']
            if ref_path.startswith('#/components/schemas/'):
                schema_name = ref_path.split('/')[-1]
                schema_def = schemas.get(schema_name, {})
                return self._normalize_schema(schema_def)
        
        # Handle inline schema
        if 'properties' in payload or 'type' in payload:
            return self._normalize_schema(payload)
        
        return {}
    
    def _normalize_schema(self, schema: Dict[str, Any]) -> Dict[str, Any]:
        """Normalize schema to a consistent format."""
        if not isinstance(schema, dict):
            return {}
        
        normalized = {
            'type': schema.get('type', 'object'),
            'properties': {},
            'required': schema.get('required', []),
        }
        
        properties = schema.get('properties', {})
        for prop_name, prop_def in properties.items():
            if isinstance(prop_def, dict):
                prop_type = prop_def.get('type', 'unknown')
                prop_desc = prop_def.get('description', '')
                prop_default = prop_def.get('default')
                
                normalized['properties'][prop_name] = {
                    'type': prop_type,
                    'description': prop_desc,
                    'default': prop_default,
                    'required': prop_name in normalized['required'],
                }
                
                # Handle nested objects
                if prop_type == 'object' and 'properties' in prop_def:
                    normalized['properties'][prop_name]['properties'] = prop_def['properties']
                
                # Handle arrays
                if prop_type == 'array' and 'items' in prop_def:
                    normalized['properties'][prop_name]['items'] = prop_def['items']
        
        return normalized
    
    def sync_from_github(self) -> Dict[str, Any]:
        """Sync event definitions from GitHub repository."""
        import time
        
        logger.info("Starting event index sync from GitHub...")
        
        eventdef_files = self.fetch_eventdef_files_from_github()
        
        all_events = []
        mods_data = {}
        
        for file_info in eventdef_files:
            file_path = file_info.get('path', '')
            
            content = self.fetch_file_content_from_github(file_path)
            if not content:
                logger.warning(f"Could not fetch content for {file_path}")
                continue
            
            parsed = self.parse_eventdef_file(content, file_path)
            if parsed:
                all_events.extend(parsed['events'])
                
                # Store mod information
                mod_id = parsed['mod_id']
                if mod_id not in mods_data:
                    mods_data[mod_id] = {
                        'mod_id': mod_id,
                        'mod_name': parsed['mod_name'],
                        'mod_path': parsed['mod_path'],
                        'mod_description': parsed['mod_description'],
                        'event_count': 0,
                    }
                mods_data[mod_id]['event_count'] += len(parsed['events'])
        
        # Index events by event_name
        self.indexed_events = {event['event_name']: event for event in all_events}
        self.indexed_mods = mods_data
        self.last_sync_time = time.time()
        
        logger.info(f"Successfully indexed {len(all_events)} events from {len(mods_data)} mods")
        
        return {
            'success': True,
            'total_events': len(all_events),
            'total_mods': len(mods_data),
            'last_sync': self.last_sync_time,
        }
    
    def get_all_events(self, mod_filter: Optional[str] = None, type_filter: Optional[str] = None) -> List[Dict[str, Any]]:
        """Get all indexed events with optional filters."""
        events = list(self.indexed_events.values())
        
        if mod_filter:
            events = [e for e in events if e.get('mod_id') == mod_filter]
        
        if type_filter:
            events = [e for e in events if e.get('event_type') == type_filter]
        
        return events
    
    def get_event(self, event_name: str) -> Optional[Dict[str, Any]]:
        """Get a specific event by name."""
        return self.indexed_events.get(event_name)
    
    def get_mods(self) -> List[Dict[str, Any]]:
        """Get all indexed mods."""
        return list(self.indexed_mods.values())
    
    def search_events(self, query: str) -> List[Dict[str, Any]]:
        """Search events by name or description."""
        query_lower = query.lower()
        results = []
        
        for event in self.indexed_events.values():
            if (query_lower in event.get('event_name', '').lower() or
                query_lower in event.get('description', '').lower() or
                query_lower in event.get('mod_name', '').lower()):
                results.append(event)
        
        return results


# Global event indexer instance
_event_indexer: Optional[EventIndexer] = None


def get_event_indexer() -> EventIndexer:
    """Get or create the global event indexer instance."""
    global _event_indexer
    if _event_indexer is None:
        _event_indexer = EventIndexer()
    return _event_indexer

