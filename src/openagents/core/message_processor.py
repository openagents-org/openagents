"""
Message Processing Pipeline for OpenAgents.

This module implements the ordered message processing pipeline that routes
messages through mods in a structured, predictable way.
"""

import logging
from typing import Dict, Any, List, Optional, TYPE_CHECKING

if TYPE_CHECKING:
    from openagents.core.network import AgentNetwork
    from openagents.core.base_mod import BaseMod

from openagents.models.event import Event

logger = logging.getLogger(__name__)


class MessageProcessor:
    """
    Handles ordered processing of messages through mods and network core.
    
    Implements the three-type message processing pipeline:
    1. Direct Messages: Agent → Mod1 → Mod2 → ... → ModN → NetworkCore → TargetAgent
    2. Broadcast Messages: Agent → Mod1 → Mod2 → ... → ModN → NetworkCore → AllAgents  
    3. System Messages: Various flows depending on inbound/outbound/internal
    """
    
    def __init__(self, network: "AgentNetwork"):
        """Initialize the message processor.
        
        Args:
            network: The network instance this processor belongs to
        """
        self.network = network
        self.logger = logging.getLogger(f"{__name__}.{network.network_id}")
    
    async def process_message(self, event: Event) -> bool:
        """Process a message through the appropriate pipeline.
        
        Args:
            event: The event to process
            
        Returns:
            bool: True if processing was successful
        """
        try:
            message_type = event.get_message_type()
            self.logger.info(f"Processing {message_type} event: {event.event_name} from {event.source_id}")
            
            if message_type == "direct_message":
                return await self._process_direct_message(event)
            elif message_type == "broadcast_message":
                return await self._process_broadcast_message(event)
            elif message_type == "system_message":
                return await self._process_system_message(event)
            else:
                self.logger.error(f"Unknown message type: {message_type}")
                return False
                
        except Exception as e:
            self.logger.error(f"Error processing message {event.event_id}: {e}")
            import traceback
            self.logger.error(f"Traceback: {traceback.format_exc()}")
            return False
    
    async def _process_direct_message(self, event: Event) -> bool:
        """Process a direct message through the mod pipeline.
        
        Flow: Agent → Mod1 → Mod2 → ... → ModN → NetworkCore → TargetAgent
        
        Args:
            event: The direct message event
            
        Returns:
            bool: True if message was processed successfully
        """
        self.logger.debug(f"Processing direct message from {event.source_id} to {event.target_agent_id}")
        
        # Process through mods in order
        current_event = event
        current_event = await self._process_through_mods(current_event, "process_direct_message")
        
        if current_event is None:
            self.logger.debug("Direct message processing stopped by mod")
            return True
        
        # Process through network core
        current_event = await self._process_through_network_core_direct(current_event)
        
        if current_event is None:
            self.logger.debug("Direct message processing stopped by network core")
            return True
        
        # Deliver to target agent
        return await self._deliver_to_target_agent(current_event)
    
    async def _process_broadcast_message(self, event: Event) -> bool:
        """Process a broadcast message through the mod pipeline.
        
        Flow: Agent → Mod1 → Mod2 → ... → ModN → NetworkCore → AllAgents
        
        Args:
            event: The broadcast message event
            
        Returns:
            bool: True if message was processed successfully
        """
        self.logger.debug(f"Processing broadcast message from {event.source_id}")
        
        # Process through mods in order
        current_event = event
        current_event = await self._process_through_mods(current_event, "process_broadcast_message")
        
        if current_event is None:
            self.logger.debug("Broadcast message processing stopped by mod")
            return True
        
        # Process through network core
        current_event = await self._process_through_network_core_broadcast(current_event)
        
        if current_event is None:
            self.logger.debug("Broadcast message processing stopped by network core")
            return True
        
        # Deliver to all agents
        return await self._deliver_to_all_agents(current_event)
    
    async def _process_system_message(self, event: Event) -> bool:
        """Process a system message based on its flow type.
        
        Three flows:
        1. Inbound (agent→system): Agent → Mod1 → Mod2 → ... → ModN → NetworkCore → Discard
        2. Outbound (mod→agent): Mod → DirectDelivery → TargetAgent  
        3. Internal (mod→network): Mod → Mod1 → Mod2 → ... → ModN → NetworkCore → Discard
        
        Args:
            event: The system message event
            
        Returns:
            bool: True if message was processed successfully
        """
        # Determine flow type based on target_agent_id and source_id
        if event.target_agent_id:
            # Outbound system message - direct delivery to target agent
            self.logger.debug(f"Processing outbound system message from {event.source_id} to {event.target_agent_id}")
            return await self._deliver_to_target_agent(event)
        else:
            # Inbound or internal system message - process through mod pipeline
            self.logger.debug(f"Processing inbound/internal system message: {event.event_name} from {event.source_id}")
            
            # Process through mods in order
            current_event = event
            current_event = await self._process_through_mods(current_event, "process_system_message")
            
            if current_event is None:
                self.logger.debug("System message processing stopped by mod")
                return True
            
            # Process through network core
            current_event = await self._process_through_network_core_system(current_event)
            
            # System messages are discarded after processing
            self.logger.debug("System message processing completed, message discarded")
            return True
    
    async def _process_through_mods(self, event: Event, method_name: str) -> Optional[Event]:
        """Process event through all relevant mods in order.
        
        Args:
            event: The event to process
            method_name: The method to call on each mod
            
        Returns:
            Optional[Event]: The processed event, or None if processing should stop
        """
        current_event = event
        
        # If relevant_mod is set, only process through that mod
        if event.relevant_mod:
            if event.relevant_mod in self.network.mods:
                mod = self.network.mods[event.relevant_mod]
                self.logger.debug(f"Processing event through specific mod: {event.relevant_mod}")
                try:
                    if hasattr(mod, method_name):
                        current_event = await getattr(mod, method_name)(current_event)
                        if current_event is None:
                            self.logger.debug(f"Event processing stopped by mod {event.relevant_mod}")
                            return None
                except Exception as e:
                    self.logger.error(f"Error in mod {event.relevant_mod}.{method_name}: {e}")
            else:
                self.logger.warning(f"Relevant mod {event.relevant_mod} not found")
        else:
            # Process through all mods in order
            for mod_name, mod in self.network.mods.items():
                self.logger.debug(f"Processing event through mod: {mod_name}")
                try:
                    if hasattr(mod, method_name):
                        current_event = await getattr(mod, method_name)(current_event)
                        if current_event is None:
                            self.logger.debug(f"Event processing stopped by mod {mod_name}")
                            return None
                except Exception as e:
                    self.logger.error(f"Error in mod {mod_name}.{method_name}: {e}")
                    # Continue processing through other mods even if one fails
        
        return current_event
    
    async def _process_through_network_core_direct(self, event: Event) -> Optional[Event]:
        """Process direct message through network core.
        
        Args:
            event: The direct message event
            
        Returns:
            Optional[Event]: The processed event, or None if processing should stop
        """
        # Network core processing for direct messages
        # This is where network-level direct message handling would go
        self.logger.debug("Processing direct message through network core")
        return event
    
    async def _process_through_network_core_broadcast(self, event: Event) -> Optional[Event]:
        """Process broadcast message through network core.
        
        Args:
            event: The broadcast message event
            
        Returns:
            Optional[Event]: The processed event, or None if processing should stop
        """
        # Network core processing for broadcast messages
        # This is where network-level broadcast message handling would go
        self.logger.debug("Processing broadcast message through network core")
        return event
    
    async def _process_through_network_core_system(self, event: Event) -> Optional[Event]:
        """Process system message through network core.
        
        Args:
            event: The system message event
            
        Returns:
            Optional[Event]: The processed event, or None if processing should stop
        """
        # Network core processing for system messages
        # This is where network-level system message handling would go
        self.logger.debug("Processing system message through network core")
        return event
    
    async def _deliver_to_target_agent(self, event: Event) -> bool:
        """Deliver event to the target agent.
        
        Args:
            event: The event to deliver
            
        Returns:
            bool: True if delivery was successful
        """
        if not event.target_agent_id:
            self.logger.error("Cannot deliver event: no target_agent_id specified")
            return False
        
        target_agent_id = event.target_agent_id
        self.logger.debug(f"Delivering event to target agent: {target_agent_id}")
        
        try:
            # First try to deliver directly to registered workspaces
            if target_agent_id in self.network._registered_workspaces:
                self.logger.debug(f"Delivering to registered workspace: {target_agent_id}")
                workspace = self.network._registered_workspaces[target_agent_id]
                await workspace._handle_project_responses(event)
                return True
            
            # Try to deliver directly to registered agent clients
            elif target_agent_id in self.network._registered_agent_clients:
                self.logger.debug(f"Delivering to registered agent client: {target_agent_id}")
                agent_client = self.network._registered_agent_clients[target_agent_id]
                await agent_client._handle_mod_message(event)
                return True
            
            # Try to deliver through transport layer
            elif target_agent_id in self.network.agents:
                self.logger.debug(f"Delivering through transport to agent: {target_agent_id}")
                
                # Check if this is a gRPC transport - queue the message
                if hasattr(self.network.topology, 'transport_manager') and self.network.topology.transport_manager:
                    for transport in self.network.topology.transport_manager.transports.values():
                        if hasattr(transport, 'transport_type') and transport.transport_type.value == 'grpc':
                            self.logger.debug(f"Queueing event for gRPC agent: {target_agent_id}")
                            self.network._queue_message_for_agent(target_agent_id, event)
                            return True
                
                # For non-gRPC transports, route through topology
                success = await self.network.topology.route_message(event)
                if success:
                    self.logger.debug(f"Successfully delivered event to {target_agent_id}")
                    return True
                else:
                    # Fallback: queue for gRPC agents
                    self.logger.debug(f"Failed to route, falling back to queue for {target_agent_id}")
                    self.network._queue_message_for_agent(target_agent_id, event)
                    return True
            
            else:
                self.logger.warning(f"Target agent {target_agent_id} not found")
                return False
                
        except Exception as e:
            self.logger.error(f"Error delivering event to {target_agent_id}: {e}")
            return False
    
    async def _deliver_to_all_agents(self, event: Event) -> bool:
        """Deliver event to all agents in the network.
        
        Args:
            event: The event to deliver
            
        Returns:
            bool: True if delivery was successful
        """
        self.logger.debug("Delivering event to all agents")
        
        try:
            # Route through topology for broadcast delivery
            success = await self.network.topology.route_message(event)
            if success:
                self.logger.debug("Successfully delivered broadcast event to all agents")
                return True
            else:
                self.logger.warning("Failed to deliver broadcast event")
                return False
                
        except Exception as e:
            self.logger.error(f"Error delivering broadcast event: {e}")
            return False