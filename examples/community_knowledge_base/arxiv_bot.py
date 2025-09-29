#!/usr/bin/env python3
"""
ArXiv AI Papers Bot for Community Knowledge Base

This agent automatically finds and shares new AI research papers from ArXiv.
It monitors multiple AI-related categories and shares interesting papers to 
the general channel with proper formatting and metadata.

Features:
- ArXiv API integration for AI research papers
- Multi-category monitoring (AI, ML, CV, NLP, etc.)
- Paper categorization and author tracking
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
from private.arxiv_util import ArxivFetcher
from openagents.config.globals import DEFAULT_NETWORK_PORT

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

DEFAULT_NETWORK_PORT = 8572


class ArxivBot(AIBaseAgent):
    """
    ArXiv AI Papers Bot that discovers and shares new AI research papers.
    
    This agent monitors ArXiv for new papers in AI-related categories and
    automatically shares interesting findings with the community.
    """
    
    default_agent_id = "arxiv-bot"
    content_type = "AI Research Papers"
    source_name = "ArXiv"
    auto_mention_response = True
    default_channels = ["general"]
    
    def __init__(self, **kwargs):
        """Initialize the ArXiv Bot."""
        super().__init__(**kwargs)
        
        self.min_message_interval = 90  # Post every 90 seconds
        
        # ArXiv-specific settings with memory pool logic
        self.content_check_interval = 90  # Check every 90 seconds (for posting)
        self.pool_refresh_interval = 21600  # Refresh content pool every 6 hours (21600 seconds)
        self.last_pool_refresh = 0
        self.content_pool = []  # Memory pool to store fetched papers
        
        # Enhanced research-specific categories
        self.content_categories.update({
            "computer_vision": "👁️",
            "nlp": "🗣️",
            "machine_learning": "🤖",
            "neural_networks": "🧠",
            "robotics": "🦾",
            "theory": "📊",
            "interdisciplinary": "🔬"
        })
        
        # ArXiv-specific keywords and categories for comprehensive search
        self.arxiv_categories = {
            "cs.AI": "Artificial Intelligence",
            "cs.LG": "Machine Learning", 
            "cs.CL": "Computation and Language (NLP)",
            "cs.CV": "Computer Vision",
            "cs.NE": "Neural and Evolutionary Computing",
            "stat.ML": "Machine Learning (Statistics)"
        }
    
    async def initialize_content_fetcher(self):
        """Initialize the ArXiv fetcher."""
        try:
            # Clean up any existing tracking file for fresh start (optional)
            tracking_file = "/tmp/arxiv_fetched_papers.json"
            if os.path.exists(tracking_file):
                logger.info("🗑️ Removing existing ArXiv tracking file for fresh start")
                os.remove(tracking_file)
            
            self.content_fetcher = ArxivFetcher(tracking_file=tracking_file)
            
            # Get ArXiv fetcher stats
            stats = self.content_fetcher.get_tracking_stats()
            logger.info(f"📊 ArXiv fetcher initialized: {stats}")
            
        except Exception as e:
            logger.error(f"❌ Failed to initialize ArXiv fetcher: {e}")
            raise
    
    async def _refresh_content_pool(self) -> None:
        """Refresh the content pool by fetching papers from ArXiv."""
        try:
            if not self.content_fetcher:
                logger.warning("⚠️ ArXiv fetcher not initialized")
                return
            
            logger.info("🔄 Refreshing content pool from ArXiv...")
            
            # Fetch new papers using the utility (synchronous call wrapped in executor)
            loop = asyncio.get_event_loop()
            new_papers = await loop.run_in_executor(
                None, 
                self.content_fetcher.fetch_new_list,
                100,  # max_results: 100 papers total
                14    # days_back: Look back 14 days
            )
            
            if new_papers:
                # Remove duplicates based on ArXiv ID
                existing_ids = {article.get('id') for article in self.content_pool}
                seen_ids = set()
                unique_papers = []
                
                for paper in new_papers:
                    arxiv_id = paper.get('id', '')
                    if arxiv_id and arxiv_id not in seen_ids and arxiv_id not in existing_ids:
                        seen_ids.add(arxiv_id)
                        
                        # Convert ArXiv paper format to our standard format
                        article = self._convert_arxiv_paper_to_article(paper)
                        if article:
                            unique_papers.append(article)
                
                # Add new papers to the pool
                self.content_pool.extend(unique_papers)
                
                # Keep pool size manageable (max 150 papers)
                if len(self.content_pool) > 150:
                    self.content_pool = self.content_pool[-150:]
                
                logger.info(f"✅ Content pool refreshed: {len(unique_papers)} new papers added, pool size: {len(self.content_pool)}")
            else:
                logger.info("📭 No new papers found during pool refresh")
                
        except Exception as e:
            logger.error(f"❌ Error refreshing content pool: {e}")

    async def fetch_new_content(self, limit: int = 1) -> List[Dict[str, Any]]:
        """
        Memory pool-based content fetching:
        - Refresh pool from ArXiv every 6 hours using all AI categories
        - Return random content from pool every 90 seconds
        
        Args:
            limit: Maximum number of papers to return (default 1)
            
        Returns:
            List of random paper dictionaries from pool
        """
        try:
            current_time = time.time()
            
            # Refresh content pool every 6 hours
            if current_time - self.last_pool_refresh >= self.pool_refresh_interval:
                await self._refresh_content_pool()
                self.last_pool_refresh = current_time
            
            # Return random content from pool if available
            if self.content_pool:
                # Select random papers from pool (can repeat)
                selected_papers = random.choices(self.content_pool, k=min(limit, len(self.content_pool)))
                logger.info(f"🎲 Selected {len(selected_papers)} random papers from pool (pool size: {len(self.content_pool)})")
                return selected_papers
            else:
                logger.info("📭 Content pool is empty, no papers to share")
                return []
                
        except Exception as e:
            logger.error(f"❌ Error in fetch_new_content: {e}")
            return []
    
    def _convert_arxiv_paper_to_article(self, paper: Dict[str, Any]) -> Dict[str, Any]:
        """
        Convert ArXiv paper format to our standard article format.
        
        Args:
            paper: ArXiv paper dictionary
            
        Returns:
            Article dictionary compatible with existing sharing system
        """
        try:
            # Extract and clean paper data
            title = paper.get('title', '').strip()
            summary = paper.get('summary', '').strip()
            authors = paper.get('authors', [])
            categories = paper.get('categories', [])
            
            # Create author string
            author_str = ', '.join(authors[:3])  # Show first 3 authors
            if len(authors) > 3:
                author_str += f" et al. ({len(authors)} total)"
            elif not author_str:
                author_str = "Unknown"
            
            # Categorize based on ArXiv categories
            category = self._categorize_arxiv_paper(categories, title, summary)
            
            # Extract tags
            tags = self._extract_arxiv_tags(categories, title, summary)
            
            # Parse timestamp
            timestamp = datetime.now()
            if 'published' in paper:
                try:
                    # ArXiv timestamps are in ISO format
                    timestamp = datetime.fromisoformat(paper['published'].replace('Z', '+00:00'))
                    if timestamp.tzinfo:
                        timestamp = timestamp.replace(tzinfo=None)
                except:
                    pass
            
            # Clean and truncate summary
            if len(summary) > 500:
                summary = summary[:500] + "..."
            
            article = {
                "id": paper.get('id', ''),
                "title": title,
                "summary": summary,
                "category": category,
                "source": "ArXiv",
                "url": paper.get('arxiv_url', ''),
                "pdf_url": paper.get('pdf_url'),
                "image_url": None,  # ArXiv doesn't provide images
                "tags": tags,
                "timestamp": timestamp,
                "authors": authors,
                "author_string": author_str,
                "arxiv_categories": categories,
                "hash": paper.get('id', '')
            }
            
            return article
            
        except Exception as e:
            logger.debug(f"⚠️ Error converting ArXiv paper: {e}")
            return None
    
    def _categorize_arxiv_paper(self, categories: List[str], title: str, summary: str) -> str:
        """Categorize ArXiv paper based on categories and content."""
        text = (title + " " + summary).lower()
        
        # Check ArXiv categories first
        if any(cat.startswith('cs.CV') for cat in categories):
            return "computer_vision"
        elif any(cat.startswith('cs.CL') for cat in categories):
            return "nlp"
        elif any(cat.startswith('cs.LG') or cat.startswith('stat.ML') for cat in categories):
            return "machine_learning"
        elif any(cat.startswith('cs.NE') for cat in categories):
            return "neural_networks"
        elif any(cat.startswith('cs.RO') for cat in categories):
            return "robotics"
        elif any(cat.startswith('cs.AI') for cat in categories):
            return "research"  # General AI research
        
        # Content-based categorization
        if any(word in text for word in ["computer vision", "image", "visual", "detection", "segmentation", "object"]):
            return "computer_vision"
        elif any(word in text for word in ["natural language", "nlp", "text", "language model", "translation", "sentiment"]):
            return "nlp"
        elif any(word in text for word in ["neural network", "deep learning", "cnn", "rnn", "transformer", "attention"]):
            return "neural_networks"
        elif any(word in text for word in ["robot", "robotics", "autonomous", "control", "manipulation"]):
            return "robotics"
        elif any(word in text for word in ["theory", "theoretical", "proof", "algorithm", "complexity", "optimization"]):
            return "theory"
        elif any(word in text for word in ["interdisciplinary", "application", "biology", "physics", "medicine"]):
            return "interdisciplinary"
        
        # Default to research
        return "research"
    
    def _extract_arxiv_tags(self, categories: List[str], title: str, summary: str) -> List[str]:
        """Extract relevant tags from ArXiv paper."""
        text = (title + " " + summary).lower()
        tags = []
        
        # Add ArXiv category tags
        for cat in categories:
            if cat in self.arxiv_categories:
                tags.append(self.arxiv_categories[cat].lower().replace(" ", "_"))
        
        # Technical terms
        tech_terms = [
            "transformer", "attention", "bert", "gpt", "llm", "cnn", "rnn", "lstm",
            "reinforcement_learning", "supervised_learning", "unsupervised_learning",
            "generative_model", "gan", "vae", "diffusion", "neural_network",
            "deep_learning", "machine_learning", "computer_vision", "nlp"
        ]
        
        for term in tech_terms:
            if term.replace("_", " ") in text:
                tags.append(term)
        
        # Remove duplicates and limit
        return list(set(tags))[:5]
    
    def _create_startup_message(self) -> str:
        """Create startup message specific to ArXiv papers."""
        categories_str = ", ".join([f"{code} ({name})" for code, name in list(self.arxiv_categories.items())[:3]]) + " (+3 more)"
        return (f"🤖 **ArXiv AI Papers Bot Online!** 🔬\n\n"
                f"I'm now connected with a new 6-hour category pooling system!\n\n"
                f"**What I do:**\n"
                f"• 📡 Monitor all 6 ArXiv AI research categories\n"
                f"• 🔄 Refresh content pool every 6 hours\n"
                f"• 🎲 Post random papers from pool every 90 seconds\n"
                f"• 🏷️ Categorize papers by research area\n"
                f"• 💬 Answer questions about AI research\n"
                f"• 🔁 Allow content repeats for consistent posting\n\n"
                f"**Memory Pool System:**\n"
                f"• Pool refreshes: Every 6 hours\n"
                f"• Content posting: Every 90 seconds\n"
                f"• Pool size: Up to 150 papers\n"
                f"• Selection: Random from pool (repeats allowed)\n\n"
                f"**ArXiv Categories Monitored:**\n"
                f"• cs.AI (Artificial Intelligence)\n"
                f"• cs.LG (Machine Learning)\n"
                f"• cs.CV (Computer Vision)\n"
                f"• cs.CL (Natural Language Processing)\n"
                f"• cs.NE (Neural Networks)\n"
                f"• stat.ML (ML Statistics)\n\n"
                f"**Commands:**\n"
                f"• `@{self.default_agent_id} search <topic>` - Find specific papers\n"
                f"• `@{self.default_agent_id} summary` - Get research summary\n"
                f"• `@{self.default_agent_id} pool` - Show current pool status\n"
                f"• `@{self.default_agent_id} categories` - Show research categories\n\n"
                f"🔥 **Now featuring 6-hour category-based pool system!** 🚀")
    
    async def _share_content(self, content: Dict[str, Any]):
        """Share AI research paper with enhanced formatting."""
        channel = "general"
        
        # Enhanced message formatting for research papers
        title = content.get('title', 'Unknown Paper')
        summary = content.get('summary', '').strip()
        authors = content.get('author_string', 'Unknown')
        
        message = f"🔬 **New AI Research: {title}**\n\n"
        
        # Add authors
        message += f"👥 **Authors:** {authors}\n\n"
        
        # Add paper summary
        if summary and len(summary) > 10:
            message += f"📝 **Abstract:** {summary}\n\n"
        
        # Add research area and category info
        category = content.get('category', 'research')
        emoji = self.content_categories.get(category, "🔬")
        message += f"{emoji} **Research Area:** {category.replace('_', ' ').title()}\n"
        
        # Add ArXiv categories
        arxiv_cats = content.get('arxiv_categories', [])
        if arxiv_cats:
            cat_names = [self.arxiv_categories.get(cat, cat) for cat in arxiv_cats[:3]]
            message += f"📚 **ArXiv Categories:** {', '.join(cat_names)}\n"
        
        # Add publication date
        timestamp = content.get('timestamp')
        if timestamp:
            if isinstance(timestamp, datetime):
                date_str = timestamp.strftime("%Y-%m-%d")
            else:
                date_str = str(timestamp)
            message += f"📅 **Published:** {date_str}\n"
        
        # Add tags
        tags = content.get('tags', [])
        if tags:
            message += f"🏷️ **Keywords:** {', '.join(tags[:3])}\n"
        
        # Add links
        arxiv_url = content.get('url', '')
        pdf_url = content.get('pdf_url', '')
        
        message += f"\n🔗 **Links:**\n"
        if arxiv_url:
            message += f"• [ArXiv Page]({arxiv_url})\n"
        if pdf_url and pdf_url != arxiv_url:
            message += f"• [PDF Download]({pdf_url})\n"
        
        # Post to general channel
        try:
            ws = self.workspace()
            await ws.channel(channel).post(message)
            logger.info(f"✅ Successfully shared paper: {title[:50]}...")
        except Exception as e:
            logger.error(f"❌ Failed to share paper: {e}")
            # Fallback: try with # prefix
            try:
                ws = self.workspace()
                await ws.channel(f"#{channel}").post(message)
                logger.info(f"✅ Successfully shared paper to #{channel}")
            except Exception as e2:
                logger.error(f"❌ Failed to share paper to #{channel}: {e2}")
        
        # Store in knowledge base
        content_hash = content.get('hash', self._generate_content_hash(content))
        self.knowledge_base[content_hash] = content
        
        logger.info(f"📤 Shared AI paper: {title[:50]}...")
    
    async def on_direct(self, msg):
        """Enhanced direct message handling for ArXiv bot."""
        await super().on_direct(msg)
        
        text = msg.text.lower().strip()
        
        # ArXiv-specific commands
        if "pool" in text:
            # Show current content pool status
            pool_info = f"🎲 **Content Pool Status:**\n\n"
            pool_info += f"📊 **Pool Size:** {len(self.content_pool)} papers\n"
            pool_info += f"🔄 **Last Refresh:** {time.time() - self.last_pool_refresh:.1f} seconds ago\n"
            pool_info += f"⏰ **Next Refresh:** {max(0, self.pool_refresh_interval - (time.time() - self.last_pool_refresh)):.1f} seconds\n\n"
            
            if self.content_pool:
                pool_info += "**Recent Papers in Pool:**\n"
                # Show last 5 papers added to pool
                for i, paper in enumerate(self.content_pool[-5:], 1):
                    title = paper.get('title', 'Unknown')
                    if len(title) > 60:
                        title = title[:60] + "..."
                    authors = paper.get('authors', [])
                    author_str = authors[0] if authors else "Unknown"
                    pool_info += f"{i}. {title} - {author_str}\n"
            else:
                pool_info += "📭 Pool is currently empty\n"
            
            ws = self.workspace()
            await ws.agent(msg.sender_id).send_direct_message(pool_info)
            
        elif "authors" in text or "author" in text:
            # Show top authors from recent papers
            recent_papers = [p for p in self.knowledge_base.values() 
                           if p.get('timestamp', datetime.min).date() == datetime.now().date()]
            
            if recent_papers:
                authors_info = "👥 **Today's Research Authors:**\n\n"
                all_authors = []
                for paper in recent_papers:
                    all_authors.extend(paper.get('authors', []))
                
                # Count author frequency
                from collections import Counter
                author_counts = Counter(all_authors)
                
                for author, count in author_counts.most_common(10):
                    authors_info += f"• {author} ({count} paper{'s' if count > 1 else ''})\n"
                
                ws = self.workspace()
                await ws.agent(msg.sender_id).send_direct_message(authors_info)
            else:
                ws = self.workspace()
                await ws.agent(msg.sender_id).send_direct_message(
                    "📭 No papers shared today yet. Check back later!"
                )
        
        elif "categories" in text or "arxiv" in text:
            categories_info = "📚 **ArXiv Categories Monitored:**\n\n"
            for cat_id, cat_name in self.arxiv_categories.items():
                categories_info += f"• **{cat_id}**: {cat_name}\n"
            
            categories_info += f"\n🔗 **ArXiv Search:** https://arxiv.org/search/"
            
            ws = self.workspace()
            await ws.agent(msg.sender_id).send_direct_message(categories_info)


async def main():
    """Main function to run the ArXiv Bot."""
    print("🚀 Starting ArXiv AI Papers Bot...")
    print("=" * 60)
    
    # Create the bot
    bot = ArxivBot(agent_id="arxiv-bot")
    
    try:
        # Connect to the network
        print("🔌 Connecting to Community Knowledge Base network...")
        await bot.async_start(host="localhost", port=DEFAULT_NETWORK_PORT)
        print("✅ Connected successfully!")
        
        # Keep the bot running
        print("🤖 ArXiv Bot is now active and monitoring for new papers...")
        print("📋 Press Ctrl+C to stop the bot")
        
        # Run indefinitely
        while True:
            await asyncio.sleep(1)
            
    except KeyboardInterrupt:
        print("\n🛑 Shutting down ArXiv Bot...")
    except Exception as e:
        print(f"❌ Error running bot: {e}")
        import traceback
        traceback.print_exc()
    finally:
        # Clean shutdown
        await bot.async_stop()
        print("👋 ArXiv Bot stopped")


if __name__ == "__main__":
    # Run the bot
    asyncio.run(main())