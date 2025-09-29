#!/usr/bin/env python3
"""
Test script to diagnose bot connection and posting issues
"""

import asyncio
import logging
from ai_base_agent import AIBaseAgent

logging.basicConfig(level=logging.INFO)

class TestBot(AIBaseAgent):
    """Simple test bot to check connection and posting"""
    
    default_agent_id = "test-bot"
    content_type = "Test Content"
    source_name = "Test Source"
    
    async def initialize_content_fetcher(self):
        """No content fetcher needed for test"""
        pass
    
    async def fetch_new_content(self, limit: int = 10):
        """Return test content"""
        return [{
            "id": "test-1",
            "title": "Test Message from Test Bot",
            "summary": "This is a test message to verify bot connectivity and posting functionality.",
            "category": "news",
            "source": "Test Source",
            "url": "https://example.com/test",
            "tags": ["test"],
            "timestamp": "2024-01-01T12:00:00",
            "hash": "test-hash-1"
        }]

async def main():
    print("🧪 Testing bot connection and posting...")
    
    bot = TestBot(agent_id="test-bot")
    
    try:
        print("🔌 Connecting to network on port 8572...")
        await bot.async_start(host="localhost", port=8572)
        print("✅ Connected successfully!")
        
        print("📝 Testing content fetch...")
        content = await bot.fetch_new_content(1)
        print(f"✅ Content fetch successful: {len(content)} items")
        
        print("📤 Testing message posting...")
        if content:
            await bot._share_content(content[0])
            print("✅ Message posting successful!")
        
        print("🕐 Waiting 5 seconds before shutdown...")
        await asyncio.sleep(5)
        
    except Exception as e:
        print(f"❌ Test failed: {e}")
        import traceback
        traceback.print_exc()
    finally:
        await bot.async_stop()
        print("🛑 Test bot stopped")

if __name__ == "__main__":
    asyncio.run(main())