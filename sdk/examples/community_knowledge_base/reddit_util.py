#!/usr/bin/env python3
"""
Reddit Feeder Utility for Community Knowledge Base

This module provides a RedditFeeder class that crawls Reddit posts from r/artificial,
tracks which posts have already been processed, and provides methods to get new posts
with title, link, and image URL information.

Features:
- Crawls r/artificial subreddit posts
- Tracks processed posts to avoid duplicates
- Extracts title, link, and image URLs
- Persistent storage of crawled post IDs
- Rate limiting and error handling
"""

import asyncio
import json
import logging
import aiohttp
import time
import hashlib
import xml.etree.ElementTree as ET
import re
from datetime import datetime, timedelta
from typing import Dict, List, Set, Optional, Any
from pathlib import Path
from urllib.parse import urljoin, urlparse

# Configure logging
logger = logging.getLogger(__name__)


class RedditFeeder:
    """
    Reddit feeder class that crawls r/artificial subreddit for AI-related posts.
    
    This class handles:
    - Crawling Reddit posts via the JSON API
    - Tracking processed posts to avoid duplicates
    - Extracting relevant information (title, URL, images)
    - Persistent storage of crawl state
    """
    
    def __init__(self, subreddit: str = "artificial", storage_file: str = "/tmp/reddit_crawl_data.json"):
        """
        Initialize the Reddit feeder.
        
        Args:
            subreddit: The subreddit to crawl (default: "artificial")
            storage_file: File to store crawl state and processed post IDs
        """
        self.subreddit = subreddit
        self.storage_file = Path(storage_file)
        
        # Track processed posts to avoid duplicates
        self.processed_posts: Set[str] = set()
        
        # Reddit RSS endpoint (more accessible than JSON API)
        self.reddit_url = f"https://www.reddit.com/r/{subreddit}/.rss"
        
        # Request headers to appear as a regular browser
        self.headers = {
            'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Accept-Encoding': 'gzip, deflate, br',
            'DNT': '1',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
        }
        
        # Rate limiting
        self.last_request_time = 0
        self.min_request_interval = 5  # Minimum 5 seconds between requests
        
        # Load existing crawl data
        self._load_crawl_data()
    
    def _load_crawl_data(self):
        """Load previously crawled post IDs from storage file."""
        try:
            if self.storage_file.exists():
                with open(self.storage_file, 'r') as f:
                    data = json.load(f)
                    self.processed_posts = set(data.get('processed_posts', []))
                    logger.info(f"📚 Loaded {len(self.processed_posts)} previously processed post IDs")
            else:
                logger.info("🆕 No existing crawl data found, starting fresh")
        except Exception as e:
            logger.warning(f"⚠️ Could not load crawl data: {e}")
            self.processed_posts = set()
    
    def _save_crawl_data(self):
        """Save crawled post IDs to storage file."""
        try:
            data = {
                'processed_posts': list(self.processed_posts),
                'last_crawl': datetime.now().isoformat(),
                'subreddit': self.subreddit
            }
            
            with open(self.storage_file, 'w') as f:
                json.dump(data, f, indent=2)
                
            logger.info(f"💾 Saved {len(self.processed_posts)} processed post IDs")
        except Exception as e:
            logger.error(f"❌ Could not save crawl data: {e}")
    
    async def _rate_limit(self):
        """Enforce rate limiting between requests."""
        current_time = time.time()
        time_since_last = current_time - self.last_request_time
        
        if time_since_last < self.min_request_interval:
            sleep_time = self.min_request_interval - time_since_last
            logger.debug(f"⏱️ Rate limiting: sleeping for {sleep_time:.2f} seconds")
            await asyncio.sleep(sleep_time)
        
        self.last_request_time = time.time()
    
    def _extract_image_url_from_content(self, content_html: str, entry) -> Optional[str]:
        """
        Extract image URL from RSS entry content or media thumbnail.
        
        Args:
            content_html: HTML content from RSS entry
            entry: RSS entry element
            
        Returns:
            Image URL if found, None otherwise
        """
        try:
            # First check for media:thumbnail in RSS
            for media_thumb in entry.findall('.//{http://search.yahoo.com/mrss/}thumbnail'):
                url = media_thumb.get('url')
                if url:
                    return url.replace('&amp;', '&')
            
            # Extract from HTML content using regex
            if content_html:
                # Look for img src in the content
                img_match = re.search(r'<img[^>]+src="([^"]+)"', content_html)
                if img_match:
                    return img_match.group(1).replace('&amp;', '&')
                
                # Look for [link] pattern which might contain image URLs
                link_match = re.search(r'href="(https://[^"]*\.(jpg|jpeg|png|gif|webp)[^"]*)"', content_html, re.IGNORECASE)
                if link_match:
                    return link_match.group(1).replace('&amp;', '&')
                    
        except Exception as e:
            logger.debug(f"⚠️ Error extracting image URL from content: {e}")
        
        return None
    
    def _process_rss_entry(self, entry) -> Optional[Dict[str, Any]]:
        """
        Process a single RSS entry and extract relevant information.
        
        Args:
            entry: XML entry element from RSS feed
            
        Returns:
            Processed post dictionary or None if invalid
        """
        try:
            # Define namespace
            atom_ns = {'atom': 'http://www.w3.org/2005/Atom'}
            
            # Extract post ID from the id field (format: t3_1nburdo)
            id_elem = entry.find('atom:id', atom_ns)
            if id_elem is None:
                id_elem = entry.find('id')
            
            if id_elem is None or not id_elem.text:
                logger.debug(f"No ID element found or empty text")
                return None
            
            post_id = id_elem.text.strip()
            if post_id.startswith('t3_'):
                post_id = post_id[3:]  # Remove 't3_' prefix
            
            # Skip if already processed
            if post_id in self.processed_posts:
                logger.debug(f"Skipping already processed post: {post_id}")
                return None
            
            # Extract title
            title_elem = entry.find('atom:title', atom_ns)
            if title_elem is None:
                title_elem = entry.find('title')
            
            if title_elem is None or not title_elem.text:
                logger.debug(f"No title element found for post {post_id}")
                return None
            title = title_elem.text.strip()
            
            # Extract link (Reddit post URL)
            link_elem = entry.find('atom:link', atom_ns)
            if link_elem is None:
                link_elem = entry.find('link')
            reddit_post_url = link_elem.get('href') if link_elem is not None else ''
            
            # Extract author from author/name
            author = '[deleted]'
            author_elem = entry.find('atom:author/atom:name', atom_ns)
            if author_elem is None:
                author_elem = entry.find('author/name')
            if author_elem is not None and author_elem.text:
                author = author_elem.text.strip()
                if author.startswith('/u/'):
                    author = author[3:]  # Remove '/u/' prefix
            
            # Extract timestamp
            created_time = datetime.now()
            published_elem = entry.find('atom:published', atom_ns)
            if published_elem is None:
                published_elem = entry.find('published')
            if published_elem is not None and published_elem.text:
                try:
                    # Parse ISO format: 2025-09-08T17:53:43+00:00
                    time_str = published_elem.text.replace('Z', '+00:00')
                    created_time = datetime.fromisoformat(time_str)
                except Exception as e:
                    logger.debug(f"Failed to parse timestamp {published_elem.text}: {e}")
            
            # Extract content/description
            content_html = ''
            selftext = ''
            content_elem = entry.find('atom:content', atom_ns)
            if content_elem is None:
                content_elem = entry.find('content')
            if content_elem is not None and content_elem.text:
                content_html = content_elem.text
                # Extract plain text from HTML (simple approach)
                selftext = re.sub(r'<[^>]+>', '', content_html).strip()
                selftext = re.sub(r'\s+', ' ', selftext)  # Normalize whitespace
                if len(selftext) > 500:
                    selftext = selftext[:500]
            
            # Extract image URL
            image_url = self._extract_image_url_from_content(content_html, entry)
            
            # Determine content URL (could be external link or Reddit post)
            # For RSS, the main link is usually the Reddit post, we need to extract external links from content
            content_url = reddit_post_url
            if content_html:
                # Look for [link] references which are external links
                link_match = re.search(r'<span><a href="([^"]+)">\[link\]</a></span>', content_html)
                if link_match:
                    external_url = link_match.group(1).replace('&amp;', '&')
                    if external_url != reddit_post_url:
                        content_url = external_url
            
            processed_post = {
                'id': post_id,
                'title': title,
                'url': content_url,
                'reddit_url': reddit_post_url,
                'image_url': image_url,
                'score': 0,  # RSS doesn't include score
                'num_comments': 0,  # RSS doesn't include comment count
                'author': author,
                'created_time': created_time,
                'selftext': selftext,
                'subreddit': self.subreddit
            }
            
            # Mark as processed
            self.processed_posts.add(post_id)
            
            return processed_post
            
        except Exception as e:
            logger.warning(f"⚠️ Error processing RSS entry: {e}")
            return None
    
    async def get_new_posts(self, limit: int = 25) -> List[Dict[str, Any]]:
        """
        Crawl r/artificial and return a list of new posts with title, link, and image URL.
        
        Args:
            limit: Maximum number of posts to fetch (default: 25, Reddit's default)
            
        Returns:
            List of new post dictionaries with keys:
            - id: Reddit post ID
            - title: Post title
            - url: Content URL (external link or Reddit post URL)
            - reddit_url: Direct Reddit post URL
            - image_url: Image URL if available (can be None)
            - score: Post score (upvotes - downvotes)
            - num_comments: Number of comments
            - author: Post author
            - created_time: When the post was created
            - selftext: Post text content (for self-posts)
            - subreddit: Source subreddit
        """
        new_posts = []
        
        try:
            # Enforce rate limiting
            await self._rate_limit()
            
            # Construct URL with limit parameter
            url = f"{self.reddit_url}?limit={limit}"
            
            logger.info(f"🔍 Crawling r/{self.subreddit} for new posts...")
            
            # Create session with cookie jar to handle redirects
            jar = aiohttp.CookieJar(unsafe=True)
            async with aiohttp.ClientSession(cookie_jar=jar) as session:
                async with session.get(url, headers=self.headers, timeout=aiohttp.ClientTimeout(total=30), allow_redirects=True) as response:
                    if response.status != 200:
                        response_text = await response.text()
                        logger.error(f"❌ Failed to fetch Reddit RSS data: HTTP {response.status}")
                        logger.debug(f"Response body: {response_text[:200]}")
                        return new_posts
                    
                    rss_content = await response.text()
            
            # Parse RSS XML
            try:
                root = ET.fromstring(rss_content)
                logger.debug(f"RSS root tag: {root.tag}")
                logger.debug(f"RSS content preview: {rss_content[:500]}")
            except ET.ParseError as e:
                logger.error(f"❌ Failed to parse RSS XML: {e}")
                return new_posts
            
            # Find all entries in the RSS feed (Atom format)
            entries = root.findall('.//entry')
            logger.info(f"📥 Retrieved {len(entries)} entries from r/{self.subreddit} RSS feed")
            
            # Debug: if no entries found, check for different formats
            if len(entries) == 0:
                # Try different xpath patterns
                entries_alt = root.findall('.//{http://www.w3.org/2005/Atom}entry')
                logger.debug(f"Found {len(entries_alt)} entries with Atom namespace")
                if entries_alt:
                    entries = entries_alt
            
            # Process each entry
            for i, entry in enumerate(entries):
                logger.debug(f"Processing entry {i+1}/{len(entries)}: {entry.tag}")
                processed_post = self._process_rss_entry(entry)
                if processed_post:
                    new_posts.append(processed_post)
                    logger.debug(f"Successfully processed post: {processed_post['title']}")
                else:
                    logger.debug(f"Failed to process entry {i+1}")
            
            logger.info(f"✅ Found {len(new_posts)} new posts from r/{self.subreddit}")
            
            # Save updated crawl data
            if new_posts:
                self._save_crawl_data()
            
            return new_posts
            
        except asyncio.TimeoutError:
            logger.error("❌ Timeout while fetching Reddit data")
        except aiohttp.ClientError as e:
            logger.error(f"❌ Network error while fetching Reddit data: {e}")
        except json.JSONDecodeError as e:
            logger.error(f"❌ Invalid JSON response from Reddit: {e}")
        except Exception as e:
            logger.error(f"❌ Unexpected error while crawling Reddit: {e}")
        
        return new_posts
    
    def get_stats(self) -> Dict[str, Any]:
        """
        Get statistics about the Reddit feeder.
        
        Returns:
            Dictionary with statistics
        """
        return {
            'subreddit': self.subreddit,
            'processed_posts_count': len(self.processed_posts),
            'storage_file': str(self.storage_file),
            'last_crawl_exists': self.storage_file.exists()
        }
    
    def reset_crawl_data(self):
        """Reset all crawl data and start fresh."""
        self.processed_posts.clear()
        if self.storage_file.exists():
            self.storage_file.unlink()
        logger.info("🔄 Reset crawl data - starting fresh")


