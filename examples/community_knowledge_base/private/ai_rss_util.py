#!/usr/bin/env python3
"""
AI News RSS Utility for Community Knowledge Base

This module provides an AINewsRSS class that can discover RSS feeds from various AI news sources,
track processed posts, and aggregate new posts from multiple feeds to avoid duplicates.

Features:
- Automatic RSS feed discovery from known AI news sources
- Multi-feed aggregation with deduplication
- Persistent tracking of processed posts
- Content filtering and categorization
- Rate limiting and error handling
"""

import asyncio
import json
import logging
import aiohttp
import xml.etree.ElementTree as ET
import re
import hashlib
import time
from datetime import datetime, timedelta
from typing import Dict, List, Set, Optional, Any, Tuple
from pathlib import Path
from urllib.parse import urljoin, urlparse, urlencode
from dataclasses import dataclass

# Configure logging
logger = logging.getLogger(__name__)

@dataclass
class RSSSource:
    """Represents an RSS feed source"""
    name: str
    url: str
    description: str = ""
    category: str = "general"
    last_checked: Optional[datetime] = None
    is_active: bool = True
    error_count: int = 0

@dataclass
class NewsPost:
    """Represents a news post from RSS feeds"""
    id: str
    title: str
    url: str
    summary: str
    source: str
    category: str
    published: datetime
    tags: List[str]
    image_url: Optional[str] = None


