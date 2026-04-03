import logging
import re
from typing import Dict

from openagents.agents.runner import AgentRunner
from openagents.models.agent_config import AgentTriggerConfigItem
from openagents.models.event_context import EventContext

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

    def _is_mentioned(self, event) -> bool:
        """Check if this agent is @mentioned in the event payload."""
        payload = event.payload or {}
        if payload.get("mentioned_agent_id") == self.client.agent_id:
            return True
        content = payload.get("content", "")
        if content and re.search(rf"@{re.escape(self.client.agent_id)}\b", content):
            return True
        return False

    async def react(self, context: EventContext):
        """React to an incoming message using agent orchestrator."""
        trigger = self._triggers_map.get(context.incoming_event.event_name)
        if trigger:
            logger.debug(
                f"Trigger found for event: {context.incoming_event.event_name}, responding with trigger instruction"
            )
            await self.run_agent(context=context, instruction=trigger.instruction)
        elif self.agent_config is not None and self.agent_config.react_to_all_messages:
            logger.debug(
                f"No trigger found for event: {context.incoming_event.event_name} but react_to_all_messages is True, responding"
            )
            await self.run_agent(context=context)
        elif self._is_mentioned(context.incoming_event):
            logger.debug(
                f"Agent @mentioned in event: {context.incoming_event.event_name}, responding"
            )
            await self.run_agent(context=context)
        else:
            logger.debug(
                f"No trigger for event: {context.incoming_event.event_name}, not mentioned, skipping"
            )
