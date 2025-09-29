#!/usr/bin/env python3
"""
Google News Fetcher Utility for Community Knowledge Base

This module provides a GoogleNewsFetcher class that fetches AI-related news from Google News
using the Serper API, tracks processed news articles, and returns unreported news items.

Features:
- Google News API integration via Serper
- Content filtering for AI-related news
- Persistent tracking of processed articles
- News categorization and content extraction
- Rate limiting and error handling
"""

import asyncio
import json
import logging
import aiohttp
import hashlib
import time
from datetime import datetime, timedelta
from typing import Dict, List, Set, Optional, Any
from pathlib import Path
from dataclasses import dataclass

# Configure logging
logger = logging.getLogger(__name__)

@dataclass
class NewsArticle:
    """Represents a news article from Google News"""
    id: str
    title: str
    snippet: str
    link: str
    source: str
    date: datetime
    position: int
    category: str
    topics: List[str]


class GoogleNewsFetcher:
    """
    Google News fetcher class that retrieves AI-related news articles.
    
    This class handles:
    - Fetching news from Google News via Serper API
    - Filtering for AI-related content
    - Tracking processed articles to avoid duplicates
    - Article categorization and content extraction
    """
    
    def __init__(self, api_key: str, storage_file: str = "/tmp/google_news_data.json"):
        """
        Initialize the Google News fetcher.
        
        Args:
            api_key: Serper API key for Google News access
            storage_file: File to store processed article tracking
        """
        self.api_key = api_key
        self.storage_file = Path(storage_file)
        
        # Track processed articles to avoid duplicates
        self.processed_articles: Set[str] = set()
        
        # Rate limiting
        self.last_request_time = 0
        self.min_request_interval = 2  # Minimum 2 seconds between requests
        
        # API configuration
        self.api_url = "https://google.serper.dev/news"
        self.headers = {
            'X-API-KEY': self.api_key,
            'Content-Type': 'application/json'
        }
        
        # AI-related keywords for news filtering
        self.ai_keywords = [
            "artificial intelligence", "ai", "machine learning", "ml", "deep learning",
            "neural network", "chatbot", "chat bot", "gpt", "llm", "large language model",
            "natural language", "nlp", "computer vision", "automation", "neural",
            "generative", "openai", "anthropic", "ai-powered", "ai powered",
            "intelligent", "smart assistant", "voice assistant", "conversational ai",
            "predictive", "recommendation engine", "ai tool", "ai platform",
            "automated", "algorithm", "data science", "tensorflow", "pytorch",
            "transformers", "bert", "roberta", "stable diffusion", "midjourney",
            "copilot", "assistant", "bot", "cognitive", "gemini", "claude",
            "ai model", "ai system", "ai technology", "artificial neural",
            "machine intelligence", "ai research", "ai development", "ai startup",
            "ai company", "ai industry", "ai regulation", "ai ethics"
        ]
        
        # News categories for classification
        self.categories = {
            "business": ["business", "startup", "funding", "investment", "market", "stock", "ipo", "acquisition", "merger"],
            "technology": ["technology", "tech", "software", "hardware", "platform", "system", "development", "innovation"],
            "research": ["research", "study", "paper", "academic", "university", "science", "breakthrough", "discovery"],
            "regulation": ["regulation", "policy", "law", "government", "legal", "compliance", "ethics", "safety"],
            "healthcare": ["health", "medical", "healthcare", "diagnosis", "treatment", "patient", "clinical", "pharma"],
            "finance": ["finance", "fintech", "banking", "trading", "payment", "crypto", "blockchain", "financial"],
            "education": ["education", "learning", "training", "course", "student", "teacher", "school", "university"],
            "entertainment": ["entertainment", "gaming", "media", "content", "creative", "art", "music", "video"],
            "automotive": ["automotive", "car", "vehicle", "autonomous", "self-driving", "transport", "mobility"],
            "security": ["security", "cybersecurity", "privacy", "data protection", "breach", "threat", "safety"]
        }
        
        # Load existing data
        self._load_storage_data()
    
    def _load_storage_data(self):
        """Load processed articles from storage file."""
        try:
            if self.storage_file.exists():
                with open(self.storage_file, 'r') as f:
                    data = json.load(f)
                    self.processed_articles = set(data.get('processed_articles', []))
                    logger.info(f"📚 Loaded {len(self.processed_articles)} previously processed articles")
            else:
                logger.info("🆕 No existing news data found, starting fresh")
        except Exception as e:
            logger.warning(f"⚠️ Could not load news data: {e}")
            self.processed_articles = set()
    
    def _save_storage_data(self):
        """Save processed articles to storage file."""
        try:
            data = {
                'processed_articles': list(self.processed_articles),
                'last_updated': datetime.now().isoformat()
            }
            
            with open(self.storage_file, 'w') as f:
                json.dump(data, f, indent=2)
                
            logger.info(f"💾 Saved {len(self.processed_articles)} processed article IDs")
        except Exception as e:
            logger.error(f"❌ Could not save news data: {e}")
    
    async def _rate_limit(self):
        """Enforce rate limiting between requests."""
        current_time = time.time()
        time_since_last = current_time - self.last_request_time
        
        if time_since_last < self.min_request_interval:
            sleep_time = self.min_request_interval - time_since_last
            logger.debug(f"⏱️ Rate limiting: sleeping for {sleep_time:.2f} seconds")
            await asyncio.sleep(sleep_time)
        
        self.last_request_time = time.time()
    
    def _is_ai_related(self, text: str) -> bool:
        """
        Check if article text contains AI-related keywords.
        
        Args:
            text: Article text to check
            
        Returns:
            True if AI-related, False otherwise
        """
        text_lower = text.lower()
        return any(keyword in text_lower for keyword in self.ai_keywords)
    
    def _categorize_article(self, title: str, snippet: str, source: str) -> str:
        """
        Categorize article based on title, snippet, and source.
        
        Args:
            title: Article title
            snippet: Article snippet
            source: News source
            
        Returns:
            Category string
        """
        text = (title + " " + snippet + " " + source).lower()
        
        for category, keywords in self.categories.items():
            if any(keyword in text for keyword in keywords):
                return category
        
        return "general"  # Default category
    
    def _extract_topics(self, title: str, snippet: str) -> List[str]:
        """Extract relevant topics/tags from article information."""
        text = (title + " " + snippet).lower()
        topics = []
        
        # Look for AI-related terms
        for keyword in self.ai_keywords:
            if keyword in text and len(keyword) > 2:  # Skip very short terms
                topics.append(keyword.replace(" ", "_"))
        
        # Look for company names and products
        companies = [
            "openai", "anthropic", "google", "microsoft", "apple", "meta", "amazon",
            "nvidia", "intel", "tesla", "spacex", "deepmind", "facebook", "twitter"
        ]
        for company in companies:
            if company in text:
                topics.append(company)
        
        # Remove duplicates and limit
        return list(set(topics))[:5]
    
    def _process_article_data(self, article_data: Dict[str, Any], position: int) -> Optional[NewsArticle]:
        """
        Process raw article data into a NewsArticle object.
        
        Args:
            article_data: Raw article data dictionary
            position: Position in search results
            
        Returns:
            NewsArticle object or None if invalid/not AI-related
        """
        try:
            # Extract basic fields
            title = article_data.get('title', '').strip()
            snippet = article_data.get('snippet', '').strip()
            link = article_data.get('link', '').strip()
            source = article_data.get('source', '').strip()
            
            if not title or not link:
                return None
            
            # Create article ID from link
            article_id = hashlib.md5(link.encode()).hexdigest()[:16]
            
            # Skip if already processed
            if article_id in self.processed_articles:
                return None
            
            # Check if AI-related
            combined_text = f"{title} {snippet}"
            if not self._is_ai_related(combined_text):
                return None
            
            # Extract date
            date = datetime.now()
            if 'date' in article_data and article_data['date']:
                try:
                    # Parse various date formats
                    date_str = article_data['date']
                    if 'ago' in date_str.lower():
                        # Handle relative dates like "2 hours ago"
                        if 'hour' in date_str:
                            hours = int(''.join(filter(str.isdigit, date_str.split('hour')[0])))
                            date = datetime.now() - timedelta(hours=hours)
                        elif 'day' in date_str:
                            days = int(''.join(filter(str.isdigit, date_str.split('day')[0])))
                            date = datetime.now() - timedelta(days=days)
                        elif 'minute' in date_str:
                            minutes = int(''.join(filter(str.isdigit, date_str.split('minute')[0])))
                            date = datetime.now() - timedelta(minutes=minutes)
                    else:
                        # Try to parse absolute date
                        from dateutil import parser
                        date = parser.parse(date_str)
                        if date.tzinfo:
                            date = date.replace(tzinfo=None)
                except:
                    # Keep current datetime if parsing fails
                    pass
            
            # Categorize and extract topics
            category = self._categorize_article(title, snippet, source)
            topics = self._extract_topics(title, snippet)
            
            article = NewsArticle(
                id=article_id,
                title=title,
                snippet=snippet,
                link=link,
                source=source,
                date=date,
                position=position,
                category=category,
                topics=topics
            )
            
            # Mark as processed
            self.processed_articles.add(article_id)
            
            return article
            
        except Exception as e:
            logger.debug(f"⚠️ Error processing article data: {e}")
            return None
    
    async def fetch_new_list(self, query: str = "AI", max_articles: int = 20) -> List[Dict[str, Any]]:
        """
        Fetch new AI-related news articles from Google News.
        
        Args:
            query: Search query for news
            max_articles: Maximum number of articles to fetch
            
        Returns:
            List of new article dictionaries compatible with existing sharing system
        """
        logger.info(f"🔍 Fetching new AI news from Google News (query: '{query}', max: {max_articles})")
        new_articles = []
        
        try:
            await self._rate_limit()
            
            # Prepare API request
            payload = {
                "q": query,
                "num": min(max_articles * 2, 100)  # Fetch more to account for filtering
            }
            
            logger.info("📡 Making request to Google News API...")
            
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    self.api_url, 
                    headers=self.headers, 
                    json=payload,
                    timeout=aiohttp.ClientTimeout(total=30)
                ) as response:
                    
                    if response.status == 200:
                        data = await response.json()
                        
                        # Extract news articles
                        news_articles = data.get('news', [])
                        logger.info(f"📥 Received {len(news_articles)} articles from Google News")
                        
                        # Process each article
                        processed_count = 0
                        for i, article_data in enumerate(news_articles):
                            if processed_count >= max_articles:
                                break
                            
                            article = self._process_article_data(article_data, i + 1)
                            if article:
                                # Convert to format compatible with existing sharing system
                                article_dict = {
                                    "id": article.id,
                                    "title": article.title,
                                    "summary": article.snippet,
                                    "category": article.category,
                                    "source": f"Google News ({article.source})",
                                    "url": article.link,
                                    "image_url": None,  # Google News API doesn't provide images
                                    "tags": article.topics,
                                    "timestamp": article.date,
                                    "position": article.position,
                                    "hash": article.id
                                }
                                
                                new_articles.append(article_dict)
                                processed_count += 1
                                
                                logger.info(f"✅ Added AI news: {article.title[:60]}... (#{article.position})")
                        
                        # Sort by position (relevance)
                        new_articles.sort(key=lambda x: x.get('position', 999))
                        
                    elif response.status == 401:
                        logger.error("❌ API authentication failed - check your Serper API key")
                        return []
                    elif response.status == 429:
                        logger.warning("⏰ Rate limit exceeded - please wait before making more requests")
                        return []
                    else:
                        logger.warning(f"⚠️ API request failed with status {response.status}")
                        error_text = await response.text()
                        logger.debug(f"Error response: {error_text}")
                        return []
            
            # Save tracking data
            if new_articles:
                self._save_storage_data()
            
            logger.info(f"🎯 Google News fetch complete: {len(new_articles)} new AI articles")
            return new_articles
            
        except asyncio.TimeoutError:
            logger.error("⏰ Request to Google News API timed out")
            return []
        except Exception as e:
            logger.error(f"❌ Error fetching news from Google News: {e}")
            return []
    
    def get_stats(self) -> Dict[str, Any]:
        """
        Get statistics about the news fetcher.
        
        Returns:
            Dictionary with statistics
        """
        return {
            'processed_articles_count': len(self.processed_articles),
            'storage_file': str(self.storage_file),
            'last_fetch_exists': self.storage_file.exists(),
            'api_configured': bool(self.api_key)
        }
    
    def reset_tracking(self):
        """Reset all tracking data and start fresh."""
        self.processed_articles.clear()
        if self.storage_file.exists():
            self.storage_file.unlink()
        logger.info("🔄 Reset Google News tracking data - starting fresh")


