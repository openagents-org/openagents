#!/usr/bin/env python3
"""
Dummy Agent 1 for Multi-Agent Messaging Debug

This is a simple test agent that sends periodic messages to debug
multi-agent messaging issues in the network.
"""

import asyncio
import logging
from datetime import datetime
from typing import Dict, List, Any

from ai_base_agent import AIBaseAgent

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

DEFAULT_NETWORK_PORT = 8572


class DummyAgent1(AIBaseAgent):
    """
    Dummy Agent 1 for testing multi-agent messaging.
    Sends simple test messages every 30 seconds.
    """
    
    default_agent_id = "dummy-agent-1"
    content_type = "Test Messages"
    source_name = "Dummy Source 1"
    auto_mention_response = True
    default_channels = ["general"]
    
    def __init__(self, **kwargs):
        """Initialize Dummy Agent 1."""
        super().__init__(**kwargs)
        
        # Fast posting for testing
        self.content_check_interval = 30  # Check every 30 seconds
        self.min_message_interval = 30   # 30 seconds between messages for testing
        
        # Message counter
        self.message_count = 0
    
    async def initialize_content_fetcher(self):
        """No real content fetcher needed for dummy agent."""
        logger.info("🤖 Dummy Agent 1: No content fetcher needed")
    
    async def fetch_new_content(self, limit: int = 1) -> List[Dict[str, Any]]:
        """Generate dummy test content."""
        self.message_count += 1
        
        return [{
            "id": f"dummy1-{self.message_count}",
            "title": f"Test Message #{self.message_count} from Dummy Agent 1",
            "summary": f"This is test message number {self.message_count} sent at {datetime.now().strftime('%H:%M:%S')} to debug multi-agent messaging issues.",
            "category": "test",
            "source": "Dummy Agent 1",
            "url": f"https://example.com/dummy1/{self.message_count}",
            "tags": ["test", "dummy", "agent1"],
            "timestamp": datetime.now(),
            "hash": f"dummy1-{self.message_count}"
        }]
    
    def _create_startup_message(self) -> str:
        """Create startup message for Dummy Agent 1."""
        return (f"🤖 **Dummy Agent 1 Online!** 🧪\n\n"
                f"I'm a test agent for debugging multi-agent messaging issues.\n\n"
                f"**What I do:**\n"
                f"• 📡 Send test messages every 30 seconds\n"
                f"• 🎯 Help debug message delivery issues\n"
                f"• 📊 Number my messages for tracking\n"
                f"• ⏱️ Use 30-second intervals for faster testing\n\n"
                f"**Purpose:**\n"
                f"• Test multi-agent messaging reliability\n"
                f"• Identify message delivery conflicts\n"
                f"• Debug network timing issues\n\n"
                f"🔥 **Dummy Agent 1 ready for testing!** 🚀")


async def main():
    """Main function to run Dummy Agent 1."""
    print("🚀 Starting Dummy Agent 1...")
    print("=" * 60)
    
    # Create the bot
    bot = DummyAgent1(agent_id="dummy-agent-1")
    
    try:
        # Connect to the network
        print("🔌 Connecting to Community Knowledge Base network...")
        await bot.async_start(host="localhost", port=DEFAULT_NETWORK_PORT)
        print("✅ Dummy Agent 1 connected successfully!")
        
        # Keep the bot running
        print("🤖 Dummy Agent 1 is now active and sending test messages...")
        print("📋 Press Ctrl+C to stop the agent")
        
        # Run indefinitely
        while True:
            await asyncio.sleep(1)
            
    except KeyboardInterrupt:
        print("\n🛑 Shutting down Dummy Agent 1...")
    except Exception as e:
        print(f"❌ Error running Dummy Agent 1: {e}")
        import traceback
        traceback.print_exc()
    finally:
        # Clean shutdown
        await bot.async_stop()
        print("👋 Dummy Agent 1 stopped")


if __name__ == "__main__":
    # Run the bot
    asyncio.run(main())