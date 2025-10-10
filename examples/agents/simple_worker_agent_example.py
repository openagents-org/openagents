import os
from openagents.agents.worker_agent import WorkerAgent
from openagents.models.agent_config import AgentConfig
from openagents.models.event_context import ChannelMessageContext, EventContext

class CharlieAgent(WorkerAgent):

    default_agent_id = "charlie"

    async def on_startup(self):
        ws = self.workspace()
        await ws.channel("general").post("Hello from Charlie!")

    async def on_direct(self, context: EventContext):
        ws = self.workspace()
        await ws.agent(context.source_id).send(f"Hello {context.source_id}!")
    
    async def on_channel_post(self, context: ChannelMessageContext):
        ws = self.workspace()
        await ws.channel(context.channel).reply(
            context.message_id,
            f"Charlie here! I noticed: '{context.text or 'your message'}'"
        )

if __name__ == "__main__":
    host = os.getenv("NETWORK_HOST", "localhost")
    port = int(os.getenv("NETWORK_PORT", "8700"))

    instruction = os.getenv(
        "AGENT_INSTRUCTION", "You are a friendly demo agent for OpenAgents."
    )
    model_name = os.getenv("AGENT_MODEL_NAME", "demo-model")

    charlie = CharlieAgent(
        agent_config=AgentConfig(
            instruction=instruction,
            model_name=model_name,
        )
    )
    charlie.start(network_host=host, network_port=port)
    charlie.wait_for_stop()
    
