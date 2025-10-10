import os
import logging

from openagents.agents.worker_agent import WorkerAgent
from openagents.models.agent_config import AgentConfig
from openagents.models.event_context import ChannelMessageContext, EventContext


logger = logging.getLogger(__name__)


class LLMDemoAgent(WorkerAgent):
    """Worker agent that answers channel messages using an LLM."""

    default_agent_id = "llm-demo"

    async def on_startup(self):
        ws = self.workspace()
        await ws.channel("general").post("LLM demo agent is online.")

    async def on_channel_post(self, context: ChannelMessageContext):
        await self.respond_via_llm(context)

    async def respond_via_llm(self, context: EventContext):
        instruction = os.getenv(
            "AGENT_RESPONSE_PROMPT",
            "Respond concisely and mention the sender by name.",
        )

        configured_api_key = getattr(self.agent_config, "api_key", None)
        effective_api_key = (
            configured_api_key
            or os.getenv("API_KEY")
            or os.getenv("AGENT_API_KEY")
            or os.getenv("OPENAI_API_KEY")
        )

        configured_base = getattr(self.agent_config, "api_base", None)
        effective_base = configured_base or os.getenv("BASE_URL") or os.getenv("AGENT_API_BASE")

        ws = self.workspace()

        if not effective_api_key:
            logger.warning(
                "LLM demo agent skipped response: missing API_KEY / AGENT_API_KEY / OPENAI_API_KEY."
            )
            await ws.channel(context.channel).reply(
                context.message_id,
                "I need an API key (set API_KEY in .env) to generate LLM replies.",
            )
            return

        # Ensure downstream components have the latest values
        if not configured_api_key:
            self.agent_config.api_key = effective_api_key
        if effective_base and not configured_base:
            self.agent_config.api_base = effective_base

        await self.run_agent(
            context=context,
            instruction=instruction,
        )


if __name__ == "__main__":
    host = os.getenv("NETWORK_HOST", "localhost")
    port = int(os.getenv("NETWORK_PORT", "8700"))

    instruction = os.getenv(
        "AGENT_INSTRUCTION",
        "You are an assistant that helps teammates in the OpenAgents network.",
    )
    model_name = os.getenv("MODEL") or os.getenv("AGENT_MODEL_NAME") or "gpt-4o-mini"
    provider = os.getenv("AGENT_PROVIDER", "openai")
    api_key = os.getenv("API_KEY") or os.getenv("AGENT_API_KEY")
    api_base = os.getenv("BASE_URL") or os.getenv("AGENT_API_BASE")

    agent_config = AgentConfig(
        instruction=instruction,
        model_name=model_name,
        provider=provider,
        api_key=api_key,
        react_to_all_messages=True,
    )

    if api_base:
        agent_config.api_base = api_base

    agent = LLMDemoAgent(agent_config=agent_config)
    agent.start(network_host=host, network_port=port)
    agent.wait_for_stop()