class AINewsRSS:
    """
    AI News RSS aggregator class that discovers and monitors multiple RSS feeds
    for AI-related news and research updates.
    
    This class handles:
    - Discovery of active RSS feeds from AI news sources
    - Aggregation of posts from multiple feeds
    - Deduplication and tracking of processed posts
    - Content filtering and categorization
    """
    
    def __init__(self, storage_file: str = "/tmp/ai_rss_feeds_data.json"):
        """
        Initialize the AI News RSS aggregator.
        
        Args:
            storage_file: File to store feed sources and processed post tracking
        """
        self.storage_file = Path(storage_file)
        
        # RSS feed sources
        self.rss_sources: Dict[str, RSSSource] = {}
        
        # Track processed posts to avoid duplicates
        self.processed_posts: Set[str] = set()
        
        # Rate limiting
        self.last_request_time = {}
        self.min_request_interval = 3  # Minimum 3 seconds between requests per source
        
        # Load RSS feeds from feeds.txt file
        self.feeds_file = Path(__file__).parent / "feeds.txt"
        self.known_ai_sources = self._load_feeds_from_file()
        
        # Verification results cache
        self.verification_cache_file = Path(storage_file).parent / "rss_verification_cache.json"
        self.verified_feeds = self._load_verification_cache()
        
        # Content categories for classification
        self.categories = {
            "research": ["research", "paper", "study", "arxiv", "academic", "university"],
            "product": ["launch", "release", "product", "announce", "available"],
            "news": ["news", "update", "development", "breakthrough"],
            "tutorial": ["tutorial", "guide", "how-to", "learn", "course"],
            "tools": ["tool", "framework", "library", "api", "platform"],
            "ethics": ["ethics", "bias", "fairness", "responsible", "safety"],
            "business": ["funding", "investment", "acquisition", "ipo", "market"]
        }
        
        # AI-related keywords for content filtering
        self.ai_keywords = [
            "artificial intelligence", "machine learning", "deep learning", "neural network",
            "transformer", "llm", "large language model", "gpt", "bert", "generative ai",
            "computer vision", "nlp", "natural language processing", "reinforcement learning",
            "openai", "anthropic", "google ai", "deepmind", "meta ai", "microsoft ai",
            "chatbot", "ai model", "algorithm", "automation", "robotics", "ai research"
        ]
        
        # Load existing data
        self._load_storage_data()
    
    def _load_feeds_from_file(self) -> Dict[str, str]:
        """Load RSS feed URLs from feeds.txt file."""
        feeds_dict = {}
        
        try:
            if self.feeds_file.exists():
                with open(self.feeds_file, 'r') as f:
                    lines = f.readlines()
                
                for i, line in enumerate(lines, 1):
                    url = line.strip()
                    if url and not url.startswith('#'):  # Skip empty lines and comments
                        # Generate a name for the feed based on domain
                        try:
                            from urllib.parse import urlparse
                            domain = urlparse(url).netloc
                            # Clean up common patterns
                            if domain.startswith('www.'):
                                domain = domain[4:]
                            name = f"Feed #{i} ({domain})"
                            feeds_dict[name] = url
                        except:
                            feeds_dict[f"Feed #{i}"] = url
                
                logger.info(f"📚 Loaded {len(feeds_dict)} RSS feeds from {self.feeds_file}")
            else:
                logger.warning(f"⚠️ Feeds file not found: {self.feeds_file}")
                # Fallback to default sources
                feeds_dict = {
                    "TechCrunch AI": "https://techcrunch.com/tag/artificial-intelligence/feed/",
                    "VentureBeat AI": "https://venturebeat.com/ai/feed/",
                    "AI News": "https://artificialintelligence-news.com/feed/",
                    "The Verge AI": "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml",
                    "OpenAI Blog": "https://openai.com/blog/rss/",
                }
                
        except Exception as e:
            logger.error(f"❌ Error loading feeds from file: {e}")
            feeds_dict = {}
        
        return feeds_dict
    
    def _load_verification_cache(self) -> Dict[str, Dict[str, Any]]:
        """Load RSS feed verification cache."""
        try:
            if self.verification_cache_file.exists():
                with open(self.verification_cache_file, 'r') as f:
                    cache = json.load(f)
                    logger.info(f"📋 Loaded verification cache for {len(cache)} feeds")
                    return cache
            else:
                logger.info("🆕 No verification cache found, starting fresh")
                return {}
        except Exception as e:
            logger.warning(f"⚠️ Could not load verification cache: {e}")
            return {}
    
    def _save_verification_cache(self):
        """Save RSS feed verification cache."""
        try:
            # Ensure directory exists
            self.verification_cache_file.parent.mkdir(parents=True, exist_ok=True)
            
            with open(self.verification_cache_file, 'w') as f:
                json.dump(self.verified_feeds, f, indent=2)
            
            logger.info(f"💾 Saved verification cache for {len(self.verified_feeds)} feeds")
        except Exception as e:
            logger.error(f"❌ Could not save verification cache: {e}")
    
    async def _verify_feed(self, url: str, name: str) -> Dict[str, Any]:
        """
        Verify if an RSS feed is working and get its metadata.
        
        Args:
            url: RSS feed URL
            name: Feed name
            
        Returns:
            Dictionary with verification results
        """
        result = {
            "url": url,
            "name": name,
            "is_working": False,
            "last_verified": datetime.now().isoformat(),
            "error": None,
            "posts_count": 0,
            "title": None,
            "description": None
        }
        
        try:
            # Fetch RSS content
            rss_content = await self._fetch_rss_content(url)
            
            if rss_content:
                # Try to parse and validate
                posts = self._parse_rss_feed(rss_content, name)
                
                # Extract feed metadata
                try:
                    import xml.etree.ElementTree as ET
                    root = ET.fromstring(rss_content)
                    
                    # Get feed title and description
                    if root.tag == 'rss':
                        channel = root.find('.//channel')
                        if channel is not None:
                            title_elem = channel.find('title')
                            desc_elem = channel.find('description')
                            result["title"] = title_elem.text if title_elem is not None else None
                            result["description"] = desc_elem.text if desc_elem is not None else None
                    elif root.tag.endswith('feed'):
                        title_elem = root.find('.//{http://www.w3.org/2005/Atom}title')
                        subtitle_elem = root.find('.//{http://www.w3.org/2005/Atom}subtitle')
                        result["title"] = title_elem.text if title_elem is not None else None
                        result["description"] = subtitle_elem.text if subtitle_elem is not None else None
                        
                except Exception as parse_error:
                    logger.debug(f"⚠️ Could not extract metadata for {url}: {parse_error}")
                
                result["is_working"] = True
                result["posts_count"] = len(posts)
                logger.info(f"✅ Verified feed: {name} ({len(posts)} posts)")
                
            else:
                result["error"] = "Failed to fetch content"
                logger.warning(f"❌ Feed verification failed: {name} - {url}")
                
        except Exception as e:
            result["error"] = str(e)
            logger.warning(f"❌ Feed verification error: {name} - {e}")
        
        return result
    
    def _load_storage_data(self):
        """Load RSS sources and processed posts from storage file."""
        try:
            if self.storage_file.exists():
                with open(self.storage_file, 'r') as f:
                    data = json.load(f)
                    
                    # Load RSS sources
                    sources_data = data.get('rss_sources', {})
                    for source_id, source_info in sources_data.items():
                        self.rss_sources[source_id] = RSSSource(
                            name=source_info['name'],
                            url=source_info['url'],
                            description=source_info.get('description', ''),
                            category=source_info.get('category', 'general'),
                            last_checked=datetime.fromisoformat(source_info['last_checked']) if source_info.get('last_checked') else None,
                            is_active=source_info.get('is_active', True),
                            error_count=source_info.get('error_count', 0)
                        )
                    
                    # Load processed posts
                    self.processed_posts = set(data.get('processed_posts', []))
                    
                    logger.info(f"📚 Loaded {len(self.rss_sources)} RSS sources and {len(self.processed_posts)} processed posts")
            else:
                logger.info("🆕 No existing RSS data found, starting fresh")
        except Exception as e:
            logger.warning(f"⚠️ Could not load RSS data: {e}")
            self.rss_sources = {}
            self.processed_posts = set()
    
    def _save_storage_data(self):
        """Save RSS sources and processed posts to storage file."""
        try:
            # Prepare sources data for serialization
            sources_data = {}
            for source_id, source in self.rss_sources.items():
                sources_data[source_id] = {
                    'name': source.name,
                    'url': source.url,
                    'description': source.description,
                    'category': source.category,
                    'last_checked': source.last_checked.isoformat() if source.last_checked else None,
                    'is_active': source.is_active,
                    'error_count': source.error_count
                }
            
            data = {
                'rss_sources': sources_data,
                'processed_posts': list(self.processed_posts),
                'last_updated': datetime.now().isoformat()
            }
            
            with open(self.storage_file, 'w') as f:
                json.dump(data, f, indent=2)
                
            logger.info(f"💾 Saved {len(self.rss_sources)} RSS sources and {len(self.processed_posts)} processed posts")
        except Exception as e:
            logger.error(f"❌ Could not save RSS data: {e}")
    
    async def _rate_limit(self, source_url: str):
        """Enforce rate limiting for RSS requests."""
        current_time = time.time()
        last_time = self.last_request_time.get(source_url, 0)
        
        if current_time - last_time < self.min_request_interval:
            sleep_time = self.min_request_interval - (current_time - last_time)
            logger.debug(f"⏱️ Rate limiting {source_url}: sleeping for {sleep_time:.2f} seconds")
            await asyncio.sleep(sleep_time)
        
        self.last_request_time[source_url] = time.time()
    
    async def _fetch_rss_content(self, url: str) -> Optional[str]:
        """
        Fetch RSS content from URL with error handling and rate limiting.
        
        Args:
            url: RSS feed URL
            
        Returns:
            RSS content as string or None if failed
        """
        try:
            await self._rate_limit(url)
            
            headers = {
                'User-Agent': 'Mozilla/5.0 (compatible; AINewsRSS/1.0; +http://openagents.ai)',
                'Accept': 'application/rss+xml, application/xml, text/xml, */*',
            }
            
            async with aiohttp.ClientSession() as session:
                async with session.get(url, headers=headers, timeout=aiohttp.ClientTimeout(total=15)) as response:
                    if response.status == 200:
                        return await response.text()
                    else:
                        logger.warning(f"⚠️ Failed to fetch {url}: HTTP {response.status}")
                        return None
                        
        except asyncio.TimeoutError:
            logger.warning(f"⏰ Timeout fetching {url}")
            return None
        except Exception as e:
            logger.warning(f"⚠️ Error fetching {url}: {e}")
            return None
    
    def _parse_rss_feed(self, rss_content: str, source_name: str) -> List[NewsPost]:
        """
        Parse RSS content and extract news posts.
        
        Args:
            rss_content: RSS XML content
            source_name: Name of the RSS source
            
        Returns:
            List of NewsPost objects
        """
        posts = []
        
        try:
            root = ET.fromstring(rss_content)
            
            # Handle both RSS and Atom feeds
            items = root.findall('.//item') or root.findall('.//{http://www.w3.org/2005/Atom}entry')
            
            for item in items:
                try:
                    # Extract title
                    title_elem = item.find('title')
                    if title_elem is None:
                        title_elem = item.find('.//{http://www.w3.org/2005/Atom}title')
                    if title_elem is None or not title_elem.text:
                        continue
                    title = title_elem.text.strip()
                    
                    # Extract link/URL
                    link_elem = item.find('link')
                    if link_elem is None:
                        link_elem = item.find('.//{http://www.w3.org/2005/Atom}link')
                    if link_elem is None:
                        continue
                    
                    if hasattr(link_elem, 'get') and link_elem.get('href'):
                        # Atom format
                        url = link_elem.get('href')
                    else:
                        # RSS format
                        url = link_elem.text if link_elem.text else ''
                    
                    if not url or not url.startswith('http'):
                        continue
                    
                    # Extract description/summary
                    desc_elem = item.find('description')
                    if desc_elem is None:
                        desc_elem = item.find('.//{http://www.w3.org/2005/Atom}summary')
                    if desc_elem is None:
                        desc_elem = item.find('.//{http://www.w3.org/2005/Atom}content')
                    
                    summary = ""
                    if desc_elem is not None and desc_elem.text:
                        summary = desc_elem.text.strip()
                        # Clean HTML tags
                        summary = re.sub(r'<[^>]+>', '', summary)
                        summary = re.sub(r'\s+', ' ', summary)
                        if len(summary) > 500:
                            summary = summary[:500] + "..."
                    
                    # Extract publication date
                    pub_date_elem = item.find('pubDate')
                    if pub_date_elem is None:
                        pub_date_elem = item.find('.//{http://www.w3.org/2005/Atom}published')
                    if pub_date_elem is None:
                        pub_date_elem = item.find('.//{http://www.w3.org/2005/Atom}updated')
                    
                    published = datetime.now()
                    if pub_date_elem is not None and pub_date_elem.text:
                        try:
                            # Try parsing different date formats
                            date_str = pub_date_elem.text.strip()
                            if 'T' in date_str:
                                # ISO format
                                published = datetime.fromisoformat(date_str.replace('Z', '+00:00'))
                                # Convert to naive datetime for consistency
                                if published.tzinfo is not None:
                                    published = published.replace(tzinfo=None)
                            else:
                                # Try RFC format
                                from email.utils import parsedate_to_datetime
                                parsed_date = parsedate_to_datetime(date_str)
                                # Convert to naive datetime for consistency
                                if parsed_date.tzinfo is not None:
                                    published = parsed_date.replace(tzinfo=None)
                                else:
                                    published = parsed_date
                        except:
                            pass  # Use default datetime.now()
                    
                    # Generate unique ID
                    post_id = hashlib.md5((url + title).encode()).hexdigest()
                    
                    # Skip if already processed
                    if post_id in self.processed_posts:
                        continue
                    
                    # Filter for AI-related content
                    content_text = (title + " " + summary).lower()
                    if not any(keyword in content_text for keyword in self.ai_keywords):
                        continue
                    
                    # Categorize content
                    category = self._categorize_content(title, summary)
                    
                    # Extract tags
                    tags = self._extract_tags(title, summary)
                    
                    # Try to extract image URL
                    image_url = self._extract_image_url(item)
                    
                    post = NewsPost(
                        id=post_id,
                        title=title,
                        url=url,
                        summary=summary,
                        source=source_name,
                        category=category,
                        published=published,
                        tags=tags,
                        image_url=image_url
                    )
                    
                    posts.append(post)
                    
                except Exception as e:
                    logger.debug(f"⚠️ Error processing RSS item from {source_name}: {e}")
                    continue
            
        except ET.ParseError as e:
            logger.warning(f"⚠️ Error parsing RSS from {source_name}: {e}")
        except Exception as e:
            logger.warning(f"⚠️ Unexpected error parsing RSS from {source_name}: {e}")
        
        return posts
    
    def _categorize_content(self, title: str, summary: str) -> str:
        """Categorize content based on title and summary."""
        text = (title + " " + summary).lower()
        
        for category, keywords in self.categories.items():
            if any(keyword in text for keyword in keywords):
                return category
        
        return "news"  # Default category
    
    def _extract_tags(self, title: str, summary: str) -> List[str]:
        """Extract relevant tags from title and summary."""
        text = (title + " " + summary).lower()
        tags = []
        
        # Look for AI-related terms
        for keyword in self.ai_keywords:
            if keyword in text:
                tags.append(keyword.replace(" ", "_"))
        
        # Look for company names
        companies = ["openai", "anthropic", "google", "microsoft", "meta", "amazon", "apple", "nvidia"]
        for company in companies:
            if company in text:
                tags.append(company)
        
        # Remove duplicates and limit
        return list(set(tags))[:5]
    
    def _extract_image_url(self, item) -> Optional[str]:
        """Extract image URL from RSS item if available."""
        try:
            # Check for media:thumbnail
            media_thumb = item.find('.//{http://search.yahoo.com/mrss/}thumbnail')
            if media_thumb is not None:
                return media_thumb.get('url')
            
            # Check for enclosure with image type
            enclosure = item.find('enclosure')
            if enclosure is not None:
                enclosure_type = enclosure.get('type', '')
                if enclosure_type.startswith('image/'):
                    return enclosure.get('url')
            
            # Check content for img tags
            content_elem = item.find('content:encoded') or item.find('description')
            if content_elem is not None and content_elem.text:
                img_match = re.search(r'<img[^>]+src="([^"]+)"', content_elem.text)
                if img_match:
                    return img_match.group(1)
                    
        except Exception:
            pass
        
        return None
    
    async def discover(self, max_sources: int = 50, force_reverify: bool = False) -> List[RSSSource]:
        """
        Discover and validate RSS feeds from feeds.txt with verification caching.
        
        Args:
            max_sources: Maximum number of sources to discover and validate
            force_reverify: If True, reverify all feeds regardless of cache
            
        Returns:
            List of discovered and validated RSS sources
        """
        logger.info(f"🔍 Starting RSS feed discovery from feeds.txt (max {max_sources} sources)")
        discovered_sources = []
        verified_count = 0
        
        # Test feeds from feeds.txt
        for source_name, source_url in list(self.known_ai_sources.items())[:max_sources]:
            try:
                source_id = hashlib.md5(source_url.encode()).hexdigest()[:12]
                
                # Check if we already have verification results (unless force reverify)
                if not force_reverify and source_url in self.verified_feeds:
                    verification = self.verified_feeds[source_url]
                    
                    # Check if verification is recent (within 7 days)
                    try:
                        last_verified = datetime.fromisoformat(verification["last_verified"])
                        if (datetime.now() - last_verified).days < 7:
                            if verification["is_working"]:
                                # Use cached verification result
                                category = self._determine_category_from_url(source_url, source_name)
                                
                                source = RSSSource(
                                    name=verification.get("title") or source_name,
                                    url=source_url,
                                    description=verification.get("description") or f"AI content from {source_name}",
                                    category=category,
                                    last_checked=datetime.now(),
                                    is_active=True,
                                    error_count=0
                                )
                                
                                self.rss_sources[source_id] = source
                                discovered_sources.append(source)
                                
                                logger.info(f"✅ Using cached verification: {source_name} (working)")
                                continue
                            else:
                                logger.info(f"⚠️ Skipping cached non-working feed: {source_name}")
                                continue
                    except:
                        # Invalid cache entry, verify again
                        pass
                
                # Verify the feed
                logger.info(f"🧪 Verifying RSS feed: {source_name}")
                verification = await self._verify_feed(source_url, source_name)
                verified_count += 1
                
                # Cache the verification result
                self.verified_feeds[source_url] = verification
                
                if verification["is_working"]:
                    category = self._determine_category_from_url(source_url, source_name)
                    
                    source = RSSSource(
                        name=verification.get("title") or source_name,
                        url=source_url,
                        description=verification.get("description") or f"AI content from {source_name}",
                        category=category,
                        last_checked=datetime.now(),
                        is_active=True,
                        error_count=0
                    )
                    
                    self.rss_sources[source_id] = source
                    discovered_sources.append(source)
                    
                    logger.info(f"✅ Verified RSS feed: {source_name} ({verification['posts_count']} posts)")
                else:
                    logger.warning(f"❌ RSS feed not working: {source_name} - {verification.get('error', 'Unknown error')}")
                
                # Small delay between requests to be respectful
                await asyncio.sleep(2)
                
                # Save cache every 10 verifications
                if verified_count % 10 == 0:
                    self._save_verification_cache()
                
            except Exception as e:
                logger.warning(f"⚠️ Error discovering {source_name}: {e}")
                continue
        
        # Save all caches and discovered sources
        if discovered_sources:
            self._save_storage_data()
        
        if verified_count > 0:
            self._save_verification_cache()
        
        working_feeds = len(discovered_sources)
        total_feeds = len(self.known_ai_sources)
        
        logger.info(f"🎯 Discovery complete: {working_feeds}/{total_feeds} feeds working, {verified_count} newly verified")
        return discovered_sources
    
    def _determine_category_from_url(self, url: str, name: str) -> str:
        """Determine category based on URL and name patterns."""
        url_lower = (url + " " + name).lower()
        
        if any(term in url_lower for term in ["arxiv", "research", "academic", "paper", "mit", "university"]):
            return "research"
        elif any(term in url_lower for term in ["blog", "personal", "medium"]):
            return "blog"
        elif any(term in url_lower for term in ["tech", "technology", "wired", "verge"]):
            return "tech"
        elif any(term in url_lower for term in ["news", "bbc", "cnn", "reuters"]):
            return "news"
        else:
            return "news"
    
    async def get_new_posts(self, max_posts_per_source: int = 20) -> List[Dict[str, Any]]:
        """
        Check all active RSS feeds and return new posts.
        
        Args:
            max_posts_per_source: Maximum posts to process per RSS source
            
        Returns:
            List of new post dictionaries compatible with existing sharing system
        """
        if not self.rss_sources:
            logger.warning("📭 No RSS sources available. Run discover() first.")
            return []
        
        logger.info(f"📡 Checking {len(self.rss_sources)} RSS sources for new posts...")
        all_new_posts = []
        
        for source_id, source in self.rss_sources.items():
            if not source.is_active:
                continue
            
            try:
                logger.debug(f"🔍 Checking {source.name}")
                
                # Fetch RSS content
                rss_content = await self._fetch_rss_content(source.url)
                if not rss_content:
                    source.error_count += 1
                    if source.error_count > 5:
                        source.is_active = False
                        logger.warning(f"⚠️ Deactivated {source.name} due to repeated failures")
                    continue
                
                # Parse posts
                posts = self._parse_rss_feed(rss_content, source.name)
                
                if posts:
                    # Limit posts per source and convert to compatible format
                    new_posts_from_source = posts[:max_posts_per_source]
                    
                    for post in new_posts_from_source:
                        # Convert to format compatible with existing sharing system
                        article = {
                            "id": post.id,
                            "title": post.title,
                            "summary": post.summary,
                            "category": post.category,
                            "source": f"RSS: {post.source}",
                            "url": post.url,
                            "image_url": post.image_url,
                            "tags": post.tags,
                            "timestamp": post.published,
                            "hash": post.id
                        }
                        
                        all_new_posts.append(article)
                        # Mark as processed
                        self.processed_posts.add(post.id)
                    
                    logger.info(f"📰 Found {len(new_posts_from_source)} new posts from {source.name}")
                
                # Update source status
                source.last_checked = datetime.now()
                source.error_count = 0  # Reset error count on success
                
                # Small delay between sources
                await asyncio.sleep(0.5)
                
            except Exception as e:
                logger.warning(f"⚠️ Error processing {source.name}: {e}")
                source.error_count += 1
                continue
        
        # Sort posts by publication date (newest first)
        all_new_posts.sort(key=lambda x: x['timestamp'], reverse=True)
        
        # Save updated data
        if all_new_posts:
            self._save_storage_data()
        
        logger.info(f"✅ RSS aggregation complete: {len(all_new_posts)} total new posts")
        return all_new_posts
    
    def get_stats(self) -> Dict[str, Any]:
        """
        Get statistics about the RSS aggregator.
        
        Returns:
            Dictionary with statistics
        """
        active_sources = sum(1 for source in self.rss_sources.values() if source.is_active)
        
        return {
            'total_sources': len(self.rss_sources),
            'active_sources': active_sources,
            'inactive_sources': len(self.rss_sources) - active_sources,
            'processed_posts_count': len(self.processed_posts),
            'storage_file': str(self.storage_file),
            'sources': {
                source_id: {
                    'name': source.name,
                    'category': source.category,
                    'is_active': source.is_active,
                    'error_count': source.error_count,
                    'last_checked': source.last_checked.isoformat() if source.last_checked else None
                }
                for source_id, source in self.rss_sources.items()
            }
        }
    
    def reset_tracking(self):
        """Reset all tracking data and start fresh."""
        self.processed_posts.clear()
        self.rss_sources.clear()
        if self.storage_file.exists():
            self.storage_file.unlink()
        logger.info("🔄 Reset RSS tracking data - starting fresh")


