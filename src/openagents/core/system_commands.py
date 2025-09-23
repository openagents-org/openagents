"""
OpenAgents System Commands

This module provides centralized handling for system-level commands in the OpenAgents framework.
System commands are used for network operations like registration, listing agents, and listing mods.
"""

import logging
import time
from typing import TYPE_CHECKING, Dict, Any, List, Optional, Callable, Awaitable, Union
from openagents.config.globals import (
    SYSTEM_EVENT_REGISTER_AGENT,
    SYSTEM_EVENT_UNREGISTER_AGENT,
    SYSTEM_EVENT_LIST_AGENTS,
    SYSTEM_EVENT_LIST_MODS,
    SYSTEM_EVENT_GET_MOD_MANIFEST,
    SYSTEM_EVENT_GET_NETWORK_INFO,
    SYSTEM_EVENT_CLAIM_AGENT_ID,
    SYSTEM_EVENT_VALIDATE_CERTIFICATE,
    SYSTEM_EVENT_POLL_MESSAGES,
    SYSTEM_EVENT_SUBSCRIBE_EVENTS,
    SYSTEM_EVENT_UNSUBSCRIBE_EVENTS,
    SYSTEM_EVENT_HEALTH_CHECK,
    SYSTEM_EVENT_HEARTBEAT,
    SYSTEM_EVENT_PING_AGENT,
    SYSTEM_EVENT_ADD_CHANNEL_MEMBER,
    SYSTEM_EVENT_REMOVE_CHANNEL_MEMBER,
    SYSTEM_EVENT_GET_CHANNEL_MEMBERS,
    SYSTEM_EVENT_REMOVE_CHANNEL,
    SYSTEM_EVENT_LIST_CHANNELS
)
from openagents.models.event import Event
from openagents.models.event_response import EventResponse
from openagents.models.transport import TransportType
if TYPE_CHECKING:
    from openagents.core.network import AgentNetwork

logger = logging.getLogger(__name__)

# Type definitions
SystemCommandHandler = Callable[["SystemCommandProcessor", Event], Awaitable[EventResponse]]

