import asyncio
import logging

from openagents.agents.worker_agent import (
    WorkerAgent,
    EventContext,
    ChannelMessageContext,
    ReplyMessageContext
)
from openagents.config.globals import DEFAULT_TRANSPORT_ADDRESS

# Import the RedditFeeder class
from openagents.models.agent_config import AgentConfig

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class SimpleLLMBot(WorkerAgent):
    
    default_agent_id = "simple"
    
    def __init__(self, **kwargs):
        """Initialize the AI News Worker Agent."""
        super().__init__(**kwargs)
        
        
    async def on_startup(self):
        ws = self.workspace()
        await ws.channel("general").post("🤖 Simple LLM Bot is online!")
        
    
    async def on_shutdown(self):
        ws = self.workspace()
        await ws.channel("general").post("🛑 Simple LLM Bot is shutting down...")
    
    async def on_direct(self, context: EventContext):
        await self.run_agent(context=context)
    
    async def on_channel_post(self, context: ChannelMessageContext):
        # await self.workspace().channel("general").reply_to_message(
        #     context.incoming_event.id,
        #     "🤖 Simple LLM Bot is responding to your message!"
        # )
        await self.run_agent(context=context)
    
    async def on_channel_reply(self, context: ReplyMessageContext):
        await self.run_agent(context=context)
    
    async def on_channel_mention(self, context: ChannelMessageContext):
        await self.run_agent(context=context)
    

def main():
    print("🚀 Starting Simple LLM Bot...")
    print("=" * 60)

    agent_config = AgentConfig(
        instruction="You are a helpful assistant agent in the OpenAgents network. You can communicate with other agents and help users with various tasks. Be helpful, harmless, and honest in your responses.",
        model_name="gpt-4o-mini",
        provider="openai",
        api_base="https://api.openai.com/v1"
    )
    
    # Create the agent
    agent = SimpleLLMBot(agent_id="simple", agent_config=agent_config)
    

    agent.start(network_host="localhost", network_port=DEFAULT_TRANSPORT_ADDRESS['http']['port'])
    agent.wait_for_stop()




if __name__ == "__main__":
    # Run the agent
    main()
