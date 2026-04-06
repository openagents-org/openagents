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
from datetime import datetime, timedelta
from typing import Dict, List, Set, Optional, Any
from pathlib import Path

from openagents.agents.worker_agent import (
    WorkerAgent,
    EventContext,
    ChannelMessageContext,
    ReplyMessageContext
)
from openagents.config.globals import DEFAULT_TRANSPORT_ADDRESS

# Import the RedditFeeder class
from openagents.models.agent_config import AgentConfig
from reddit_util import RedditFeeder

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
    default_channels = ["general", "#ai-news", "#research", "#tools"]
    
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
        self.news_check_interval = 60  # 60 seconds for Reddit crawling
        
        # Initialize Reddit feeder
        self.reddit_feeder = RedditFeeder(subreddit="artificial", storage_file="/tmp/ai_news_reddit_crawl.json")
        self.last_reddit_check = datetime.now() - timedelta(hours=1)  # Force initial check
        
    async def on_startup(self):
        """Initialize the agent and start background tasks."""
        logger.info(f"🤖 AI News Agent '{self.default_agent_id}' starting up...")
        
        # Load existing knowledge base if available
        await self._load_knowledge_base()
        
        # Get Reddit feeder stats
        logger.info("📊 Reddit feeder initialized")
        stats = self.reddit_feeder.get_stats()
        logger.info(f"Reddit feeder stats: {stats}")
        
        # Check available channels
        logger.info("🔍 Checking available channels...")
        try:
            ws = self.workspace()
            ws._auto_connect_config = {
                'host': 'localhost',
                'port': DEFAULT_TRANSPORT_ADDRESS['http']['port']
            }
            channels_info = await ws.channels()
            logger.info(f"📺 Available channels: {channels_info}")
        except Exception as e:
            logger.error(f"❌ Error listing channels: {e}")
        
        # Start background news monitoring
        asyncio.create_task(self._news_monitoring_loop())
        
        # Send startup message to general channel using direct adapter
        startup_message = (f"🤖 **AI News Bot Online!** 📰\n\n"
                          f"I'm now connected and ready to share AI news from **Reddit r/artificial**!\n\n"
                          f"**What I do:**\n"
                          f"• 📡 Crawl AI posts from Reddit r/artificial\n"
                          f"• 🎲 Share new posts every 60 seconds to general\n"
                          f"• 🔄 Check for new posts continuously\n"
                          f"• 💬 Answer questions about AI developments\n"
                          f"• 🏷️ Categorize and tag content automatically\n\n"
                          f"**Commands:**\n"
                          f"• `@ai-news-bot search <topic>` - Search shared articles\n"
                          f"• `@ai-news-bot summary` - Get today's AI news summary\n"
                          f"• `@ai-news-bot categories` - Show content categories\n\n"
                          f"🔥 **Now featuring real-time AI news from [Reddit r/artificial](https://reddit.com/r/artificial)!** 🚀")
        
        try:
            ws = self.workspace()
            ws._auto_connect_config = {
                'host': 'localhost',
                'port': DEFAULT_TRANSPORT_ADDRESS['http']['port']
            }
            await ws.channel("general").post(startup_message)
            logger.info("✅ Successfully sent startup message to general channel")
        except Exception as e:
            logger.error(f"❌ Failed to send startup message: {e}")
        
        logger.info("✅ AI News Agent startup complete")
    
    async def on_shutdown(self):
        """Clean shutdown of the agent."""
        logger.info("🛑 AI News Agent shutting down...")
        self.is_active = False
        await self._save_knowledge_base()
        logger.info("✅ AI News Agent shutdown complete")
    
    async def on_direct(self, msg: EventContext):
        """Handle direct messages with personalized AI news assistance."""
        text = msg.payload['content']['text'].lower().strip()
        
        if "hello" in text or "hi" in text:
            ws = self.workspace()
            await ws.agent(msg.source_id).send(
                f"👋 Hello {msg.source_id}! I'm your AI News assistant.\n\n"
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
                await self._send_search_results(msg.source_id, query, results, is_direct=True)
            else:
                ws = self.workspace()
                await ws.agent(msg.source_id).send(
                    "🔍 Please specify what you'd like to search for!\n"
                    f"Example: `search transformer models`"
                )
        
        elif "summary" in text:
            summary = await self._generate_daily_summary()
            ws = self.workspace()
            await ws.agent(msg.source_id).send(summary)
        
        elif "categories" in text:
            categories_text = "📋 **Content Categories:**\n\n"
            for category, emoji in self.content_categories.items():
                count = len([item for item in self.knowledge_base.values() 
                           if item.get('category') == category])
                categories_text += f"{emoji} **{category.title()}** ({count} items)\n"
            
            ws = self.workspace()
            await ws.agent(msg.source_id).send(categories_text)
        
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
            
            ws = self.workspace()
            await ws.agent(msg.source_id).send(help_text)
        
        else:
            # Try to answer as an AI-related question
            if any(keyword in text for keyword in ["ai", "artificial intelligence", "machine learning", "llm"]):
                ws = self.workspace()
                await ws.agent(msg.source_id).send(
                    f"🤔 That's an interesting AI question! While I specialize in sharing news and updates, "
                    f"I'd recommend asking in general or #research for community discussion.\n\n"
                    f"I can help you search for related content though - try `search {text[:30]}...`"
                )
            else:
                ws = self.workspace()
                await ws.agent(msg.source_id).send(
                    "🤖 I'm focused on AI news and research! Try asking me about:\n"
                    f"• `search <AI topic>`\n"
                    f"• `summary` for today's updates\n"
                    f"• `help` for more commands"
                )
    
    async def on_channel_mention(self, context: ChannelMessageContext):
        """Handle mentions in channels."""
        text = context.incoming_event.payload['content']['text'].lower()
        await self.run_agent(
            context=context,
            instruction="if the message is about ai, reply with a post in the channel"
        )
    
    async def on_channel_post(self, msg: ChannelMessageContext):
        """Monitor channel posts for AI-related discussions."""
        # Skip our own messages
        if msg.source_id == self.client.agent_id:
            return
        await self.run_agent(
            context=msg,
            instruction="if the message is about ai, reply with a comment in the channel."
        )
        

    async def _news_monitoring_loop(self):
        """Background task that checks for new Reddit posts every 60 seconds."""
        logger.info("🔄 Starting AI news monitoring loop (checking Reddit every 60 seconds)...")
        
        while self.is_active:
            try:
                # Check for new Reddit posts
                if datetime.now() - self.last_news_check >= timedelta(seconds=self.news_check_interval):
                    logger.info("🔍 Checking Reddit r/artificial for new posts...")
                    
                    # Get new posts from Reddit
                    new_posts = await self.reddit_feeder.get_new_posts(limit=10)
                    
                    if new_posts:
                        logger.info(f"📰 Found {len(new_posts)} new posts from Reddit")
                        
                        # Share each new post
                        for post in new_posts:
                            # Convert Reddit post to our article format
                            article = self._convert_reddit_post_to_article(post)
                            logger.info(f"📤 Sharing Reddit post: {article['title']}")
                            await self._share_content(article)
                            
                            # Add small delay between posts to avoid spam
                            await asyncio.sleep(2)
                    else:
                        logger.info("📰 No new posts found on Reddit")
                    
                    self.last_news_check = datetime.now()
                
                # Wait before next check
                await asyncio.sleep(self.news_check_interval)
                
            except Exception as e:
                logger.error(f"❌ Error in news monitoring loop: {e}")
                await asyncio.sleep(60)  # Wait 1 minute on error before retrying
    
    def _convert_reddit_post_to_article(self, post: Dict[str, Any]) -> Dict[str, Any]:
        """
        Convert a Reddit post to our internal article format.
        
        Args:
            post: Reddit post dictionary from RedditFeeder
            
        Returns:
            Article dictionary compatible with existing sharing system
        """
        # Categorize based on title and content
        category = self._categorize_article(post['title'], post.get('selftext', ''))
        
        # Extract tags from title and content
        tags = self._extract_tags(post['title'], post.get('selftext', ''))
        
        article = {
            "title": post['title'],
            "summary": post.get('selftext', post['title'])[:300] + "..." if len(post.get('selftext', '')) > 300 else post.get('selftext', post['title']),
            "category": category,
            "source": "Reddit r/artificial",
            "url": post['url'],
            "reddit_url": post['reddit_url'],
            "image_url": post.get('image_url'),
            "tags": tags,
            "timestamp": post['created_time'],
            "author": post['author'],
            "score": post.get('score', 0),
            "num_comments": post.get('num_comments', 0),
            "hash": self._generate_content_hash({"title": post['title'], "url": post['url']})
        }
        
        return article
    
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
        # Always post to general channel as requested
        channel = "general"
        
        # Format the message in markdown style
        message = f"## {content['title']}\n\n"
        
        # Add summary if available and not empty
        summary = content.get('summary', '').strip()
        if summary and len(summary) > 10:  # Only if there's meaningful content
            message += f"{summary}\n\n"
        
        # Add image if available
        image_url = content.get('image_url')
        if image_url:
            message += f"![Image]({image_url})\n\n"
        
        # Add link
        url = content.get('url', 'N/A')
        message += f"[Read more]({url})"
        
        # Post to general channel using workspace
        try:
            ws = self.workspace()
            await ws.channel(channel).post(message)
            logger.info(f"✅ Successfully sent message to {channel}")
        except Exception as e:
            logger.error(f"❌ Failed to send message to {channel}: {e}")
            # Fallback: try with # prefix
            try:
                ws = self.workspace()
                await ws.channel(f"#{channel}").post(message)
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
    
    async def _send_search_results(self, source_id: str, query: str, results: List[Dict[str, Any]], 
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
            ws = self.workspace()
            await ws.agent(source_id).send(message)
        else:
            ws = self.workspace()
            await ws.channel(channel).post_with_mention(message, mention_agent_id=source_id)
    
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

    agent_config = AgentConfig(
        instruction="You are a helpful assistant agent in the OpenAgents network. You can communicate with other agents and help users with various tasks. Be helpful, harmless, and honest in your responses.",
        model_name="gpt-4o-mini",
        provider="openai",
        api_base="https://api.openai.com/v1"
    )
    
    # Create the agent
    agent = AINewsWorkerAgent(agent_id="ai-news-bot", agent_config=agent_config)
    
    try:
        # Connect to the network
        print("🔌 Connecting to Community Knowledge Base network...")
        await agent.async_start(network_host="localhost", network_port=DEFAULT_TRANSPORT_ADDRESS['http']['port'])
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
