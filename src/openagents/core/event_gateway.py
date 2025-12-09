import time
from typing import Dict, List, Set
import asyncio
import logging
from typing import Any, TYPE_CHECKING, Optional
from openagents.core.event_processor import ModEventProcessor
from openagents.core.system_commands import SystemCommandProcessor
from openagents.models.event import Event, EventSubscription
from openagents.models.event_response import EventResponse
from openagents.models.network_role import NetworkRole

if TYPE_CHECKING:
    from openagents.core.network import AgentNetwork

logger = logging.getLogger(__name__)

MAX_PROCESSED_EVENT_IDS = 100000


class EventGateway:
    """
    Gateway for processing events and also an event bus for storing the events pending delivery to agents.

    In OpenAgents, several entities can send out events: 1/ Agents, 2/ Mods, 3/ System (which is the network core).

    General event flow for inbound events:
    - Events arrive from transport layer
    - System events are processed immediately by SystemCommandProcessor
    - Regular events go through EventProcessorPipeline
    - Responses are returned to the transport layer

    Event routing:

        Each event in general has an event name, a source and a destination.

        Example event names:
        - agent.message
        - project.run.completed
        - channel.message.posted
        - mod.generic.message_received
        - system.register_agent

        Example source IDs:
        - agent:charlie_123
        - mod:openagents.mods.communication.simple_messaging
        - system:system

        Example destination IDs:
        - agent:charlie_123
        - mod:openagents.mods.communication.simple_messaging
        - system:system
        - channel:general
        - agent:broadcast

        If the the destination is an agent ID, then the event will be delivered to the target agent directly. If the destination is system, then the event will
        be discarded after processing. Each event will be processed by mods in the network, and each mod can decide whether to process the message or not.
        A special case is if the destination is a specific mod, then the event will only be processed by that mod.

    Channel events and broadcast events:

        When an event has a `channel` destination, it will be delivered and visible to all member agents in the channel.
        When an event has a `agent:broadcast` destination, it will be delivered and visible to all agents in the network.

    Subscription of events:

        By default, an agent will be notified of all events it's permitted to see. However, an agent can subscribe to
        specific events with event name patterns. Once subscribed, only the events that match the subscription will be
        delivered to the agent.

    Delivery of events:

    - After processed by the event processor, there are two outcomes:
        1. The event is captured by the system or a mod in the process, and an event response is returned.
        2. None of the system or mods capture the event, and None is returned from the processor.

    - In the first case, the event response will be immediately returned to sender of the event and no message delivery will happen.
      Therefore, if a mod wants to intercept the event, it just needs to return an event response.
    - In the seconds case, the event will be delivered to the destination specified in the event.
    - Delivery to agents:
        - If the event has a `channel:...` destination, it will be delivered to all member agents in the channel.
        - If the event has a `agent:broadcast` destination, it will be delivered to all agents in the network.
        - If the event has a `agent:...` destination, it will be delivered to the target agent directly.
        - Otherwise, the event will be discarded.

    The event gateway maintains a queue for each agent to temporarily store delivered events. An event notifier will monitor
    the queue and deliver the events to the agent. In some cases, the agent can also poll the queue to get new events.

    Key responsibilities of the event gateway:
    1. Route events to appropriate processors (system commands vs regular events)
    2. Maintain event subscriptions for agents
    3. Queue events for delivery to agents
    4. Prevent duplicate event processing
    5. Coordinate with the event processor pipeline

    The event gateway will replace the old event bus (EventBus).
    """

    def __init__(self, network: "AgentNetwork"):
        self.network = network
        self.processed_event_ids: Set[str] = set()
        self.agent_subscriptions: Dict[str, List[EventSubscription]] = {}
        self.channel_members: Dict[str, List[str]] = {}
        self.agent_event_queues: Dict[str, asyncio.Queue] = {}
        self.system_command_processor = SystemCommandProcessor(network)
        self.mod_event_processor = ModEventProcessor(network.mods)

    async def process_system_command(self, event: Event) -> Optional[EventResponse]:
        """
        Process a system command.
        """
        logger.debug(f"Processing system command: {event.event_name}")
        response = await self.system_command_processor.process_command(event)
        return response

    async def process_regular_event(self, event: Event) -> Optional[EventResponse]:
        """
        Process a regular event.
        """
        logger.debug(f"Processing regular event: {event.event_name}")
        event_id = event.event_id
        logger.info(
            f"🔧 NETWORK: Processing regular event: {event_id}|{event.event_name}"
        )

        # Prevent infinite loops by tracking processed messages
        if event_id in self.processed_event_ids:
            logger.info(f"🔧 Skipping already processed event {event_id}")
            return

        # Mark message as processed
        self.processed_event_ids.add(event_id)

        # Clean up old processed message IDs to prevent memory leak (keep last 1000)
        if len(self.processed_event_ids) > MAX_PROCESSED_EVENT_IDS:
            # Remove oldest half
            old_ids = list(self.processed_event_ids)[: MAX_PROCESSED_EVENT_IDS // 2]
            for old_id in old_ids:
                self.processed_event_ids.remove(old_id)

        response = await self.mod_event_processor.process_event(event)
        return response

    async def process_event(
        self, event: Event, enable_delivery: bool = True
    ) -> EventResponse:
        """
        Process an event coming from the transport layer.
        For system events, the event gateway should direct process them and return the response immediately.
        For other events, the event gateway should process them through the event processor and return the response.

        Args:
            event: The event to process
            enable_delivery: Whether to enable delivery of the event to the destination

        Returns:
            EventResponse: The event response
        """
        # Override the timestamp to the current time
        event.timestamp = int(time.time())

        # Auto-populate source_agent_group for agent sources
        if event.source_id:
            parsed_source = event.parse_source()
            if parsed_source.role == NetworkRole.AGENT:
                event.source_agent_group = self.network.topology.agent_group_membership.get(
                    parsed_source.source_id, None
                )

        # Process the event through the pipeline
        response = None
        if event.event_name.startswith("system."):
            response = await self.process_system_command(event)
            if response is not None:
                return response
        # Process the event through the regular event processor
        response = await self.process_regular_event(event)
        if response is not None:
            return response
        # Deliver the event to the destination if the event is not intercepted by the system or regular event processor
        if enable_delivery:
            await self.deliver_event(event)
            return EventResponse(
                success=True,
                message=f"Event {event.event_name} delivered to destination",
            )
        else:
            return EventResponse(
                success=True,
                message=f"Event {event.event_name} processed but not delivered",
            )

    async def deliver_event(self, event: Event):
        """
        Deliver an event to corresponding agent queue.

        If the event has `channel:...` specified, it will be delivered to all member agents in the channel.
        If the event has `agent:...` specified, it will be delivered to the target agent directly.
        If the event has `agent:broadcast` specified, it will be delivered to all agents in the network.
        """
        destination = event.parse_destination()
        logger.debug(
            f"Delivering event: {event.event_name} from {event.source_id} to {event.destination_id}"
        )

        # Handle channel-based delivery
        if destination.role == NetworkRole.CHANNEL:
            channel_id = destination.desitnation_id
            logger.debug(f"Delivering event to channel: {channel_id}")
            if channel_id in self.channel_members:
                for agent_id in self.channel_members[channel_id]:
                    if agent_id != event.source_id:  # Don't deliver to sender
                        await self.deliver_to_agent(event, agent_id)
            else:
                logger.warning(f"Channel {channel_id} has no members")

        # Handle group-based delivery
        elif destination.role == NetworkRole.GROUP:
            group_id = destination.desitnation_id
            logger.debug(f"Delivering event to group: {group_id}")
            group_members = self._get_group_members(group_id)
            if group_members:
                logger.info(f"Delivering event to {len(group_members)} agents in group '{group_id}'")
                for agent_id in group_members:
                    if agent_id != event.source_id:  # Don't deliver to sender
                        await self.deliver_to_agent(event, agent_id)
            else:
                logger.warning(f"Group '{group_id}' has no members or does not exist")

        # Handle direct delivery to target agent
        elif destination.role == NetworkRole.AGENT:
            if destination.desitnation_id == "broadcast":
                # Broadcast to all agents
                logger.debug("Broadcasting event to all agents")
                for agent_id in self.agent_event_queues.keys():
                    if agent_id != event.source_id:  # Don't deliver to sender
                        await self.deliver_to_agent(event, agent_id)
            else:
                # Direct delivery to specific agent
                logger.debug(
                    f"Delivering event directly to agent: {destination.desitnation_id}"
                )
                await self.deliver_to_agent(event, destination.desitnation_id)

        else:
            logger.debug("No valid destination specified, skipping delivery")

    async def deliver_to_agent(self, event: Event, agent_id: str):
        """
        Deliver an event to a specific agent's queue, filtered by agent's subscriptions.
        """
        if agent_id not in self.agent_event_queues:
            logger.debug(f"Agent {agent_id} has no event queue, skipping delivery")
            return

        # Check if agent has any subscriptions
        if agent_id in self.agent_subscriptions and self.agent_subscriptions[agent_id]:
            # Agent has subscriptions - check if event matches any of them
            event_matches = False
            for subscription in self.agent_subscriptions[agent_id]:
                if subscription.is_active and subscription.matches_event(event):
                    event_matches = True
                    logger.debug(
                        f"Event {event.event_name} matches subscription {subscription.subscription_id} for agent {agent_id}"
                    )
                    break

            if not event_matches:
                logger.debug(
                    f"Event {event.event_name} does not match any subscriptions for agent {agent_id}, skipping delivery"
                )
                return
        else:
            # Agent has no subscriptions - deliver all events (default behavior)
            logger.debug(
                f"Agent {agent_id} has no active subscriptions, delivering event {event.event_name}"
            )

        # Deliver the event to the agent's queue
        await self.agent_event_queues[agent_id].put(event)
        logger.debug(f"Delivered event {event.event_name} to agent {agent_id}")

    async def poll_events(self, agent_id: str) -> List[Event]:
        """
        Poll events from a specific agent's queue.
        """
        # Record heartbeat
        await self.network.topology.record_heartbeat(agent_id)

        if agent_id in self.agent_event_queues:
            queue = self.agent_event_queues[agent_id]
            events = []
            while not queue.empty():
                event = queue.get_nowait()
                events.append(event)
            return events
        else:
            logger.debug(f"Agent {agent_id} has no event queue, returning empty list")
            return []

    def register_agent(self, agent_id: str):
        """
        Register an agent with the event gateway by creating an event queue.
        """
        if agent_id not in self.agent_event_queues:
            self.agent_event_queues[agent_id] = asyncio.Queue()
            logger.debug(f"Created event queue for agent {agent_id}")
        else:
            logger.debug(f"Agent {agent_id} already has an event queue")

    def subscribe(
        self,
        agent_id: str,
        event_patterns: List[str],
        channels: Optional[List[str]] = None,
    ) -> EventSubscription:
        """
        Subscribe an agent to events matching the given patterns.
        """
        # Initialize agent subscriptions list if it doesn't exist
        if agent_id not in self.agent_subscriptions:
            self.agent_subscriptions[agent_id] = []

        subscription = EventSubscription(
            agent_id=agent_id,
            event_patterns=event_patterns,
            channels=set(channels) if channels else set(),
        )
        self.agent_subscriptions[agent_id].append(subscription)
        logger.info(f"Agent {agent_id} subscribed to patterns {event_patterns}")
        return subscription

    def unsubscribe(self, subscription_id: str) -> bool:
        """
        Unsubscribe an agent from events matching the given patterns.
        """
        for agent_id in list(self.agent_subscriptions.keys()):
            subscriptions = self.agent_subscriptions[agent_id]
            for subscription in list(subscriptions):
                if subscription.subscription_id == subscription_id:
                    subscriptions.remove(subscription)
                    logger.info(
                        f"Agent {agent_id} unsubscribed from patterns {subscription.event_patterns}"
                    )
                    return True
        return False

    def unsubscribe_agent(self, agent_id: str) -> None:
        """
        Unsubscribe an agent from all events.
        """
        if agent_id in self.agent_subscriptions:
            for subscription in self.agent_subscriptions[agent_id]:
                self.unsubscribe(subscription.subscription_id)
        return None

    def get_agent_subscriptions(self, agent_id: str) -> List[EventSubscription]:
        """
        Get all subscriptions for a specific agent.
        """
        return self.agent_subscriptions.get(agent_id, [])

    def get_stats(self) -> Dict[str, Any]:
        """
        Get the statistics of the event gateway.
        """
        return {
            "total_events": len(self.processed_event_ids),
            "active_subscriptions": len(self.agent_subscriptions),
        }

    def remove_agent_event_queue(self, agent_id: str):
        """
        Remove an agent's event queue.
        """
        if agent_id in self.agent_event_queues:
            del self.agent_event_queues[agent_id]

    def create_channel(self, channel_id: str):
        """
        Create a channel.
        """
        if channel_id not in self.channel_members:
            self.channel_members[channel_id] = []
            logger.debug(f"Created channel: {channel_id}")
        else:
            logger.debug(f"Channel {channel_id} already exists")

    def add_channel_member(self, channel_id: str, agent_id: str):
        """
        Add a member to a channel. Creates the channel if it doesn't exist.
        """
        if channel_id not in self.channel_members:
            self.create_channel(channel_id)
            logger.debug(
                f"Auto-created channel {channel_id} when adding member {agent_id}"
            )

        if agent_id not in self.channel_members[channel_id]:
            self.channel_members[channel_id].append(agent_id)
            logger.debug(f"Added member {agent_id} to channel {channel_id}")
        else:
            logger.debug(f"Member {agent_id} already in channel {channel_id}")

    def remove_channel_member(self, channel_id: str, agent_id: str):
        """
        Remove a member from a channel.
        """
        if channel_id in self.channel_members:
            self.channel_members[channel_id].remove(agent_id)
            logger.debug(f"Removed member {agent_id} from channel {channel_id}")
        else:
            logger.debug(f"Channel {channel_id} does not exist")

    def get_channel_members(self, channel_id: str) -> List[str]:
        """
        Get the members of a channel.
        """
        return self.channel_members.get(channel_id, [])

    def list_channels(self) -> List[str]:
        """
        List all channels.
        """
        return list(self.channel_members.keys())

    def remove_channel(self, channel_id: str):
        """
        Remove a channel.
        """
        if channel_id in self.channel_members:
            del self.channel_members[channel_id]
            logger.debug(f"Removed channel: {channel_id}")
        else:
            logger.debug(f"Channel {channel_id} does not exist")

    def _get_group_members(self, group_id: str) -> List[str]:
        """
        Get the list of agent IDs that belong to a specific group.
        
        Args:
            group_id: The ID of the agent group
            
        Returns:
            List of agent IDs in the group, empty list if group not found
        """
        try:
            # Access network configuration to get agent groups
            if hasattr(self.network, 'config') and hasattr(self.network.config, 'agent_groups'):
                agent_groups = self.network.config.agent_groups
                if group_id in agent_groups:
                    group_info = agent_groups[group_id]
                    
                    # Handle Pydantic AgentGroupConfig objects
                    if hasattr(group_info, 'metadata'):
                        metadata = group_info.metadata
                        if isinstance(metadata, dict) and 'agents' in metadata:
                            agents = metadata['agents']
                            logger.debug(f"Found {len(agents)} agents in group '{group_id}': {agents}")
                            return agents
                    
                    # Handle dictionary format (backward compatibility)
                    elif isinstance(group_info, dict):
                        if 'metadata' in group_info and 'agents' in group_info['metadata']:
                            agents = group_info['metadata']['agents']
                            logger.debug(f"Found {len(agents)} agents in group '{group_id}': {agents}")
                            return agents
                        elif 'agents' in group_info:
                            agents = group_info['agents']
                            logger.debug(f"Found {len(agents)} agents in group '{group_id}': {agents}")
                            return agents
                    
            logger.debug(f"Group '{group_id}' not found or has no agents defined")
            return []
            
        except Exception as e:
            logger.error(f"Error looking up group members for '{group_id}': {e}")
            return []

    async def cleanup_agent(self, agent_id: str):
        """
        Cleanup an agent's event subscription and queue.
        """
        if agent_id in self.agent_subscriptions:
            del self.agent_subscriptions[agent_id]
        if agent_id in self.agent_event_queues:
            self.remove_agent_event_queue(agent_id)
        for channel in self.channel_members:
            if agent_id in self.channel_members[channel]:
                self.channel_members[channel].remove(agent_id)
