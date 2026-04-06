import logging
from typing import Optional, List

from openagents.agents.runner import AgentRunner
from openagents.models.agent_config import AgentConfig
from openagents.models.event_context import EventContext
from openagents.agents.orchestrator import orchestrate_agent

logger = logging.getLogger(__name__)


class SimpleAutoAgent(AgentRunner):
    """
    A simple agent that responds to all incoming messages automatically.
    """

    async def react(self, context: EventContext):
        """React to an incoming message using agent orchestrator."""
        await self.run_agent(context=context)
