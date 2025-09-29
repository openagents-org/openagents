#!/usr/bin/env python3
"""
AI Product Bot for Community Knowledge Base

This agent automatically finds and shares new AI products from Product Hunt,
tech news sources, and other product launch platforms. It posts findings to 
the general channel and responds to product-related questions.

Features:
- Automatic AI product discovery and sharing
- Product Hunt integration with fallback sources
- Product categorization and tagging
- Interactive search and summaries
- Persistent tracking to avoid duplicates
"""

import asyncio
import logging
import os
import random
import time
from datetime import datetime
from typing import Dict, List, Any

from ai_base_agent import AIBaseAgent
from private.ai_product_fetch_util import AIProductFetcher
from openagents.config.globals import DEFAULT_NETWORK_PORT

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

DEFAULT_NETWORK_PORT = 8572


class AIProductBot(AIBaseAgent):
    """
    AI Product Bot that discovers and shares new AI products and tools.
    
    This agent monitors Product Hunt and other sources for new AI-related
    products and automatically shares interesting findings with the community.
    """
    
    default_agent_id = "ai-product-bot"
    content_type = "AI Products"
    source_name = "Product Hunt & Tech News"
    auto_mention_response = True
    default_channels = ["general"]
    
    def __init__(self, **kwargs):
        """Initialize the AI Product Bot."""
        super().__init__(**kwargs)
        
        self.min_message_interval = 120  # Post every 2 minutes
        
        # Product-specific settings with memory pool logic
        self.content_check_interval = 120  # Check every 2 minutes (for posting)
        self.pool_refresh_interval = 14400  # Refresh content pool every 4 hours (14400 seconds)
        self.last_pool_refresh = 0
        self.content_pool = []  # Memory pool to store fetched products
        
        # Enhanced product categories
        self.content_categories.update({
            "productivity": "⚡",
            "creative": "🎨", 
            "developer": "👩‍💻",
            "healthcare": "🏥",
            "education": "🎓",
            "finance": "💰",
            "communication": "💬",
            "entertainment": "🎮"
        })
        
        # Product-specific AI keywords for comprehensive search
        self.ai_product_keywords = [
            "ai-powered", "ai powered", "intelligent", "smart assistant", 
            "voice assistant", "conversational ai", "predictive", 
            "recommendation engine", "ai platform", "automated", 
            "algorithm", "data science", "copilot", "assistant", 
            "bot", "cognitive", "ai model", "ai system", "ai technology"
        ]
    
    async def initialize_content_fetcher(self):
        """Initialize the AI Product Fetcher."""
        try:
            # Clean up any existing tracking file for fresh start (optional)
            storage_file = "/tmp/ai_product_hunt_data.json"
            if os.path.exists(storage_file):
                logger.info("🗑️ Removing existing product tracking file for fresh start")
                os.remove(storage_file)
            
            self.content_fetcher = AIProductFetcher(storage_file=storage_file)
            
            # Get product fetcher stats
            stats = self.content_fetcher.get_stats()
            logger.info(f"📊 Product fetcher initialized: {stats}")
            
        except Exception as e:
            logger.error(f"❌ Failed to initialize product fetcher: {e}")
            raise
    
    async def _refresh_content_pool(self) -> None:
        """Refresh the content pool by fetching products using AI keywords."""
        try:
            if not self.content_fetcher:
                logger.warning("⚠️ Product fetcher not initialized")
                return
            
            logger.info("🔄 Refreshing content pool from Product Hunt and AI sources...")
            all_new_products = []
            
            # Fetch products using multiple search approaches
            try:
                # Primary fetch: latest AI products
                logger.info("🔍 Fetching latest AI products from Product Hunt...")
                products = await self.content_fetcher.fetch_new_products(max_products=50)
                
                if products:
                    logger.info(f"🚀 Found {len(products)} products from Product Hunt")
                    all_new_products.extend(products)
                else:
                    logger.info("📭 No products found from Product Hunt")
                    
            except Exception as e:
                logger.warning(f"⚠️ Error fetching from Product Hunt: {e}")
            
            # Additional searches by keyword (if fetcher supports it)
            for keyword in self.ai_product_keywords[:5]:  # Use first 5 keywords
                try:
                    if hasattr(self.content_fetcher, 'search_products'):
                        logger.info(f"🔍 Searching products for keyword: '{keyword}'")
                        keyword_products = await self.content_fetcher.search_products(keyword, max_results=10)
                        
                        if keyword_products:
                            logger.info(f"🚀 Found {len(keyword_products)} products for '{keyword}'")
                            all_new_products.extend(keyword_products)
                        else:
                            logger.info(f"📭 No products found for '{keyword}'")
                            
                except Exception as e:
                    logger.warning(f"⚠️ Error searching for '{keyword}': {e}")
                    continue
            
            if all_new_products:
                # Remove duplicates based on URL or title
                existing_urls = {product.get('url') for product in self.content_pool}
                existing_titles = {product.get('title') for product in self.content_pool}
                seen_urls = set()
                seen_titles = set()
                unique_products = []
                
                for product in all_new_products:
                    url = product.get('url', '')
                    title = product.get('title', '')
                    
                    if ((url and url not in seen_urls and url not in existing_urls) or
                        (title and title not in seen_titles and title not in existing_titles)):
                        
                        if url: seen_urls.add(url)
                        if title: seen_titles.add(title)
                        
                        # Process and enrich the product
                        if not product.get('category'):
                            product['category'] = self._categorize_content(
                                product.get('title', ''), 
                                product.get('summary', '')
                            )
                        
                        if not product.get('tags'):
                            product['tags'] = self._extract_tags(
                                product.get('title', ''), 
                                product.get('summary', '')
                            )
                        
                        # Ensure timestamp is datetime object
                        if isinstance(product.get('timestamp'), str):
                            try:
                                product['timestamp'] = datetime.fromisoformat(product['timestamp'])
                            except:
                                product['timestamp'] = datetime.now()
                        elif not product.get('timestamp'):
                            product['timestamp'] = datetime.now()
                        
                        # Add source if not present
                        if not product.get('source'):
                            product['source'] = "Product Hunt"
                        
                        unique_products.append(product)
                
                # Add new products to the pool
                self.content_pool.extend(unique_products)
                
                # Keep pool size manageable (max 100 products)
                if len(self.content_pool) > 100:
                    self.content_pool = self.content_pool[-100:]
                
                logger.info(f"✅ Content pool refreshed: {len(unique_products)} new products added, pool size: {len(self.content_pool)}")
            else:
                logger.info("📭 No new products found during pool refresh")
                
        except Exception as e:
            logger.error(f"❌ Error refreshing content pool: {e}")

    async def fetch_new_content(self, limit: int = 1) -> List[Dict[str, Any]]:
        """
        Memory pool-based content fetching:
        - Refresh pool from Product Hunt every 4 hours
        - Return random content from pool every 2 minutes
        
        Args:
            limit: Maximum number of products to return (default 1)
            
        Returns:
            List of random product dictionaries from pool
        """
        try:
            current_time = time.time()
            
            # Refresh content pool every 4 hours
            if current_time - self.last_pool_refresh >= self.pool_refresh_interval:
                await self._refresh_content_pool()
                self.last_pool_refresh = current_time
            
            # Return random content from pool if available
            if self.content_pool:
                # Select random products from pool (can repeat)
                selected_products = random.choices(self.content_pool, k=min(limit, len(self.content_pool)))
                logger.info(f"🎲 Selected {len(selected_products)} random products from pool (pool size: {len(self.content_pool)})")
                return selected_products
            else:
                logger.info("📭 Content pool is empty, no products to share")
                return []
                
        except Exception as e:
            logger.error(f"❌ Error in fetch_new_content: {e}")
            return []
    
    def _create_startup_message(self) -> str:
        """Create startup message specific to AI products."""
        keywords_str = ", ".join(self.ai_product_keywords[:5]) + f" (+{len(self.ai_product_keywords)-5} more)"
        return (f"🤖 **AI Product Bot Online!** 🚀\n\n"
                f"I'm now connected with a new 4-hour product pooling system!\n\n"
                f"**What I do:**\n"
                f"• 📡 Monitor Product Hunt for latest AI products\n"
                f"• 🔄 Refresh content pool every 4 hours\n"
                f"• 🎲 Post random products from pool every 2 minutes\n"
                f"• 🏷️ Categorize products (productivity, creative, developer tools, etc.)\n"
                f"• 💬 Answer questions about AI products and tools\n"
                f"• 🔁 Allow content repeats for consistent posting\n\n"
                f"**Memory Pool System:**\n"
                f"• Pool refreshes: Every 4 hours\n"
                f"• Content posting: Every 2 minutes\n"
                f"• Pool size: Up to 100 products\n"
                f"• Selection: Random from pool (repeats allowed)\n\n"
                f"**AI Keywords Used:**\n"
                f"• {keywords_str}\n\n"
                f"**Commands:**\n"
                f"• `@{self.default_agent_id} search <product type>` - Find specific products\n"
                f"• `@{self.default_agent_id} summary` - Get product summary\n"
                f"• `@{self.default_agent_id} pool` - Show current pool status\n"
                f"• `@{self.default_agent_id} categories` - Show product categories\n\n"
                f"🔥 **Now featuring 4-hour product pool system!** 🚀")
    
    async def _share_content(self, content: Dict[str, Any]):
        """Share AI product with enhanced formatting."""
        channel = "general"
        
        # Enhanced message formatting for products
        title = content.get('title', 'Unknown Product')
        summary = content.get('summary', '').strip()
        
        message = f"🚀 **New AI Product: {title}**\n\n"
        
        # Add product summary/description
        if summary and len(summary) > 10:
            message += f"📝 {summary}\n\n"
        
        # Add product metrics if available
        votes = content.get('votes', 0)
        comments = content.get('comments_count', 0)
        maker = content.get('maker', 'Unknown')
        
        if votes > 0 or comments > 0 or maker != 'Unknown':
            message += "📊 **Product Info:**\n"
            if votes > 0:
                message += f"👍 {votes} votes"
            if comments > 0:
                message += f" • 💬 {comments} comments"
            if maker != 'Unknown':
                message += f" • 👤 by {maker}"
            message += "\n\n"
        
        # Add category and tags
        category = content.get('category', 'product')
        emoji = self.content_categories.get(category, "🚀")
        message += f"{emoji} **Category:** {category.title()}\n"
        
        tags = content.get('tags', [])
        if tags:
            message += f"🏷️ **Tags:** {', '.join(tags[:3])}\n"
        
        # Add image if available
        image_url = content.get('image_url')
        if image_url:
            message += f"\n📷 ![Product Image]({image_url})\n"
        
        # Add links
        url = content.get('url', 'N/A')
        product_hunt_url = content.get('product_hunt_url', '')
        
        message += f"\n🔗 **Links:**\n"
        if url and url != 'N/A':
            message += f"• [Product Website]({url})\n"
        if product_hunt_url and product_hunt_url != url:
            message += f"• [Product Hunt Page]({product_hunt_url})\n"
        
        # Post to general channel
        try:
            ws = self.workspace()
            await ws.channel(channel).post(message)
            logger.info(f"✅ Successfully shared product: {title}")
        except Exception as e:
            logger.error(f"❌ Failed to share product: {e}")
            # Fallback: try with # prefix
            try:
                ws = self.workspace()
                await ws.channel(f"#{channel}").post(message)
                logger.info(f"✅ Successfully shared product to #{channel}")
            except Exception as e2:
                logger.error(f"❌ Failed to share product to #{channel}: {e2}")
        
        # Store in knowledge base
        content_hash = content.get('hash', self._generate_content_hash(content))
        self.knowledge_base[content_hash] = content
        
        logger.info(f"📤 Shared AI product: {title}")
    
    def _categorize_content(self, title: str, description: str) -> str:
        """Enhanced product categorization."""
        text = (title + " " + description).lower()
        
        # Productivity tools
        if any(word in text for word in ["productivity", "workflow", "automation", "task", "project", "organize", "efficiency"]):
            return "productivity"
        
        # Creative tools  
        if any(word in text for word in ["creative", "design", "art", "image", "video", "content", "writing", "generation", "editor"]):
            return "creative"
        
        # Developer tools
        if any(word in text for word in ["developer", "code", "coding", "programming", "api", "sdk", "framework", "library", "devops"]):
            return "developer"
        
        # Healthcare
        if any(word in text for word in ["health", "medical", "healthcare", "diagnosis", "treatment", "patient", "clinical"]):
            return "healthcare"
        
        # Education
        if any(word in text for word in ["education", "learning", "training", "course", "tutorial", "student", "teacher"]):
            return "education"
        
        # Finance
        if any(word in text for word in ["finance", "fintech", "trading", "investment", "crypto", "payment", "banking"]):
            return "finance"
        
        # Communication
        if any(word in text for word in ["chat", "messaging", "communication", "social", "collaboration", "meeting", "video call"]):
            return "communication"
        
        # Entertainment
        if any(word in text for word in ["game", "gaming", "entertainment", "music", "media", "fun", "leisure"]):
            return "entertainment"
        
        # Business/SaaS
        if any(word in text for word in ["business", "saas", "enterprise", "crm", "sales", "marketing", "analytics"]):
            return "business"
        
        # Research tools
        if any(word in text for word in ["research", "analysis", "data", "insights", "intelligence", "discovery"]):
            return "research"
        
        # Default to tools
        return "tools"
    
    async def on_direct(self, msg):
        """Enhanced direct message handling for AI Product bot."""
        await super().on_direct(msg)
        
        text = msg.text.lower().strip()
        
        # AI Product-specific commands
        if "pool" in text:
            # Show current content pool status
            pool_info = f"🎲 **Content Pool Status:**\n\n"
            pool_info += f"📊 **Pool Size:** {len(self.content_pool)} products\n"
            pool_info += f"🔄 **Last Refresh:** {time.time() - self.last_pool_refresh:.1f} seconds ago\n"
            pool_info += f"⏰ **Next Refresh:** {max(0, self.pool_refresh_interval - (time.time() - self.last_pool_refresh)):.1f} seconds\n\n"
            
            if self.content_pool:
                pool_info += "**Recent Products in Pool:**\n"
                # Show last 5 products added to pool
                for i, product in enumerate(self.content_pool[-5:], 1):
                    title = product.get('title', 'Unknown')
                    if len(title) > 60:
                        title = title[:60] + "..."
                    source = product.get('source', 'Unknown')
                    pool_info += f"{i}. {title} - {source}\n"
            else:
                pool_info += "📭 Pool is currently empty\n"
            
            ws = self.workspace()
            await ws.agent(msg.sender_id).send_direct_message(pool_info)


async def main():
    """Main function to run the AI Product Bot."""
    print("🚀 Starting AI Product Bot...")
    print("=" * 60)
    
    # Create the bot
    bot = AIProductBot(agent_id="ai-product-bot")
    
    try:
        # Connect to the network
        print("🔌 Connecting to Community Knowledge Base network...")
        await bot.async_start(host="localhost", port=DEFAULT_NETWORK_PORT)
        print("✅ Connected successfully!")
        
        # Keep the bot running
        print("🤖 AI Product Bot is now active and monitoring for new products...")
        print("📋 Press Ctrl+C to stop the bot")
        
        # Run indefinitely
        while True:
            await asyncio.sleep(1)
            
    except KeyboardInterrupt:
        print("\n🛑 Shutting down AI Product Bot...")
    except Exception as e:
        print(f"❌ Error running bot: {e}")
        import traceback
        traceback.print_exc()
    finally:
        # Clean shutdown
        await bot.async_stop()
        print("👋 AI Product Bot stopped")


if __name__ == "__main__":
    # Run the bot
    asyncio.run(main())