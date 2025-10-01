#!/usr/bin/env python3
"""
Example Client Agent for Community Knowledge Base

This script demonstrates how to create a simple client agent that can
participate in the community knowledge base network.
"""

import asyncio
import logging
import sys
import time
from pathlib import Path

# Add the OpenAgents source to the path
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "src"))

from openagents.agents.worker_agent import WorkerAgent, ChannelMessageContext, EventContext
from openagents.config.globals import DEFAULT_TRANSPORT_ADDRESS

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class CommunityMemberAgent(WorkerAgent):
    """Simple agent that participates in the community knowledge base."""
    
    default_agent_id = "community-member-1"
    auto_mention_response = True
    default_channels = ["general", "#ai-news", "#research", "#tools"]
    
    def __init__(self, **kwargs):
        """Initialize the Community Member Agent."""
        super().__init__(**kwargs)
    
    async def on_direct(self, msg: EventContext):
        """Handle direct messages."""
        text = msg.text.lower().strip()
        
        if "hello" in text or "hi" in text:
            ws = self.workspace()
            await ws.agent(msg.sender_id).send(
                f"Hello {msg.sender_id}! 👋 I'm a community member interested in AI developments."
            )
        elif "help" in text:
            ws = self.workspace()
            await ws.agent(msg.sender_id).send(
                f"Hi {msg.sender_id}! I'm here to participate in AI discussions. Try asking @ai-news-bot for the latest updates!"
            )
        else:
            ws = self.workspace()
            await ws.agent(msg.sender_id).send(
                f"Thanks for messaging me, {msg.sender_id}! I'm always interested in AI discussions."
            )
    
    async def on_channel_mention(self, msg: ChannelMessageContext):
        """Handle mentions in channels."""
        text = msg.text.lower()
        
        # Remove mention from text for processing
        clean_text = text.replace(f"@{self.default_agent_id}", "").strip()
        
        if "hello" in clean_text or "hi" in clean_text:
            ws = self.workspace()
            await ws.channel(msg.channel).post_with_mention(
                f"Hello {msg.sender_id}! 👋 I'm a community member interested in AI developments.",
                mention_agent_id=msg.sender_id
            )
        elif "help" in clean_text:
            ws = self.workspace()
            await ws.channel(msg.channel).post_with_mention(
                f"Hi {msg.sender_id}! I'm here to participate in AI discussions. Try asking @ai-news-bot for the latest updates!",
                mention_agent_id=msg.sender_id
            )
        else:
            ws = self.workspace()
            await ws.channel(msg.channel).post_with_mention(
                f"Thanks for mentioning me, {msg.sender_id}! I'm always interested in AI discussions.",
                mention_agent_id=msg.sender_id
            )
    
    async def on_startup(self):
        """Initialize the agent and send introduction message."""
        logger.info(f"🤖 Community Member Agent '{self.default_agent_id}' starting up...")
        
        # Send introduction message
        try:
            ws = self.workspace()
            ws._auto_connect_config = {
                'host': 'localhost',
                'port': DEFAULT_TRANSPORT_ADDRESS['http']['port']
            }
            await ws.channel("general").post(
                f"👋 Hello community! {self.client.agent_id} has joined the network. Excited to learn about AI developments!"
            )
            logger.info("✅ Successfully sent introduction message to general channel")
        except Exception as e:
            logger.error(f"❌ Failed to send introduction message: {e}")
        
        logger.info("✅ Community Member Agent startup complete")
    
    async def on_shutdown(self):
        """Clean shutdown of the agent."""
        logger.info("🛑 Community Member Agent shutting down...")
        
        # Send goodbye message
        try:
            ws = self.workspace()
            await ws.channel("general").post(
                f"👋 {self.client.agent_id} is leaving the network. Thanks for the great discussions!"
            )
            logger.info("✅ Successfully sent goodbye message")
        except Exception as e:
            logger.error(f"❌ Failed to send goodbye message: {e}")
        
        logger.info("✅ Community Member Agent shutdown complete")
    
    async def participate(self):
        """Simulate participation in the community."""
        # Wait a bit after startup
        await asyncio.sleep(5)
        
        # Ask the AI bot for a summary
        try:
            ws = self.workspace()
            await ws.channel("general").post("@ai-news-bot summary")
            logger.info("✅ Asked AI bot for summary")
        except Exception as e:
            logger.error(f"❌ Failed to ask for summary: {e}")
        
        await asyncio.sleep(10)
        
        # Share interest in a topic
        try:
            ws = self.workspace()
            await ws.channel("research").post("I'm really interested in the latest developments in multimodal AI. Has anyone seen interesting papers recently?")
            logger.info("✅ Shared interest in research channel")
        except Exception as e:
            logger.error(f"❌ Failed to share interest: {e}")
        
        await asyncio.sleep(15)
        
        # Search for specific content
        try:
            ws = self.workspace()
            await ws.channel("research").post("@ai-news-bot search transformer models")
            logger.info("✅ Asked AI bot to search for transformer models")
        except Exception as e:
            logger.error(f"❌ Failed to search: {e}")


async def main():
    """Run the example client agent."""
    print("🤖 Starting Community Member Agent Example...")
    print("=" * 60)
    
    # Create a community member agent with unique ID
    unique_id = f"community-member-{int(time.time())}"
    agent = CommunityMemberAgent(agent_id=unique_id)
    print(f"🆔 Agent ID: {unique_id}")
    
    try:
        # Start the agent (connects to network and runs startup)
        print("🔌 Connecting to Community Knowledge Base network...")
        await agent.async_start(network_host="localhost", network_port=DEFAULT_TRANSPORT_ADDRESS['http']['port'])
        print("✅ Connected successfully!")
        
        print("🎭 Participating in community discussions...")
        
        # Participate in the community
        await agent.participate()
        
        # Keep running to receive messages
        print("👂 Listening for community messages...")
        print("🛑 Press Ctrl+C to disconnect")
        
        # Run for a while to demonstrate interaction
        for i in range(60):  # Run for 1 minute
            await asyncio.sleep(1)
            if i % 10 == 0:
                print(f"⏱️  Running... ({i+1}/60 seconds)")
        
        print("✅ Example completed!")
        
    except KeyboardInterrupt:
        print("\n🛑 Stopping agent...")
    except Exception as e:
        print(f"❌ Error running agent: {e}")
        import traceback
        traceback.print_exc()
        return 1
    finally:
        # Clean shutdown
        await agent.async_stop()
        print("👋 Community Member Agent stopped")
    
    return 0


if __name__ == "__main__":
    exit_code = asyncio.run(main())
    sys.exit(exit_code)
