import logging
from typing import Optional, List

from openagents.agents.runner import AgentRunner
from openagents.models.agent_config import AgentConfig
from openagents.models.event_context import EventContext
from openagents.agents.orchestrator import orchestrate_agent

logger = logging.getLogger(__name__)

class SimpleAgentRunner(AgentRunner):
    """Unified agent runner supporting multiple model providers."""
    
    def __init__(
        self,
        agent_id: str,
        agent_config: AgentConfig,
        mod_names: Optional[List[str]] = None,
        **kwargs
    ):
        """Initialize the SimpleAgentRunner.
        
        Args:
            agent_id: Unique identifier for this agent
            agent_config: AgentConfig containing model and prompt configuration
            protocol_names: List of protocol names to register with (overrides agent_config)
            **kwargs: Additional provider-specific configuration
        """
        # Use protocol_names parameter if provided, otherwise use config's ignored_sender_ids
        ignored_sender_ids = agent_config.ignored_sender_ids
        super().__init__(agent_id=agent_id, mod_names=mod_names, ignored_sender_ids=ignored_sender_ids)
        
        # Store the agent config
        self.agent_config = agent_config
        
        # Extract configuration values
        self.model_name = agent_config.model_name
    
    
    async def react(self, context: EventContext):
        """React to an incoming message using the configured model provider."""
        # Use orchestrator for agent interaction
        trajectory = orchestrate_agent(
            context=context,
            agent_config=self.agent_config,
            tools=self.tools
        )
        return trajectory
