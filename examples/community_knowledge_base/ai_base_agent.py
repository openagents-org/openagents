#!/usr/bin/env python3
"""
AI Base Agent for Community Knowledge Base

This module provides a base class for AI content worker agents that can discover 
and share different types of content (news, research, products, etc.) in the 
community knowledge base.

Features:
- Common agent functionality (startup, shutdown, messaging)
- Content categorization and tagging
- Knowledge base management
- Channel posting and user interaction
- Configurable content sources and intervals
"""

import asyncio
import logging
import json
import hashlib
import random
from datetime import datetime, timedelta
from typing import Dict, List, Set, Optional, Any
from pathlib import Path
from abc import ABC, abstractmethod

from openagents.agents.worker_agent import (
    WorkerAgent,
    EventContext,
    ChannelMessageContext,
    ReplyMessageContext
)

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class AIBaseAgent(WorkerAgent, ABC):
    """
    Base class for AI content worker agents.
    
    This abstract base class provides common functionality for agents that
    discover and share different types of AI-related content with the community.
    """
    
    # Override these in subclasses
    default_agent_id = "ai-base-bot"
    content_type = "AI content"
    source_name = "AI Source"
    
    auto_mention_response = True
    default_channels = ["general"]
    
    def __init__(self, **kwargs):
        """Initialize the AI Base Agent."""
        super().__init__(**kwargs)
        
        # Content tracking
        self.shared_content: Set[str] = set()
        self.content_categories = {
            "news": "📰",
            "research": "🔬", 
            "tools": "🛠️",
            "product": "🚀",
            "tutorial": "📚",
            "announcement": "📢",
            "business": "💼",
            "ethics": "⚖️"
        }
        
        # Common AI keywords for filtering
        self.ai_keywords = [
            "ai",
            "artificial intelligence", "machine learning", "deep learning",
            "neural networks", "LLM", "large language model", "GPT",
            "transformer", "AI model", "AI product", "AI tool",
            "computer vision", "natural language processing", "NLP",
            "reinforcement learning", "generative AI", "AI research",
            "OpenAI", "Anthropic", "Google AI", "Meta AI", "Microsoft AI"
        ]
        
        # Content database
        self.knowledge_base: Dict[str, Dict[str, Any]] = {}
        self.last_content_check = datetime.now() - timedelta(hours=1)
        
        # Agent state
        self.is_active = True
        self.content_check_interval = 60  # seconds
        
        # Message rate limiting - enforce 1 minute interval between posts
        self.last_message_time = None
        self.min_message_interval = 60  # 1 minute between messages
        
        # Initialize content fetcher (to be implemented by subclasses)
        self.content_fetcher = None
    
    @abstractmethod
    async def initialize_content_fetcher(self):
        """Initialize the content fetcher specific to this agent type."""
        pass
    
    @abstractmethod
    async def fetch_new_content(self, limit: int = 10) -> List[Dict[str, Any]]:
        """Fetch new content from the source."""
        pass
    
    async def _enforce_message_rate_limit(self):
        """Enforce minimum 1 minute interval between messages."""
        if self.last_message_time is not None:
            time_since_last = (datetime.now() - self.last_message_time).total_seconds()
            if time_since_last < self.min_message_interval:
                wait_time = self.min_message_interval - time_since_last
                logger.info(f"⏱️ Rate limiting: waiting {wait_time:.1f} seconds before next message")
                await asyncio.sleep(wait_time)
    
    async def on_startup(self):
        """Initialize the agent and start background tasks."""
        logger.info(f"🤖 {self.content_type} Agent '{self.default_agent_id}' starting up...")
        
        # Initialize content fetcher
        await self.initialize_content_fetcher()
        
        # Load existing knowledge base if available
        await self._load_knowledge_base()
        
        # Check available channels
        logger.info("🔍 Checking available channels...")
        try:
            ws = self.workspace()
            channels_info = await ws.channels()
            logger.info(f"📺 Available channels: {channels_info}")
        except Exception as e:
            logger.error(f"❌ Error listing channels: {e}")
        
        # Start background content monitoring
        asyncio.create_task(self._content_monitoring_loop())
        
        # Send startup message to general channel
        startup_message = self._create_startup_message()
        
        try:
            ws = self.workspace()
            await ws.channel("general").post(startup_message)
            logger.info("✅ Successfully sent startup message to general channel")
        except Exception as e:
            logger.error(f"❌ Failed to send startup message: {e}")
        
        logger.info(f"✅ {self.content_type} Agent startup complete")
    
    def _create_startup_message(self) -> str:
        """Create startup message for the agent."""
        return (f"🤖 **{self.content_type} Bot Online!** 📰\n\n"
                f"I'm now connected and ready to share {self.content_type.lower()} from **{self.source_name}**!\n\n"
                f"**What I do:**\n"
                f"• 📡 Monitor {self.source_name} for new {self.content_type.lower()}\n"
                f"• 🎲 Check for updates every {self.content_check_interval} seconds\n"
                f"• ⏱️ Share content with 1-minute intervals (respectful posting)\n"
                f"• 🔄 Continuously discover new content\n"
                f"• 💬 Answer questions about {self.content_type.lower()}\n"
                f"• 🏷️ Categorize and tag content automatically\n\n"
                f"**Commands:**\n"
                f"• `@{self.default_agent_id} search <topic>` - Search shared content\n"
                f"• `@{self.default_agent_id} summary` - Get today's summary\n"
                f"• `@{self.default_agent_id} categories` - Show content categories\n\n"
                f"🔥 **Now featuring real-time {self.content_type.lower()} from {self.source_name}!** 🚀")
    
    async def on_shutdown(self):
        """Clean shutdown of the agent."""
        logger.info(f"🛑 {self.content_type} Agent shutting down...")
        self.is_active = False
        await self._save_knowledge_base()
        logger.info(f"✅ {self.content_type} Agent shutdown complete")
    
    async def on_direct(self, msg: EventContext):
        """Handle direct messages with personalized assistance."""
        text = msg.text.lower().strip()
        
        if "hello" in text or "hi" in text:
            ws = self.workspace()
            await ws.agent(msg.sender_id).send_direct_message(
                f"👋 Hello {msg.sender_id}! I'm your {self.content_type} assistant.\n\n"
                f"I can help you stay updated on {self.content_type.lower()}. Try asking me about:\n"
                f"• Latest {self.content_type.lower()}\n"
                f"• Search for specific topics\n"
                f"• Daily summaries\n"
                f"• Content categories\n\n"
                f"What would you like to know about?"
            )
        
        elif "search" in text:
            query = text.replace("search", "").strip()
            if query:
                results = await self._search_knowledge_base(query)
                await self._send_search_results(msg.sender_id, query, results, is_direct=True)
            else:
                ws = self.workspace()
                await ws.agent(msg.sender_id).send_direct_message(
                    "🔍 Please specify what you'd like to search for!\n"
                    f"Example: `search transformer models`"
                )
        
        elif "summary" in text:
            summary = await self._generate_daily_summary()
            ws = self.workspace()
            await ws.agent(msg.sender_id).send_direct_message(summary)
        
        elif "categories" in text:
            categories_text = "📋 **Content Categories:**\n\n"
            for category, emoji in self.content_categories.items():
                count = len([item for item in self.knowledge_base.values() 
                           if item.get('category') == category])
                categories_text += f"{emoji} **{category.title()}** ({count} items)\n"
            
            ws = self.workspace()
            await ws.agent(msg.sender_id).send_direct_message(categories_text)
        
        elif "help" in text:
            help_text = f"""
🤖 **{self.content_type} Bot Help**

**Commands:**
• `search <topic>` - Search knowledge base
• `summary` - Get today's summary  
• `categories` - Show content categories
• `help` - Show this help message

**What I monitor:**
• {self.content_type} from {self.source_name}
• AI-related developments
• Research and announcements

**Channels I post to:**
• general - All updates

I automatically share interesting findings every {self.content_check_interval} seconds!
            """.strip()
            
            ws = self.workspace()
            await ws.agent(msg.sender_id).send_direct_message(help_text)
        
        else:
            # Try to answer as an AI-related question
            if any(keyword in text for keyword in ["ai", "artificial intelligence", "machine learning", "llm"]):
                ws = self.workspace()
                await ws.agent(msg.sender_id).send_direct_message(
                    f"🤔 That's an interesting AI question! While I specialize in sharing {self.content_type.lower()}, "
                    f"I'd recommend asking in general for community discussion.\n\n"
                    f"I can help you search for related content though - try `search {text[:30]}...`"
                )
            else:
                ws = self.workspace()
                await ws.agent(msg.sender_id).send_direct_message(
                    f"🤖 I'm focused on {self.content_type.lower()}! Try asking me about:\n"
                    f"• `search <topic>`\n"
                    f"• `summary` for today's updates\n"
                    f"• `help` for more commands"
                )
    
    async def on_channel_mention(self, msg: ChannelMessageContext):
        """Handle mentions in channels."""
        text = msg.text.lower()
        clean_text = text.replace(f"@{self.default_agent_id}", "").strip()
        
        if "search" in clean_text:
            query = clean_text.replace("search", "").strip()
            if query:
                results = await self._search_knowledge_base(query)
                await self._send_search_results(msg.sender_id, query, results, 
                                              channel=msg.channel, is_direct=False)
            else:
                ws = self.workspace()
                await ws.channel(msg.channel).post_with_mention(
                    f"🔍 {msg.sender_id}, please specify what you'd like to search for!\n"
                    f"Example: `@{self.default_agent_id} search GPT models`",
                    mention_agent_id=msg.sender_id
                )
        
        elif "summary" in clean_text:
            summary = await self._generate_daily_summary()
            ws = self.workspace()
            await ws.channel(msg.channel).post_with_mention(
                f"📊 **Daily Summary for {msg.sender_id}:**\n\n{summary}",
                mention_agent_id=msg.sender_id
            )
        
        elif "categories" in clean_text:
            categories_text = "📋 **Content Categories:**\n\n"
            for category, emoji in self.content_categories.items():
                count = len([item for item in self.knowledge_base.values() 
                           if item.get('category') == category])
                categories_text += f"{emoji} **{category.title()}** ({count} items)\n"
            
            ws = self.workspace()
            await ws.channel(msg.channel).post_with_mention(
                f"{categories_text}\n\n*Requested by {msg.sender_id}*",
                mention_agent_id=msg.sender_id
            )
        
        else:
            ws = self.workspace()
            await ws.channel(msg.channel).post_with_mention(
                f"👋 Hi {msg.sender_id}! I can help with {self.content_type.lower()}.\n"
                f"Try: `@{self.default_agent_id} search <topic>`, `@{self.default_agent_id} summary`, or `@{self.default_agent_id} help`",
                mention_agent_id=msg.sender_id
            )
    
    async def on_channel_post(self, msg: ChannelMessageContext):
        """Monitor channel posts for AI-related discussions."""
        # Skip our own messages
        if msg.sender_id == self.client.agent_id:
            return
        
        text = msg.text.lower()
        
        # Check if message contains AI-related keywords
        if any(keyword in text for keyword in self.ai_keywords[:10]):
            # If it's a question, offer to help occasionally
            if "?" in text and len(text) > 20:
                if random.random() < 0.3:  # 30% chance to respond
                    ws = self.workspace()
                    await ws.channel(msg.channel).post_with_mention(
                        f"💡 Interesting discussion! I might have related {self.content_type.lower()} - "
                        f"try `@{self.default_agent_id} search {' '.join(text.split()[:3])}`",
                        mention_agent_id=msg.sender_id
                    )
    
    async def _content_monitoring_loop(self):
        """Background task that checks for new content."""
        logger.info(f"🔄 Starting {self.content_type.lower()} monitoring loop (checking every {self.content_check_interval} seconds)...")
        
        while self.is_active:
            try:
                # Check for new content
                if datetime.now() - self.last_content_check >= timedelta(seconds=self.content_check_interval):
                    logger.info(f"🔍 Checking {self.source_name} for new {self.content_type.lower()}...")
                    
                    # Get new content
                    new_content = await self.fetch_new_content(limit=10)
                    
                    if new_content:
                        logger.info(f"📰 Found {len(new_content)} new items from {self.source_name}")
                        
                        # Share each new item with rate limiting
                        for item in new_content:
                            logger.info(f"📤 Sharing: {item['title']}")
                            
                            # Enforce 1 minute interval between messages
                            await self._enforce_message_rate_limit()
                            
                            # Share the content
                            await self._share_content(item)
                            
                            # Update last message time
                            self.last_message_time = datetime.now()
                    else:
                        logger.info(f"📰 No new {self.content_type.lower()} found")
                    
                    self.last_content_check = datetime.now()
                
                # Wait before next check
                await asyncio.sleep(self.content_check_interval)
                
            except Exception as e:
                logger.error(f"❌ Error in content monitoring loop: {e}")
                await asyncio.sleep(60)  # Wait 1 minute on error before retrying
    
    def _categorize_content(self, title: str, description: str) -> str:
        """Categorize content based on title and description."""
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
        
        # Business indicators
        if any(word in text for word in ["funding", "investment", "startup", "business", "market", "ipo"]):
            return "business"
        
        # Ethics indicators
        if any(word in text for word in ["ethics", "bias", "fairness", "responsible", "safety", "regulation"]):
            return "ethics"
        
        # Announcement indicators
        if any(word in text for word in ["announcement", "breaking", "update", "news", "alert"]):
            return "announcement"
        
        # Default to news
        return "news"
    
    def _extract_tags(self, title: str, description: str) -> List[str]:
        """Extract relevant tags from content title and description."""
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
        channel = "general"
        
        # Format the message in markdown style
        message = f"## {content['title']}\n\n"
        
        # Add summary if available and not empty
        summary = content.get('summary', '').strip()
        if summary and len(summary) > 10:
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
        content_hash = content.get('hash', self._generate_content_hash(content))
        self.knowledge_base[content_hash] = content
        
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
            ws = self.workspace()
            await ws.agent(sender_id).send_direct_message(message)
        else:
            ws = self.workspace()
            await ws.channel(channel).post_with_mention(message, mention_agent_id=sender_id)
    
    async def _generate_daily_summary(self) -> str:
        """Generate a summary of today's content."""
        today = datetime.now().date()
        today_content = [
            content for content in self.knowledge_base.values()
            if content.get('timestamp', datetime.min).date() == today
        ]
        
        if not today_content:
            return f"📊 **Today's {self.content_type} Summary**\n\nNo new content shared today. Check back later for updates!"
        
        # Group by category
        by_category = {}
        for content in today_content:
            category = content.get('category', 'news')
            if category not in by_category:
                by_category[category] = []
            by_category[category].append(content)
        
        summary = f"📊 **Today's {self.content_type} Summary** ({len(today_content)} items)\n\n"
        
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
            kb_file = Path(f"{self.default_agent_id}_knowledge_base.json")
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
            kb_file = Path(f"{self.default_agent_id}_knowledge_base.json")
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