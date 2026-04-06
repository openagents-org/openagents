#!/usr/bin/env python3
"""
Product Review Agent for Community Knowledge Base

This agent automatically finds and shares product reviews, comparisons,
and interesting developments in various product categories. It posts findings to the general
channel and can respond to specific requests for product information.

Features:
- Automatic product review discovery and sharing
- Responds to product-related questions
- Categorizes content by type (reviews, comparisons, guides, etc.)
- Provides summaries and key insights
- Maintains a knowledge base of shared content
"""

import asyncio
import logging
import json
import hashlib
import random
from datetime import datetime, timedelta
from typing import Dict, List, Set, Optional, Any
from pathlib import Path
from openagents.models.event import Event
from openagents.agents.worker_agent import (
    WorkerAgent,
    EventContext,
    ChannelMessageContext,
    ReplyMessageContext,
    on_event
)
from openagents.models.event_thread import EventThread

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

NETWORK_PORT = 8700


class ProductReviewAgent(WorkerAgent):
    """
    Worker agent that discovers and shares product reviews and comparisons.
    
    This agent monitors various sources for product-related content and automatically
    shares interesting findings with the community through channel posts.
    """
    
    default_agent_id = "product-review-bot"
    auto_mention_response = True
    default_channels = ["general", "#reviews", "#products", "#comparisons"]
    
    def __init__(self, **kwargs):
        """Initialize the Product Review Agent."""
        super().__init__(**kwargs)
        
        # Content tracking
        self.shared_content: Set[str] = set()  # Track shared content hashes
        self.content_categories = {
            "review": "⭐",
            "comparison": "⚖️", 
            "guide": "📖",
            "unboxing": "📦",
            "tutorial": "🎓",
            "announcement": "📢"
        }
        
        # Product sources and keywords
        self.product_keywords = [
            "review", "comparison", "vs", "unboxing", "hands-on",
            "product test", "buying guide", "best", "top rated",
            "smartphone", "laptop", "headphones", "camera", "tablet",
            "gaming", "tech review", "product launch", "first look",
            "pros and cons", "worth it", "should you buy", "recommendation"
        ]
        
        # Simulated review sources (in real implementation, these would be actual APIs)
        self.review_sources = [
            "Product Review Sites",
            "Tech Review Aggregator", 
            "Consumer Reports",
            "Unboxing Videos",
            "Comparison Guides"
        ]
        
        # Content database
        self.last_review_check = datetime.now() - timedelta(hours=1)
        
        # Agent state
        self.is_active = True
        self.review_check_interval = 60  # 60 seconds for Reddit crawling
        
        # Initialize Reddit feeder for product reviews
        self.last_reddit_check = datetime.now() - timedelta(hours=1)  # Force initial check
        
    async def on_startup(self):
        """Initialize the agent and start background tasks."""
        logger.info(f"🤖 Product Review Agent '{self.default_agent_id}' starting up...")
        
        # Check available channels
        try:
            ws = self.workspace()
            ws._auto_connect_config = {
                'host': 'localhost',
                'port': NETWORK_PORT
            }
            channels_info = await ws.channels()
            logger.info(f"📺 Available channels: {channels_info}")
        except Exception as e:
            logger.error(f"❌ Error listing channels: {e}")
        
        # Send startup message to general channel using direct adapter
        startup_message = (f"🤖 **Product Review Bot Online!** ⭐\n\n")
        
        try:
            ws = self.workspace()
            ws._auto_connect_config = {
                'host': 'localhost',
                'port': NETWORK_PORT
            }
            await ws.channel("general").post(startup_message)
            logger.info("✅ Successfully sent startup message to general channel")
        except Exception as e:
            logger.error(f"❌ Failed to send startup message: {e}")
        
        logger.info("✅ Product Review Agent startup complete")
    
    async def on_shutdown(self):
        """Clean shutdown of the agent."""
        logger.info("🛑 Product Review Agent shutting down...")
        self.is_active = False
        logger.info("✅ Product Review Agent shutdown complete")
    
    async def on_direct(self, context: EventContext):
        """Handle direct messages."""
        logger.info(f"Received direct message from {context.source_id}: {context.text}")
        self.client.send_event(context.event)
        self.send_direct(context.source_id, f"Hello {context.source_id}!")
    
    async def on_channel_mention(self, context: ChannelMessageContext):
        """Handle channel mentions."""
        logger.info(f"Received channel mention from {context}")
        incoming_event = context.incoming_event
        await self.workspace().channel(context.channel).post(
            f"Hello {incoming_event.sender_id}! You mentioned me.",
        )
    
    @on_event("thread.direct_message.notification")
    async def on_direct_message_notification(self, context: EventContext):
        """Handle direct message notifications."""
        logger.info(f"Received direct message notification from {context.source_id}: {context.text}")
        self.send_direct(context.source_id, f"Hello {context.source_id}!")
    
    @on_event("forum.topic.created")
    async def on_forum_topic_created(self, context: EventContext):
        """Handle forum topic creations."""
        try:
            incoming_message = context.incoming_event
            topic_data = incoming_message.payload.get('topic', {})
            topic_id = topic_data.get('topic_id')
            
            if not topic_id:
                logger.warning("No topic_id found in forum topic creation event")
                return
                
            logger.info(f"📝 Forum topic created: {topic_id}, preparing product review...")
            
            # Send initial comment indicating we're working on a review
            await self.client.send_event(Event(
                event_name="forum.comment.post",
                source_id=self.agent_id,
                destination_id="mod:openagents.mods.workspace.forum",
                payload={
                    "action": "post",
                    "topic_id": topic_id,
                    "content": "🔍 Working on reviewing and trying out the product..."
                }
            ))
            
            # Wait a bit before posting the full review
            await asyncio.sleep(3)
            
            # Try to get a screenshot and create a detailed review
            try:
                import openmcp
                import os
                
                # Set API key if available
                if not os.environ.get("OPENMCP_API_KEY"):
                    os.environ["OPENMCP_API_KEY"] = "bmcp_jDVc1fk17UaUMc3cd2uxaYMdag8UYLU8B4SxArxc_Vo"
                
                async with openmcp.browser() as browser:
                    await browser.navigate("https://imgur.com/")
                    screenshot_path = await browser.screenshot()
                    full_image_path = "http://cur2.acenta.ai:5000/" + screenshot_path
                    
                    markdown_response = f"""![Screenshot]({full_image_path})

                        ## 📊 Product Review

                        **Overall Rating:** ⭐⭐⭐⭐☆ (4/5)

                        **Pros:**
                        - Clean and intuitive interface
                        - Fast loading times
                        - Good visual design
                        - User-friendly navigation

                        **Cons:**
                        - Limited customization options
                        - Could use more advanced features
                        - Some performance issues on older devices

                        **Bottom Line:** This is a solid product that delivers on its core promises. While there's room for improvement, it's definitely worth considering for most users. The interface is well-designed and the core functionality works reliably.

                        **Recommendation:** ✅ Recommended for general use
                    """

                    await self.client.send_event(Event(
                        event_name="forum.comment.post",
                        source_id=self.agent_id,
                        destination_id="mod:openagents.mods.workspace.forum",
                        payload={
                            "action": "post",
                            "topic_id": topic_id,
                            "content": markdown_response
                        }
                    ))
                    
                    logger.info(f"✅ Posted detailed product review for topic {topic_id}")
                    
            except Exception as e:
                logger.error(f"❌ Error creating detailed review: {e}")
                
                # Fallback error message
                error_response = "⚠️ Encountered an issue while preparing the detailed review. Will provide a basic assessment instead."
                
                await self.client.send_event(Event(
                    event_name="forum.comment.post",
                    source_id=self.agent_id,
                    destination_id="mod:openagents.mods.workspace.forum",
                    payload={
                        "action": "post",
                        "topic_id": topic_id,
                        "content": error_response
                    }
                ))
                
        except Exception as e:
            logger.error(f"❌ Error in forum topic creation handler: {e}")
            import traceback
            traceback.print_exc()
    
async def main():
    """Main function to run the Product Review Agent."""
    print("🚀 Starting Product Review Agent...")
    print("=" * 60)
    
    # Create the agent
    agent = ProductReviewAgent(agent_id="product-review-bot")
    
    try:
        # Connect to the network
        print("🔌 Connecting to Community Knowledge Base network...")
        await agent.async_start(network_host="localhost", network_port=NETWORK_PORT)
        print("✅ Connected successfully!")
        
        # Keep the agent running
        print("🤖 Product Review Agent is now active and monitoring for product content...")
        print("📋 Press Ctrl+C to stop the agent")
        
        # Run indefinitely
        while True:
            await asyncio.sleep(1)
            
    except KeyboardInterrupt:
        print("\n🛑 Shutting down Product Review Agent...")
    except Exception as e:
        print(f"❌ Error running agent: {e}")
        import traceback
        traceback.print_exc()
    finally:
        # Clean shutdown
        await agent.async_stop()
        print("👋 Product Review Agent stopped")


if __name__ == "__main__":
    # Run the agent
    asyncio.run(main())
