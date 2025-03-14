"""
OpenAgents System Commands

This module provides centralized handling for system-level commands in the OpenAgents framework.
System commands are used for network operations like registration, listing agents, and listing protocols.
"""

import logging
import json
from typing import Dict, Any, List, Optional, Callable, Awaitable, Union
import asyncio
from websockets.asyncio.server import ServerConnection

logger = logging.getLogger(__name__)

# Type definitions
SystemCommandHandler = Callable[[str, Dict[str, Any], ServerConnection], Awaitable[None]]
SystemResponseHandler = Callable[[Dict[str, Any]], Awaitable[None]]


class SystemCommandRegistry:
    """Registry for system commands and their handlers."""
    
    def __init__(self):
        """Initialize the system command registry."""
        self.command_handlers: Dict[str, SystemCommandHandler] = {}
    
    def register_handler(self, command: str, handler: SystemCommandHandler) -> None:
        """Register a handler for a system command.
        
        Args:
            command: The command to handle
            handler: The handler function
        """
        self.command_handlers[command] = handler
        logger.debug(f"Registered handler for system command: {command}")
    
    async def handle_command(self, command: str, data: Dict[str, Any], connection: ServerConnection) -> bool:
        """Handle a system command.
        
        Args:
            command: The command to handle
            data: The command data
            connection: The WebSocket connection
            
        Returns:
            bool: True if the command was handled, False otherwise
        """
        if command in self.command_handlers:
            await self.command_handlers[command](command, data, connection)
            return True
        return False


# Server-side command handlers

async def handle_register_agent(command: str, data: Dict[str, Any], connection: ServerConnection, 
                               network_instance: Any) -> None:
    """Handle the register_agent command.
    
    Args:
        command: The command name
        data: The command data
        connection: The WebSocket connection
        network_instance: The network instance
    """
    agent_id = data.get("agent_id")
    metadata = data.get("metadata", {})
    
    if not agent_id:
        logger.error("Registration message missing agent_id")
        await connection.send(json.dumps({
            "type": "system_response",
            "command": "register_agent",
            "success": False,
            "error": "Missing agent_id"
        }))
        return
    
    # Check if agent is already registered
    if agent_id in network_instance.connections:
        logger.warning(f"Agent {agent_id} is already connected to the network")
        await connection.send(json.dumps({
            "type": "system_response",
            "command": "register_agent",
            "success": False,
            "error": "Agent with this ID is already connected to the network"
        }))
        return
    
    logger.info(f"Received registration from agent {agent_id}")
    
    # Store connection
    from .network import AgentConnection
    network_instance.connections[agent_id] = AgentConnection(
        agent_id=agent_id,
        connection=connection,
        metadata=metadata,
        last_activity=asyncio.get_event_loop().time()
    )
    
    # Register agent metadata
    network_instance.register_agent(agent_id, metadata)
    
    # Send registration response
    await connection.send(json.dumps({
        "type": "system_response",
        "command": "register_agent",
        "success": True,
        "network_name": network_instance.network_name,
        "network_id": network_instance.network_id,
        "metadata": network_instance.metadata
    }))


async def handle_list_agents(command: str, data: Dict[str, Any], connection: ServerConnection,
                            network_instance: Any) -> None:
    """Handle the list_agents command.
    
    Args:
        command: The command name
        data: The command data
        connection: The WebSocket connection
        network_instance: The network instance
    """
    requesting_agent_id = data.get("agent_id")
    
    if requesting_agent_id not in network_instance.connections:
        logger.warning(f"Agent {requesting_agent_id} not connected")
        return
        
    # Prepare agent list with relevant information
    agent_list = []
    for agent_id, metadata in network_instance.agents.items():
        agent_info = {
            "agent_id": agent_id,
            "name": metadata.get("name", agent_id),
            "connected": agent_id in network_instance.connections,
            "metadata": metadata
        }
        agent_list.append(agent_info)
        
    # Send response
    try:
        await connection.send(json.dumps({
            "type": "system_response",
            "command": "list_agents",
            "success": True,
            "agents": agent_list
        }))
        logger.debug(f"Sent agent list to {requesting_agent_id}")
    except Exception as e:
        logger.error(f"Failed to send agent list to {requesting_agent_id}: {e}")


