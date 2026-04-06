#!/usr/bin/env python3
"""
Elon Musk News Collector Agent

This agent continuously collects news about Elon Musk from various RSS sources
and broadcasts them via the feed mod. Other agents can then query the feed to
answer questions like "What did Elon Musk do in the last 24 hours?"
"""

import asyncio
import sys
import hashlib
from pathlib import Path
from datetime import datetime
from typing import Set

# Add parent directories to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent.parent.parent / "src"))
sys.path.insert(0, str(Path(__file__).parent.parent))

from openagents.agents.worker_agent import WorkerAgent
from tools.rss_fetcher import fetch_all_elon_news


def get_item_hash(item: dict) -> str:
    """Generate a unique hash for a news item to detect duplicates."""
    key = f"{item.get('title', '')}|{item.get('link', '')}"
    return hashlib.md5(key.encode()).hexdigest()[:16]


def categorize_news(item: dict) -> list:
    """Determine relevant tags/categories for a news item."""
    title_lower = (item.get('title', '') + ' ' + item.get('description', '')).lower()
    tags = ["elon-musk", "news"]

    # Company/project specific tags
    if any(word in title_lower for word in ['tesla', 'ev', 'electric vehicle', 'cybertruck', 'model']):
        tags.append("tesla")
    if any(word in title_lower for word in ['spacex', 'starship', 'falcon', 'rocket', 'launch', 'starlink']):
        tags.append("spacex")
    if any(word in title_lower for word in ['twitter', 'x.com', 'x corp']):
        tags.append("x-twitter")
    if any(word in title_lower for word in ['neuralink', 'brain', 'implant']):
        tags.append("neuralink")
    if any(word in title_lower for word in ['boring company', 'tunnel', 'hyperloop']):
        tags.append("boring-company")
    if any(word in title_lower for word in ['xai', 'grok', 'artificial intelligence', ' ai ']):
        tags.append("xai")

    # Source-specific tag
    source = item.get('feed_source', '')
    if 'reddit' in source:
        tags.append("reddit")
    elif 'hackernews' in source:
        tags.append("hackernews")
    elif 'google' in source:
        tags.append("mainstream-news")

    return tags


class NewsCollectorAgent(WorkerAgent):
    """
    An agent that continuously collects Elon Musk news from RSS feeds
    and broadcasts them via the feed mod.
    """

    default_agent_id = "elon-news-collector"

    def __init__(self, fetch_interval: int = 300, **kwargs):
        """
        Initialize the news collector agent.

        Args:
            fetch_interval: Seconds between news fetches (default 300 = 5 minutes)
        """
        super().__init__(**kwargs)
        self.fetch_interval = fetch_interval
        self.posted_hashes: Set[str] = set()
        self._collection_task = None

    async def on_startup(self):
        """Called when agent starts and connects to the network."""
        print(f"[NewsCollector] Connected! Starting news collection loop (interval: {self.fetch_interval}s)")
        # Start the collection loop
        self._collection_task = asyncio.create_task(self._collection_loop())

    async def on_shutdown(self):
        """Called when agent shuts down."""
        if self._collection_task:
            self._collection_task.cancel()
            try:
                await self._collection_task
            except asyncio.CancelledError:
                pass
        print("[NewsCollector] Disconnected.")

    async def _collection_loop(self):
        """Continuous loop to fetch and broadcast news."""
        # Wait a bit before first fetch to let everything initialize
        await asyncio.sleep(5)

        while True:
            try:
                await self._fetch_and_broadcast_news()
            except Exception as e:
                print(f"[NewsCollector] Error in collection loop: {e}")

            # Wait for next fetch cycle
            await asyncio.sleep(self.fetch_interval)

    async def _fetch_and_broadcast_news(self):
        """Fetch news from all sources and broadcast new items via feed mod."""
        print(f"[NewsCollector] Fetching news at {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}...")

        # Fetch from all sources
        all_news = fetch_all_elon_news(count_per_source=5)

        if not all_news:
            print("[NewsCollector] No news items fetched.")
            return

        # Filter out already posted items
        new_items = []
        for item in all_news:
            item_hash = get_item_hash(item)
            if item_hash not in self.posted_hashes:
                new_items.append((item, item_hash))

        if not new_items:
            print("[NewsCollector] No new items to post.")
            return

        print(f"[NewsCollector] Found {len(new_items)} new items to post.")

        # Get the feed adapter
        feed_adapter = self.client.mod_adapters.get("openagents.mods.workspace.feed")
        if not feed_adapter:
            print("[NewsCollector] Warning: Feed adapter not available!")
            return

        # Post each new item
        posted_count = 0
        for item, item_hash in new_items[:5]:  # Limit to 5 posts per cycle
            try:
                title = item.get('title', 'Untitled')[:195]  # Max 200 chars
                source = item.get('feed_source', 'unknown')
                link = item.get('link', '')
                description = item.get('description', '')
                pub_date = item.get('published_date', '')
                author = item.get('author', '')

                # Build content with all available info
                content_parts = []

                if description:
                    content_parts.append(description)

                content_parts.append(f"\n\n**Source:** {source}")

                if link:
                    content_parts.append(f"\n**Link:** {link}")

                if pub_date:
                    content_parts.append(f"\n**Published:** {pub_date}")

                if author:
                    content_parts.append(f"\n**Author:** {author}")

                content = "\n".join(content_parts)

                # Get categories/tags for this item
                tags = categorize_news(item)

                # Create the feed post
                result = await feed_adapter.create_post(
                    title=title,
                    content=content,
                    tags=tags
                )

                if result:
                    self.posted_hashes.add(item_hash)
                    posted_count += 1
                    print(f"[NewsCollector] Posted: {title[:50]}...")

                # Small delay between posts
                await asyncio.sleep(1)

            except Exception as e:
                print(f"[NewsCollector] Error posting item: {e}")

        print(f"[NewsCollector] Posted {posted_count} new items. Total tracked: {len(self.posted_hashes)}")


async def main():
    """Run the news collector agent."""
    import argparse

    parser = argparse.ArgumentParser(description="Elon Musk News Collector Agent")
    parser.add_argument("--host", default="localhost", help="Network host")
    parser.add_argument("--port", type=int, default=8700, help="Network port")
    parser.add_argument("--interval", type=int, default=300, help="Fetch interval in seconds (default 300)")
    args = parser.parse_args()

    agent = NewsCollectorAgent(fetch_interval=args.interval)

    try:
        await agent.async_start(
            network_host=args.host,
            network_port=args.port,
        )

        print(f"[NewsCollector] Running. Press Ctrl+C to stop.")
        while True:
            await asyncio.sleep(1)

    except KeyboardInterrupt:
        print("\n[NewsCollector] Shutting down...")
    finally:
        await agent.async_stop()


if __name__ == "__main__":
    asyncio.run(main())
