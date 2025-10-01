import asyncio
from openagents.core.client import AgentClient
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
        task_instruction = "If the message is about weather, check weather report and reply"
        await self.run_agent(
            context=context,
            instruction=task_instruction
        )

if __name__ == "__main__":
    charlie = CharlieAgent(agent_config=AgentConfig(
        model_name="gpt-4o-mini",
        instruction="You are a weather assistant ...",
    ))
    charlie.start(network_host="localhost")
    charlie.wait_for_stop()
    