async def handle_list_protocols(command: str, data: Dict[str, Any], connection: ServerConnection,
                               network_instance: Any) -> None:
    """Handle the list_protocols command.
    
    Args:
        command: The command name
        data: The command data
        connection: The WebSocket connection
        network_instance: The network instance
    """
    requesting_agent_id = data.get("agent_id")
    
    if requesting_agent_id not in network_instance.connections:
        logger.warning(f"Agent {requesting_agent_id} not connected")
        return
    
    # Get all unique protocol names from both protocols and protocol_manifests
    all_protocol_names = set(network_instance.protocols.keys())
    
    # Add protocol names from manifests if they exist
    if hasattr(network_instance, "protocol_manifests"):
        all_protocol_names.update(network_instance.protocol_manifests.keys())
    
    # Prepare protocol list with relevant information
    protocol_list = []
    
    for protocol_name in all_protocol_names:
        protocol_info = {
            "name": protocol_name,
            "description": "No description available",
            "version": "1.0.0",
            "requires_adapter": False,
            "capabilities": []
        }
        
        # Add implementation-specific information if available
        if protocol_name in network_instance.protocols:
            protocol = network_instance.protocols[protocol_name]
            protocol_info.update({
                "description": getattr(protocol, "description", protocol_info["description"]),
                "version": getattr(protocol, "version", protocol_info["version"]),
                "requires_adapter": getattr(protocol, "requires_adapter", protocol_info["requires_adapter"]),
                "capabilities": getattr(protocol, "capabilities", protocol_info["capabilities"]),
                "implementation": protocol.__class__.__module__ + "." + protocol.__class__.__name__
            })
        
        # Add manifest information if available (overriding implementation info)
        if protocol_name in network_instance.protocol_manifests:
            manifest = network_instance.protocol_manifests[protocol_name]
            protocol_info.update({
                "version": manifest.version,
                "description": manifest.description,
                "capabilities": manifest.capabilities,
                "authors": manifest.authors,
                "license": manifest.license,
                "requires_adapter": manifest.requires_adapter,
                "network_protocol_class": manifest.network_protocol_class
            })
        
        protocol_list.append(protocol_info)
    
    # Send response
    try:
        await connection.send(json.dumps({
            "type": "system_response",
            "command": "list_protocols",
            "success": True,
            "protocols": protocol_list
        }))
        logger.debug(f"Sent protocol list to {requesting_agent_id}")
    except Exception as e:
        logger.error(f"Failed to send protocol list to {requesting_agent_id}: {e}")


async def handle_get_protocol_manifest(command: str, data: Dict[str, Any], connection: ServerConnection,
                                     network_instance: Any) -> None:
    """Handle the get_protocol_manifest command.
    
    Args:
        command: The command name
        data: The command data
        connection: The WebSocket connection
        network_instance: The network instance
    """
    requesting_agent_id = data.get("agent_id")
    protocol_name = data.get("protocol_name")
    
    if requesting_agent_id not in network_instance.connections:
        logger.warning(f"Agent {requesting_agent_id} not connected")
        return
    
    if not protocol_name:
        await connection.send(json.dumps({
            "type": "system_response",
            "command": "get_protocol_manifest",
            "success": False,
            "error": "Missing protocol_name parameter"
        }))
        return
    
    # Check if we have a manifest for this protocol
    if protocol_name in network_instance.protocol_manifests:
        manifest = network_instance.protocol_manifests[protocol_name]
        
        # Convert manifest to dict for JSON serialization
        manifest_dict = manifest.model_dump()
        
        await connection.send(json.dumps({
            "type": "system_response",
            "command": "get_protocol_manifest",
            "success": True,
            "protocol_name": protocol_name,
            "manifest": manifest_dict
        }))
        logger.debug(f"Sent protocol manifest for {protocol_name} to {requesting_agent_id}")
    else:
        # Try to load the manifest if it's not already loaded
        manifest = network_instance.load_protocol_manifest(protocol_name)
        
        if manifest:
            # Convert manifest to dict for JSON serialization
            manifest_dict = manifest.model_dump()
            
            await connection.send(json.dumps({
                "type": "system_response",
                "command": "get_protocol_manifest",
                "success": True,
                "protocol_name": protocol_name,
                "manifest": manifest_dict
            }))
            logger.debug(f"Loaded and sent protocol manifest for {protocol_name} to {requesting_agent_id}")
        else:
            await connection.send(json.dumps({
                "type": "system_response",
                "command": "get_protocol_manifest",
                "success": False,
                "protocol_name": protocol_name,
                "error": f"No manifest found for protocol {protocol_name}"
            }))
            logger.warning(f"No manifest found for protocol {protocol_name}")


# Client-side command handling

async def send_system_request(connection: ServerConnection, command: str, **kwargs) -> bool:
    """Send a system request to the server.
    
    Args:
        connection: The WebSocket connection
        command: The command to send
        **kwargs: Additional parameters for the command
        
    Returns:
        bool: True if the request was sent successfully
    """
    try:
        request_data = {
            "type": "system_request",
            "command": command,
            **kwargs
        }
        await connection.send(json.dumps(request_data))
        logger.debug(f"Sent system request: {command}")
        return True
    except Exception as e:
        logger.error(f"Failed to send system request {command}: {e}")
        return False


# Command constants
REGISTER_AGENT = "register_agent"
LIST_AGENTS = "list_agents"
LIST_PROTOCOLS = "list_protocols"
GET_PROTOCOL_MANIFEST = "get_protocol_manifest"

# Default system command registry
default_registry = SystemCommandRegistry() 