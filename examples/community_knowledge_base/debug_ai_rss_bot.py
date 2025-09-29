#!/usr/bin/env python3
"""
Debug version of AI RSS Bot with verbose logging
"""

import asyncio
import logging
import sys
from ai_rss_bot import AIRSSBot

# Set up detailed logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout)
    ]
)

logger = logging.getLogger(__name__)

async def main():
    logger.info("🐛 DEBUG: Starting AI RSS Bot with verbose logging...")
    
    try:
        logger.info("🐛 DEBUG: Creating AIRSSBot instance...")
        bot = AIRSSBot(agent_id="debug-ai-rss-bot")
        logger.info("🐛 DEBUG: AIRSSBot created successfully")
        
        logger.info("🐛 DEBUG: Starting bot connection to network...")
        await bot.async_start(host="localhost", port=8572)
        logger.info("🐛 DEBUG: Bot connected successfully!")
        
        # Test content fetching
        logger.info("🐛 DEBUG: Testing content fetching...")
        try:
            content = await bot.fetch_new_content(2)
            logger.info(f"🐛 DEBUG: Content fetch result: {len(content)} items")
            for i, item in enumerate(content, 1):
                logger.info(f"🐛 DEBUG: Item {i}: {item.get('title', 'No title')}")
        except Exception as e:
            logger.error(f"🐛 DEBUG: Content fetch failed: {e}")
        
        logger.info("🐛 DEBUG: Bot is running... Press Ctrl+C to stop")
        
        # Keep running
        while True:
            await asyncio.sleep(1)
            
    except KeyboardInterrupt:
        logger.info("🐛 DEBUG: Shutting down due to KeyboardInterrupt...")
    except Exception as e:
        logger.error(f"🐛 DEBUG: Unexpected error: {e}")
        import traceback
        traceback.print_exc()
    finally:
        try:
            await bot.async_stop()
            logger.info("🐛 DEBUG: Bot stopped successfully")
        except:
            pass

if __name__ == "__main__":
    asyncio.run(main())