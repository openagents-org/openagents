"""
Global event bus for the unified OpenAgents event system.

This module provides the central event distribution system that replaces
the current message routing with a unified event-based approach.
"""

import asyncio
import logging
from typing import Dict, List, Set, Optional, Callable, Awaitable, Any
from collections import defaultdict, deque
import time

from openagents.models.event import Event, EventSubscription, EventVisibility

logger = logging.getLogger(__name__)

# Type definitions
EventHandler = Callable[[Event], Awaitable[None]]
EventFilter = Callable[[Event], bool]


class EventBus:
    """
    Global event bus that handles all event distribution in the network.
    
    This replaces the current message routing system with a unified approach
    where all interactions (direct messages, broadcasts, mod messages) are
    handled as events.
    """
    
    def __init__(self, max_history_size: int = 10000):
        """Initialize the event bus.
        
        Args:
            max_history_size: Maximum number of events to keep in history
        """
        self.max_history_size = max_history_size
        
        # Subscription management
        self.subscriptions: Dict[str, EventSubscription] = {}
        self.agent_subscriptions: Dict[str, List[str]] = defaultdict(list)  # agent_id -> subscription_ids
        
        # Event handlers for mods
        self.mod_handlers: Dict[str, List[EventHandler]] = defaultdict(list)  # mod_name -> handlers
        self.global_handlers: List[EventHandler] = []  # Handlers that see all events
        
        # Agent channel tracking (for visibility checks)
        self.agent_channels: Dict[str, Set[str]] = defaultdict(set)  # agent_id -> channels
        
        # Event history and metrics
        self.event_history: deque = deque(maxlen=max_history_size)
        self.event_count = 0
        self.events_by_name: Dict[str, int] = defaultdict(int)
        
        # Agent event queues (for agents that want to poll events)
        self.agent_event_queues: Dict[str, asyncio.Queue] = {}
        
        logger.info(f"EventBus initialized with max_history_size={max_history_size}")
    
    async def emit_event(self, event: Event) -> None:
        """
        Emit an event to all matching subscribers and handlers.
        
        Args:
            event: The event to emit
        """
        try:
            logger.debug(f"Emitting event: {event.event_name} from {event.source_id}")
            
            # Add to history and update metrics
            self.event_history.append(event)
            self.event_count += 1
            self.events_by_name[event.event_name] += 1
            
            # Handle mod-specific events first
            if event.relevant_mod and event.visibility == EventVisibility.MOD_ONLY:
                await self._handle_mod_event(event)
            else:
                # Handle regular events - deliver to subscribers
                await self._deliver_to_subscribers(event)
            
            # Always call global handlers (for logging, metrics, etc.)
            await self._call_global_handlers(event)
            
            logger.debug(f"Successfully emitted event: {event.event_name}")
            
        except Exception as e:
            logger.error(f"Error emitting event {event.event_name}: {e}")
            raise
    
    async def _handle_mod_event(self, event: Event) -> None:
        """Handle events targeted at specific mods."""
        if not event.relevant_mod:
            return
        
        handlers = self.mod_handlers.get(event.relevant_mod, [])
        if not handlers:
            logger.warning(f"No handlers registered for mod {event.relevant_mod}")
            return
        
        logger.debug(f"Delivering event {event.event_name} to {len(handlers)} mod handlers")
        
        for handler in handlers:
            try:
                await handler(event)
            except Exception as e:
                logger.error(f"Error in mod handler for {event.relevant_mod}: {e}")
    
    async def _deliver_to_subscribers(self, event: Event) -> None:
        """Deliver event to all matching agent subscriptions."""
        delivered_count = 0
        
        for subscription_id, subscription in self.subscriptions.items():
            if not subscription.is_active:
                continue
            
            try:
                agent_channels = self.agent_channels.get(subscription.agent_id, set())
                
                if subscription.matches_event(event, agent_channels):
                    await self._deliver_to_agent(subscription.agent_id, event)
                    delivered_count += 1
                    
            except Exception as e:
                logger.error(f"Error delivering event to subscription {subscription_id}: {e}")
        
        logger.debug(f"Delivered event {event.event_name} to {delivered_count} subscribers")
    
    async def _deliver_to_agent(self, agent_id: str, event: Event) -> None:
        """Deliver event to a specific agent."""
        # If agent has an event queue, add to queue
        if agent_id in self.agent_event_queues:
            try:
                self.agent_event_queues[agent_id].put_nowait(event)
                logger.debug(f"Added event {event.event_name} to queue for agent {agent_id}")
            except asyncio.QueueFull:
                logger.warning(f"Event queue full for agent {agent_id}, dropping event {event.event_name}")
        else:
            logger.debug(f"No event queue for agent {agent_id}, event {event.event_name} not queued")
    
    async def _call_global_handlers(self, event: Event) -> None:
        """Call all global event handlers."""
        for handler in self.global_handlers:
            try:
                await handler(event)
            except Exception as e:
                logger.error(f"Error in global event handler: {e}")
    
    def subscribe(self, agent_id: str, event_patterns: List[str], **filters) -> EventSubscription:
        """
        Subscribe an agent to events matching the given patterns.
        
        Args:
            agent_id: ID of the subscribing agent
            event_patterns: List of event patterns to match (supports wildcards)
            **filters: Optional filters (mod_filter, channel_filter, agent_filter)
            
        Returns:
            EventSubscription: The created subscription
        """
        subscription = EventSubscription(
            agent_id=agent_id,
            event_patterns=event_patterns,
            mod_filter=filters.get('mod_filter'),
            channel_filter=filters.get('channel_filter'),
            agent_filter=filters.get('agent_filter')
        )
        
        self.subscriptions[subscription.subscription_id] = subscription
        self.agent_subscriptions[agent_id].append(subscription.subscription_id)
        
        logger.info(f"Agent {agent_id} subscribed to patterns {event_patterns} with subscription {subscription.subscription_id}")
        return subscription
    
    def unsubscribe(self, subscription_id: str) -> bool:
        """
        Remove a subscription.
        
        Args:
            subscription_id: ID of the subscription to remove
            
        Returns:
            bool: True if subscription was removed, False if not found
        """
        if subscription_id not in self.subscriptions:
            return False
        
        subscription = self.subscriptions[subscription_id]
        agent_id = subscription.agent_id
        
        # Remove from subscriptions
        del self.subscriptions[subscription_id]
        
        # Remove from agent subscriptions
        if agent_id in self.agent_subscriptions:
            try:
                self.agent_subscriptions[agent_id].remove(subscription_id)
                if not self.agent_subscriptions[agent_id]:
                    del self.agent_subscriptions[agent_id]
            except ValueError:
                pass
        
        logger.info(f"Removed subscription {subscription_id} for agent {agent_id}")
        return True
    
    def unsubscribe_agent(self, agent_id: str) -> int:
        """
        Remove all subscriptions for an agent.
        
        Args:
            agent_id: ID of the agent
            
        Returns:
            int: Number of subscriptions removed
        """
        if agent_id not in self.agent_subscriptions:
            return 0
        
        subscription_ids = self.agent_subscriptions[agent_id].copy()
        removed_count = 0
        
        for subscription_id in subscription_ids:
            if self.unsubscribe(subscription_id):
                removed_count += 1
        
        logger.info(f"Removed {removed_count} subscriptions for agent {agent_id}")
        return removed_count
    
    def register_mod_handler(self, mod_name: str, handler: EventHandler) -> None:
        """
        Register an event handler for a specific mod.
        
        Args:
            mod_name: Name of the mod
            handler: Async function to handle events
        """
        self.mod_handlers[mod_name].append(handler)
        logger.info(f"Registered event handler for mod {mod_name}")
    
    def unregister_mod_handler(self, mod_name: str, handler: EventHandler) -> bool:
        """
        Unregister an event handler for a mod.
        
        Args:
            mod_name: Name of the mod
            handler: Handler function to remove
            
        Returns:
            bool: True if handler was removed
        """
        if mod_name not in self.mod_handlers:
            return False
        
        try:
            self.mod_handlers[mod_name].remove(handler)
            if not self.mod_handlers[mod_name]:
                del self.mod_handlers[mod_name]
            logger.info(f"Unregistered event handler for mod {mod_name}")
            return True
        except ValueError:
            return False
    
    def register_global_handler(self, handler: EventHandler) -> None:
        """Register a global event handler that sees all events."""
        self.global_handlers.append(handler)
        logger.info("Registered global event handler")
    
    def unregister_global_handler(self, handler: EventHandler) -> bool:
        """Unregister a global event handler."""
        try:
            self.global_handlers.remove(handler)
            logger.info("Unregistered global event handler")
            return True
        except ValueError:
            return False
    
    def update_agent_channels(self, agent_id: str, channels: Set[str]) -> None:
        """
        Update the channels an agent is in (for visibility checks).
        
        Args:
            agent_id: ID of the agent
            channels: Set of channel names the agent is in
        """
        self.agent_channels[agent_id] = channels.copy()
        logger.debug(f"Updated channels for agent {agent_id}: {channels}")
    
    def create_agent_event_queue(self, agent_id: str, maxsize: int = 1000) -> asyncio.Queue:
        """
        Create an event queue for an agent to poll events.
        
        Args:
            agent_id: ID of the agent
            maxsize: Maximum queue size
            
        Returns:
            asyncio.Queue: The event queue
        """
        queue = asyncio.Queue(maxsize=maxsize)
        self.agent_event_queues[agent_id] = queue
        logger.info(f"Created event queue for agent {agent_id} with maxsize={maxsize}")
        return queue
    
    def remove_agent_event_queue(self, agent_id: str) -> bool:
        """
        Remove an agent's event queue.
        
        Args:
            agent_id: ID of the agent
            
        Returns:
            bool: True if queue was removed
        """
        if agent_id in self.agent_event_queues:
            del self.agent_event_queues[agent_id]
            logger.info(f"Removed event queue for agent {agent_id}")
            return True
        return False
    
    def get_agent_subscriptions(self, agent_id: str) -> List[EventSubscription]:
        """Get all subscriptions for an agent."""
        subscription_ids = self.agent_subscriptions.get(agent_id, [])
        return [self.subscriptions[sub_id] for sub_id in subscription_ids if sub_id in self.subscriptions]
    
    def get_event_history(self, limit: Optional[int] = None, event_name_filter: Optional[str] = None) -> List[Event]:
        """
        Get recent event history.
        
        Args:
            limit: Maximum number of events to return
            event_name_filter: Only return events matching this name pattern
            
        Returns:
            List[Event]: Recent events
        """
        events = list(self.event_history)
        
        if event_name_filter:
            events = [e for e in events if e.matches_pattern(event_name_filter)]
        
        if limit:
            events = events[-limit:]
        
        return events
    
    def get_stats(self) -> Dict[str, Any]:
        """Get event bus statistics."""
        return {
            "total_events": self.event_count,
            "active_subscriptions": len(self.subscriptions),
            "agents_with_subscriptions": len(self.agent_subscriptions),
            "registered_mods": len(self.mod_handlers),
            "global_handlers": len(self.global_handlers),
            "agent_event_queues": len(self.agent_event_queues),
            "events_by_name": dict(self.events_by_name),
            "history_size": len(self.event_history)
        }
    
    def cleanup(self) -> None:
        """Clean up event bus resources."""
        logger.info("Cleaning up EventBus")
        
        # Clear all data structures
        self.subscriptions.clear()
        self.agent_subscriptions.clear()
        self.mod_handlers.clear()
        self.global_handlers.clear()
        self.agent_channels.clear()
        self.event_history.clear()
        self.events_by_name.clear()
        
        # Clear agent event queues
        for queue in self.agent_event_queues.values():
            while not queue.empty():
                try:
                    queue.get_nowait()
                except asyncio.QueueEmpty:
                    break
        self.agent_event_queues.clear()
        
        logger.info("EventBus cleanup completed")
