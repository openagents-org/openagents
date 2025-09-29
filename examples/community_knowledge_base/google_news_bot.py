#!/usr/bin/env python3
"""
Google News AI Bot for Community Knowledge Base

This agent automatically finds and shares AI-related news from Google News using
the Serper API. It posts findings to the general channel and responds to 
news-related questions with real-time search capabilities.

Features:
- Google News API integration via Serper
- Real-time AI news discovery
- News categorization and source tracking
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
from private.google_news_fetcher import GoogleNewsFetcher
from openagents.config.globals import DEFAULT_NETWORK_PORT

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

DEFAULT_NETWORK_PORT = 8572


class GoogleNewsBot(AIBaseAgent):
    """
    Google News AI Bot that discovers and shares AI-related news articles.
    
    This agent monitors Google News for AI-related articles and automatically
    shares interesting findings with the community.
    """
    
    default_agent_id = "google-news-bot"
    content_type = "AI News"
    source_name = "Google News"
    auto_mention_response = True
    default_channels = ["general"]
    
    def __init__(self, **kwargs):
        """Initialize the Google News Bot."""
        super().__init__(**kwargs)
        
        self.min_message_interval = 60  # Post every 60 seconds
        
        # Google News specific settings with memory pool logic
        self.content_check_interval = 60  # Check every 60 seconds (for posting)
        self.pool_refresh_interval = 10800  # Refresh content pool every 3 hours (10800 seconds)
        self.last_pool_refresh = 0
        self.content_pool = []  # Memory pool to store fetched content
        self.current_keyword_index = 0  # Track current keyword for rotation
        
        # 10 simple AI-related keywords for Google News search
        self.ai_keywords = [
            "artificial intelligence",
            "machine learning", 
            "AI technology",
            "deep learning",
            "neural networks",
            "AI research",
            "robotics",
            "automation",
            "AI ethics",
            "chatbot"
        ]
        
        # Enhanced news-specific categories
        self.content_categories.update({
            "breaking": "🚨",
            "analysis": "📊",
            "interview": "🎤",
            "opinion": "💭",
            "trending": "📈",
            "policy": "🏛️",
            "startup": "🚀",
            "funding": "💰"
        })
        
        # API key for Serper (from environment or hardcoded)
        self.api_key = os.getenv('SERPER_API_KEY', '')
    
    async def initialize_content_fetcher(self):
        """Initialize the Google News fetcher."""
        try:
            if not self.api_key:
                raise ValueError("Serper API key is required. Set SERPER_API_KEY environment variable.")
            
            # Clean up any existing tracking file for fresh start (optional)
            storage_file = "/tmp/google_news_data.json"
            if os.path.exists(storage_file):
                logger.info("🗑️ Removing existing Google News tracking file for fresh start")
                os.remove(storage_file)
            
            self.content_fetcher = GoogleNewsFetcher(
                api_key=self.api_key, 
                storage_file=storage_file
            )
            
            # Get Google News fetcher stats
            stats = self.content_fetcher.get_stats()
            logger.info(f"📊 Google News fetcher initialized: {stats}")
            
        except Exception as e:
            logger.error(f"❌ Failed to initialize Google News fetcher: {e}")
            raise
    
    async def _refresh_content_pool(self) -> None:
        """Refresh the content pool by fetching news for all AI keywords from Google News."""
        try:
            if not self.content_fetcher:
                logger.warning("⚠️ Google News fetcher not initialized")
                return
            
            logger.info("🔄 Refreshing content pool from Google News with AI keywords...")
            all_new_articles = []
            
            # Search for each keyword to build comprehensive pool
            for keyword in self.ai_keywords:
                try:
                    logger.info(f"🔍 Searching Google News for keyword: '{keyword}'")
                    articles = await self.content_fetcher.fetch_new_list(
                        query=keyword, 
                        max_articles=10  # 10 articles per keyword
                    )
                    
                    if articles:
                        logger.info(f"📰 Found {len(articles)} articles for '{keyword}'")
                        all_new_articles.extend(articles)
                    else:
                        logger.info(f"📭 No articles found for '{keyword}'")
                        
                except Exception as e:
                    logger.warning(f"⚠️ Error searching for '{keyword}': {e}")
                    continue
            
            if all_new_articles:
                # Remove duplicates based on URL
                existing_urls = {article.get('url') for article in self.content_pool}
                seen_urls = set()
                unique_articles = []
                
                for article in all_new_articles:
                    url = article.get('url', '')
                    if url and url not in seen_urls and url not in existing_urls:
                        seen_urls.add(url)
                        
                        # Process and enrich the article
                        if not article.get('category'):
                            article['category'] = self._categorize_content(
                                article.get('title', ''), 
                                article.get('summary', '')
                            )
                        
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
                        source = article.get('source', 'Google News')
                        if not source.startswith('Google News'):
                            article['source'] = f"Google News ({source})"
                        
                        unique_articles.append(article)
                
                # Add new articles to the pool
                self.content_pool.extend(unique_articles)
                
                # Keep pool size manageable (max 200 articles)
                if len(self.content_pool) > 200:
                    self.content_pool = self.content_pool[-200:]
                
                logger.info(f"✅ Content pool refreshed: {len(unique_articles)} new articles added, pool size: {len(self.content_pool)}")
            else:
                logger.info("📭 No new articles found during pool refresh")
                
        except Exception as e:
            logger.error(f"❌ Error refreshing content pool: {e}")

    async def fetch_new_content(self, limit: int = 1) -> List[Dict[str, Any]]:
        """
        Memory pool-based content fetching:
        - Refresh pool from Google News every 3 hours using 10 AI keywords
        - Return random content from pool every 60 seconds
        
        Args:
            limit: Maximum number of articles to return (default 1)
            
        Returns:
            List of random article dictionaries from pool
        """
        try:
            current_time = time.time()
            
            # Refresh content pool every 3 hours
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
        """Create startup message specific to Google News."""
        keywords_str = ", ".join(self.ai_keywords[:5]) + f" (+{len(self.ai_keywords)-5} more)"
        return (f"🤖 **Google News AI Bot Online!** 📰\n\n"
                f"I'm now connected with a new 3-hour keyword pooling system!\n\n"
                f"**What I do:**\n"
                f"• 📡 Search Google News using 10 AI keywords\n"
                f"• 🔄 Refresh content pool every 3 hours\n"
                f"• 🎲 Post random articles from pool every 60 seconds\n"
                f"• 🏷️ Categorize news by type (breaking, analysis, startup, etc.)\n"
                f"• 💬 Answer questions about current AI news\n"
                f"• 🔁 Allow content repeats for consistent posting\n\n"
                f"**Memory Pool System:**\n"
                f"• Pool refreshes: Every 3 hours\n"
                f"• Content posting: Every 60 seconds\n"
                f"• Pool size: Up to 200 articles\n"
                f"• Selection: Random from pool (repeats allowed)\n\n"
                f"**AI Keywords Used:**\n"
                f"• {keywords_str}\n\n"
                f"**Commands:**\n"
                f"• `@{self.default_agent_id} search <topic>` - Find specific news\n"
                f"• `@{self.default_agent_id} summary` - Get today's news summary\n"
                f"• `@{self.default_agent_id} pool` - Show current pool status\n"
                f"• `@{self.default_agent_id} keywords` - Show all keywords\n\n"
                f"🔥 **Now featuring 3-hour keyword-based pool system!** 🚀")
    
    async def _share_content(self, content: Dict[str, Any]):
        """Share AI news with enhanced formatting for Google News."""
        channel = "general"
        
        # Enhanced message formatting for Google News articles
        title = content.get('title', 'Unknown Article')
        summary = content.get('summary', '').strip()
        source = content.get('source', 'Google News')
        
        message = f"📰 **Breaking AI News: {title}**\n\n"
        
        # Add article summary
        if summary and len(summary) > 10:
            # Limit summary length for channel posting
            if len(summary) > 250:
                summary = summary[:250] + "..."
            message += f"📝 {summary}\n\n"
        
        # Add source and position info
        position = content.get('position', 0)
        category = content.get('category', 'news')
        emoji = self.content_categories.get(category, "📰")
        
        message += f"{emoji} **Category:** {category.title()}\n"
        message += f"📊 **Source:** {source}\n"
        if position > 0:
            message += f"📍 **Search Position:** #{position}\n"
        
        # Add publication time
        timestamp = content.get('timestamp')
        if timestamp:
            if isinstance(timestamp, datetime):
                time_str = timestamp.strftime("%Y-%m-%d %H:%M")
            else:
                time_str = str(timestamp)
            message += f"📅 **Date:** {time_str}\n"
        
        # Add tags
        tags = content.get('tags', [])
        if tags:
            message += f"🏷️ **Tags:** {', '.join(tags[:3])}\n"
        
        # Add trending indicator for high-position articles
        if position <= 3:
            message += f"🔥 **Trending** (Top {position} result)\n"
        
        # Add link
        url = content.get('url', 'N/A')
        if url and url != 'N/A':
            message += f"\n🔗 [Read Full Article]({url})"
        
        # Post to general channel
        try:
            ws = self.workspace()
            await ws.channel(channel).post(message)
            logger.info(f"✅ Successfully shared news: {title[:50]}...")
        except Exception as e:
            logger.error(f"❌ Failed to share news: {e}")
            # Fallback: try with # prefix
            try:
                ws = self.workspace()
                await ws.channel(f"#{channel}").post(message)
                logger.info(f"✅ Successfully shared news to #{channel}")
            except Exception as e2:
                logger.error(f"❌ Failed to share news to #{channel}: {e2}")
        
        # Store in knowledge base
        content_hash = content.get('hash', self._generate_content_hash(content))
        self.knowledge_base[content_hash] = content
        
        logger.info(f"📤 Shared AI news: {title[:50]}...")
    
    def _categorize_content(self, title: str, description: str) -> str:
        """Enhanced news categorization for Google News."""
        text = (title + " " + description).lower()
        
        # Breaking news indicators
        if any(word in text for word in ["breaking", "urgent", "just in", "developing", "alert"]):
            return "breaking"
        
        # Analysis and opinion
        if any(word in text for word in ["analysis", "opinion", "commentary", "editorial", "perspective"]):
            return "analysis"
        
        # Interview content
        if any(word in text for word in ["interview", "talks with", "speaks about", "says", "discusses"]):
            return "interview"
        
        # Policy and regulation
        if any(word in text for word in ["regulation", "policy", "government", "congress", "senate", "law"]):
            return "policy"
        
        # Startup and business news
        if any(word in text for word in ["startup", "founder", "ceo", "company", "business", "enterprise"]):
            return "startup"
        
        # Funding and investment
        if any(word in text for word in ["funding", "investment", "raised", "series", "venture", "ipo"]):
            return "funding"
        
        # Trending topics
        if any(word in text for word in ["trending", "viral", "popular", "millions", "widespread"]):
            return "trending"
        
        # Research and academic
        if any(word in text for word in ["research", "study", "university", "academic", "paper", "breakthrough"]):
            return "research"
        
        # Product and technology
        if any(word in text for word in ["launch", "release", "product", "technology", "platform", "tool"]):
            return "product"
        
        # Default to news
        return "news"
    
    async def on_direct(self, msg):
        """Enhanced direct message handling for Google News bot."""
        await super().on_direct(msg)
        
        text = msg.text.lower().strip()
        
        # Google News specific commands
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
            
        elif "keywords" in text:
            # Show all AI keywords used for searches
            keywords_info = f"🔍 **AI Keywords Used:**\n\n"
            for i, keyword in enumerate(self.ai_keywords, 1):
                keywords_info += f"{i}. {keyword}\n"
            keywords_info += f"\n📊 **Total:** {len(self.ai_keywords)} keywords\n"
            keywords_info += f"🔄 **Refresh Schedule:** Every 3 hours\n"
            keywords_info += f"📰 **Articles per keyword:** Up to 10\n"
            
            ws = self.workspace()
            await ws.agent(msg.sender_id).send_direct_message(keywords_info)
            
        elif "trending" in text or "popular" in text:
            # Show trending news from today
            today_articles = [a for a in self.knowledge_base.values() 
                            if a.get('timestamp', datetime.min).date() == datetime.now().date()]
            
            if today_articles:
                # Sort by position (lower is better/more trending)
                trending = sorted(today_articles, key=lambda x: x.get('position', 999))[:5]
                
                trending_info = "📈 **Today's Trending AI News:**\n\n"
                for i, article in enumerate(trending, 1):
                    pos = article.get('position', 0)
                    trending_info += f"{i}. 🔥 **{article['title']}**\n"
                    trending_info += f"   📍 Position #{pos} | 📊 {article.get('source', 'Unknown')}\n"
                    trending_info += f"   🔗 {article.get('url', 'N/A')}\n\n"
                
                ws = self.workspace()
                await ws.agent(msg.sender_id).send_direct_message(trending_info)
            else:
                ws = self.workspace()
                await ws.agent(msg.sender_id).send_direct_message(
                    "📭 No trending news shared today yet. Check back later!"
                )
        
        elif "sources" in text:
            # Show news sources from today
            today_articles = [a for a in self.knowledge_base.values() 
                            if a.get('timestamp', datetime.min).date() == datetime.now().date()]
            
            if today_articles:
                from collections import Counter
                sources = [a.get('source', 'Unknown') for a in today_articles]
                source_counts = Counter(sources)
                
                sources_info = "📊 **Today's News Sources:**\n\n"
                for source, count in source_counts.most_common(10):
                    sources_info += f"• {source}: {count} article{'s' if count > 1 else ''}\n"
                
                ws = self.workspace()
                await ws.agent(msg.sender_id).send_direct_message(sources_info)
            else:
                ws = self.workspace()
                await ws.agent(msg.sender_id).send_direct_message(
                    "📭 No news sources tracked today yet."
                )


async def main():
    """Main function to run the Google News Bot."""
    print("🚀 Starting Google News AI Bot...")
    print("=" * 60)
    
    # Create the bot
    bot = GoogleNewsBot(agent_id="google-news-bot")
    
    try:
        # Connect to the network
        print("🔌 Connecting to Community Knowledge Base network...")
        await bot.async_start(host="localhost", port=DEFAULT_NETWORK_PORT)
        print("✅ Connected successfully!")
        
        # Keep the bot running
        print("🤖 Google News Bot is now active and monitoring for AI news...")
        print("📋 Press Ctrl+C to stop the bot")
        
        # Run indefinitely
        while True:
            await asyncio.sleep(1)
            
    except KeyboardInterrupt:
        print("\n🛑 Shutting down Google News Bot...")
    except Exception as e:
        print(f"❌ Error running bot: {e}")
        import traceback
        traceback.print_exc()
    finally:
        # Clean shutdown
        await bot.async_stop()
        print("👋 Google News Bot stopped")


if __name__ == "__main__":
    # Run the bot
    asyncio.run(main())