class SystemCommandProcessor:
    """Centralized processor for all system commands."""

    def __init__(self, network: "AgentNetwork"):
        self.network = network
        self.logger = logging.getLogger(f"{__name__}.{network.network_id}")
        
        # Register all command handlers using event names from globals
        self.command_handlers: Dict[str, SystemCommandHandler] = {
            SYSTEM_EVENT_REGISTER_AGENT: self.handle_register_agent,
            SYSTEM_EVENT_UNREGISTER_AGENT: self.handle_unregister_agent,
            SYSTEM_EVENT_LIST_AGENTS: self.handle_list_agents,
            SYSTEM_EVENT_LIST_MODS: self.handle_list_mods,
            SYSTEM_EVENT_GET_MOD_MANIFEST: self.handle_get_mod_manifest,
            SYSTEM_EVENT_GET_NETWORK_INFO: self.handle_get_network_info,
            SYSTEM_EVENT_PING_AGENT: self.handle_heartbeat,
            SYSTEM_EVENT_CLAIM_AGENT_ID: self.handle_claim_agent_id,
            SYSTEM_EVENT_VALIDATE_CERTIFICATE: self.handle_validate_certificate,
            SYSTEM_EVENT_POLL_MESSAGES: self.handle_poll_messages,
            SYSTEM_EVENT_SUBSCRIBE_EVENTS: self.handle_subscribe_events,
            SYSTEM_EVENT_UNSUBSCRIBE_EVENTS: self.handle_unsubscribe_events,
            SYSTEM_EVENT_HEALTH_CHECK: self.handle_health_check,  # Health check uses same logic as ping
            SYSTEM_EVENT_HEARTBEAT: self.handle_heartbeat,  # Heartbeat uses same logic as ping
            SYSTEM_EVENT_ADD_CHANNEL_MEMBER: self.handle_add_channel_member,
            SYSTEM_EVENT_REMOVE_CHANNEL_MEMBER: self.handle_remove_channel_member,
            SYSTEM_EVENT_GET_CHANNEL_MEMBERS: self.handle_get_channel_members,
            SYSTEM_EVENT_REMOVE_CHANNEL: self.handle_remove_channel,
            SYSTEM_EVENT_LIST_CHANNELS: self.handle_list_channels,
        }

    async def process_command(self, system_event: Event) -> Optional[EventResponse]:
        """
        Process a system event and return the response.
        
        Args:
            system_event: The system event to process
            
        Returns:
            Optional[EventResponse]: The response to the event, or None if the event is not processed
        """
        # Use the full event name for command matching
        event_name = system_event.event_name
        self.logger.debug(f"Processing system event: {event_name}")
        
        # Execute the command
        if event_name in self.command_handlers:
            try:
                return await self.command_handlers[event_name](system_event)
            except Exception as e:
                self.logger.error(f"Error processing system event {event_name}: {e}")
                import traceback
                self.logger.error(f"Traceback: {traceback.format_exc()}")
                return EventResponse(
                    success=False,
                    message=f"Internal error processing event {event_name}: {str(e)}"
                )
        return None
    
    async def handle_health_check(self, event: Event) -> EventResponse:
        """Handle the health_check command.
        
        Returns comprehensive network health information including:
        - Network configuration and status
        - Agent statistics (count, online status)
        - Event gateway statistics
        - System uptime and performance metrics
        """
        # Get network statistics
        network_stats = self.network.get_network_stats()
        
        return EventResponse(
            success=True,
            message="Health check completed successfully",
            data=network_stats
        )
            
    
    def _format_uptime(self, uptime_seconds: float) -> str:
        """Format uptime in a human-readable format.
        
        Args:
            uptime_seconds: Uptime in seconds
            
        Returns:
            str: Formatted uptime string
        """
        if uptime_seconds < 60:
            return f"{uptime_seconds:.1f} seconds"
        elif uptime_seconds < 3600:
            minutes = uptime_seconds / 60
            return f"{minutes:.1f} minutes"
        elif uptime_seconds < 86400:
            hours = uptime_seconds / 3600
            return f"{hours:.1f} hours"
        else:
            days = uptime_seconds / 86400
            return f"{days:.1f} days"
    
    async def handle_register_agent(self, event: Event) -> EventResponse:
        """Handle the register_agent command."""
        agent_id = event.payload.get("agent_id", event.source_id)
        transport_type = event.payload.get("transport_type", TransportType.GRPC)
        metadata = event.payload.get("metadata", {})
        certificate = event.payload.get("certificate", None)
        force_reconnect = event.payload.get("force_reconnect", False)

        return await self.network.register_agent(agent_id, transport_type, metadata, certificate, force_reconnect)
    
    async def handle_unregister_agent(self, event: Event) -> EventResponse:
        """Handle the unregister_agent command."""
        agent_id = event.payload.get("agent_id", event.source_id)
        return await self.network.unregister_agent(agent_id)
        
    async def handle_list_agents(self, event: Event) -> EventResponse:
        """Handle the list_agents command."""
        requesting_agent_id = event.payload.get("agent_id", event.source_id)
        
        agent_registry = self.network.get_agent_registry()
        if requesting_agent_id not in agent_registry:
            self.logger.warning(f"Agent {requesting_agent_id} not registered")
            return EventResponse(
                success=False,
                message="Agent not registered"
            )
            
        # Prepare agent list with relevant information
        agent_list = []
        for agent_id, info in agent_registry.items():
            metadata = info.metadata
            agent_info = {
                "agent_id": agent_id,
                "name": metadata.get("name", agent_id),
                "connected": True,  # All agents in deprecated_agents are considered connected
                "metadata": metadata
            }
            agent_list.append(agent_info)
            
        return EventResponse(
            success=True,
            message="Agent list retrieved successfully",
            data={
                "type": "system_response",
                "command": "list_agents",
                "agents": agent_list
            }
        )

    async def handle_list_mods(self, event: Event) -> EventResponse:
        """Handle the list_mods command."""
        requesting_agent_id = event.payload.get("agent_id", event.source_id)
        
        self.logger.info(f"🔧 LIST_MODS: Request from agent_id: {requesting_agent_id}")
        
        agent_registry = self.network.get_agent_registry()
        if requesting_agent_id not in agent_registry:
            self.logger.warning(f"Agent {requesting_agent_id} not registered")
            return EventResponse(
                success=False,
                message="Agent not registered"
            )
        
        # Get all unique mod names from both mods and mod_manifests
        all_mod_names = set(self.network.mods.keys())
        
        # Add mod names from manifests if they exist
        if hasattr(self.network, "mod_manifests"):
            all_mod_names.update(self.network.mod_manifests.keys())
        
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
            if mod_name in self.network.mods:
                mod = self.network.mods[mod_name]
                mod_info.update({
                    "description": getattr(mod, "description", mod_info["description"]),
                    "version": getattr(mod, "version", mod_info["version"]),
                    "requires_adapter": getattr(mod, "requires_adapter", mod_info["requires_adapter"]),
                    "capabilities": getattr(mod, "capabilities", mod_info["capabilities"]),
                    "implementation": mod.__class__.__module__ + "." + mod.__class__.__name__
                })
            
            # Add manifest information if available (overriding implementation info)
            if hasattr(self.network, "mod_manifests") and mod_name in self.network.mod_manifests:
                manifest = self.network.mod_manifests[mod_name]
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
        
        response_data = {
            "type": "system_response",
            "command": "list_mods",
            "mods": mod_list
        }
        
        # Include request_id if it was provided in the original request
        if "request_id" in event.payload:
            response_data["request_id"] = event.payload["request_id"]
            
        return EventResponse(
            success=True,
            message="Mod list retrieved successfully",
            data=response_data
        )

    async def handle_get_mod_manifest(self, event: Event) -> EventResponse:
        """Handle the get_mod_manifest command."""
        requesting_agent_id = event.payload.get("agent_id", event.source_id)
        mod_name = event.payload.get("mod_name")
        
        agent_registry = self.network.get_agent_registry()
        if requesting_agent_id not in agent_registry:
            self.logger.warning(f"Agent {requesting_agent_id} not registered")
            return EventResponse(
                success=False,
                message="Agent not registered"
            )
        
        if not mod_name:
            return EventResponse(
                success=False,
                message="Missing mod_name parameter"
            )
        
        # Check if we have a manifest for this mod
        if hasattr(self.network, "mod_manifests") and mod_name in self.network.mod_manifests:
            manifest = self.network.mod_manifests[mod_name]
            
            # Convert manifest to dict for JSON serialization
            manifest_dict = manifest.model_dump()
            
            return EventResponse(
                success=True,
                message="Mod manifest retrieved successfully",
                data={
                    "type": "system_response",
                    "command": "get_mod_manifest",
                    "mod_name": mod_name,
                    "manifest": manifest_dict
                }
            )
        else:
            # Try to load the manifest if it's not already loaded
            if hasattr(self.network, "load_mod_manifest"):
                manifest = self.network.load_mod_manifest(mod_name)
                
                if manifest:
                    # Convert manifest to dict for JSON serialization
                    manifest_dict = manifest.model_dump()
                    
                    return EventResponse(
                        success=True,
                        message="Mod manifest retrieved successfully",
                        data={
                            "type": "system_response",
                            "command": "get_mod_manifest",
                            "mod_name": mod_name,
                            "manifest": manifest_dict
                        }
                    )
            
            return EventResponse(
                success=False,
                message=f"No manifest found for mod {mod_name}",
                data={
                    "type": "system_response",
                    "command": "get_mod_manifest",
                    "mod_name": mod_name
                }
            )

    async def handle_get_network_info(self, event: Event) -> EventResponse:
        """Handle the get_network_info command."""
        requesting_agent_id = event.payload.get("agent_id", event.source_id)
        
        # Allow temporary studio connections to fetch network info without being registered
        is_studio_temp = requesting_agent_id and requesting_agent_id.startswith("studio_temp_")
        
        if is_studio_temp:
            self.logger.debug(f"Studio frontend requesting network info via temporary connection: {requesting_agent_id}")
        elif requesting_agent_id not in self.network.deprecated_agents:
            self.logger.warning(f"Agent {requesting_agent_id} not registered")
            return EventResponse(
                success=False,
                message="Agent not registered"
            )
        
        # Prepare network info
        network_info = {
            "name": self.network.network_name,
            "node_id": self.network.network_id,
            "mode": "centralized" if hasattr(self.network.topology, 'server_mode') else "decentralized",
            "mods": list(self.network.mods.keys()),
            "agent_count": len(self.network.get_agent_registry())
        }
        
        # Include workspace path if available in metadata
        if hasattr(self.network, 'metadata') and 'workspace_path' in self.network.metadata:
            network_info["workspace_path"] = self.network.metadata['workspace_path']
        
        response_data = {
            "type": "system_response",
            "command": "get_network_info",
            "network_info": network_info
        }
        
        # Include request_id if it was provided in the original request
        if "request_id" in event.payload:
            response_data["request_id"] = event.payload["request_id"]
            
        return EventResponse(
            success=True,
            message="Network info retrieved successfully",
            data=response_data
        )

    async def handle_heartbeat(self, event: Event) -> EventResponse:
        """Handle the ping_agent command."""
        # Record heartbeat
        await self.network.topology.record_heartbeat(event.parse_source().source_id)
        return EventResponse(
            success=True,
            message="Ping successful",
            data={
                "type": "system_response",
                "command": "ping_agent",
                "timestamp": event.payload.get("timestamp", time.time())
            }
        )

    async def handle_claim_agent_id(self, event: Event) -> EventResponse:
        """Handle the claim_agent_id command."""
        agent_id = event.payload.get("agent_id", event.source_id)
        force = event.payload.get("force", False)
        
        if not agent_id:
            return EventResponse(
                success=False,
                message="Missing agent_id"
            )
        
        try:
            # Try to claim the agent ID
            certificate = self.network.identity_manager.claim_agent_id(agent_id, force=force)
            
            if certificate:
                self.logger.info(f"Issued certificate for agent ID {agent_id}")
                return EventResponse(
                    success=True,
                    message=f"Agent ID {agent_id} claimed successfully",
                    data={
                        "type": "system_response",
                        "command": "claim_agent_id",
                        "agent_id": agent_id,
                        "certificate": certificate.to_dict()
                    }
                )
            else:
                self.logger.warning(f"Failed to claim agent ID {agent_id} - already claimed")
                return EventResponse(
                    success=False,
                    message=f"Agent ID {agent_id} is already claimed"
                )
        
        except Exception as e:
            self.logger.error(f"Error claiming agent ID {agent_id}: {e}")
            return EventResponse(
                success=False,
                message=f"Internal error: {str(e)}"
            )

    async def handle_validate_certificate(self, event: Event) -> EventResponse:
        """Handle the validate_certificate command."""
        certificate_data = event.payload.get("certificate")
        
        if not certificate_data:
            return EventResponse(
                success=False,
                message="Missing certificate data"
            )
        
        try:
            # Validate the certificate
            is_valid = self.network.identity_manager.validate_certificate(certificate_data)
            
            self.logger.debug(f"Certificate validation result for {certificate_data.get('agent_id')}: {is_valid}")
            return EventResponse(
                success=True,
                message=f"Certificate validation completed: {'valid' if is_valid else 'invalid'}",
                data={
                    "type": "system_response",
                    "command": "validate_certificate",
                    "valid": is_valid,
                    "agent_id": certificate_data.get("agent_id")
                }
            )
        
        except Exception as e:
            self.logger.error(f"Error validating certificate: {e}")
            return EventResponse(
                success=False,
                message=f"Internal error: {str(e)}"
            )

    async def handle_poll_messages(self, event: Event) -> EventResponse:
        """Handle the poll_messages command for gRPC agents."""
        self.logger.info(f"🔧 POLL_MESSAGES: Handler called for event: {event.event_name}")
        
        requesting_agent_id = event.payload.get("agent_id", event.source_id)
        self.logger.info(f"🔧 POLL_MESSAGES: Requesting agent: {requesting_agent_id}")
        
        if not requesting_agent_id:
            self.logger.warning("poll_messages command missing agent_id")
            return EventResponse(
                success=False,
                message="Missing agent_id"
            )
        
        agent_registry = self.network.get_agent_registry()
        if requesting_agent_id not in agent_registry:
            self.logger.warning(f"Agent {requesting_agent_id} not registered")
            return EventResponse(
                success=False,
                message="Agent not registered"
            )
        
        # Get queued messages for the agent from event gateway
        messages = await self.network.event_gateway.poll_events(requesting_agent_id)
        
        # Convert messages to serializable format
        serialized_messages = []
        for i, message in enumerate(messages):
            self.logger.debug(f"🔧 POLL_MESSAGES: Serializing message {i}: {type(message)}")
            serialized_msg = None
            
            # Try to_dict() first (works for Event objects)
            if hasattr(message, 'to_dict'):
                try:
                    serialized_msg = message.to_dict()
                    self.logger.info(f"🔧 POLL_MESSAGES: Used to_dict() for message {i}")
                except Exception as to_dict_error:
                    self.logger.error(f"🔧 POLL_MESSAGES: to_dict() failed for message {i}: {to_dict_error}")
                    serialized_msg = None
            elif hasattr(message, 'model_dump'):
                try:
                    serialized_msg = message.model_dump()
                    self.logger.info(f"🔧 POLL_MESSAGES: Used model_dump() for message {i}")
                except Exception as model_dump_error:
                    self.logger.warning(f"🔧 POLL_MESSAGES: model_dump failed for message {i}: {model_dump_error}")
                    serialized_msg = None
            elif hasattr(message, 'dict'):
                serialized_msg = message.dict()
                self.logger.info(f"🔧 POLL_MESSAGES: Used dict() for message {i}")
            elif hasattr(message, '__dict__'):
                import datetime
                serialized_msg = {}
                for key, value in message.__dict__.items():
                    # Handle datetime objects
                    if isinstance(value, datetime.datetime):
                        serialized_msg[key] = value.isoformat()
                    else:
                        serialized_msg[key] = value
                self.logger.info(f"🔧 POLL_MESSAGES: Used __dict__ with datetime handling for message {i}")
            else:
                serialized_msg = str(message)
                self.logger.info(f"🔧 POLL_MESSAGES: Used str() for message {i}")
            
            if serialized_msg is not None:
                serialized_messages.append(serialized_msg)
            else:
                self.logger.error(f"🔧 POLL_MESSAGES: Failed to serialize message {i} - all methods failed")
                serialized_messages.append({})
        
        self.logger.info(f"🔧 POLL_MESSAGES: Serialized {len(serialized_messages)} messages")
        
        response_data = {
            "type": "system_response",
            "command": "poll_messages",
            "messages": serialized_messages
        }
        
        # Include request_id if it was provided in the original request
        if "request_id" in event.payload:
            response_data["request_id"] = event.payload["request_id"]
        
        self.logger.info(f"🔧 POLL_MESSAGES: Sending response with {len(serialized_messages)} messages to {requesting_agent_id}")
        return EventResponse(
            success=True,
            message=f"Retrieved {len(serialized_messages)} messages",
            data=response_data
        )

    async def handle_subscribe_events(self, event: Event) -> EventResponse:
        """Handle the subscribe_events command."""
        requesting_agent_id = event.payload.get("agent_id", event.source_id)
        event_patterns = event.payload.get("event_patterns", [])
        channels = event.payload.get("channels", [])
        
        self.logger.info(f"🔧 SUBSCRIBE_EVENTS: Request from agent_id: {requesting_agent_id}")
        
        agent_registry = self.network.get_agent_registry()
        if requesting_agent_id not in agent_registry:
            self.logger.warning(f"Agent {requesting_agent_id} not registered")
            return EventResponse(
                success=False,
                message="Agent not registered"
            )
        
        if not event_patterns:
            return EventResponse(
                success=False,
                message="Missing event_patterns parameter"
            )
        
        subscription = self.network.event_gateway.subscribe(
            agent_id=requesting_agent_id,
            event_patterns=event_patterns,
            channels=channels if channels else []
        )
        
        response_data = {
            "type": "system_response",
            "command": "subscribe_events",
            "subscription_id": subscription.subscription_id,
            "agent_id": requesting_agent_id,
            "event_patterns": event_patterns,
            "channels": list(channels) if channels else []
        }
        
        # Include request_id if it was provided in the original request
        if "request_id" in event.payload:
            response_data["request_id"] = event.payload["request_id"]
        
        self.logger.info(f"🔧 SUBSCRIBE_EVENTS: Created subscription {subscription.subscription_id} for {requesting_agent_id}")
        return EventResponse(
            success=True,
            message=f"Successfully subscribed to {len(event_patterns)} event patterns",
            data=response_data
        )

    async def handle_unsubscribe_events(self, event: Event) -> EventResponse:
        """Handle the unsubscribe_events command."""
        requesting_agent_id = event.payload.get("agent_id", event.source_id)
        subscription_id = event.payload.get("subscription_id")
        
        self.logger.info(f"🔧 UNSUBSCRIBE_EVENTS: Request from agent_id: {requesting_agent_id}")
        
        agent_registry = self.network.get_agent_registry()
        if requesting_agent_id not in agent_registry:
            self.logger.warning(f"Agent {requesting_agent_id} not registered")
            return EventResponse(
                success=False,
                message="Agent not registered"
            )
        
        if subscription_id:
            # Unsubscribe specific subscription
            success = self.network.event_gateway.unsubscribe(subscription_id)
            if success:
                response_data = {
                    "type": "system_response",
                    "command": "unsubscribe_events",
                    "subscription_id": subscription_id,
                    "agent_id": requesting_agent_id
                }
                
                # Include request_id if it was provided in the original request
                if "request_id" in event.payload:
                    response_data["request_id"] = event.payload["request_id"]
                
                self.logger.info(f"🔧 UNSUBSCRIBE_EVENTS: Removed subscription {subscription_id} for {requesting_agent_id}")
                return EventResponse(
                    success=True,
                    message=f"Successfully unsubscribed from subscription {subscription_id}",
                    data=response_data
                )
            else:
                return EventResponse(
                    success=False,
                    message=f"Subscription {subscription_id} not found"
                )
        else:
            # Unsubscribe all subscriptions for the agent
            self.network.event_gateway.unsubscribe_agent(requesting_agent_id)
            
            response_data = {
                "type": "system_response",
                "command": "unsubscribe_events",
                "agent_id": requesting_agent_id
            }
            
            # Include request_id if it was provided in the original request
            if "request_id" in event.payload:
                response_data["request_id"] = event.payload["request_id"]
            
            self.logger.info(f"🔧 UNSUBSCRIBE_EVENTS: Removed all subscriptions for {requesting_agent_id}")
            return EventResponse(
                success=True,
                message=f"Successfully unsubscribed from all events",
                data=response_data
            )
    
    async def handle_add_channel_member(self, event: Event) -> EventResponse:
        """Handle the add_channel_member command."""
        channel_id = event.payload.get("channel_id")
        agent_id = event.payload.get("agent_id")
        
        self.logger.info(f"🔧 ADD_CHANNEL_MEMBER: Request from agent_id: {agent_id}")
        
        self.network.event_gateway.add_channel_member(channel_id, agent_id)
        
        return EventResponse(
            success=True,
            message=f"Successfully added {agent_id} to channel {channel_id}",
            data={
                "type": "system_response",
                "command": "add_channel_member",
                "channel_id": channel_id,
                "agent_id": agent_id
            }
        )

    async def handle_remove_channel_member(self, event: Event) -> EventResponse:
        """Handle the remove_channel_member command."""
        channel_id = event.payload.get("channel_id")
        agent_id = event.payload.get("agent_id")
        
        self.logger.info(f"🔧 REMOVE_CHANNEL_MEMBER: Request from agent_id: {agent_id}")
        
        self.network.event_gateway.remove_channel_member(channel_id, agent_id)
        
        return EventResponse(
            success=True,
            message=f"Successfully removed {agent_id} from channel {channel_id}",
            data={
                "type": "system_response",
                "command": "remove_channel_member",
                "channel_id": channel_id,
                "agent_id": agent_id
            }
        )
    
    async def handle_get_channel_members(self, event: Event) -> EventResponse:
        """Handle the get_channel_members command."""
        channel_id = event.payload.get("channel_id")
        
        self.logger.info(f"🔧 GET_CHANNEL_MEMBERS: Request from agent_id: {channel_id}")
        
        members = self.network.event_gateway.get_channel_members(channel_id)
        
        return EventResponse(
            success=True,
            message=f"Successfully retrieved members of channel {channel_id}",
            data={
                "type": "system_response",
                "command": "get_channel_members",
                "channel_id": channel_id,
                "members": members
            }
        )

    async def handle_remove_channel(self, event: Event) -> EventResponse:
        """Handle the remove_channel command."""
        channel_id = event.payload.get("channel_id")
        
        self.logger.info(f"🔧 REMOVE_CHANNEL: Request from agent_id: {channel_id}")
        
        self.network.event_gateway.remove_channel(channel_id)
        
        return EventResponse(
            success=True,
            message=f"Successfully removed channel {channel_id}",
            data={
                "type": "system_response",
                "command": "remove_channel",
                "channel_id": channel_id
            }
        )

    async def handle_list_channels(self, event: Event) -> EventResponse:
        """Handle the list_channels command."""
        self.logger.info(f"🔧 LIST_CHANNELS: Request from agent_id: {event.source_id}")
        
        channels = self.network.event_gateway.list_channels()
        
        return EventResponse(
            success=True,
            message=f"Successfully retrieved list of channels",
            data={
                "type": "system_response",
                "command": "list_channels",
                "channels": channels
            }
        )