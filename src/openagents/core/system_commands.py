"""
OpenAgents System Commands

This module provides centralized handling for system-level commands in the OpenAgents framework.
System commands are used for network operations like registration, listing agents, and listing mods.
"""

import logging
import time
import uuid
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
    SYSTEM_EVENT_LIST_CHANNELS,
    SYSTEM_EVENT_VERIFY_PASSWORD,
    SYSTEM_EVENT_KICK_AGENT,
    SYSTEM_EVENT_UPDATE_NETWORK_PROFILE,
    SYSTEM_EVENT_UPDATE_AGENT_GROUPS,
    SYSTEM_EVENT_UPDATE_EXTERNAL_ACCESS,
    SYSTEM_EVENT_REPORT_LLM_LOG,
    SYSTEM_NOTIFICATION_AGENT_KICKED,
)
from openagents.models.event import Event
from openagents.models.event_response import EventResponse
from openagents.models.transport import TransportType

if TYPE_CHECKING:
    from openagents.core.network import AgentNetwork

logger = logging.getLogger(__name__)

# Type definitions
SystemCommandHandler = Callable[
    ["SystemCommandProcessor", Event], Awaitable[EventResponse]
]


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
            SYSTEM_EVENT_VERIFY_PASSWORD: self.handle_verify_password,
            SYSTEM_EVENT_KICK_AGENT: self.handle_kick_agent,
            SYSTEM_EVENT_UPDATE_NETWORK_PROFILE: self.handle_update_network_profile,
            SYSTEM_EVENT_UPDATE_AGENT_GROUPS: self.handle_update_agent_groups,
            SYSTEM_EVENT_UPDATE_EXTERNAL_ACCESS: self.handle_update_external_access,
            SYSTEM_EVENT_REPORT_LLM_LOG: self.handle_report_llm_log,
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
                    message=f"Internal error processing event {event_name}: {str(e)}",
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
            data=network_stats,
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
        password_hash = event.payload.get("password_hash", None)
        requested_group = event.payload.get("agent_group", None)

        return await self.network.register_agent(
            agent_id,
            transport_type,
            metadata,
            certificate,
            force_reconnect,
            password_hash,
            requested_group
        )

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
            return EventResponse(success=False, message="Agent not registered")

        # Prepare agent list with relevant information
        agent_list = []
        for agent_id, info in agent_registry.items():
            metadata = info.metadata
            agent_info = {
                "agent_id": agent_id,
                "name": metadata.get("name", agent_id),
                "connected": True,  # All agents in deprecated_agents are considered connected
                "metadata": metadata,
            }
            agent_list.append(agent_info)

        return EventResponse(
            success=True,
            message="Agent list retrieved successfully",
            data={
                "type": "system_response",
                "command": "list_agents",
                "agents": agent_list,
            },
        )

    async def handle_list_mods(self, event: Event) -> EventResponse:
        """Handle the list_mods command."""
        requesting_agent_id = event.payload.get("agent_id", event.source_id)

        self.logger.info(f"🔧 LIST_MODS: Request from agent_id: {requesting_agent_id}")

        agent_registry = self.network.get_agent_registry()
        if requesting_agent_id not in agent_registry:
            self.logger.warning(f"Agent {requesting_agent_id} not registered")
            return EventResponse(success=False, message="Agent not registered")

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
                "capabilities": [],
            }

            # Add implementation-specific information if available
            if mod_name in self.network.mods:
                mod = self.network.mods[mod_name]
                mod_info.update(
                    {
                        "description": getattr(
                            mod, "description", mod_info["description"]
                        ),
                        "version": getattr(mod, "version", mod_info["version"]),
                        "requires_adapter": getattr(
                            mod, "requires_adapter", mod_info["requires_adapter"]
                        ),
                        "capabilities": getattr(
                            mod, "capabilities", mod_info["capabilities"]
                        ),
                        "implementation": mod.__class__.__module__
                        + "."
                        + mod.__class__.__name__,
                    }
                )

            # Add manifest information if available (overriding implementation info)
            if (
                hasattr(self.network, "mod_manifests")
                and mod_name in self.network.mod_manifests
            ):
                manifest = self.network.mod_manifests[mod_name]
                mod_info.update(
                    {
                        "version": manifest.version,
                        "description": manifest.description,
                        "capabilities": manifest.capabilities,
                        "authors": manifest.authors,
                        "license": manifest.license,
                        "requires_adapter": manifest.requires_adapter,
                        "network_mod_class": manifest.network_mod_class,
                    }
                )

            mod_list.append(mod_info)

        response_data = {
            "type": "system_response",
            "command": "list_mods",
            "mods": mod_list,
        }

        # Include request_id if it was provided in the original request
        if "request_id" in event.payload:
            response_data["request_id"] = event.payload["request_id"]

        return EventResponse(
            success=True, message="Mod list retrieved successfully", data=response_data
        )

    async def handle_get_mod_manifest(self, event: Event) -> EventResponse:
        """Handle the get_mod_manifest command."""
        requesting_agent_id = event.payload.get("agent_id", event.source_id)
        mod_name = event.payload.get("mod_name")

        agent_registry = self.network.get_agent_registry()
        if requesting_agent_id not in agent_registry:
            self.logger.warning(f"Agent {requesting_agent_id} not registered")
            return EventResponse(success=False, message="Agent not registered")

        if not mod_name:
            return EventResponse(success=False, message="Missing mod_name parameter")

        # Check if we have a manifest for this mod
        if (
            hasattr(self.network, "mod_manifests")
            and mod_name in self.network.mod_manifests
        ):
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
                    "manifest": manifest_dict,
                },
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
                            "manifest": manifest_dict,
                        },
                    )

            return EventResponse(
                success=False,
                message=f"No manifest found for mod {mod_name}",
                data={
                    "type": "system_response",
                    "command": "get_mod_manifest",
                    "mod_name": mod_name,
                },
            )

    async def handle_get_network_info(self, event: Event) -> EventResponse:
        """Handle the get_network_info command."""
        requesting_agent_id = event.payload.get("agent_id", event.source_id)

        # Allow temporary studio connections to fetch network info without being registered
        is_studio_temp = requesting_agent_id and requesting_agent_id.startswith(
            "studio_temp_"
        )

        if is_studio_temp:
            self.logger.debug(
                f"Studio frontend requesting network info via temporary connection: {requesting_agent_id}"
            )
        elif requesting_agent_id not in self.network.deprecated_agents:
            self.logger.warning(f"Agent {requesting_agent_id} not registered")
            return EventResponse(success=False, message="Agent not registered")

        # Prepare network info
        network_info = {
            "name": self.network.network_name,
            "node_id": self.network.network_id,
            "mode": (
                "centralized"
                if hasattr(self.network.topology, "server_mode")
                else "decentralized"
            ),
            "mods": list(self.network.mods.keys()),
            "agent_count": len(self.network.get_agent_registry()),
        }

        # Include workspace path if available in metadata
        if (
            hasattr(self.network, "metadata")
            and "workspace_path" in self.network.metadata
        ):
            network_info["workspace_path"] = self.network.metadata["workspace_path"]

        response_data = {
            "type": "system_response",
            "command": "get_network_info",
            "network_info": network_info,
        }

        # Include request_id if it was provided in the original request
        if "request_id" in event.payload:
            response_data["request_id"] = event.payload["request_id"]

        return EventResponse(
            success=True,
            message="Network info retrieved successfully",
            data=response_data,
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
                "timestamp": event.payload.get("timestamp", time.time()),
            },
        )

    async def handle_claim_agent_id(self, event: Event) -> EventResponse:
        """Handle the claim_agent_id command."""
        agent_id = event.payload.get("agent_id", event.source_id)
        force = event.payload.get("force", False)

        if not agent_id:
            return EventResponse(success=False, message="Missing agent_id")

        try:
            # Try to claim the agent ID
            certificate = self.network.identity_manager.claim_agent_id(
                agent_id, force=force
            )

            if certificate:
                self.logger.info(f"Issued certificate for agent ID {agent_id}")
                return EventResponse(
                    success=True,
                    message=f"Agent ID {agent_id} claimed successfully",
                    data={
                        "type": "system_response",
                        "command": "claim_agent_id",
                        "agent_id": agent_id,
                        "certificate": certificate.to_dict(),
                    },
                )
            else:
                self.logger.warning(
                    f"Failed to claim agent ID {agent_id} - already claimed"
                )
                return EventResponse(
                    success=False, message=f"Agent ID {agent_id} is already claimed"
                )

        except Exception as e:
            self.logger.error(f"Error claiming agent ID {agent_id}: {e}")
            return EventResponse(success=False, message=f"Internal error: {str(e)}")

    async def handle_validate_certificate(self, event: Event) -> EventResponse:
        """Handle the validate_certificate command."""
        certificate_data = event.payload.get("certificate")

        if not certificate_data:
            return EventResponse(success=False, message="Missing certificate data")

        try:
            # Validate the certificate
            is_valid = self.network.identity_manager.validate_certificate(
                certificate_data
            )

            self.logger.debug(
                f"Certificate validation result for {certificate_data.get('agent_id')}: {is_valid}"
            )
            return EventResponse(
                success=True,
                message=f"Certificate validation completed: {'valid' if is_valid else 'invalid'}",
                data={
                    "type": "system_response",
                    "command": "validate_certificate",
                    "valid": is_valid,
                    "agent_id": certificate_data.get("agent_id"),
                },
            )

        except Exception as e:
            self.logger.error(f"Error validating certificate: {e}")
            return EventResponse(success=False, message=f"Internal error: {str(e)}")

    async def handle_poll_messages(self, event: Event) -> EventResponse:
        """Handle the poll_messages command for gRPC agents."""
        self.logger.info(
            f"🔧 POLL_MESSAGES: Handler called for event: {event.event_name}"
        )

        requesting_agent_id = event.payload.get("agent_id", event.source_id)
        self.logger.info(f"🔧 POLL_MESSAGES: Requesting agent: {requesting_agent_id}")

        if not requesting_agent_id:
            self.logger.warning("poll_messages command missing agent_id")
            return EventResponse(success=False, message="Missing agent_id")

        agent_registry = self.network.get_agent_registry()
        if requesting_agent_id not in agent_registry:
            self.logger.warning(f"Agent {requesting_agent_id} not registered")
            return EventResponse(success=False, message="Agent not registered")

        # Get queued messages for the agent from event gateway
        messages = await self.network.event_gateway.poll_events(requesting_agent_id)

        # Convert messages to serializable format
        serialized_messages = []
        for i, message in enumerate(messages):
            self.logger.debug(
                f"🔧 POLL_MESSAGES: Serializing message {i}: {type(message)}"
            )
            serialized_msg = None

            # Try to_dict() first (works for Event objects)
            if hasattr(message, "to_dict"):
                try:
                    serialized_msg = message.to_dict()
                    self.logger.info(
                        f"🔧 POLL_MESSAGES: Used to_dict() for message {i}"
                    )
                except Exception as to_dict_error:
                    self.logger.error(
                        f"🔧 POLL_MESSAGES: to_dict() failed for message {i}: {to_dict_error}"
                    )
                    serialized_msg = None
            elif hasattr(message, "model_dump"):
                try:
                    serialized_msg = message.model_dump()
                    self.logger.info(
                        f"🔧 POLL_MESSAGES: Used model_dump() for message {i}"
                    )
                except Exception as model_dump_error:
                    self.logger.warning(
                        f"🔧 POLL_MESSAGES: model_dump failed for message {i}: {model_dump_error}"
                    )
                    serialized_msg = None
            elif hasattr(message, "dict"):
                serialized_msg = message.dict()
                self.logger.info(f"🔧 POLL_MESSAGES: Used dict() for message {i}")
            elif hasattr(message, "__dict__"):
                import datetime

                serialized_msg = {}
                for key, value in message.__dict__.items():
                    # Handle datetime objects
                    if isinstance(value, datetime.datetime):
                        serialized_msg[key] = value.isoformat()
                    else:
                        serialized_msg[key] = value
                self.logger.info(
                    f"🔧 POLL_MESSAGES: Used __dict__ with datetime handling for message {i}"
                )
            else:
                serialized_msg = str(message)
                self.logger.info(f"🔧 POLL_MESSAGES: Used str() for message {i}")

            if serialized_msg is not None:
                serialized_messages.append(serialized_msg)
            else:
                self.logger.error(
                    f"🔧 POLL_MESSAGES: Failed to serialize message {i} - all methods failed"
                )
                serialized_messages.append({})

        self.logger.info(
            f"🔧 POLL_MESSAGES: Serialized {len(serialized_messages)} messages"
        )

        response_data = {
            "type": "system_response",
            "command": "poll_messages",
            "messages": serialized_messages,
        }

        # Include request_id if it was provided in the original request
        if "request_id" in event.payload:
            response_data["request_id"] = event.payload["request_id"]

        self.logger.info(
            f"🔧 POLL_MESSAGES: Sending response with {len(serialized_messages)} messages to {requesting_agent_id}"
        )
        return EventResponse(
            success=True,
            message=f"Retrieved {len(serialized_messages)} messages",
            data=response_data,
        )

    async def handle_subscribe_events(self, event: Event) -> EventResponse:
        """Handle the subscribe_events command."""
        requesting_agent_id = event.payload.get("agent_id", event.source_id)
        event_patterns = event.payload.get("event_patterns", [])
        channels = event.payload.get("channels", [])

        self.logger.info(
            f"🔧 SUBSCRIBE_EVENTS: Request from agent_id: {requesting_agent_id}"
        )

        agent_registry = self.network.get_agent_registry()
        if requesting_agent_id not in agent_registry:
            self.logger.warning(f"Agent {requesting_agent_id} not registered")
            return EventResponse(success=False, message="Agent not registered")

        if not event_patterns:
            return EventResponse(
                success=False, message="Missing event_patterns parameter"
            )

        subscription = self.network.event_gateway.subscribe(
            agent_id=requesting_agent_id,
            event_patterns=event_patterns,
            channels=channels if channels else [],
        )

        response_data = {
            "type": "system_response",
            "command": "subscribe_events",
            "subscription_id": subscription.subscription_id,
            "agent_id": requesting_agent_id,
            "event_patterns": event_patterns,
            "channels": list(channels) if channels else [],
        }

        # Include request_id if it was provided in the original request
        if "request_id" in event.payload:
            response_data["request_id"] = event.payload["request_id"]

        self.logger.info(
            f"🔧 SUBSCRIBE_EVENTS: Created subscription {subscription.subscription_id} for {requesting_agent_id}"
        )
        return EventResponse(
            success=True,
            message=f"Successfully subscribed to {len(event_patterns)} event patterns",
            data=response_data,
        )

    async def handle_unsubscribe_events(self, event: Event) -> EventResponse:
        """Handle the unsubscribe_events command."""
        requesting_agent_id = event.payload.get("agent_id", event.source_id)
        subscription_id = event.payload.get("subscription_id")

        self.logger.info(
            f"🔧 UNSUBSCRIBE_EVENTS: Request from agent_id: {requesting_agent_id}"
        )

        agent_registry = self.network.get_agent_registry()
        if requesting_agent_id not in agent_registry:
            self.logger.warning(f"Agent {requesting_agent_id} not registered")
            return EventResponse(success=False, message="Agent not registered")

        if subscription_id:
            # Unsubscribe specific subscription
            success = self.network.event_gateway.unsubscribe(subscription_id)
            if success:
                response_data = {
                    "type": "system_response",
                    "command": "unsubscribe_events",
                    "subscription_id": subscription_id,
                    "agent_id": requesting_agent_id,
                }

                # Include request_id if it was provided in the original request
                if "request_id" in event.payload:
                    response_data["request_id"] = event.payload["request_id"]

                self.logger.info(
                    f"🔧 UNSUBSCRIBE_EVENTS: Removed subscription {subscription_id} for {requesting_agent_id}"
                )
                return EventResponse(
                    success=True,
                    message=f"Successfully unsubscribed from subscription {subscription_id}",
                    data=response_data,
                )
            else:
                return EventResponse(
                    success=False, message=f"Subscription {subscription_id} not found"
                )
        else:
            # Unsubscribe all subscriptions for the agent
            self.network.event_gateway.unsubscribe_agent(requesting_agent_id)

            response_data = {
                "type": "system_response",
                "command": "unsubscribe_events",
                "agent_id": requesting_agent_id,
            }

            # Include request_id if it was provided in the original request
            if "request_id" in event.payload:
                response_data["request_id"] = event.payload["request_id"]

            self.logger.info(
                f"🔧 UNSUBSCRIBE_EVENTS: Removed all subscriptions for {requesting_agent_id}"
            )
            return EventResponse(
                success=True,
                message=f"Successfully unsubscribed from all events",
                data=response_data,
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
                "agent_id": agent_id,
            },
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
                "agent_id": agent_id,
            },
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
                "members": members,
            },
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
                "channel_id": channel_id,
            },
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
                "channels": channels,
            },
        )

    async def handle_verify_password(self, event: Event) -> EventResponse:
        """Handle the verify_password command.
        
        Verifies a password hash against configured agent groups and returns
        the matching group information.
        """
        password_hash = event.payload.get("password_hash")
        
        if not password_hash:
            return EventResponse(
                success=False,
                message="Missing password_hash parameter",
                data={
                    "type": "system_response",
                    "command": "verify_password",
                    "valid": False,
                }
            )
        
        # Check against configured agent groups
        for group_name, group_config in self.network.config.agent_groups.items():
            if group_config.password_hash and password_hash == group_config.password_hash:
                # Password matches this group
                response_data = {
                    "type": "system_response",
                    "command": "verify_password",
                    "valid": True,
                    "group_name": group_name,
                    "group_description": group_config.description,
                    "group_metadata": group_config.metadata,
                    "default_group": self.network.config.default_agent_group,
                }
                
                # Include request_id if provided
                if "request_id" in event.payload:
                    response_data["request_id"] = event.payload["request_id"]
                
                return EventResponse(
                    success=True,
                    message=f"Password verified: matches group '{group_name}'",
                    data=response_data,
                )
        
        # No matching group found
        response_data = {
            "type": "system_response", 
            "command": "verify_password",
            "valid": False,
            "default_group": self.network.config.default_agent_group,
            "requires_password": self.network.config.requires_password,
        }
        
        # Include request_id if provided
        if "request_id" in event.payload:
            response_data["request_id"] = event.payload["request_id"]
        
        if self.network.config.requires_password:
            message = "Password verification failed: no matching group found (registration would be rejected)"
        else:
            message = f"Password verification failed: no matching group found (would assign to default group '{self.network.config.default_agent_group}')"
        
        return EventResponse(
            success=True,
            message=message,
            data=response_data,
        )

    async def handle_kick_agent(self, event: Event) -> EventResponse:
        """Handle the kick_agent command.
        
        Only agents in the 'admin' group can kick other agents.
        Takes target_agent_id from the payload and removes the agent from the network.
        """
        requesting_agent_id = event.payload.get("agent_id", event.source_id)
        target_agent_id = event.payload.get("target_agent_id")
        
        if not requesting_agent_id:
            return EventResponse(
                success=False,
                message="Missing requesting agent_id",
                data={
                    "type": "system_response",
                    "command": "kick_agent",
                }
            )
        
        if not target_agent_id:
            return EventResponse(
                success=False,
                message="Missing target_agent_id parameter",
                data={
                    "type": "system_response",
                    "command": "kick_agent",
                }
            )
        
        # Check if requesting agent is in admin group
        requesting_group = self.network.topology.agent_group_membership.get(requesting_agent_id)
        if requesting_group != "admin":
            self.logger.warning(f"Unauthorized kick attempt by {requesting_agent_id} (group: {requesting_group})")
            return EventResponse(
                success=False,
                message="Unauthorized: Admin privileges required to kick agents",
                data={
                    "type": "system_response",
                    "command": "kick_agent",
                    "requesting_agent": requesting_agent_id,
                    "requesting_group": requesting_group,
                }
            )
        
        # Check if target agent exists
        agent_registry = self.network.get_agent_registry()
        if target_agent_id not in agent_registry:
            return EventResponse(
                success=False,
                message=f"Target agent '{target_agent_id}' not found",
                data={
                    "type": "system_response",
                    "command": "kick_agent",
                    "target_agent_id": target_agent_id,
                }
            )
        
        # Don't allow kicking yourself
        if requesting_agent_id == target_agent_id:
            return EventResponse(
                success=False,
                message="Cannot kick yourself",
                data={
                    "type": "system_response",
                    "command": "kick_agent",
                    "target_agent_id": target_agent_id,
                }
            )
        
        try:
            # Get target agent's group before removal for notification
            target_group = self.network.topology.agent_group_membership.get(target_agent_id, "unknown")
            
            # Remove the agent from the network
            unregister_response = await self.network.unregister_agent(target_agent_id)
            
            if unregister_response.success:
                self.logger.info(f"Agent {target_agent_id} kicked by admin {requesting_agent_id}")
                
                # Create and broadcast the agent_kicked notification event
                kick_notification = Event(
                    event_name=SYSTEM_NOTIFICATION_AGENT_KICKED,
                    source_id="system",
                    destination_id="agent:broadcast",  # Broadcast to all agents
                    payload={
                        "target_agent_id": target_agent_id,
                        "kicked_by": requesting_agent_id,
                        "target_group": target_group,
                        "reason": "Kicked by admin",
                        "timestamp": int(time.time()),
                    },
                    text_representation=f"Agent {target_agent_id} was kicked by admin {requesting_agent_id}"
                )
                
                # Broadcast the notification to all connected agents
                await self.network.event_gateway.process_event(kick_notification)
                
                return EventResponse(
                    success=True,
                    message=f"Successfully kicked agent '{target_agent_id}'",
                    data={
                        "type": "system_response",
                        "command": "kick_agent",
                        "target_agent_id": target_agent_id,
                        "kicked_by": requesting_agent_id,
                        "target_group": target_group,
                    }
                )
            else:
                return EventResponse(
                    success=False,
                    message=f"Failed to kick agent '{target_agent_id}': {unregister_response.message}",
                    data={
                        "type": "system_response",
                        "command": "kick_agent",
                        "target_agent_id": target_agent_id,
                    }
                )
                
        except Exception as e:
            self.logger.error(f"Error kicking agent {target_agent_id}: {e}")
            return EventResponse(
                success=False,
                message=f"Internal error while kicking agent: {str(e)}",
                data={
                    "type": "system_response",
                    "command": "kick_agent",
                    "target_agent_id": target_agent_id,
                }
            )

    async def handle_update_network_profile(self, event: Event) -> EventResponse:
        """Handle the update_network_profile command.
        
        Updates network profile configuration in real-time:
        - Validates partial update payload
        - Merges with current configuration
        - Writes to YAML atomically
        - Refreshes in-memory config
        - Immediately reflects in /api/health
        
        Only agents in the 'admin' group can update network profile.
        """
        requesting_agent_id = event.payload.get("agent_id", event.source_id)
        profile_update = event.payload.get("profile")
        
        if not requesting_agent_id:
            return EventResponse(
                success=False,
                message="Missing requesting agent_id",
                data={
                    "type": "system_response",
                    "command": "update_network_profile",
                }
            )
        
        if not profile_update or not isinstance(profile_update, dict):
            return EventResponse(
                success=False,
                message="Missing or invalid 'profile' field in payload",
                data={
                    "type": "system_response",
                    "command": "update_network_profile",
                }
            )
        
        # Check if requesting agent is in admin group
        requesting_group = self.network.topology.agent_group_membership.get(requesting_agent_id)
        if requesting_group != "admin":
            self.logger.warning(
                f"Unauthorized network profile update attempt by {requesting_agent_id} (group: {requesting_group})"
            )
            return EventResponse(
                success=False,
                message="Unauthorized: Admin privileges required to update network profile",
                data={
                    "type": "system_response",
                    "command": "update_network_profile",
                    "requesting_agent": requesting_agent_id,
                    "requesting_group": requesting_group,
                }
            )
        
        try:
            from openagents.models.network_profile_update import NetworkProfilePatch, NetworkProfileComplete
            from pydantic import ValidationError
            import yaml
            import os
            import tempfile
            import shutil
            import threading
            from pathlib import Path
            
            # Validate patch (forbids unknown fields)
            try:
                patch = NetworkProfilePatch(**profile_update)
            except ValidationError as e:
                error_details = []
                for error in e.errors():
                    field = ".".join(str(loc) for loc in error["loc"])
                    message = error["msg"]
                    error_details.append(f"{field}: {message}")
                
                return EventResponse(
                    success=False,
                    message=f"Validation failed: {'; '.join(error_details)}",
                    data={
                        "type": "system_response",
                        "command": "update_network_profile",
                        "errors": error_details,
                    }
                )
            
            # Get current profile
            current_profile = {}
            if hasattr(self.network.config, "network_profile") and self.network.config.network_profile:
                profile_obj = self.network.config.network_profile
                if hasattr(profile_obj, "model_dump"):
                    current_profile = profile_obj.model_dump(mode="json", exclude_none=False)
                elif isinstance(profile_obj, dict):
                    current_profile = profile_obj.copy()
            
            # Merge patch into current
            merged_profile = current_profile.copy()
            patch_dict = patch.model_dump(exclude_none=True)
            updated_fields = list(patch_dict.keys())
            
            for key, value in patch_dict.items():
                merged_profile[key] = value
            
            # Apply defaults if missing
            if "port" not in merged_profile or merged_profile["port"] is None:
                merged_profile["port"] = 8700

            # Ensure network_id is preserved from current config
            if "network_id" not in merged_profile or not merged_profile["network_id"]:
                # Try to get network_id from network config
                if hasattr(self.network.config, "network_profile") and self.network.config.network_profile:
                    profile_obj = self.network.config.network_profile
                    if hasattr(profile_obj, "network_id") and profile_obj.network_id:
                        merged_profile["network_id"] = profile_obj.network_id
                    elif isinstance(profile_obj, dict) and profile_obj.get("network_id"):
                        merged_profile["network_id"] = profile_obj["network_id"]

                # If still not found, generate a new one as fallback
                if "network_id" not in merged_profile or not merged_profile["network_id"]:
                    merged_profile["network_id"] = f"network-{uuid.uuid4().hex[:8]}"

            # Validate complete profile
            try:
                complete_profile = NetworkProfileComplete(**merged_profile)
            except ValidationError as e:
                error_details = []
                for error in e.errors():
                    field = ".".join(str(loc) for loc in error["loc"])
                    message = error["msg"]
                    error_details.append(f"{field}: {message}")
                
                return EventResponse(
                    success=False,
                    message=f"Merged profile validation failed: {'; '.join(error_details)}",
                    data={
                        "type": "system_response",
                        "command": "update_network_profile",
                        "errors": error_details,
                    }
                )
            
            final_profile = complete_profile.model_dump(mode="json", exclude_none=False)
            
            # Find config file path
            config_path = None
            if hasattr(self.network, "config_path") and self.network.config_path:
                config_path = Path(self.network.config_path)
            
            # Atomic YAML write with file lock
            if config_path and config_path.exists():
                # Use a lock for thread-safe file operations
                lock_file = Path(str(config_path) + ".lock")
                lock = threading.Lock()
                
                with lock:
                    try:
                        # Read existing config
                        with open(config_path, 'r', encoding='utf-8') as f:
                            config_data = yaml.safe_load(f) or {}
                        
                        # Update network_profile section
                        config_data['network_profile'] = final_profile
                        
                        # Write to temporary file
                        temp_fd, temp_path = tempfile.mkstemp(
                            suffix='.yaml',
                            dir=config_path.parent,
                            text=True
                        )
                        
                        try:
                            with os.fdopen(temp_fd, 'w', encoding='utf-8') as f:
                                yaml.dump(
                                    config_data,
                                    f,
                                    default_flow_style=False,
                                    allow_unicode=True,
                                    sort_keys=False
                                )
                                f.flush()
                                os.fsync(f.fileno())
                            
                            # Atomic rename
                            shutil.move(temp_path, config_path)
                            self.logger.info(f"Network profile written to {config_path}")
                            
                        except Exception as e:
                            # Clean up temp file on error
                            if os.path.exists(temp_path):
                                os.remove(temp_path)
                            raise
                    
                    except Exception as e:
                        self.logger.error(f"Failed to write YAML config: {e}")
                        return EventResponse(
                            success=False,
                            message=f"Failed to write configuration file: {str(e)}",
                            data={
                                "type": "system_response",
                                "command": "update_network_profile",
                            }
                        )
            
            # Update in-memory configuration
            from openagents.models.network_profile import NetworkProfile
            try:
                updated_profile_obj = NetworkProfile(**final_profile)
                self.network.config.network_profile = updated_profile_obj
                self.logger.info("Network profile updated in memory")
            except Exception as e:
                # Fallback to dict
                self.network.config.network_profile = final_profile
                self.logger.warning(f"Updated network profile as dict (NetworkProfile creation failed: {e})")
            
            # Generate warnings
            warnings = []
            if "required_openagents_version" in patch_dict:
                # Could compare with current version if available
                self.logger.info(f"Required OpenAgents version updated to: {final_profile['required_openagents_version']}")
            
            # Audit log
            self.logger.info(
                f"🔒 AUDIT: Network profile updated by {requesting_agent_id}. "
                f"Updated fields: {updated_fields} at {time.time()}"
            )
            
            return EventResponse(
                success=True,
                message="Network profile updated successfully",
                data={
                    "type": "system_response",
                    "command": "update_network_profile",
                    "network_profile": final_profile,
                    "warnings": warnings,
                }
            )
            
        except Exception as e:
            self.logger.error(f"Error updating network profile: {e}")
            import traceback
            self.logger.error(f"Traceback: {traceback.format_exc()}")
            return EventResponse(
                success=False,
                message=f"Internal error while updating network profile: {str(e)}",
                data={
                    "type": "system_response",
                    "command": "update_network_profile",
                }
            )

    async def handle_update_external_access(self, event: Event) -> EventResponse:
        """Handle the update_external_access command.

        Updates external access configuration in real-time:
        - Validates the external_access payload
        - Merges with current configuration
        - Writes to YAML atomically
        - Refreshes in-memory config

        Only agents in the 'admin' group can update external access.
        """
        requesting_agent_id = event.payload.get("agent_id", event.source_id)
        external_access_update = event.payload.get("external_access")

        if not requesting_agent_id:
            return EventResponse(
                success=False,
                message="Missing requesting agent_id",
                data={
                    "type": "system_response",
                    "command": "update_external_access",
                }
            )

        if not external_access_update or not isinstance(external_access_update, dict):
            return EventResponse(
                success=False,
                message="Missing or invalid 'external_access' field in payload",
                data={
                    "type": "system_response",
                    "command": "update_external_access",
                }
            )

        # Check if requesting agent is in admin group
        requesting_group = self.network.topology.agent_group_membership.get(requesting_agent_id)
        if requesting_group != "admin":
            self.logger.warning(
                f"Unauthorized external access update attempt by {requesting_agent_id} (group: {requesting_group})"
            )
            return EventResponse(
                success=False,
                message="Unauthorized: Admin privileges required to update external access",
                data={
                    "type": "system_response",
                    "command": "update_external_access",
                    "requesting_agent": requesting_agent_id,
                    "requesting_group": requesting_group,
                }
            )

        try:
            from openagents.models.external_access import ExternalAccessConfig
            from pydantic import ValidationError
            import yaml
            import os
            import tempfile
            import shutil
            import threading
            from pathlib import Path

            # Validate the update
            try:
                validated_config = ExternalAccessConfig(**external_access_update)
            except ValidationError as e:
                error_details = []
                for error in e.errors():
                    field = ".".join(str(loc) for loc in error["loc"])
                    message = error["msg"]
                    error_details.append(f"{field}: {message}")

                return EventResponse(
                    success=False,
                    message=f"Validation failed: {'; '.join(error_details)}",
                    data={
                        "type": "system_response",
                        "command": "update_external_access",
                        "errors": error_details,
                    }
                )

            final_config = validated_config.model_dump(mode="json", exclude_none=False)

            # Find config file path
            config_path = None
            if hasattr(self.network, "config_path") and self.network.config_path:
                config_path = Path(self.network.config_path)

            # Atomic YAML write with file lock
            if config_path and config_path.exists():
                lock = threading.Lock()

                with lock:
                    try:
                        # Read existing config
                        with open(config_path, 'r', encoding='utf-8') as f:
                            config_data = yaml.safe_load(f) or {}

                        # Update external_access section
                        config_data['external_access'] = final_config

                        # Write to temporary file
                        temp_fd, temp_path = tempfile.mkstemp(
                            suffix='.yaml',
                            dir=config_path.parent,
                            text=True
                        )

                        try:
                            with os.fdopen(temp_fd, 'w', encoding='utf-8') as f:
                                yaml.dump(
                                    config_data,
                                    f,
                                    default_flow_style=False,
                                    allow_unicode=True,
                                    sort_keys=False
                                )
                                f.flush()
                                os.fsync(f.fileno())

                            # Atomic rename
                            shutil.move(temp_path, config_path)
                            self.logger.info(f"External access config written to {config_path}")

                        except Exception as e:
                            # Clean up temp file on error
                            if os.path.exists(temp_path):
                                os.remove(temp_path)
                            raise

                    except Exception as e:
                        self.logger.error(f"Failed to write YAML config: {e}")
                        return EventResponse(
                            success=False,
                            message=f"Failed to write configuration file: {str(e)}",
                            data={
                                "type": "system_response",
                                "command": "update_external_access",
                            }
                        )

            # Update in-memory configuration
            try:
                self.network.config.external_access = validated_config
                self.logger.info("External access config updated in memory")
            except Exception as e:
                self.logger.warning(f"Updated external access as dict (model update failed: {e})")

            # Audit log
            self.logger.info(
                f"🔒 AUDIT: External access config updated by {requesting_agent_id} at {time.time()}"
            )

            return EventResponse(
                success=True,
                message="External access configuration updated successfully",
                data={
                    "type": "system_response",
                    "command": "update_external_access",
                    "external_access": final_config,
                }
            )

        except Exception as e:
            self.logger.error(f"Error updating external access: {e}")
            import traceback
            self.logger.error(f"Traceback: {traceback.format_exc()}")
            return EventResponse(
                success=False,
                message=f"Internal error while updating external access: {str(e)}",
                data={
                    "type": "system_response",
                    "command": "update_external_access",
                }
            )

    def _check_admin_access(self, agent_id: str) -> bool:
        """Check if agent has admin access.
        
        Args:
            agent_id: ID of the agent to check
            
        Returns:
            bool: True if agent is in admin group, False otherwise
        """
        if not self.network or not self.network.topology:
            return False
        agent_group = self.network.topology.agent_group_membership.get(agent_id)
        return agent_group == "admin"

    def _get_agent_group_info(self) -> Dict[str, Any]:
        """Get current agent groups information for API response.
        
        Returns:
            Dict containing agent_groups, default_agent_group, and requires_password
        """
        # Build groups dictionary: group_name -> list of agent_ids
        groups: Dict[str, List[str]] = {}
        for agent_id, group_name in self.network.topology.agent_group_membership.items():
            if group_name not in groups:
                groups[group_name] = []
            groups[group_name].append(agent_id)

        # Build agent group info
        agent_groups_info: Dict[str, Dict[str, Any]] = {}
        for group_name, group_cfg in self.network.config.agent_groups.items():
            members = groups.get(group_name, [])
            permissions = group_cfg.metadata.get("permissions", []) if isinstance(group_cfg.metadata, dict) else []
            
            agent_groups_info[group_name] = {
                "name": group_name,
                "description": group_cfg.description,
                "has_password": bool(group_cfg.password_hash),
                "member_count": len(members),
                "members": members,
                "permissions": permissions if isinstance(permissions, list) else [],
                "metadata": group_cfg.metadata,
                "is_default": group_name == self.network.config.default_agent_group,
            }

        # Add default group if not in agent_groups
        default_group_name = self.network.config.default_agent_group
        if default_group_name not in agent_groups_info:
            members = groups.get(default_group_name, [])
            agent_groups_info[default_group_name] = {
                "name": default_group_name,
                "description": "Default group for agents without specific credentials",
                "has_password": False,
                "member_count": len(members),
                "members": members,
                "permissions": [],
                "metadata": {},
                "is_default": True,
            }

        return {
            "agent_groups": agent_groups_info,
            "default_agent_group": self.network.config.default_agent_group,
            "requires_password": self.network.config.requires_password,
        }

    async def handle_update_agent_groups(self, event: Event) -> EventResponse:
        """Handle the update_agent_groups command.
        
        Allows admin agents to update agent group configuration at runtime.
        
        Actions:
        - create: Create new agent group
        - update: Update existing agent group
        - delete: Delete agent group
        - set_default: Set default agent group
        - set_requires_password: Toggle password requirement
        """
        requesting_agent_id = event.payload.get("agent_id", event.source_id)
        action = event.payload.get("action")
        
        if not requesting_agent_id:
            return EventResponse(
                success=False,
                message="Missing requesting agent_id",
                data={
                    "type": "system_response",
                    "command": "update_agent_groups",
                }
            )
        
        # Check admin access
        if not self._check_admin_access(requesting_agent_id):
            self.logger.warning(
                f"Unauthorized agent groups update attempt by {requesting_agent_id}"
            )
            return EventResponse(
                success=False,
                message="Access denied. Admin group required.",
                data={
                    "type": "system_response",
                    "command": "update_agent_groups",
                    "requesting_agent": requesting_agent_id,
                }
            )
        
        if not action:
            return EventResponse(
                success=False,
                message="Missing 'action' parameter",
                data={
                    "type": "system_response",
                    "command": "update_agent_groups",
                }
            )
        
        try:
            from openagents.utils.password_utils import hash_password
            from openagents.models.network_config import AgentGroupConfig
            import yaml
            import os
            import tempfile
            import shutil
            import threading
            from pathlib import Path
            import re
            
            # Validate group name format
            def validate_group_name(name: str) -> tuple[bool, str]:
                if not name or not isinstance(name, str):
                    return False, "Group name must be a non-empty string"
                if len(name) < 1 or len(name) > 64:
                    return False, "Group name must be 1-64 characters"
                if not re.match(r'^[a-zA-Z0-9_]+$', name):
                    return False, "Group name must contain only alphanumeric characters and underscores"
                return True, ""
            
            if action == "create":
                group_name = event.payload.get("group_name")
                group_config = event.payload.get("group_config", {})
                
                if not group_name:
                    return EventResponse(
                        success=False,
                        message="Missing 'group_name' parameter for create action",
                    )
                
                # Validate group name
                is_valid, error_msg = validate_group_name(group_name)
                if not is_valid:
                    return EventResponse(
                        success=False,
                        message=f"Invalid group name: {error_msg}",
                    )
                
                # Check if group already exists
                if group_name in self.network.config.agent_groups:
                    return EventResponse(
                        success=False,
                        message=f"Group '{group_name}' already exists",
                    )
                
                # Validate description
                description = group_config.get("description", "")
                if len(description) > 512:
                    return EventResponse(
                        success=False,
                        message="Description must be 512 characters or less",
                    )
                
                # Validate password
                password = group_config.get("password")
                password_hash = None
                if password:
                    if len(password) < 4:
                        return EventResponse(
                            success=False,
                            message="Password must be at least 4 characters",
                        )
                    password_hash = hash_password(password)
                
                # Validate permissions
                permissions = group_config.get("permissions", [])
                if not isinstance(permissions, list):
                    return EventResponse(
                        success=False,
                        message="Permissions must be a list",
                    )
                if len(permissions) > 32:
                    return EventResponse(
                        success=False,
                        message="Maximum 32 permissions allowed per group",
                    )
                for perm in permissions:
                    if not isinstance(perm, str) or len(perm) > 64:
                        return EventResponse(
                            success=False,
                            message="Each permission must be a string of 64 characters or less",
                        )
                
                # Create group config
                metadata = group_config.get("metadata", {})
                if not isinstance(metadata, dict):
                    metadata = {}
                if permissions:
                    metadata["permissions"] = permissions
                
                new_group_config = AgentGroupConfig(
                    password_hash=password_hash,
                    description=description,
                    metadata=metadata,
                )
                
                # Add to config
                self.network.config.agent_groups[group_name] = new_group_config
                
            elif action == "update":
                group_name = event.payload.get("group_name")
                group_config = event.payload.get("group_config", {})
                
                if not group_name:
                    return EventResponse(
                        success=False,
                        message="Missing 'group_name' parameter for update action",
                    )
                
                # Check if group exists
                if group_name not in self.network.config.agent_groups:
                    return EventResponse(
                        success=False,
                        message=f"Group '{group_name}' not found",
                    )
                
                # Cannot update default group name (it's immutable)
                if group_name == self.network.config.default_agent_group:
                    # Allow updating other fields but not the name itself
                    pass
                
                existing_group = self.network.config.agent_groups[group_name]
                
                # Update description
                if "description" in group_config:
                    description = group_config["description"]
                    if len(description) > 512:
                        return EventResponse(
                            success=False,
                            message="Description must be 512 characters or less",
                        )
                    existing_group.description = description
                
                # Update password
                if "clear_password" in group_config and group_config["clear_password"]:
                    existing_group.password_hash = None
                elif "password" in group_config:
                    password = group_config["password"]
                    if password:
                        if len(password) < 4:
                            return EventResponse(
                                success=False,
                                message="Password must be at least 4 characters",
                            )
                        existing_group.password_hash = hash_password(password)
                
                # Update permissions
                if "permissions" in group_config:
                    permissions = group_config["permissions"]
                    if not isinstance(permissions, list):
                        return EventResponse(
                            success=False,
                            message="Permissions must be a list",
                        )
                    if len(permissions) > 32:
                        return EventResponse(
                            success=False,
                            message="Maximum 32 permissions allowed per group",
                        )
                    for perm in permissions:
                        if not isinstance(perm, str) or len(perm) > 64:
                            return EventResponse(
                                success=False,
                                message="Each permission must be a string of 64 characters or less",
                            )
                    if not isinstance(existing_group.metadata, dict):
                        existing_group.metadata = {}
                    existing_group.metadata["permissions"] = permissions
                
                # Update metadata
                if "metadata" in group_config:
                    metadata = group_config["metadata"]
                    if isinstance(metadata, dict):
                        if not isinstance(existing_group.metadata, dict):
                            existing_group.metadata = {}
                        existing_group.metadata.update(metadata)
            
            elif action == "delete":
                group_name = event.payload.get("group_name")
                
                if not group_name:
                    return EventResponse(
                        success=False,
                        message="Missing 'group_name' parameter for delete action",
                    )
                
                # Cannot delete default group
                if group_name == self.network.config.default_agent_group:
                    return EventResponse(
                        success=False,
                        message="Cannot delete the default agent group",
                    )
                
                # Check if group exists
                if group_name not in self.network.config.agent_groups:
                    return EventResponse(
                        success=False,
                        message=f"Group '{group_name}' not found",
                    )
                
                # Check if group has active members
                members = [
                    agent_id
                    for agent_id, g in self.network.topology.agent_group_membership.items()
                    if g == group_name
                ]
                if members:
                    return EventResponse(
                        success=False,
                        message=f"Cannot delete group '{group_name}' with {len(members)} active member(s). Reassign members first.",
                    )
                
                # Delete group
                del self.network.config.agent_groups[group_name]
            
            elif action == "set_default":
                group_name = event.payload.get("group_name")
                
                if not group_name:
                    return EventResponse(
                        success=False,
                        message="Missing 'group_name' parameter for set_default action",
                    )
                
                # Check if group exists (or is the current default)
                if group_name not in self.network.config.agent_groups and group_name != self.network.config.default_agent_group:
                    return EventResponse(
                        success=False,
                        message=f"Group '{group_name}' not found",
                    )
                
                # Set as default
                self.network.config.default_agent_group = group_name
            
            elif action == "set_requires_password":
                requires_password = event.payload.get("requires_password", False)
                self.network.config.requires_password = bool(requires_password)
            
            else:
                return EventResponse(
                    success=False,
                    message=f"Unknown action: {action}",
                )
            
            # Save to YAML file
            config_path = None
            if hasattr(self.network, "config_path") and self.network.config_path:
                config_path = Path(self.network.config_path)
            
            if config_path and config_path.exists():
                lock = threading.Lock()
                with lock:
                    try:
                        # Read existing config
                        with open(config_path, 'r', encoding='utf-8') as f:
                            config_data = yaml.safe_load(f) or {}
                        
                        # Update network.agent_groups section
                        if "network" not in config_data:
                            config_data["network"] = {}
                        
                        # Convert agent_groups to dict format
                        agent_groups_dict = {}
                        for g_name, g_cfg in self.network.config.agent_groups.items():
                            agent_groups_dict[g_name] = {
                                "description": g_cfg.description,
                                "metadata": g_cfg.metadata,
                            }
                            if g_cfg.password_hash:
                                agent_groups_dict[g_name]["password_hash"] = g_cfg.password_hash
                        
                        config_data["network"]["agent_groups"] = agent_groups_dict
                        config_data["network"]["default_agent_group"] = self.network.config.default_agent_group
                        config_data["network"]["requires_password"] = self.network.config.requires_password
                        
                        # Write to temporary file
                        temp_fd, temp_path = tempfile.mkstemp(
                            suffix='.yaml',
                            dir=config_path.parent,
                            text=True
                        )
                        
                        try:
                            with os.fdopen(temp_fd, 'w', encoding='utf-8') as f:
                                yaml.dump(
                                    config_data,
                                    f,
                                    default_flow_style=False,
                                    allow_unicode=True,
                                    sort_keys=False
                                )
                                f.flush()
                                os.fsync(f.fileno())
                            
                            # Atomic rename
                            shutil.move(temp_path, config_path)
                            self.logger.info(f"Agent groups configuration written to {config_path}")
                            
                        except Exception as e:
                            # Clean up temp file on error
                            if os.path.exists(temp_path):
                                os.remove(temp_path)
                            raise
                    
                    except Exception as e:
                        self.logger.error(f"Failed to write YAML config: {e}")
                        return EventResponse(
                            success=False,
                            message=f"Failed to write configuration file: {str(e)}",
                            data={
                                "type": "system_response",
                                "command": "update_agent_groups",
                            }
                        )
            
            # Get updated groups info
            groups_info = self._get_agent_group_info()
            
            # Audit log
            self.logger.info(
                f"🔒 AUDIT: Agent groups updated by {requesting_agent_id}. "
                f"Action: {action}, Group: {event.payload.get('group_name', 'N/A')} at {time.time()}"
            )
            
            return EventResponse(
                success=True,
                message=f"Agent groups updated successfully: {action}",
                data={
                    "type": "system_response",
                    "command": "update_agent_groups",
                    **groups_info,
                }
            )
            
        except Exception as e:
            self.logger.error(f"Error updating agent groups: {e}")
            import traceback
            self.logger.error(f"Traceback: {traceback.format_exc()}")
            return EventResponse(
                success=False,
                message=f"Internal error while updating agent groups: {str(e)}",
                data={
                    "type": "system_response",
                    "command": "update_agent_groups",
                }
            )

    async def handle_report_llm_log(self, event: Event) -> EventResponse:
        """Handle the report_llm_log command.

        Receives LLM call logs from agents and stores them in the workspace.
        This allows external agents to report their LLM usage to the network
        for centralized logging and monitoring.

        Expected payload:
        - agent_id: ID of the agent reporting the log
        - log_entry: Dict containing LLM log data (model, messages, completion, tokens, etc.)
        """
        requesting_agent_id = event.payload.get("agent_id", event.source_id)
        log_entry = event.payload.get("log_entry")

        if not requesting_agent_id:
            return EventResponse(
                success=False,
                message="Missing agent_id",
                data={
                    "type": "system_response",
                    "command": "report_llm_log",
                }
            )

        if not log_entry:
            return EventResponse(
                success=False,
                message="Missing log_entry in payload",
                data={
                    "type": "system_response",
                    "command": "report_llm_log",
                }
            )

        try:
            # Get workspace path from network
            workspace_path = None
            if hasattr(self.network, "workspace_manager") and self.network.workspace_manager:
                workspace_path = self.network.workspace_manager.workspace_path

            if not workspace_path:
                return EventResponse(
                    success=False,
                    message="Workspace not configured on network",
                    data={
                        "type": "system_response",
                        "command": "report_llm_log",
                    }
                )

            # Use LLMCallLogger to write the log
            from openagents.lms.llm_logger import LLMCallLogger
            from openagents.models.llm_log import LLMLogEntry
            from pathlib import Path

            logger_instance = LLMCallLogger(Path(workspace_path), requesting_agent_id)

            # Convert dict to LLMLogEntry and write
            entry = LLMLogEntry.from_dict(log_entry)
            logger_instance._write_log_entry(entry)

            self.logger.debug(f"Stored LLM log from agent {requesting_agent_id}: {entry.log_id}")

            return EventResponse(
                success=True,
                message="LLM log stored successfully",
                data={
                    "type": "system_response",
                    "command": "report_llm_log",
                    "log_id": entry.log_id,
                    "agent_id": requesting_agent_id,
                }
            )

        except Exception as e:
            self.logger.error(f"Error storing LLM log from {requesting_agent_id}: {e}")
            import traceback
            self.logger.error(f"Traceback: {traceback.format_exc()}")
            return EventResponse(
                success=False,
                message=f"Failed to store LLM log: {str(e)}",
                data={
                    "type": "system_response",
                    "command": "report_llm_log",
                }
            )
