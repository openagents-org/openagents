"""
OpenAgents System Commands

This module provides centralized handling for system-level commands in the OpenAgents framework.
System commands are used for network operations like registration, listing agents, and listing mods.
"""

import logging
import json
import time
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
    certificate_data = data.get("certificate")
    force_reconnect = data.get("force_reconnect", False)
    
    if metadata is None:
        metadata = {}
    
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
        # Check if we can override the connection
        can_override = False
        
        if certificate_data:
            # Validate certificate for override
            if network_instance.identity_manager.validate_certificate(certificate_data):
                can_override = True
                logger.info(f"Agent {agent_id} provided valid certificate for override")
            else:
                logger.warning(f"Agent {agent_id} provided invalid certificate")
        elif force_reconnect:
            # Allow force reconnect without certificate (less secure)
            can_override = True
            logger.info(f"Agent {agent_id} using force_reconnect override")
        
        if can_override:
            # Clean up existing connection
            logger.info(f"Overriding existing connection for agent {agent_id}")
            await network_instance.cleanup_agent(agent_id)
        else:
            # Reject registration
            error_msg = "Agent with this ID is already connected to the network"
            if certificate_data:
                error_msg += ". Certificate validation failed."
            else:
                error_msg += ". Use force_reconnect=true or provide valid certificate to override."
            
            logger.warning(f"Agent {agent_id} registration rejected: {error_msg}")
            await connection.send(json.dumps({
                "type": "system_response",
                "command": "register_agent",
                "success": False,
                "error": error_msg
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
    await network_instance.register_agent(agent_id, metadata)
    
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


async def handle_list_mods(command: str, data: Dict[str, Any], connection: ServerConnection,
                               network_instance: Any) -> None:
    """Handle the list_mods command.
    
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
    
    # Get all unique mod names from both mods and mod_manifests
    all_mod_names = set(network_instance.mods.keys())
    
    # Add mod names from manifests if they exist
    if hasattr(network_instance, "mod_manifests"):
        all_mod_names.update(network_instance.mod_manifests.keys())
    
    # Prepare mod list with relevant information
    mod_list = []
    
    for mod_name in all_mod_names:
        mod_info = {
            "name": mod_name,
            "description": "No description available",
            "version": "1.0.0",
            "requires_adapter": False,
            "capabilities": []
        }
        
        # Add implementation-specific information if available
        if mod_name in network_instance.mods:
            mod = network_instance.mods[mod_name]
            mod_info.update({
                "description": getattr(mod, "description", mod_info["description"]),
                "version": getattr(mod, "version", mod_info["version"]),
                "requires_adapter": getattr(mod, "requires_adapter", mod_info["requires_adapter"]),
                "capabilities": getattr(mod, "capabilities", mod_info["capabilities"]),
                "implementation": mod.__class__.__module__ + "." + mod.__class__.__name__
            })
        
        # Add manifest information if available (overriding implementation info)
        if mod_name in network_instance.mod_manifests:
            manifest = network_instance.mod_manifests[mod_name]
            mod_info.update({
                "version": manifest.version,
                "description": manifest.description,
                "capabilities": manifest.capabilities,
                "authors": manifest.authors,
                "license": manifest.license,
                "requires_adapter": manifest.requires_adapter,
                "network_mod_class": manifest.network_mod_class
            })
        
        mod_list.append(mod_info)
    
    # Send response
    try:
        response = {
            "type": "system_response",
            "command": "list_mods",
            "success": True,
            "mods": mod_list
        }
        
        # Include request_id if it was provided in the original request
        if "request_id" in data:
            response["request_id"] = data["request_id"]
            
        await connection.send(json.dumps(response))
        logger.debug(f"Sent mod list to {requesting_agent_id}")
    except Exception as e:
        logger.error(f"Failed to send mod list to {requesting_agent_id}: {e}")


async def handle_get_mod_manifest(command: str, data: Dict[str, Any], connection: ServerConnection,
                                     network_instance: Any) -> None:
    """Handle the get_mod_manifest command.
    
    Args:
        command: The command name
        data: The command data
        connection: The WebSocket connection
        network_instance: The network instance
    """
    requesting_agent_id = data.get("agent_id")
    mod_name = data.get("mod_name")
    
    if requesting_agent_id not in network_instance.connections:
        logger.warning(f"Agent {requesting_agent_id} not connected")
        return
    
    if not mod_name:
        await connection.send(json.dumps({
            "type": "system_response",
            "command": "get_mod_manifest",
            "success": False,
            "error": "Missing mod_name parameter"
        }))
        return
    
    # Check if we have a manifest for this mod
    if mod_name in network_instance.mod_manifests:
        manifest = network_instance.mod_manifests[mod_name]
        
        # Convert manifest to dict for JSON serialization
        manifest_dict = manifest.model_dump()
        
        await connection.send(json.dumps({
            "type": "system_response",
            "command": "get_mod_manifest",
            "success": True,
            "mod_name": mod_name,
            "manifest": manifest_dict
        }))
        logger.debug(f"Sent mod manifest for {mod_name} to {requesting_agent_id}")
    else:
        # Try to load the manifest if it's not already loaded
        manifest = network_instance.load_mod_manifest(mod_name)
        
        if manifest:
            # Convert manifest to dict for JSON serialization
            manifest_dict = manifest.model_dump()
            
            await connection.send(json.dumps({
                "type": "system_response",
                "command": "get_mod_manifest",
                "success": True,
                "mod_name": mod_name,
                "manifest": manifest_dict
            }))
            logger.debug(f"Loaded and sent mod manifest for {mod_name} to {requesting_agent_id}")
        else:
            await connection.send(json.dumps({
                "type": "system_response",
                "command": "get_mod_manifest",
                "success": False,
                "mod_name": mod_name,
                "error": f"No manifest found for mod {mod_name}"
            }))
            logger.warning(f"No manifest found for mod {mod_name}")


async def handle_get_network_info(command: str, data: Dict[str, Any], connection: ServerConnection,
                                 network_instance: Any) -> None:
    """Handle the get_network_info command.
    
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
    
    # Prepare network info
    network_info = {
        "name": network_instance.network_name,
        "node_id": network_instance.network_id,
        "mode": "centralized" if hasattr(network_instance.topology, 'server_mode') else "decentralized",
        "mods": list(network_instance.mods.keys()),
        "agent_count": len(network_instance.connections)
    }
    
    # Send response
    try:
        response = {
            "type": "system_response",
            "command": "get_network_info",
            "success": True,
            "network_info": network_info
        }
        
        # Include request_id if it was provided in the original request
        if "request_id" in data:
            response["request_id"] = data["request_id"]
            
        await connection.send(json.dumps(response))
        logger.debug(f"Sent network info to {requesting_agent_id}")
    except Exception as e:
        logger.error(f"Failed to send network info to {requesting_agent_id}: {e}")


async def handle_ping_agent(command: str, data: Dict[str, Any], connection: ServerConnection,
                           network_instance: Any) -> None:
    """Handle the ping_agent command.
    
    Args:
        command: The command name
        data: The command data
        connection: The WebSocket connection
        network_instance: The network instance
    """
    try:
        # Send pong response
        await connection.send(json.dumps({
            "type": "system_response",
            "command": "ping_agent",
            "success": True,
            "timestamp": data.get("timestamp", time.time())
        }))
        logger.debug("Responded to ping")
    except Exception as e:
        logger.error(f"Error handling ping: {e}")


async def handle_claim_agent_id(command: str, data: Dict[str, Any], connection: ServerConnection,
                              network_instance: Any) -> None:
    """Handle the claim_agent_id command.
    
    Args:
        command: The command name
        data: The command data
        connection: The WebSocket connection
        network_instance: The network instance
    """
    agent_id = data.get("agent_id")
    force = data.get("force", False)
    
    if not agent_id:
        await connection.send(json.dumps({
            "type": "system_response",
            "command": "claim_agent_id",
            "success": False,
            "error": "Missing agent_id"
        }))
        return
    
    try:
        # Try to claim the agent ID
        certificate = network_instance.identity_manager.claim_agent_id(agent_id, force=force)
        
        if certificate:
            await connection.send(json.dumps({
                "type": "system_response",
                "command": "claim_agent_id",
                "success": True,
                "agent_id": agent_id,
                "certificate": certificate.to_dict()
            }))
            logger.info(f"Issued certificate for agent ID {agent_id}")
        else:
            await connection.send(json.dumps({
                "type": "system_response",
                "command": "claim_agent_id",
                "success": False,
                "error": f"Agent ID {agent_id} is already claimed"
            }))
            logger.warning(f"Failed to claim agent ID {agent_id} - already claimed")
    
    except Exception as e:
        logger.error(f"Error claiming agent ID {agent_id}: {e}")
        await connection.send(json.dumps({
            "type": "system_response",
            "command": "claim_agent_id",
            "success": False,
            "error": f"Internal error: {str(e)}"
        }))


async def handle_validate_certificate(command: str, data: Dict[str, Any], connection: ServerConnection,
                                    network_instance: Any) -> None:
    """Handle the validate_certificate command.
    
    Args:
        command: The command name
        data: The command data
        connection: The WebSocket connection
        network_instance: The network instance
    """
    certificate_data = data.get("certificate")
    
    if not certificate_data:
        await connection.send(json.dumps({
            "type": "system_response",
            "command": "validate_certificate",
            "success": False,
            "error": "Missing certificate data"
        }))
        return
    
    try:
        # Validate the certificate
        is_valid = network_instance.identity_manager.validate_certificate(certificate_data)
        
        await connection.send(json.dumps({
            "type": "system_response",
            "command": "validate_certificate",
            "success": True,
            "valid": is_valid,
            "agent_id": certificate_data.get("agent_id")
        }))
        
        logger.debug(f"Certificate validation result for {certificate_data.get('agent_id')}: {is_valid}")
    
    except Exception as e:
        logger.error(f"Error validating certificate: {e}")
        await connection.send(json.dumps({
            "type": "system_response",
            "command": "validate_certificate",
            "success": False,
            "error": f"Internal error: {str(e)}"
        }))


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
LIST_MODS = "list_mods"
GET_MOD_MANIFEST = "get_mod_manifest"
PING_AGENT = "ping_agent"
CLAIM_AGENT_ID = "claim_agent_id"
VALIDATE_CERTIFICATE = "validate_certificate"
GET_NETWORK_INFO = "get_network_info"

# Default system command registry
default_registry = SystemCommandRegistry() 