from typing import Dict
import logging

from openagents.agents.runner import AgentRunner
from openagents.models.agent_config import AgentTriggerConfigItem, TriggerFilter
from openagents.models.event_context import EventContext
from openagents.models.event import Event

logger = logging.getLogger(__name__)


class CollaboratorAgent(AgentRunner):
    """
    A collaborator agent that responds to specific events based on the agent config.
    """

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        if self.agent_config is not None and self.agent_config.triggers is not None:
            self._triggers_map: Dict[str, AgentTriggerConfigItem] = {
                trigger.event: trigger for trigger in self.agent_config.triggers
            }
        else:
            self._triggers_map = {}

    def _matches_filter(self, event: Event, trigger_filter: TriggerFilter) -> bool:
        """Check if an event matches the trigger filter criteria.

        Args:
            event: The incoming event to check
            trigger_filter: The filter criteria to match against

        Returns:
            True if the event matches all filter criteria, False otherwise
        """
        if trigger_filter is None:
            return True

        # Check sender_type filter
        if trigger_filter.sender_type is not None:
            # Get sender_type from event payload
            # AI agents using the messaging adapter will set sender_type="agent"
            # Messages without sender_type are assumed to be from humans
            event_sender_type = None
            if event.payload and isinstance(event.payload, dict):
                event_sender_type = event.payload.get("sender_type")

            # If sender_type is not explicitly set in payload, default to "human"
            # This is because AI agents using the SDK will always set sender_type="agent"
            # Messages from humans (via UI) won't have this field set
            if event_sender_type is None:
                event_sender_type = "human"

            if event_sender_type != trigger_filter.sender_type:
                logger.debug(
                    f"Filter mismatch: event sender_type='{event_sender_type}' != filter sender_type='{trigger_filter.sender_type}'"
                )
                return False

        # Check source_id filter
        if trigger_filter.source_id is not None:
            if event.source_id != trigger_filter.source_id:
                logger.debug(
                    f"Filter mismatch: event source_id='{event.source_id}' != filter source_id='{trigger_filter.source_id}'"
                )
                return False

        # Check extra_filters against payload
        if trigger_filter.extra_filters is not None and event.payload:
            for key, expected_value in trigger_filter.extra_filters.items():
                actual_value = event.payload.get(key) if isinstance(event.payload, dict) else None
                if actual_value != expected_value:
                    logger.debug(
                        f"Filter mismatch: payload['{key}']={actual_value} != expected {expected_value}"
                    )
                    return False

        return True

    async def react(self, context: EventContext):
        """React to an incoming message using agent orchestrator."""
        trigger = self._triggers_map.get(context.incoming_event.event_name)
        if trigger:
            # Check if the event matches the trigger filter
            if not self._matches_filter(context.incoming_event, trigger.filter):
                logger.debug(
                    f"Trigger found for event: {context.incoming_event.event_name}, but filter did not match - skipping"
                )
                return

            logger.debug(
                f"Trigger found for event: {context.incoming_event.event_name}, responding with trigger instruction"
            )
            await self.run_agent(context=context, instruction=trigger.instruction)
        else:
            if self.agent_config is not None and self.agent_config.react_to_all_messages:
                logger.debug(
                    f"No trigger found for event: {context.incoming_event.event_name} but react_to_all_messages is True, responding with default instruction"
                )
                await self.run_agent(context=context)
            else:
                logger.debug(
                    f"No trigger found for event: {context.incoming_event.event_name} and react_to_all_messages is False, doing nothing"
                )
