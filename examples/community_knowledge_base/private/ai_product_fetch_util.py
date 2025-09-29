#!/usr/bin/env python3
"""
AI Product Fetcher Utility for Community Knowledge Base

This module provides an AIProductFetcher class that monitors Product Hunt for new AI products,
tracks processed products, and fetches product information with descriptions and links.

Features:
- Product Hunt API integration for fetching new AI products
- Content filtering for AI-related products
- Persistent tracking of processed products
- Product categorization and tagging
- Rate limiting and error handling
"""

import asyncio
import json
import logging
import aiohttp
import re
import hashlib
import time
from datetime import datetime, timedelta
from typing import Dict, List, Set, Optional, Any
from pathlib import Path
from urllib.parse import urljoin, urlparse
from dataclasses import dataclass

# Configure logging
logger = logging.getLogger(__name__)

@dataclass
class Product:
    """Represents a product from Product Hunt"""
    id: str
    name: str
    tagline: str
    description: str
    url: str
    product_hunt_url: str
    image_url: Optional[str]
    votes: int
    comments_count: int
    created_at: datetime
    maker: str
    topics: List[str]
    category: str


class AIProductFetcher:
    """
    AI Product fetcher class that monitors Product Hunt for new AI-related products.
    
    This class handles:
    - Fetching products from Product Hunt (via web scraping since API requires auth)
    - Filtering for AI-related products
    - Tracking processed products to avoid duplicates
    - Product categorization and content extraction
    """
    
    def __init__(self, storage_file: str = "/tmp/ai_product_hunt_data.json"):
        """
        Initialize the AI Product fetcher.
        
        Args:
            storage_file: File to store processed product tracking
        """
        self.storage_file = Path(storage_file)
        
        # Track processed products to avoid duplicates
        self.processed_products: Set[str] = set()
        
        # Rate limiting
        self.last_request_time = 0
        self.min_request_interval = 5  # Minimum 5 seconds between requests
        
        # Product Hunt URLs
        self.product_hunt_base = "https://www.producthunt.com"
        
        # Request headers to appear as a regular browser with more realistic headers
        self.headers = {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept-Encoding': 'gzip, deflate, br',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache',
            'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
            'Sec-Ch-Ua-Mobile': '?0',
            'Sec-Ch-Ua-Platform': '"macOS"',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Sec-Fetch-User': '?1',
            'Upgrade-Insecure-Requests': '1',
            'Connection': 'keep-alive',
        }
        
        # AI-related keywords for product filtering
        self.ai_keywords = [
            "artificial intelligence", "ai", "machine learning", "ml", "deep learning",
            "neural network", "chatbot", "chat bot", "gpt", "llm", "large language model",
            "natural language", "nlp", "computer vision", "automation", "neural",
            "generative", "openai", "anthropic", "ai-powered", "ai powered",
            "intelligent", "smart assistant", "voice assistant", "conversational ai",
            "predictive", "recommendation engine", "ai tool", "ai platform",
            "automated", "algorithm", "data science", "tensorflow", "pytorch",
            "transformers", "bert", "roberta", "stable diffusion", "midjourney",
            "copilot", "assistant", "bot", "cognitive"
        ]
        
        # Product categories for classification
        self.categories = {
            "productivity": ["productivity", "workflow", "automation", "tool", "assistant"],
            "creative": ["creative", "design", "art", "image", "video", "content", "writing"],
            "business": ["business", "marketing", "sales", "analytics", "crm", "saas"],
            "developer": ["developer", "code", "coding", "programming", "api", "sdk"],
            "healthcare": ["health", "medical", "healthcare", "wellness", "fitness"],
            "education": ["education", "learning", "training", "course", "tutorial"],
            "finance": ["finance", "fintech", "trading", "investment", "crypto"],
            "communication": ["chat", "messaging", "communication", "social", "collaboration"],
            "entertainment": ["game", "gaming", "entertainment", "music", "media"],
            "research": ["research", "academic", "science", "analysis", "data"]
        }
        
        # Load existing data
        self._load_storage_data()
    
    def _load_storage_data(self):
        """Load processed products from storage file."""
        try:
            if self.storage_file.exists():
                with open(self.storage_file, 'r') as f:
                    data = json.load(f)
                    self.processed_products = set(data.get('processed_products', []))
                    logger.info(f"📚 Loaded {len(self.processed_products)} previously processed products")
            else:
                logger.info("🆕 No existing product data found, starting fresh")
        except Exception as e:
            logger.warning(f"⚠️ Could not load product data: {e}")
            self.processed_products = set()
    
    def _save_storage_data(self):
        """Save processed products to storage file."""
        try:
            data = {
                'processed_products': list(self.processed_products),
                'last_updated': datetime.now().isoformat()
            }
            
            with open(self.storage_file, 'w') as f:
                json.dump(data, f, indent=2)
                
            logger.info(f"💾 Saved {len(self.processed_products)} processed product IDs")
        except Exception as e:
            logger.error(f"❌ Could not save product data: {e}")
    
    async def _rate_limit(self):
        """Enforce rate limiting between requests."""
        current_time = time.time()
        time_since_last = current_time - self.last_request_time
        
        if time_since_last < self.min_request_interval:
            sleep_time = self.min_request_interval - time_since_last
            logger.debug(f"⏱️ Rate limiting: sleeping for {sleep_time:.2f} seconds")
            await asyncio.sleep(sleep_time)
        
        self.last_request_time = time.time()
    
    async def _fetch_page_content(self, url: str) -> Optional[str]:
        """
        Fetch page content with error handling and rate limiting.
        
        Args:
            url: URL to fetch
            
        Returns:
            Page content as string or None if failed
        """
        try:
            await self._rate_limit()
            
            # Create session with cookie jar to maintain state
            cookie_jar = aiohttp.CookieJar()
            connector = aiohttp.TCPConnector(limit=30)
            timeout = aiohttp.ClientTimeout(total=30, connect=10)
            
            async with aiohttp.ClientSession(
                cookie_jar=cookie_jar,
                connector=connector,
                timeout=timeout
            ) as session:
                async with session.get(url, headers=self.headers, ssl=False) as response:
                    if response.status == 200:
                        return await response.text()
                    elif response.status == 403:
                        logger.warning(f"🚫 Access forbidden for {url} (403) - trying RSS alternatives")
                        return None
                    elif response.status == 429:
                        logger.warning(f"⏰ Rate limited for {url} (429) - will retry later")
                        await asyncio.sleep(10)
                        return None
                    else:
                        logger.warning(f"⚠️ Failed to fetch {url}: HTTP {response.status}")
                        return None
                        
        except asyncio.TimeoutError:
            logger.warning(f"⏰ Timeout fetching {url}")
            return None
        except Exception as e:
            logger.warning(f"⚠️ Error fetching {url}: {e}")
            return None
    
    async def _fetch_rss_alternative(self, url: str) -> Optional[str]:
        """
        Try to fetch RSS/Atom feeds as alternative data source.
        
        Args:
            url: RSS URL to fetch
            
        Returns:
            RSS content as string or None if failed
        """
        try:
            await self._rate_limit()
            
            # Use simpler headers for RSS feeds
            rss_headers = {
                'User-Agent': 'Mozilla/5.0 (compatible; RSS Reader)',
                'Accept': 'application/rss+xml, application/xml, text/xml',
                'Accept-Language': 'en-US,en;q=0.9'
            }
            
            async with aiohttp.ClientSession() as session:
                async with session.get(url, headers=rss_headers, timeout=aiohttp.ClientTimeout(total=20)) as response:
                    if response.status == 200:
                        return await response.text()
                    else:
                        logger.debug(f"⚠️ RSS fetch failed for {url}: HTTP {response.status}")
                        return None
                        
        except Exception as e:
            logger.debug(f"⚠️ RSS fetch error for {url}: {e}")
            return None
    
    def _is_ai_related(self, text: str) -> bool:
        """
        Check if product text contains AI-related keywords.
        
        Args:
            text: Product text to check
            
        Returns:
            True if AI-related, False otherwise
        """
        text_lower = text.lower()
        return any(keyword in text_lower for keyword in self.ai_keywords)
    
    def _categorize_product(self, name: str, tagline: str, description: str) -> str:
        """
        Categorize product based on name, tagline, and description.
        
        Args:
            name: Product name
            tagline: Product tagline
            description: Product description
            
        Returns:
            Category string
        """
        text = (name + " " + tagline + " " + description).lower()
        
        for category, keywords in self.categories.items():
            if any(keyword in text for keyword in keywords):
                return category
        
        return "general"  # Default category
    
    def _extract_topics(self, name: str, tagline: str, description: str) -> List[str]:
        """Extract relevant topics/tags from product information."""
        text = (name + " " + tagline + " " + description).lower()
        topics = []
        
        # Look for AI-related terms
        for keyword in self.ai_keywords:
            if keyword in text and len(keyword) > 2:  # Skip very short terms
                topics.append(keyword.replace(" ", "_"))
        
        # Look for technology terms
        tech_terms = ["saas", "api", "sdk", "mobile", "web", "ios", "android", "chrome", "plugin"]
        for term in tech_terms:
            if term in text:
                topics.append(term)
        
        # Remove duplicates and limit
        return list(set(topics))[:5]
    
    def _parse_product_hunt_json(self, html_content: str) -> List[Dict[str, Any]]:
        """
        Parse Product Hunt page HTML to extract product data from embedded JSON.
        
        Args:
            html_content: HTML content of Product Hunt page
            
        Returns:
            List of product data dictionaries
        """
        products = []
        
        try:
            # Look for JSON data in script tags
            json_pattern = r'window\.PAGE_DATA\s*=\s*({.+?});'
            matches = re.findall(json_pattern, html_content, re.DOTALL)
            
            if matches:
                json_data = json.loads(matches[0])
                
                # Navigate through the JSON structure to find products
                if 'posts' in json_data:
                    posts = json_data['posts']
                elif 'initialState' in json_data and 'posts' in json_data['initialState']:
                    posts = json_data['initialState']['posts']
                else:
                    # Try alternative structure
                    posts = {}
                    for key, value in json_data.items():
                        if isinstance(value, dict) and 'posts' in value:
                            posts = value['posts']
                            break
                
                if isinstance(posts, dict):
                    for post_id, post_data in posts.items():
                        if isinstance(post_data, dict):
                            products.append(post_data)
                elif isinstance(posts, list):
                    products = posts
                    
        except (json.JSONDecodeError, KeyError, TypeError) as e:
            logger.debug(f"⚠️ Error parsing JSON data: {e}")
            
            # Fallback: try to extract basic product info from HTML
            products = self._parse_product_hunt_html_fallback(html_content)
        
        return products
    
    def _parse_product_hunt_html_fallback(self, html_content: str) -> List[Dict[str, Any]]:
        """
        Fallback HTML parsing when JSON parsing fails.
        
        Args:
            html_content: HTML content
            
        Returns:
            List of product data dictionaries
        """
        products = []
        
        try:
            # Extract product links
            product_pattern = r'<a[^>]+href="(/posts/[^"]+)"[^>]*>([^<]+)</a>'
            product_matches = re.findall(product_pattern, html_content)
            
            for url_path, name in product_matches[:10]:  # Limit to 10 products
                if not name.strip():
                    continue
                
                # Create basic product entry
                product = {
                    'id': hashlib.md5(url_path.encode()).hexdigest()[:12],
                    'name': name.strip(),
                    'slug': url_path.split('/')[-1] if '/' in url_path else url_path,
                    'tagline': '',  # Will be filled if we can extract it
                    'description': '',
                    'votesCount': 0,
                    'commentsCount': 0,
                    'createdAt': datetime.now().isoformat(),
                    'maker': {'name': 'Unknown'},
                    'topics': []
                }
                
                products.append(product)
                
        except Exception as e:
            logger.debug(f"⚠️ Error in HTML fallback parsing: {e}")
        
        return products
    
    def _process_product_data(self, product_data: Dict[str, Any]) -> Optional[Product]:
        """
        Process raw product data into a Product object.
        
        Args:
            product_data: Raw product data dictionary
            
        Returns:
            Product object or None if invalid/not AI-related
        """
        try:
            # Extract basic fields
            product_id = str(product_data.get('id', ''))
            name = product_data.get('name', '').strip()
            tagline = product_data.get('tagline', '').strip()
            
            if not product_id or not name:
                return None
            
            # Skip if already processed
            if product_id in self.processed_products:
                return None
            
            # Extract description (might be in different fields)
            description = (
                product_data.get('description', '') or
                product_data.get('maker_comment', '') or
                tagline
            ).strip()
            
            # Check if AI-related
            combined_text = f"{name} {tagline} {description}"
            if not self._is_ai_related(combined_text):
                return None
            
            # Extract URL
            slug = product_data.get('slug', '')
            if slug:
                product_url = f"https://www.producthunt.com/posts/{slug}"
            else:
                product_url = f"https://www.producthunt.com/posts/{product_id}"
            
            # Extract website URL
            website_url = product_data.get('redirect_url', '') or product_data.get('url', '')
            
            # Extract image
            image_url = None
            if 'thumbnail' in product_data and product_data['thumbnail']:
                thumbnail = product_data['thumbnail']
                if isinstance(thumbnail, dict):
                    image_url = thumbnail.get('image_url')
                else:
                    image_url = str(thumbnail)
            elif 'gallery_images' in product_data and product_data['gallery_images']:
                gallery = product_data['gallery_images']
                if isinstance(gallery, list) and len(gallery) > 0:
                    if isinstance(gallery[0], dict):
                        image_url = gallery[0].get('image_url')
            
            # Extract metrics
            votes = int(product_data.get('votesCount', product_data.get('votes_count', 0)))
            comments_count = int(product_data.get('commentsCount', product_data.get('comments_count', 0)))
            
            # Extract date
            created_at = datetime.now()
            if 'createdAt' in product_data:
                try:
                    created_at = datetime.fromisoformat(product_data['createdAt'].replace('Z', '+00:00'))
                    if created_at.tzinfo is not None:
                        created_at = created_at.replace(tzinfo=None)
                except:
                    pass
            
            # Extract maker
            maker_name = "Unknown"
            if 'maker' in product_data and product_data['maker']:
                maker = product_data['maker']
                if isinstance(maker, dict):
                    maker_name = maker.get('name', 'Unknown')
                elif isinstance(maker, str):
                    maker_name = maker
            elif 'user' in product_data and product_data['user']:
                user = product_data['user']
                if isinstance(user, dict):
                    maker_name = user.get('name', 'Unknown')
            
            # Extract topics
            topics = []
            if 'topics' in product_data and isinstance(product_data['topics'], list):
                topics = [topic.get('name', str(topic)) if isinstance(topic, dict) else str(topic) 
                         for topic in product_data['topics']]
            
            # Add extracted topics from text
            extracted_topics = self._extract_topics(name, tagline, description)
            topics.extend(extracted_topics)
            topics = list(set(topics))[:5]  # Remove duplicates and limit
            
            # Categorize
            category = self._categorize_product(name, tagline, description)
            
            product = Product(
                id=product_id,
                name=name,
                tagline=tagline,
                description=description,
                url=website_url,
                product_hunt_url=product_url,
                image_url=image_url,
                votes=votes,
                comments_count=comments_count,
                created_at=created_at,
                maker=maker_name,
                topics=topics,
                category=category
            )
            
            # Mark as processed
            self.processed_products.add(product_id)
            
            return product
            
        except Exception as e:
            logger.debug(f"⚠️ Error processing product data: {e}")
            return None
    
    async def fetch_new_products(self, max_products: int = 20) -> List[Dict[str, Any]]:
        """
        Fetch new AI products from Product Hunt using multiple strategies.
        
        Args:
            max_products: Maximum number of products to fetch
            
        Returns:
            List of new product dictionaries compatible with existing sharing system
        """
        logger.info(f"🔍 Fetching new AI products from Product Hunt (max {max_products})")
        new_products = []
        
        try:
            # Strategy 1: Try RSS/Atom feeds first (less likely to be blocked)
            logger.info("📡 Trying RSS feeds first...")
            rss_products = await self._fetch_from_rss_feeds()
            new_products.extend(rss_products)
            
            # Strategy 2: Try official API or mobile endpoints
            if len(new_products) < max_products:
                logger.info("📱 Trying mobile/API endpoints...")
                api_products = await self._fetch_from_api_endpoints(max_products - len(new_products))
                new_products.extend(api_products)
            
            # Strategy 3: Web scraping as final fallback
            if len(new_products) < max_products // 2:
                logger.info("🌐 Trying web scraping as fallback...")
                web_products = await self._fetch_from_web_scraping(max_products - len(new_products))
                new_products.extend(web_products)
            
            # Remove duplicates based on ID
            seen_ids = set()
            unique_products = []
            for product in new_products:
                if product['id'] not in seen_ids:
                    seen_ids.add(product['id'])
                    unique_products.append(product)
            
            new_products = unique_products[:max_products]
            
            # Sort by votes (most popular first)
            new_products.sort(key=lambda x: x.get('votes', 0), reverse=True)
            
            # Save tracking data
            if new_products:
                self._save_storage_data()
            
            logger.info(f"🎯 Product Hunt fetch complete: {len(new_products)} new AI products")
            return new_products
            
        except Exception as e:
            logger.error(f"❌ Error fetching products from Product Hunt: {e}")
            return new_products
    
    async def _fetch_from_rss_feeds(self) -> List[Dict[str, Any]]:
        """Fetch products from RSS/Atom feeds and alternative sources."""
        products = []
        
        # Since Product Hunt blocks RSS, let's try alternative tech news sources
        # that often feature AI products and startups
        alternative_sources = [
            {
                "url": "https://techcrunch.com/tag/artificial-intelligence/feed/",
                "name": "TechCrunch AI",
                "type": "ai_focused"
            },
            {
                "url": "https://artificialintelligence-news.com/feed/",
                "name": "AI News",
                "type": "ai_focused"
            },
            {
                "url": "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml",
                "name": "The Verge AI",
                "type": "ai_focused"
            },
            {
                "url": "https://feeds.feedburner.com/oreilly/radar",
                "name": "O'Reilly Radar",
                "type": "tech"
            },
            {
                "url": "https://www.wired.com/feed",
                "name": "Wired",
                "type": "tech"
            },
            {
                "url": "https://feeds.arstechnica.com/arstechnica/index",
                "name": "Ars Technica",
                "type": "tech"
            }
        ]
        
        # Still try Product Hunt RSS first
        ph_rss_urls = [
            "https://www.producthunt.com/feed",
            "https://www.producthunt.com/feed.atom",
            "https://www.producthunt.com/topics/artificial-intelligence/feed"
        ]
        
        for rss_url in ph_rss_urls:
            try:
                rss_content = await self._fetch_rss_alternative(rss_url)
                if rss_content:
                    rss_products = self._parse_rss_content(rss_content)
                    if rss_products:
                        products.extend(rss_products)
                        logger.info(f"✅ Retrieved {len(rss_products)} products from Product Hunt RSS: {rss_url}")
                        break  # Stop on first successful Product Hunt RSS fetch
            except Exception as e:
                logger.debug(f"⚠️ Product Hunt RSS {rss_url} failed: {e}")
                continue
        
        # If Product Hunt RSS failed, try alternative tech sources for AI-related content
        if not products:
            logger.info("📡 Product Hunt RSS blocked, trying alternative tech news sources...")
            
            for source in alternative_sources:
                try:
                    rss_content = await self._fetch_rss_alternative(source["url"])
                    if rss_content:
                        # Parse with AI filtering
                        alt_products = self._parse_tech_news_rss(rss_content, source["name"])
                        products.extend(alt_products)
                        if alt_products:
                            logger.info(f"✅ Retrieved {len(alt_products)} AI-related items from {source['name']}")
                            break  # Stop on first successful alternative source
                except Exception as e:
                    logger.debug(f"⚠️ Alternative source {source['url']} failed: {e}")
                    continue
        
        return products
    
    async def _fetch_from_api_endpoints(self, max_products: int) -> List[Dict[str, Any]]:
        """Try mobile/API endpoints that might be less protected."""
        products = []
        
        # Try mobile API endpoints
        mobile_urls = [
            "https://www.producthunt.com/frontend/graphql",
            "https://api.producthunt.com/v2/api/posts",
            "https://www.producthunt.com/v2/posts"
        ]
        
        # Mobile-specific headers
        mobile_headers = {
            'User-Agent': 'ProductHunt/2.0 CFNetwork/1404.0.5 Darwin/22.3.0',
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        }
        
        for url in mobile_urls:
            try:
                await self._rate_limit()
                async with aiohttp.ClientSession() as session:
                    async with session.get(url, headers=mobile_headers, timeout=aiohttp.ClientTimeout(total=20)) as response:
                        if response.status == 200:
                            content = await response.text()
                            # Try to parse JSON content
                            try:
                                data = json.loads(content)
                                api_products = self._parse_api_response(data)
                                products.extend(api_products[:max_products])
                                logger.info(f"✅ Retrieved {len(api_products)} products from API: {url}")
                                break
                            except json.JSONDecodeError:
                                continue
            except Exception as e:
                logger.debug(f"⚠️ API endpoint {url} failed: {e}")
                continue
        
        return products
    
    async def _fetch_from_web_scraping(self, max_products: int) -> List[Dict[str, Any]]:
        """Traditional web scraping as last resort."""
        products = []
        
        try:
            # Try different pages
            urls_to_try = [
                f"{self.product_hunt_base}/",
                f"{self.product_hunt_base}/topics/artificial-intelligence",
                f"{self.product_hunt_base}/topics/developer-tools"
            ]
            
            for url in urls_to_try:
                logger.info(f"📡 Attempting web scraping: {url}")
                html_content = await self._fetch_page_content(url)
                
                if html_content:
                    # Parse products from the page
                    products_data = self._parse_product_hunt_json(html_content)
                    logger.info(f"📥 Found {len(products_data)} total products on page")
                    
                    # Process each product
                    for product_data in products_data:
                        if len(products) >= max_products:
                            break
                        
                        product = self._process_product_data(product_data)
                        if product:
                            # Convert to format compatible with existing sharing system
                            article = {
                                "id": product.id,
                                "title": product.name,
                                "summary": f"{product.tagline}\n\n{product.description}".strip(),
                                "category": product.category,
                                "source": "Product Hunt",
                                "url": product.url or product.product_hunt_url,
                                "product_hunt_url": product.product_hunt_url,
                                "image_url": product.image_url,
                                "tags": product.topics,
                                "timestamp": product.created_at,
                                "votes": product.votes,
                                "comments_count": product.comments_count,
                                "maker": product.maker,
                                "hash": product.id
                            }
                            
                            products.append(article)
                            logger.info(f"✅ Added AI product: {product.name} ({product.votes} votes)")
                    
                    # If we got products from this page, don't try more pages
                    if products:
                        break
                else:
                    logger.warning(f"⚠️ Failed to fetch content from {url}")
        
        except Exception as e:
            logger.error(f"❌ Web scraping error: {e}")
        
        return products
    
    def _parse_tech_news_rss(self, rss_content: str, source_name: str) -> List[Dict[str, Any]]:
        """Parse tech news RSS content to extract AI-related product mentions."""
        products = []
        
        try:
            import xml.etree.ElementTree as ET
            root = ET.fromstring(rss_content)
            
            # Handle both RSS and Atom formats
            items = []
            if root.tag == 'rss':
                items = root.findall('.//item')
            elif root.tag.endswith('feed'):
                items = root.findall('.//{http://www.w3.org/2005/Atom}entry')
            
            for item in items[:20]:  # Check more items since we're filtering for AI
                try:
                    # Extract basic info
                    title = ''
                    link = ''
                    description = ''
                    pub_date = datetime.now()
                    
                    if root.tag == 'rss':
                        # RSS format
                        title_elem = item.find('title')
                        if title_elem is not None:
                            title = title_elem.text or ''
                        
                        link_elem = item.find('link')
                        if link_elem is not None:
                            link = link_elem.text or ''
                        
                        desc_elem = item.find('description')
                        if desc_elem is not None:
                            description = desc_elem.text or ''
                        
                        # Try to extract content for better AI detection
                        content_elem = item.find('content:encoded', {'content': 'http://purl.org/rss/1.0/modules/content/'})
                        if content_elem is not None and content_elem.text:
                            description = content_elem.text[:1000]  # Limit content
                        
                        date_elem = item.find('pubDate')
                        if date_elem is not None and date_elem.text:
                            try:
                                from email.utils import parsedate_to_datetime
                                pub_date = parsedate_to_datetime(date_elem.text)
                                if pub_date.tzinfo:
                                    pub_date = pub_date.replace(tzinfo=None)
                            except:
                                pass
                    else:
                        # Atom format
                        title_elem = item.find('.//{http://www.w3.org/2005/Atom}title')
                        if title_elem is not None:
                            title = title_elem.text or ''
                        
                        link_elem = item.find('.//{http://www.w3.org/2005/Atom}link[@rel="alternate"]')
                        if link_elem is not None:
                            link = link_elem.get('href', '')
                        
                        desc_elem = item.find('.//{http://www.w3.org/2005/Atom}summary')
                        if desc_elem is not None:
                            description = desc_elem.text or ''
                        
                        content_elem = item.find('.//{http://www.w3.org/2005/Atom}content')
                        if content_elem is not None and content_elem.text:
                            description = content_elem.text[:1000]  # Limit content
                    
                    # Clean HTML from description
                    import re
                    description = re.sub(r'<[^>]+>', ' ', description)
                    description = re.sub(r'\s+', ' ', description).strip()
                    
                    # Check if AI-related and looks like a product/tool announcement
                    combined_text = f"{title} {description}"
                    if (self._is_ai_related(combined_text) and 
                        title and link and
                        any(keyword in combined_text.lower() for keyword in [
                            'launch', 'release', 'announce', 'debut', 'unveil', 'introduce',
                            'platform', 'tool', 'service', 'app', 'startup', 'product'
                        ]) and
                        # More specific AI product filtering
                        any(ai_term in combined_text.lower() for ai_term in [
                            'ai tool', 'ai platform', 'ai service', 'ai app', 'ai startup',
                            'artificial intelligence', 'machine learning', 'neural network',
                            'chatbot', 'gpt', 'llm', 'ai-powered', 'ai powered',
                            'generative ai', 'ai assistant', 'ai copilot', 'ai model'
                        ])):
                        
                        product_id = hashlib.md5(link.encode()).hexdigest()[:12]
                        
                        if product_id not in self.processed_products:
                            category = self._categorize_product(title, '', description)
                            topics = self._extract_topics(title, '', description)
                            
                            # Extract potential product name from title
                            product_title = title
                            # Look for patterns like "Company launches ProductName" -> "ProductName by Company"
                            launch_patterns = [
                                r'(.+?)\s+(?:launches|releases|announces|unveils|introduces)\s+(.+)',
                                r'(.+?):\s*(.+)',
                                r'(.+?)\s+debuts\s+(.+)'
                            ]
                            
                            for pattern in launch_patterns:
                                match = re.match(pattern, title, re.IGNORECASE)
                                if match:
                                    company, product = match.groups()
                                    product_title = f"{product.strip()} by {company.strip()}"
                                    break
                            
                            article = {
                                "id": product_id,
                                "title": product_title,
                                "summary": description[:500] + ('...' if len(description) > 500 else ''),
                                "category": category,
                                "source": f"{source_name} (AI Products)",
                                "url": link,
                                "product_hunt_url": link,  # Use original link since not from PH
                                "image_url": None,
                                "tags": topics + ["tech_news"],
                                "timestamp": pub_date,
                                "votes": 0,
                                "comments_count": 0,
                                "maker": "Tech News",
                                "hash": product_id
                            }
                            
                            products.append(article)
                            self.processed_products.add(product_id)
                
                except Exception as e:
                    logger.debug(f"⚠️ Error parsing tech news item: {e}")
                    continue
        
        except Exception as e:
            logger.debug(f"⚠️ Error parsing tech news RSS content: {e}")
        
        return products
    
    def _parse_rss_content(self, rss_content: str) -> List[Dict[str, Any]]:
        """Parse RSS/Atom content to extract product information."""
        products = []
        
        try:
            # Look for RSS items
            import xml.etree.ElementTree as ET
            root = ET.fromstring(rss_content)
            
            # Handle both RSS and Atom formats
            items = []
            if root.tag == 'rss':
                # RSS format
                items = root.findall('.//item')
            elif root.tag.endswith('feed'):
                # Atom format
                items = root.findall('.//{http://www.w3.org/2005/Atom}entry')
            
            for item in items[:10]:  # Limit to 10 items
                try:
                    # Extract basic info
                    title = ''
                    link = ''
                    description = ''
                    pub_date = datetime.now()
                    
                    if root.tag == 'rss':
                        # RSS format
                        title_elem = item.find('title')
                        if title_elem is not None:
                            title = title_elem.text or ''
                        
                        link_elem = item.find('link')
                        if link_elem is not None:
                            link = link_elem.text or ''
                        
                        desc_elem = item.find('description')
                        if desc_elem is not None:
                            description = desc_elem.text or ''
                        
                        date_elem = item.find('pubDate')
                        if date_elem is not None and date_elem.text:
                            try:
                                from email.utils import parsedate_to_datetime
                                pub_date = parsedate_to_datetime(date_elem.text)
                                if pub_date.tzinfo:
                                    pub_date = pub_date.replace(tzinfo=None)
                            except:
                                pass
                    else:
                        # Atom format
                        title_elem = item.find('.//{http://www.w3.org/2005/Atom}title')
                        if title_elem is not None:
                            title = title_elem.text or ''
                        
                        link_elem = item.find('.//{http://www.w3.org/2005/Atom}link[@rel="alternate"]')
                        if link_elem is not None:
                            link = link_elem.get('href', '')
                        
                        desc_elem = item.find('.//{http://www.w3.org/2005/Atom}summary')
                        if desc_elem is not None:
                            description = desc_elem.text or ''
                    
                    if title and link and self._is_ai_related(f"{title} {description}"):
                        product_id = hashlib.md5(link.encode()).hexdigest()[:12]
                        
                        if product_id not in self.processed_products:
                            category = self._categorize_product(title, '', description)
                            topics = self._extract_topics(title, '', description)
                            
                            article = {
                                "id": product_id,
                                "title": title,
                                "summary": description,
                                "category": category,
                                "source": "Product Hunt RSS",
                                "url": link,
                                "product_hunt_url": link,
                                "image_url": None,
                                "tags": topics,
                                "timestamp": pub_date,
                                "votes": 0,
                                "comments_count": 0,
                                "maker": "Unknown",
                                "hash": product_id
                            }
                            
                            products.append(article)
                            self.processed_products.add(product_id)
                
                except Exception as e:
                    logger.debug(f"⚠️ Error parsing RSS item: {e}")
                    continue
        
        except Exception as e:
            logger.debug(f"⚠️ Error parsing RSS content: {e}")
        
        return products
    
    def _parse_api_response(self, data: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Parse API response data to extract product information."""
        products = []
        
        try:
            # Handle different API response formats
            posts = []
            if 'data' in data:
                if 'posts' in data['data']:
                    posts = data['data']['posts']
                elif isinstance(data['data'], list):
                    posts = data['data']
            elif 'posts' in data:
                posts = data['posts']
            elif isinstance(data, list):
                posts = data
            
            for post in posts[:10]:  # Limit to 10 posts
                try:
                    if not isinstance(post, dict):
                        continue
                    
                    name = post.get('name', '').strip()
                    tagline = post.get('tagline', '').strip()
                    description = post.get('description', '').strip()
                    
                    if not name:
                        continue
                    
                    # Check if AI-related
                    combined_text = f"{name} {tagline} {description}"
                    if not self._is_ai_related(combined_text):
                        continue
                    
                    product_id = str(post.get('id', hashlib.md5(name.encode()).hexdigest()[:12]))
                    
                    if product_id not in self.processed_products:
                        category = self._categorize_product(name, tagline, description)
                        topics = self._extract_topics(name, tagline, description)
                        
                        article = {
                            "id": product_id,
                            "title": name,
                            "summary": f"{tagline}\n\n{description}".strip(),
                            "category": category,
                            "source": "Product Hunt API",
                            "url": post.get('redirect_url', ''),
                            "product_hunt_url": f"https://www.producthunt.com/posts/{post.get('slug', product_id)}",
                            "image_url": None,
                            "tags": topics,
                            "timestamp": datetime.now(),
                            "votes": int(post.get('votes_count', 0)),
                            "comments_count": int(post.get('comments_count', 0)),
                            "maker": post.get('maker', {}).get('name', 'Unknown') if isinstance(post.get('maker'), dict) else 'Unknown',
                            "hash": product_id
                        }
                        
                        # Try to extract image
                        if 'thumbnail' in post and post['thumbnail']:
                            thumbnail = post['thumbnail']
                            if isinstance(thumbnail, dict):
                                article['image_url'] = thumbnail.get('image_url')
                        
                        products.append(article)
                        self.processed_products.add(product_id)
                
                except Exception as e:
                    logger.debug(f"⚠️ Error parsing API post: {e}")
                    continue
        
        except Exception as e:
            logger.debug(f"⚠️ Error parsing API response: {e}")
        
        return products
    
    def get_stats(self) -> Dict[str, Any]:
        """
        Get statistics about the product fetcher.
        
        Returns:
            Dictionary with statistics
        """
        return {
            'processed_products_count': len(self.processed_products),
            'storage_file': str(self.storage_file),
            'last_fetch_exists': self.storage_file.exists()
        }
    
    def reset_tracking(self):
        """Reset all tracking data and start fresh."""
        self.processed_products.clear()
        if self.storage_file.exists():
            self.storage_file.unlink()
        logger.info("🔄 Reset Product Hunt tracking data - starting fresh")




# Example usage and testing
async def main():
    """Example usage of the AIProductFetcher class."""
    # Enable logging for testing
    logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')
    
    print("🚀 AI Product Hunt Fetcher Example")
    print("=" * 50)
    
    # Create product fetcher
    product_fetcher = AIProductFetcher()
    
    # Print current stats
    stats = product_fetcher.get_stats()
    print(f"📊 Current stats: {stats['processed_products_count']} processed products")
    
    try:
        # Fetch new products
        print("\n🔍 Fetching new AI products from Product Hunt...")
        new_products = await product_fetcher.fetch_new_products(max_products=10)
        
        if new_products:
            print(f"\n✅ Found {len(new_products)} new AI products:")
            print("-" * 50)
            
            for i, product in enumerate(new_products, 1):
                print(f"{i}. 🚀 {product['title']}")
                print(f"   📝 {product['summary'][:100]}{'...' if len(product['summary']) > 100 else ''}")
                print(f"   🏷️ Category: {product['category']} | 🔗 Source: {product['source']}")
                print(f"   💻 URL: {product['url']}")
                if product.get('image_url'):
                    print(f"   📷 Image: {product['image_url']}")
                print(f"   👍 Votes: {product.get('votes', 0)} | 💬 Comments: {product.get('comments_count', 0)}")
                print(f"   👤 Maker: {product.get('maker', 'Unknown')}")
                if product.get('tags'):
                    print(f"   🏷️ Tags: {', '.join(product['tags'])}")
                print()
        else:
            print("ℹ️ No new AI products found (all products have been processed before)")
            
        # Print updated stats
        updated_stats = product_fetcher.get_stats()
        print(f"\n📊 Updated stats: {updated_stats['processed_products_count']} processed products")
        
    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    # Run the example
    asyncio.run(main())