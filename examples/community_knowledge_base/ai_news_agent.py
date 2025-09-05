#!/usr/bin/env python3
"""
AI News Worker Agent for Community Knowledge Base

This agent automatically finds and shares AI product news, research updates,
and interesting developments in the AI space. It posts findings to the general
channel and can respond to specific requests for information.

Features:
- Automatic news discovery and sharing
- Responds to AI-related questions
- Categorizes content by type (news, research, tools, etc.)
- Provides summaries and key insights
- Maintains a knowledge base of shared content
"""

import asyncio
import logging
import json
import hashlib
import random
import aiohttp
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta
from typing import Dict, List, Set, Optional, Any
from pathlib import Path

from openagents.agents.worker_agent import (
    WorkerAgent,
    DirectMessageContext,
    ChannelMessageContext,
    ReplyMessageContext
)

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class AINewsWorkerAgent(WorkerAgent):
    """
    Worker agent that discovers and shares AI product news and research.
    
    This agent monitors various sources for AI-related content and automatically
    shares interesting findings with the community through channel posts.
    """
    
    default_agent_id = "ai-news-bot"
    auto_mention_response = True
    default_channels = ["#general", "#ai-news", "#research", "#tools"]
    
    def __init__(self, **kwargs):
        """Initialize the AI News Worker Agent."""
        super().__init__(**kwargs)
        
        # Content tracking
        self.shared_content: Set[str] = set()  # Track shared content hashes
        self.content_categories = {
            "news": "📰",
            "research": "🔬", 
            "tools": "🛠️",
            "product": "🚀",
            "tutorial": "📚",
            "announcement": "📢"
        }
        
        # News sources and keywords
        self.ai_keywords = [
            "artificial intelligence", "machine learning", "deep learning",
            "neural networks", "LLM", "large language model", "GPT",
            "transformer", "AI model", "AI product", "AI tool",
            "computer vision", "natural language processing", "NLP",
            "reinforcement learning", "generative AI", "AI research",
            "OpenAI", "Anthropic", "Google AI", "Meta AI", "Microsoft AI"
        ]
        
        # Simulated news sources (in real implementation, these would be actual APIs)
        self.news_sources = [
            "AI Research Papers",
            "Tech News Aggregator", 
            "AI Product Launches",
            "Research Institution Updates",
            "Industry Announcements"
        ]
        
        # Content database
        self.knowledge_base: Dict[str, Dict[str, Any]] = {}
        self.last_news_check = datetime.now() - timedelta(hours=1)
        
        # Agent state
        self.is_active = True
        self.news_check_interval = 30  # 30 seconds for real RSS feed
        self.rss_feed_url = "https://ai2people.com/feed/"
        self.all_articles: List[Dict[str, Any]] = []  # Store all articles from RSS feed
        self.last_rss_fetch = datetime.now() - timedelta(hours=1)  # Force initial fetch
        
    async def on_startup(self):
        """Initialize the agent and start background tasks."""
        logger.info(f"🤖 AI News Agent '{self.default_agent_id}' starting up...")
        
        # Load existing knowledge base if available
        await self._load_knowledge_base()
        
        # Initial RSS feed refresh
        logger.info("🔄 Performing initial RSS feed refresh...")
        await self._refresh_rss_feed()
        
        # Check available channels
        logger.info("🔍 Checking available channels...")
        try:
            channels_info = await self._thread_adapter.list_channels()
            logger.info(f"📺 Available channels: {channels_info}")
        except Exception as e:
            logger.error(f"❌ Error listing channels: {e}")
        
        # Start background news monitoring
        asyncio.create_task(self._news_monitoring_loop())
        
        # Send startup message to general channel using direct adapter
        startup_message = (f"🤖 **AI News Bot Online!** 📰\n\n"
                          f"I'm now connected and ready to share AI news from **ai2people.com**!\n\n"
                          f"**What I do:**\n"
                          f"• 📡 Fetch AI articles from ai2people.com RSS feed\n"
                          f"• 🎲 Share a random article every 30 seconds to general\n"
                          f"• 🔄 Refresh feed every 10 minutes for latest content\n"
                          f"• 💬 Answer questions about AI developments\n"
                          f"• 🏷️ Categorize and tag content automatically\n\n"
                          f"**Commands:**\n"
                          f"• `@ai-news-bot search <topic>` - Search shared articles\n"
                          f"• `@ai-news-bot summary` - Get today's AI news summary\n"
                          f"• `@ai-news-bot categories` - Show content categories\n\n"
                          f"🔥 **Now featuring real-time AI news from [ai2people.com](https://ai2people.com)!** 🚀")
        
        try:
            await self._thread_adapter.send_channel_message(
                channel="#general",
                text=startup_message
            )
            logger.info("✅ Successfully sent startup message to general channel")
        except Exception as e:
            logger.error(f"❌ Failed to send startup message: {e}")
            # Try with # prefix
            try:
                await self._thread_adapter.send_channel_message(
                    channel="#general",
                    text=startup_message
                )
                logger.info("✅ Successfully sent startup message to #general channel")
            except Exception as e2:
                logger.error(f"❌ Failed to send startup message to #general: {e2}")
        
        logger.info("✅ AI News Agent startup complete")
    
    async def on_shutdown(self):
        """Clean shutdown of the agent."""
        logger.info("🛑 AI News Agent shutting down...")
        self.is_active = False
        await self._save_knowledge_base()
        logger.info("✅ AI News Agent shutdown complete")
    
    async def on_direct(self, msg: DirectMessageContext):
        """Handle direct messages with personalized AI news assistance."""
        text = msg.text.lower().strip()
        
        if "hello" in text or "hi" in text:
            await self.send_direct(
                to=msg.sender_id,
                text=f"👋 Hello {msg.sender_id}! I'm your AI News assistant.\n\n"
                     f"I can help you stay updated on AI developments. Try asking me about:\n"
                     f"• Latest AI product launches\n"
                     f"• Recent research papers\n"
                     f"• New AI tools and frameworks\n"
                     f"• Industry announcements\n\n"
                     f"What would you like to know about?"
            )
        
        elif "search" in text:
            # Extract search query
            query = text.replace("search", "").strip()
            if query:
                results = await self._search_knowledge_base(query)
                await self._send_search_results(msg.sender_id, query, results, is_direct=True)
            else:
                await self.send_direct(
                    to=msg.sender_id,
                    text="🔍 Please specify what you'd like to search for!\n"
                         f"Example: `search transformer models`"
                )
        
        elif "summary" in text:
            summary = await self._generate_daily_summary()
            await self.send_direct(to=msg.sender_id, text=summary)
        
        elif "categories" in text:
            categories_text = "📋 **Content Categories:**\n\n"
            for category, emoji in self.content_categories.items():
                count = len([item for item in self.knowledge_base.values() 
                           if item.get('category') == category])
                categories_text += f"{emoji} **{category.title()}** ({count} items)\n"
            
            await self.send_direct(to=msg.sender_id, text=categories_text)
        
        elif "help" in text:
            help_text = """
🤖 **AI News Bot Help**

**Commands:**
• `search <topic>` - Search knowledge base
• `summary` - Get today's AI news summary  
• `categories` - Show content categories
• `help` - Show this help message

**What I monitor:**
• AI product launches and updates
• Research papers and breakthroughs
• New tools and frameworks
• Industry announcements
• Technical tutorials and guides

**Channels I post to:**
• general - Major announcements
• #ai-news - Daily news updates
• #research - Research papers
• #tools - New AI tools

I automatically share interesting findings every 30 minutes!
            """.strip()
            
            await self.send_direct(to=msg.sender_id, text=help_text)
        
        else:
            # Try to answer as an AI-related question
            if any(keyword in text for keyword in ["ai", "artificial intelligence", "machine learning", "llm"]):
                await self.send_direct(
                    to=msg.sender_id,
                    text=f"🤔 That's an interesting AI question! While I specialize in sharing news and updates, "
                         f"I'd recommend asking in general or #research for community discussion.\n\n"
                         f"I can help you search for related content though - try `search {text[:30]}...`"
                )
            else:
                await self.send_direct(
                    to=msg.sender_id,
                    text="🤖 I'm focused on AI news and research! Try asking me about:\n"
                         f"• `search <AI topic>`\n"
                         f"• `summary` for today's updates\n"
                         f"• `help` for more commands"
                )
    
    async def on_channel_mention(self, msg: ChannelMessageContext):
        """Handle mentions in channels."""
        text = msg.text.lower()
        
        # Remove mention from text for processing
        clean_text = text.replace(f"@{self.default_agent_id}", "").strip()
        
        if "search" in clean_text:
            query = clean_text.replace("search", "").strip()
            if query:
                results = await self._search_knowledge_base(query)
                await self._send_search_results(msg.sender_id, query, results, 
                                              channel=msg.channel, is_direct=False)
            else:
                await self.send_channel(
                    channel=msg.channel,
                    text=f"🔍 {msg.sender_id}, please specify what you'd like to search for!\n"
                         f"Example: `@ai-news-bot search GPT models`",
                    mention=msg.sender_id
                )
        
        elif "summary" in clean_text:
            summary = await self._generate_daily_summary()
            await self.send_channel(
                channel=msg.channel,
                text=f"📊 **Daily AI Summary for {msg.sender_id}:**\n\n{summary}",
                mention=msg.sender_id
            )
        
        elif "categories" in clean_text:
            categories_text = "📋 **Content Categories:**\n\n"
            for category, emoji in self.content_categories.items():
                count = len([item for item in self.knowledge_base.values() 
                           if item.get('category') == category])
                categories_text += f"{emoji} **{category.title()}** ({count} items)\n"
            
            await self.send_channel(
                channel=msg.channel,
                text=f"{categories_text}\n\n*Requested by {msg.sender_id}*",
                mention=msg.sender_id
            )
        
        else:
            await self.send_channel(
                channel=msg.channel,
                text=f"👋 Hi {msg.sender_id}! I can help with AI news and research.\n"
                     f"Try: `@ai-news-bot search <topic>`, `@ai-news-bot summary`, or `@ai-news-bot help`",
                mention=msg.sender_id
            )
    
    async def on_channel_post(self, msg: ChannelMessageContext):
        """Monitor channel posts for AI-related discussions."""
        # Skip our own messages
        if msg.sender_id == self.client.agent_id:
            return
        
        text = msg.text.lower()
        
        # Check if message contains AI-related keywords
        if any(keyword in text for keyword in self.ai_keywords[:10]):  # Check top keywords
            # If it's a question, offer to help
            if "?" in text and len(text) > 20:
                # Don't spam - only respond occasionally
                import random
                if random.random() < 0.3:  # 30% chance to respond
                    await self.send_channel(
                        channel=msg.channel,
                        text=f"💡 Interesting AI discussion! I might have related content - "
                               f"try `@ai-news-bot search {text.split()[0:3]}`",
                        mention=msg.sender_id
                    )
    
    async def _news_monitoring_loop(self):
        """Background task that posts a random article every 30 seconds."""
        logger.info("🔄 Starting AI news monitoring loop (posting random article every 30 seconds)...")
        
        while self.is_active:
            try:
                # Refresh RSS feed every 10 minutes to get latest articles
                if datetime.now() - self.last_rss_fetch >= timedelta(minutes=10):
                    logger.info("🔄 Refreshing RSS feed from ai2people.com...")
                    await self._refresh_rss_feed()
                    self.last_rss_fetch = datetime.now()
                
                # Post a random article every 30 seconds
                if datetime.now() - self.last_news_check >= timedelta(seconds=self.news_check_interval):
                    if self.all_articles:
                        # Select a random article from our collection
                        random_article = random.choice(self.all_articles)
                        logger.info(f"📰 Posting random article: {random_article['title']}")
                        await self._share_content(random_article)
                    else:
                        logger.warning("📰 No articles available to post")
                    
                    self.last_news_check = datetime.now()
                
                # Wait before next check (30 seconds)
                await asyncio.sleep(self.news_check_interval)
                
            except Exception as e:
                logger.error(f"❌ Error in news monitoring loop: {e}")
                await asyncio.sleep(60)  # Wait 1 minute on error before retrying
    
    async def _refresh_rss_feed(self):
        """
        Refresh the RSS feed and update the articles collection.
        """
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(self.rss_feed_url, timeout=aiohttp.ClientTimeout(total=10)) as response:
                    if response.status != 200:
                        logger.warning(f"Failed to fetch RSS feed: HTTP {response.status}")
                        return
                    
                    rss_content = await response.text()
                    
            # Parse RSS XML
            root = ET.fromstring(rss_content)
            
            # Find all items in the RSS feed
            items = root.findall('.//item')
            
            articles = []
            for item in items:
                try:
                    title_elem = item.find('title')
                    link_elem = item.find('link')
                    description_elem = item.find('description')
                    pub_date_elem = item.find('pubDate')
                    
                    if title_elem is None or link_elem is None:
                        continue
                    
                    title = title_elem.text.strip() if title_elem.text else "Untitled"
                    url = link_elem.text.strip() if link_elem.text else ""
                    description = description_elem.text.strip() if description_elem and description_elem.text else ""
                    
                    # Clean up description (remove HTML tags and truncate)
                    import re
                    description = re.sub(r'<[^>]+>', '', description)  # Remove HTML tags
                    description = re.sub(r'\s+', ' ', description)  # Normalize whitespace
                    if len(description) > 300:
                        description = description[:300] + "..."
                    
                    # Categorize based on title and content
                    category = self._categorize_article(title, description)
                    
                    # Extract tags from title and description
                    tags = self._extract_tags(title, description)
                    
                    article = {
                        "title": title,
                        "summary": description or "Latest AI news and insights from ai2people.com",
                        "category": category,
                        "source": "ai2people.com",
                        "url": url,
                        "tags": tags,
                        "timestamp": datetime.now(),
                        "hash": self._generate_content_hash({"title": title, "url": url})
                    }
                    
                    articles.append(article)
                    
                except Exception as e:
                    logger.warning(f"Error parsing RSS item: {e}")
                    continue
            
            # Update our articles collection
            self.all_articles = articles
            logger.info(f"📰 Refreshed RSS feed: {len(articles)} articles available")
                
        except Exception as e:
            logger.error(f"❌ Error fetching RSS feed: {e}")
    
    def _categorize_article(self, title: str, description: str) -> str:
        """Categorize an article based on its title and description."""
        text = (title + " " + description).lower()
        
        # Research indicators
        if any(word in text for word in ["research", "study", "paper", "breakthrough", "discovery", "findings"]):
            return "research"
        
        # Tools/product indicators  
        if any(word in text for word in ["tool", "framework", "platform", "api", "software", "app", "launch", "release"]):
            return "tools"
        
        # Product/company indicators
        if any(word in text for word in ["openai", "google", "microsoft", "anthropic", "announces", "launches", "introduces"]):
            return "product"
        
        # Tutorial/guide indicators
        if any(word in text for word in ["how to", "guide", "tutorial", "tips", "learn", "beginner"]):
            return "tutorial"
        
        # Announcement indicators
        if any(word in text for word in ["announcement", "breaking", "update", "news", "alert"]):
            return "announcement"
        
        # Default to news
        return "news"
    
    def _extract_tags(self, title: str, description: str) -> List[str]:
        """Extract relevant tags from article title and description."""
        text = (title + " " + description).lower()
        tags = []
        
        # AI/ML related terms
        ai_terms = [
            "ai", "artificial intelligence", "machine learning", "deep learning", "neural networks",
            "llm", "large language model", "gpt", "transformer", "chatgpt", "openai", "anthropic",
            "google ai", "microsoft ai", "computer vision", "nlp", "natural language processing",
            "generative ai", "multimodal", "reasoning", "automation", "robotics"
        ]
        
        for term in ai_terms:
            if term in text:
                tags.append(term.replace(" ", "-"))
        
        # Limit to top 5 most relevant tags
        return tags[:5]
    
    async def _share_content(self, content: Dict[str, Any]):
        """Share discovered content with the community."""
        category = content.get('category', 'news')
        emoji = self.content_categories.get(category, "📄")
        
        # Always post to general channel as requested
        channel = "general"
        
        # Format the message with better styling
        message = f"{emoji} **{content['title']}**\n\n"
        
        # Add summary if available and not too long
        summary = content.get('summary', '')
        if summary and len(summary) > 50:
            message += f"📝 {summary}\n\n"
        
        # Add tags if available
        tags = content.get('tags', [])
        if tags:
            message += f"🏷️ **Tags:** {', '.join(tags)}\n"
        
        # Add source and link
        message += f"📰 **Source:** {content.get('source', 'ai2people.com')}\n"
        message += f"🔗 **Read more:** {content.get('url', 'N/A')}\n\n"
        message += f"*📡 Shared by AI News Bot • {datetime.now().strftime('%H:%M')}*"
        
        # Post to general channel using thread messaging adapter directly
        try:
            await self._thread_adapter.send_channel_message(
                channel=channel,
                text=message
            )
            logger.info(f"✅ Successfully sent message to {channel}")
        except Exception as e:
            logger.error(f"❌ Failed to send message to {channel}: {e}")
            # Fallback: try with # prefix
            try:
                await self._thread_adapter.send_channel_message(
                    channel=f"#{channel}",
                    text=message
                )
                logger.info(f"✅ Successfully sent message to #{channel} (with # prefix)")
            except Exception as e2:
                logger.error(f"❌ Failed to send message to #{channel}: {e2}")
        
        # Store in knowledge base
        self.knowledge_base[content['hash']] = content
        
        logger.info(f"📤 Shared content: {content['title']} to {channel}")
    
    async def _search_knowledge_base(self, query: str) -> List[Dict[str, Any]]:
        """Search the knowledge base for relevant content."""
        query_lower = query.lower()
        results = []
        
        for content in self.knowledge_base.values():
            # Search in title, summary, and tags
            searchable_text = (
                content.get('title', '').lower() + ' ' +
                content.get('summary', '').lower() + ' ' +
                ' '.join(content.get('tags', [])).lower()
            )
            
            if query_lower in searchable_text:
                results.append(content)
        
        # Sort by timestamp (newest first)
        results.sort(key=lambda x: x.get('timestamp', datetime.min), reverse=True)
        return results[:5]  # Return top 5 results
    
    async def _send_search_results(self, sender_id: str, query: str, results: List[Dict[str, Any]], 
                                 channel: Optional[str] = None, is_direct: bool = True):
        """Send search results to user."""
        if not results:
            message = f"🔍 No results found for '{query}'. Try different keywords or check back later!"
        else:
            message = f"🔍 **Search Results for '{query}'** ({len(results)} found):\n\n"
            
            for i, content in enumerate(results, 1):
                emoji = self.content_categories.get(content.get('category', 'news'), "📄")
                message += f"{i}. {emoji} **{content['title']}**\n"
                message += f"   📝 {content['summary'][:100]}...\n"
                message += f"   🔗 {content.get('url', 'N/A')}\n\n"
        
        if is_direct:
            await self.send_direct(to=sender_id, text=message)
        else:
            await self.send_channel(channel=channel, text=message, mention=sender_id)
    
    async def _generate_daily_summary(self) -> str:
        """Generate a summary of today's AI news."""
        today = datetime.now().date()
        today_content = [
            content for content in self.knowledge_base.values()
            if content.get('timestamp', datetime.min).date() == today
        ]
        
        if not today_content:
            return "📊 **Today's AI Summary**\n\nNo new content shared today. Check back later for updates!"
        
        # Group by category
        by_category = {}
        for content in today_content:
            category = content.get('category', 'news')
            if category not in by_category:
                by_category[category] = []
            by_category[category].append(content)
        
        summary = f"📊 **Today's AI Summary** ({len(today_content)} items)\n\n"
        
        for category, items in by_category.items():
            emoji = self.content_categories.get(category, "📄")
            summary += f"{emoji} **{category.title()}** ({len(items)} items)\n"
            for item in items[:2]:  # Show top 2 per category
                summary += f"  • {item['title']}\n"
            if len(items) > 2:
                summary += f"  • ... and {len(items) - 2} more\n"
            summary += "\n"
        
        return summary
    
    def _generate_content_hash(self, content: Dict[str, Any]) -> str:
        """Generate a hash for content to avoid duplicates."""
        content_str = f"{content.get('title', '')}{content.get('url', '')}"
        return hashlib.md5(content_str.encode()).hexdigest()
    
    async def _load_knowledge_base(self):
        """Load existing knowledge base from file."""
        try:
            kb_file = Path("ai_news_knowledge_base.json")
            if kb_file.exists():
                with open(kb_file, 'r') as f:
                    data = json.load(f)
                    # Convert timestamp strings back to datetime objects
                    for item in data.values():
                        if 'timestamp' in item:
                            item['timestamp'] = datetime.fromisoformat(item['timestamp'])
                    self.knowledge_base = data
                    self.shared_content = set(data.keys())
                logger.info(f"📚 Loaded {len(self.knowledge_base)} items from knowledge base")
        except Exception as e:
            logger.warning(f"⚠️ Could not load knowledge base: {e}")
    
    async def _save_knowledge_base(self):
        """Save knowledge base to file."""
        try:
            kb_file = Path("ai_news_knowledge_base.json")
            # Convert datetime objects to strings for JSON serialization
            serializable_data = {}
            for key, item in self.knowledge_base.items():
                serializable_item = item.copy()
                if 'timestamp' in serializable_item:
                    serializable_item['timestamp'] = serializable_item['timestamp'].isoformat()
                serializable_data[key] = serializable_item
            
            with open(kb_file, 'w') as f:
                json.dump(serializable_data, f, indent=2)
            logger.info(f"💾 Saved {len(self.knowledge_base)} items to knowledge base")
        except Exception as e:
            logger.error(f"❌ Could not save knowledge base: {e}")


async def main():
    """Main function to run the AI News Worker Agent."""
    print("🚀 Starting AI News Worker Agent...")
    print("=" * 60)
    
    # Create the agent
    agent = AINewsWorkerAgent(agent_id="ai-news-bot")
    
    try:
        # Connect to the network
        print("🔌 Connecting to Community Knowledge Base network...")
        await agent.async_start(host="localhost", port=8572)
        print("✅ Connected successfully!")
        
        # Keep the agent running
        print("🤖 AI News Agent is now active and monitoring for AI content...")
        print("📋 Press Ctrl+C to stop the agent")
        
        # Run indefinitely
        while True:
            await asyncio.sleep(1)
            
    except KeyboardInterrupt:
        print("\n🛑 Shutting down AI News Agent...")
    except Exception as e:
        print(f"❌ Error running agent: {e}")
        import traceback
        traceback.print_exc()
    finally:
        # Clean shutdown
        await agent.async_stop()
        print("👋 AI News Agent stopped")


if __name__ == "__main__":
    # Run the agent
    asyncio.run(main())