# Example usage and testing
async def main():
    """Example usage of the RedditFeeder class."""
    # Enable logging for testing
    logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')
    
    print("🚀 Reddit Feeder Example")
    print("=" * 50)
    
    # Create Reddit feeder for r/artificial
    feeder = RedditFeeder(subreddit="artificial")
    
    # Print current stats
    stats = feeder.get_stats()
    print(f"📊 Current stats: {stats}")
    
    try:
        # Get new posts
        print("\n🔍 Fetching new posts from r/artificial...")
        new_posts = await feeder.get_new_posts(limit=10)
        
        if new_posts:
            print(f"\n✅ Found {len(new_posts)} new posts:")
            print("-" * 50)
            
            for i, post in enumerate(new_posts, 1):
                print(f"{i}. 📰 {post['title']}")
                print(f"   🔗 URL: {post['url']}")
                print(f"   📷 Image: {post['image_url'] or 'No image'}")
                print(f"   👤 Author: {post['author']} | 👍 Score: {post['score']} | 💬 Comments: {post['num_comments']}")
                print(f"   ⏰ Created: {post['created_time'].strftime('%Y-%m-%d %H:%M:%S')}")
                if post['selftext']:
                    print(f"   📝 Text: {post['selftext'][:100]}...")
                print()
        else:
            print("ℹ️ No new posts found (all posts have been processed before)")
            
        # Print updated stats
        updated_stats = feeder.get_stats()
        print(f"📊 Updated stats: {updated_stats}")
        
    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    # Run the example
    asyncio.run(main())