# Example usage and testing
async def main():
    """Example usage of the GoogleNewsFetcher class."""
    # Enable logging for testing
    logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')
    
    print("🚀 Google News Fetcher Example")
    print("=" * 50)
    
    # API key from the example
    api_key = "53f66cade9c650fe1f44b92dff2f0854ee4b83b4"
    
    # Create news fetcher
    news_fetcher = GoogleNewsFetcher(api_key=api_key)
    
    # Print current stats
    stats = news_fetcher.get_stats()
    print(f"📊 Current stats: {stats['processed_articles_count']} processed articles")
    print(f"🔑 API configured: {stats['api_configured']}")
    
    try:
        # Fetch new articles
        print("\n🔍 Fetching new AI news from Google News...")
        new_articles = await news_fetcher.fetch_new_list(query="AI", max_articles=10)
        
        if new_articles:
            print(f"\n✅ Found {len(new_articles)} new AI articles:")
            print("-" * 50)
            
            for i, article in enumerate(new_articles, 1):
                print(f"{i}. 📰 {article['title']}")
                print(f"   📝 {article['summary'][:100]}{'...' if len(article['summary']) > 100 else ''}")
                print(f"   🏷️ Category: {article['category']} | 📍 Position: #{article['position']}")
                print(f"   📊 Source: {article['source']}")
                print(f"   🔗 URL: {article['url']}")
                print(f"   📅 Date: {article['timestamp']}")
                if article.get('tags'):
                    print(f"   🏷️ Tags: {', '.join(article['tags'][:3])}")
                print()
        else:
            print("ℹ️ No new AI articles found (all articles have been processed before or API issue)")
            
        # Print updated stats
        updated_stats = news_fetcher.get_stats()
        print(f"\n📊 Updated stats: {updated_stats['processed_articles_count']} processed articles")
        
    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    # Run the example
    asyncio.run(main())