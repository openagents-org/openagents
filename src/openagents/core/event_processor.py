"""
Message Processing Pipeline for OpenAgents.

This module implements the ordered message processing pipeline that routes
messages through mods in a structured, predictable way.
"""

import logging
from typing import Dict, Any, List, Optional, TYPE_CHECKING, OrderedDict

from openagents.models.event_response import EventResponse
from openagents.models.network_role import NetworkRole

if TYPE_CHECKING:
    from openagents.core.base_mod import BaseMod

from openagents.models.event import Event

logger = logging.getLogger(__name__)


class ModEventProcessor:
    """
    Handles ordered processing of messages through mods and network core.
    
    Following is an illustration of the event processing pipeline:
    
    Agent → [ Network Core → Mod1 → Mod2 → ... → ModN ] → Delivery (e.g., to target agent, channel, or broadcast)

    The event processor pipeline is marked between [ ]. This ModEventProcessor is responsible for the part after the network core.

    Each mod in the pipeline can decide whether to intercept and process the event or not. If a mod decides to intercept and process the event,
    it must return an event response.
    Once an event is intercepted by a mod, it will not be processed by any other mod and will not be delivered to the destination.

    Special rules:
    - If an event has a `mod:...` destination, then the event will be processed by the specific mod only, bypassing all other mods.
    - If an event is sent from a mod, then the event will not by processed by the same mod.
    """
    
    def __init__(self, mods: OrderedDict[str, 'BaseMod']):
        """Initialize the message processor.
        
        Args:
            network: The network instance this processor belongs to
        """
        self.mods = mods
    
    async def process_event(self, event: Event) -> Optional[EventResponse]:
        """Process an event through the appropriate pipeline.
        
        Args:
            event: The event to process
            
        Returns:
            Optional[EventResponse]: The event response, or None if the event is not processed
        """
        incoming_event = event.model_copy()
        
        # Parse destination to check if it's targeting a specific mod
        destination = event.parse_destination()
        source = event.parse_source()
        
        # If destination is mod:..., only process through that specific mod
        if destination.role == NetworkRole.MOD:
            target_mod = destination.desitnation_id
            if target_mod in self.mods:
                mod = self.mods[target_mod]
                logger.debug(f"Processing event through specific mod: {target_mod}")
                try:
                    response = await mod.process_event(incoming_event)
                    if response is None:
                        logger.debug(f"Event not processed by mod {target_mod}, mod returns None")
                        return EventResponse(
                            success=False,
                            event=incoming_event,
                            message=f"Event not processed by mod {target_mod}, mod returns None"
                        )
                    return response
                except Exception as e:
                    logger.error(f"Error in mod {target_mod}.process_event: {e}")
                    return EventResponse(
                        success=False,
                        event=incoming_event,
                        message=f"Error in mod {target_mod}.process_event: {e}"
                    )
            else:
                logger.warning(f"Target mod {target_mod} not found")
                return EventResponse(
                    success=False,
                    event=incoming_event,
                    message=f"Target mod {target_mod} not found"
                )
        else:
            # Process through all mods in order, skipping the source mod if event came from a mod
            source_mod = source.source_id if source.role == NetworkRole.MOD else None
            
            for mod_name, mod in self.mods.items():
                # Skip processing if this mod is the source of the event
                if source_mod and mod_name == source_mod:
                    logger.debug(f"Skipping mod {mod_name} as it's the source of the event")
                    continue
                    
                try:
                    response = await mod.process_event(incoming_event)
                except Exception as e:
                    logger.error(f"Error in mod {mod_name}.process_event: {e}")
                    continue
                
                if response is not None:
                    logger.debug(f"Event processed by mod {mod_name}")
                    return response
        
        # Return the final event response
        logger.debug(f"Event not processed by any mod")
        return None