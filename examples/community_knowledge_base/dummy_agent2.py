#!/usr/bin/env python3
"""
Dummy Agent 2 for Multi-Agent Messaging Debug

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


class DummyAgent2(AIBaseAgent):
    """
    Dummy Agent 2 for testing multi-agent messaging.
    Sends simple test messages every 35 seconds (slightly offset from Agent 1).
    """
    
    default_agent_id = "dummy-agent-2"
    content_type = "Test Messages"
    source_name = "Dummy Source 2"
    auto_mention_response = True
    default_channels = ["general"]
    
    def __init__(self, **kwargs):
        """Initialize Dummy Agent 2."""
        super().__init__(**kwargs)
        
        # Slightly different timing to test concurrent messaging
        self.content_check_interval = 35  # Check every 35 seconds (offset from Agent 1)
        self.min_message_interval = 35   # 35 seconds between messages for testing
        
        # Message counter
        self.message_count = 0
    
    async def initialize_content_fetcher(self):
        """No real content fetcher needed for dummy agent."""
        logger.info("🤖 Dummy Agent 2: No content fetcher needed")
    
    async def fetch_new_content(self, limit: int = 1) -> List[Dict[str, Any]]:
        """Generate dummy test content."""
        self.message_count += 1
        
        return [{
            "id": f"dummy2-{self.message_count}",
            "title": f"Test Message #{self.message_count} from Dummy Agent 2",
            "summary": f"This is test message number {self.message_count} sent at {datetime.now().strftime('%H:%M:%S')} to debug multi-agent messaging issues. Agent 2 uses 35-second intervals.",
            "category": "test",
            "source": "Dummy Agent 2",
            "url": f"https://example.com/dummy2/{self.message_count}",
            "tags": ["test", "dummy", "agent2"],
            "timestamp": datetime.now(),
            "hash": f"dummy2-{self.message_count}"
        }]
    
    def _create_startup_message(self) -> str:
        """Create startup message for Dummy Agent 2."""
        return (f"🤖 **Dummy Agent 2 Online!** 🧪\n\n"
                f"I'm a test agent for debugging multi-agent messaging issues.\n\n"
                f"**What I do:**\n"
                f"• 📡 Send test messages every 35 seconds\n"
                f"• 🎯 Help debug message delivery issues\n"
                f"• 📊 Number my messages for tracking\n"
                f"• ⏱️ Use 35-second intervals (offset from Agent 1)\n\n"
                f"**Purpose:**\n"
                f"• Test multi-agent messaging reliability\n"
                f"• Identify message delivery conflicts\n"
                f"• Debug network timing issues\n"
                f"• Compare with Agent 1 (30-second intervals)\n\n"
                f"🔥 **Dummy Agent 2 ready for testing!** 🚀")


async def main():
    """Main function to run Dummy Agent 2."""
    print("🚀 Starting Dummy Agent 2...")
    print("=" * 60)
    
    # Create the bot
    bot = DummyAgent2(agent_id="dummy-agent-2")
    
    try:
        # Connect to the network
        print("🔌 Connecting to Community Knowledge Base network...")
        await bot.async_start(host="localhost", port=DEFAULT_NETWORK_PORT)
        print("✅ Dummy Agent 2 connected successfully!")
        
        # Keep the bot running
        print("🤖 Dummy Agent 2 is now active and sending test messages...")
        print("📋 Press Ctrl+C to stop the agent")
        
        # Run indefinitely
        while True:
            await asyncio.sleep(1)
            
    except KeyboardInterrupt:
        print("\n🛑 Shutting down Dummy Agent 2...")
    except Exception as e:
        print(f"❌ Error running Dummy Agent 2: {e}")
        import traceback
        traceback.print_exc()
    finally:
        # Clean shutdown
        await bot.async_stop()
        print("👋 Dummy Agent 2 stopped")


if __name__ == "__main__":
    # Run the bot
    asyncio.run(main())