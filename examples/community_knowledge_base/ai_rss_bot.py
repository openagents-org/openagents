#!/usr/bin/env python3
"""
AI RSS Bot for Community Knowledge Base

This agent automatically aggregates and shares AI-related news from multiple
RSS feeds including tech news sources, AI blogs, and research publications.
It posts findings to the general channel and responds to news-related questions.

Features:
- Multi-source RSS feed aggregation
- AI content filtering and categorization
- Automatic RSS feed discovery and validation
- Deduplication across sources
- Interactive search and summaries
"""

import asyncio
import logging
import os
import random
import time
from datetime import datetime
from typing import Dict, List, Any

from ai_base_agent import AIBaseAgent
from private.ai_rss_util import AINewsRSS
from openagents.config.globals import DEFAULT_NETWORK_PORT

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

DEFAULT_NETWORK_PORT = 8572


class AIRSSBot(AIBaseAgent):
    """
    AI RSS Bot that aggregates and shares AI news from multiple RSS sources.
    
    This agent monitors various RSS feeds from AI news sources, tech blogs,
    and research publications to discover and share relevant AI content.
    """
    
    default_agent_id = "ai-rss-bot"
    content_type = "AI News"
    source_name = "RSS Feeds"
    auto_mention_response = True
    default_channels = ["general"]
    
    def __init__(self, **kwargs):
        """Initialize the AI RSS Bot."""
        super().__init__(**kwargs)

        self.min_message_interval = 30  # Post every 30 seconds
        
        # RSS-specific settings with memory pool logic
        self.content_check_interval = 30  # Check every 30 seconds (for posting)
        self.pool_refresh_interval = 60   # Refresh content pool every 60 seconds
        self.last_pool_refresh = 0
        self.content_pool = []  # Memory pool to store fetched content
        
        # Enhanced RSS-specific categories
        self.content_categories.update({
            "blog": "📝",
            "tech": "💻",
            "industry": "🏭",
            "startup": "🚀",
            "opinion": "💭"
        })
        
        # RSS-specific AI keywords (more news-oriented)
        self.ai_keywords.extend([
            "ai industry", "ai market", "ai adoption", "ai trends", "ai breakthrough",
            "ai investment", "ai regulation", "ai policy", "ai ethics", "ai safety",
            "ai governance", "ai innovation", "ai transformation", "ai revolution"
        ])
    
    async def initialize_content_fetcher(self):
        """Initialize the AI RSS aggregator."""
        try:
            # Clean up any existing tracking file for fresh start (optional)
            storage_file = "/tmp/ai_rss_feeds_data.json"
            if os.path.exists(storage_file):
                logger.info("🗑️ Removing existing RSS tracking file for fresh start")
                os.remove(storage_file)
            
            self.content_fetcher = AINewsRSS(storage_file=storage_file)
            
            # Get RSS aggregator stats
            stats = self.content_fetcher.get_stats()
            logger.info(f"📊 RSS aggregator initialized: {stats}")
            
            # Discover RSS feeds if we don't have many active sources
            if stats['active_sources'] < 5:
                logger.info("🔍 Discovering RSS feeds...")
                discovered = await self.content_fetcher.discover(max_sources=15)
                logger.info(f"✅ Discovered {len(discovered)} RSS sources")
            
        except Exception as e:
            logger.error(f"❌ Failed to initialize RSS aggregator: {e}")
            raise
    
    async def _refresh_content_pool(self) -> None:
        """Refresh the content pool by fetching new articles from RSS feeds."""
        try:
            if not self.content_fetcher:
                logger.warning("⚠️ RSS aggregator not initialized")
                return
            
            logger.info("🔄 Refreshing content pool from RSS feeds...")
            
            # Fetch new posts using the utility
            new_articles = await self.content_fetcher.get_new_posts(max_posts_per_source=20)
            
            if new_articles:
                # Process and enrich the articles
                processed_articles = []
                for article in new_articles:
                    # Ensure required fields and categorization
                    if not article.get('category'):
                        article['category'] = self._categorize_content(
                            article.get('title', ''), 
                            article.get('summary', '')
                        )
                    
                    # Ensure tags are present
                    if not article.get('tags'):
                        article['tags'] = self._extract_tags(
                            article.get('title', ''), 
                            article.get('summary', '')
                        )
                    
                    # Ensure timestamp is datetime object
                    if isinstance(article.get('timestamp'), str):
                        try:
                            article['timestamp'] = datetime.fromisoformat(article['timestamp'])
                        except:
                            article['timestamp'] = datetime.now()
                    elif not article.get('timestamp'):
                        article['timestamp'] = datetime.now()
                    
                    # Enhance source information
                    source = article.get('source', 'RSS Feed')
                    if not source.startswith('RSS:'):
                        article['source'] = f"RSS: {source}"
                    
                    processed_articles.append(article)
                
                # Add new articles to the pool (avoiding duplicates by URL)
                existing_urls = {article.get('url') for article in self.content_pool}
                new_unique_articles = [
                    article for article in processed_articles 
                    if article.get('url') not in existing_urls
                ]
                
                self.content_pool.extend(new_unique_articles)
                
                # Keep pool size manageable (max 100 articles)
                if len(self.content_pool) > 100:
                    self.content_pool = self.content_pool[-100:]
                
                logger.info(f"✅ Content pool refreshed: {len(new_unique_articles)} new articles added, pool size: {len(self.content_pool)}")
            else:
                logger.info("📭 No new articles found during pool refresh")
                
        except Exception as e:
            logger.error(f"❌ Error refreshing content pool: {e}")

    async def fetch_new_content(self, limit: int = 1) -> List[Dict[str, Any]]:
        """
        Memory pool-based content fetching:
        - Refresh pool from RSS feeds every 60 seconds
        - Return random content from pool every 30 seconds
        
        Args:
            limit: Maximum number of articles to return (default 1)
            
        Returns:
            List of random article dictionaries from pool
        """
        try:
            current_time = time.time()
            
            # Refresh content pool every 60 seconds
            if current_time - self.last_pool_refresh >= self.pool_refresh_interval:
                await self._refresh_content_pool()
                self.last_pool_refresh = current_time
            
            # Return random content from pool if available
            if self.content_pool:
                # Select random articles from pool (can repeat)
                selected_articles = random.choices(self.content_pool, k=min(limit, len(self.content_pool)))
                logger.info(f"🎲 Selected {len(selected_articles)} random articles from pool (pool size: {len(self.content_pool)})")
                return selected_articles
            else:
                logger.info("📭 Content pool is empty, no articles to share")
                return []
                
        except Exception as e:
            logger.error(f"❌ Error in fetch_new_content: {e}")
            return []
    
    def _create_startup_message(self) -> str:
        """Create startup message specific to AI RSS."""
        return (f"🤖 **AI RSS Bot Online!** 📰\n\n"
                f"I'm now connected and ready to share AI news with a new memory pool system!\n\n"
                f"**What I do:**\n"
                f"• 📡 Monitor 15+ AI news RSS feeds\n"
                f"• 🔄 Refresh content pool every 60 seconds\n"
                f"• 🎲 Post random articles from pool every 30 seconds\n"
                f"• 🏷️ Filter and categorize AI-related news\n"
                f"• 💬 Answer questions about AI news and trends\n"
                f"• 🔁 Allow content repeats for consistent posting\n\n"
                f"**Memory Pool System:**\n"
                f"• Pool refreshes: Every 60 seconds\n"
                f"• Content posting: Every 30 seconds\n"
                f"• Pool size: Up to 100 articles\n"
                f"• Selection: Random from pool (repeats allowed)\n\n"
                f"**RSS Sources Include:**\n"
                f"• TechCrunch AI, VentureBeat AI, The Verge AI\n"
                f"• MIT Technology Review, IEEE Spectrum\n"
                f"• OpenAI Blog, Google AI Blog, DeepMind\n\n"
                f"**Commands:**\n"
                f"• `@{self.default_agent_id} search <topic>` - Find specific news\n"
                f"• `@{self.default_agent_id} summary` - Get today's news summary\n"
                f"• `@{self.default_agent_id} pool` - Show current pool status\n\n"
                f"🔥 **Now featuring memory pool-based content delivery!** 🚀")
    
    async def _share_content(self, content: Dict[str, Any]):
        """Share AI news with enhanced formatting."""
        channel = "general"
        
        # Enhanced message formatting for news articles
        title = content.get('title', 'Unknown Article')
        summary = content.get('summary', '').strip()
        source = content.get('source', 'RSS Feed')
        
        message = f"📰 **AI News: {title}**\n\n"
        
        # Add article summary
        if summary and len(summary) > 10:
            # Limit summary length for channel posting
            if len(summary) > 300:
                summary = summary[:300] + "..."
            message += f"📝 {summary}\n\n"
        
        # Add source and category info
        category = content.get('category', 'news')
        emoji = self.content_categories.get(category, "📰")
        message += f"{emoji} **Category:** {category.title()}\n"
        message += f"📡 **Source:** {source}\n"
        
        # Add publication time
        timestamp = content.get('timestamp')
        if timestamp:
            if isinstance(timestamp, datetime):
                time_str = timestamp.strftime("%Y-%m-%d %H:%M")
            else:
                time_str = str(timestamp)
            message += f"📅 **Published:** {time_str}\n"
        
        # Add tags
        tags = content.get('tags', [])
        if tags:
            message += f"🏷️ **Tags:** {', '.join(tags[:3])}\n"
        
        # Add image if available
        image_url = content.get('image_url')
        if image_url:
            message += f"\n📷 ![Article Image]({image_url})\n"
        
        # Add link
        url = content.get('url', 'N/A')
        if url and url != 'N/A':
            message += f"\n🔗 [Read Full Article]({url})"
        
        # Post to general channel
        try:
            ws = self.workspace()
            await ws.channel(channel).post(message)
            logger.info(f"✅ Successfully shared article: {title[:50]}...")
        except Exception as e:
            logger.error(f"❌ Failed to share article: {e}")
            # Fallback: try with # prefix
            try:
                ws = self.workspace()
                await ws.channel(f"#{channel}").post(message)
                logger.info(f"✅ Successfully shared article to #{channel}")
            except Exception as e2:
                logger.error(f"❌ Failed to share article to #{channel}: {e2}")
        
        # Store in knowledge base
        content_hash = content.get('hash', self._generate_content_hash(content))
        self.knowledge_base[content_hash] = content
        
        logger.info(f"📤 Shared AI news: {title[:50]}...")
    
    def _categorize_content(self, title: str, description: str) -> str:
        """Enhanced news categorization."""
        text = (title + " " + description).lower()
        
        # Blog posts
        if any(word in text for word in ["blog", "opinion", "thoughts", "perspective", "view", "editorial"]):
            return "blog"
        
        # Tech industry news
        if any(word in text for word in ["tech", "technology", "silicon valley", "startup", "venture", "ipo"]):
            return "tech"
        
        # Research and academic
        if any(word in text for word in ["research", "study", "paper", "academic", "university", "breakthrough", "discovery"]):
            return "research"
        
        # Business and industry
        if any(word in text for word in ["business", "industry", "market", "enterprise", "commercial", "adoption"]):
            return "industry"
        
        # Product launches and tools
        if any(word in text for word in ["launch", "release", "product", "tool", "platform", "service", "app"]):
            return "product"
        
        # Startup news
        if any(word in text for word in ["startup", "founder", "funding", "investment", "series", "round"]):
            return "startup"
        
        # Announcements
        if any(word in text for word in ["announcement", "announces", "unveils", "introduces", "debuts"]):
            return "announcement"
        
        # Ethics and policy
        if any(word in text for word in ["ethics", "regulation", "policy", "governance", "safety", "responsible"]):
            return "ethics"
        
        # Opinion pieces
        if any(word in text for word in ["opinion", "analysis", "commentary", "expert", "interview"]):
            return "opinion"
        
        # Default to news
        return "news"
    
    async def on_direct(self, msg):
        """Enhanced direct message handling for RSS bot."""
        await super().on_direct(msg)
        
        text = msg.text.lower().strip()
        
        # RSS-specific commands
        if "pool" in text:
            # Show current content pool status
            pool_info = f"🎲 **Content Pool Status:**\n\n"
            pool_info += f"📊 **Pool Size:** {len(self.content_pool)} articles\n"
            pool_info += f"🔄 **Last Refresh:** {time.time() - self.last_pool_refresh:.1f} seconds ago\n"
            pool_info += f"⏰ **Next Refresh:** {max(0, self.pool_refresh_interval - (time.time() - self.last_pool_refresh)):.1f} seconds\n\n"
            
            if self.content_pool:
                pool_info += "**Recent Articles in Pool:**\n"
                # Show last 5 articles added to pool
                for i, article in enumerate(self.content_pool[-5:], 1):
                    title = article.get('title', 'Unknown')
                    if len(title) > 60:
                        title = title[:60] + "..."
                    pool_info += f"{i}. {title}\n"
            else:
                pool_info += "📭 Pool is currently empty\n"
            
            ws = self.workspace()
            await ws.agent(msg.sender_id).send_direct_message(pool_info)
            
        elif "sources" in text or "feeds" in text:
            if hasattr(self.content_fetcher, 'get_stats'):
                stats = self.content_fetcher.get_stats()
                sources_info = "📡 **RSS Sources Status:**\n\n"
                
                active_count = stats.get('active_sources', 0)
                total_count = stats.get('total_sources', 0)
                
                sources_info += f"✅ **Active Sources:** {active_count}\n"
                sources_info += f"📊 **Total Sources:** {total_count}\n"
                sources_info += f"📰 **Articles Processed:** {stats.get('processed_posts_count', 0)}\n\n"
                
                # Show some source details if available
                sources = stats.get('sources', {})
                if sources:
                    sources_info += "**Top Sources:**\n"
                    for i, (source_id, source_info) in enumerate(list(sources.items())[:5], 1):
                        status = "🟢" if source_info.get('is_active') else "🔴"
                        sources_info += f"{i}. {status} {source_info.get('name', 'Unknown')}\n"
                
                ws = self.workspace()
                await ws.agent(msg.sender_id).send_direct_message(sources_info)


async def main():
    """Main function to run the AI RSS Bot."""
    print("🚀 Starting AI RSS Bot...")
    print("=" * 60)
    
    # Create the bot
    bot = AIRSSBot(agent_id="ai-rss-bot")
    
    try:
        # Connect to the network
        print("🔌 Connecting to Community Knowledge Base network...")
        await bot.async_start(host="localhost", port=DEFAULT_NETWORK_PORT)
        print("✅ Connected successfully!")
        
        # Keep the bot running
        print("🤖 AI RSS Bot is now active and monitoring RSS feeds...")
        print("📋 Press Ctrl+C to stop the bot")
        
        # Run indefinitely
        while True:
            await asyncio.sleep(1)
            
    except KeyboardInterrupt:
        print("\n🛑 Shutting down AI RSS Bot...")
    except Exception as e:
        print(f"❌ Error running bot: {e}")
        import traceback
        traceback.print_exc()
    finally:
        # Clean shutdown
        await bot.async_stop()
        print("👋 AI RSS Bot stopped")


if __name__ == "__main__":
    # Run the bot
    asyncio.run(main())