# Example usage and testing
async def main():
    """Example usage of the AINewsRSS class."""
    # Enable logging for testing
    logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')
    
    print("🚀 AI News RSS Aggregator Example")
    print("=" * 50)
    
    # Create RSS aggregator
    rss_aggregator = AINewsRSS()
    
    # Print current stats
    stats = rss_aggregator.get_stats()
    print(f"📊 Current stats: {stats['total_sources']} sources, {stats['processed_posts_count']} processed posts")
    
    try:
        # Discover RSS feeds if we don't have many
        if stats['active_sources'] < 5:
            print("\n🔍 Discovering RSS feeds...")
            discovered = await rss_aggregator.discover(max_sources=10)
            print(f"✅ Discovered {len(discovered)} RSS sources")
        
        # Get new posts from all sources
        print("\n📡 Fetching new posts from all RSS sources...")
        new_posts = await rss_aggregator.get_new_posts(max_posts_per_source=5)
        
        if new_posts:
            print(f"\n✅ Found {len(new_posts)} total new posts:")
            print("-" * 50)
            
            for i, post in enumerate(new_posts[:5], 1):  # Show first 5
                print(f"{i}. 📰 {post['title']}")
                print(f"   🏷️ Category: {post['category']} | 📰 Source: {post['source']}")
                print(f"   🔗 URL: {post['url']}")
                if post.get('image_url'):
                    print(f"   📷 Image: {post['image_url']}")
                print(f"   ⏰ Published: {post['timestamp'].strftime('%Y-%m-%d %H:%M')}")
                if post['tags']:
                    print(f"   🏷️ Tags: {', '.join(post['tags'])}")
                print()
            
            if len(new_posts) > 5:
                print(f"... and {len(new_posts) - 5} more posts")
        else:
            print("ℹ️ No new posts found (all posts have been processed before)")
            
        # Print updated stats
        updated_stats = rss_aggregator.get_stats()
        print(f"\n📊 Final stats: {updated_stats['active_sources']} active sources, {updated_stats['processed_posts_count']} processed posts")
        
    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    # Run the example
    asyncio.run(main())