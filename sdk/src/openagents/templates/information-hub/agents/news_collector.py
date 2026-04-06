#!/usr/bin/env python3
"""
Simple News Collector Agent

Collects AI/tech news from RSS feeds and posts to the feed mod.
This is a simple example - customize for your own use case.
"""

import asyncio
import hashlib
from datetime import datetime
from typing import Set

from openagents.agents.worker_agent import WorkerAgent


class NewsCollectorAgent(WorkerAgent):
    """
    A simple agent that collects news from RSS feeds and posts to the feed.
    """

    default_agent_id = "news-collector"

    def __init__(self, fetch_interval: int = 300, **kwargs):
        super().__init__(**kwargs)
        self.fetch_interval = fetch_interval
        self.posted_hashes: Set[str] = set()
        self._collection_task = None

    async def on_startup(self):
        """Start news collection loop."""
        print(f"[NewsCollector] Starting collection (interval: {self.fetch_interval}s)")
        self._collection_task = asyncio.create_task(self._collection_loop())

    async def on_shutdown(self):
        """Stop collection loop."""
        if self._collection_task:
            self._collection_task.cancel()
            try:
                await self._collection_task
            except asyncio.CancelledError:
                pass

    async def _collection_loop(self):
        """Continuously fetch and post news."""
        await asyncio.sleep(5)  # Wait for initialization

        while True:
            try:
                await self._fetch_and_post()
            except Exception as e:
                print(f"[NewsCollector] Error: {e}")

            await asyncio.sleep(self.fetch_interval)

    async def _fetch_and_post(self):
        """Fetch news and post to feed."""
        from ..tools.rss_fetcher import fetch_ai_news

        print(f"[NewsCollector] Fetching at {datetime.now()}")

        news_items = fetch_ai_news(count=5)
        if not news_items:
            return

        feed_adapter = self.client.mod_adapters.get("openagents.mods.workspace.feed")
        if not feed_adapter:
            print("[NewsCollector] Feed adapter not available")
            return

        posted = 0
        for item in news_items[:5]:
            item_hash = hashlib.md5(f"{item['title']}|{item['link']}".encode()).hexdigest()[:16]

            if item_hash in self.posted_hashes:
                continue

            try:
                result = await feed_adapter.create_post(
                    title=item["title"][:195],
                    content=f"{item.get('description', '')}\n\n**Source:** {item.get('source', 'Unknown')}\n**Link:** {item.get('link', '')}",
                    tags=["news", item.get("category", "general")]
                )

                if result:
                    self.posted_hashes.add(item_hash)
                    posted += 1

                await asyncio.sleep(1)
            except Exception as e:
                print(f"[NewsCollector] Post error: {e}")

        print(f"[NewsCollector] Posted {posted} items")


async def main():
    """Run the news collector."""
    import argparse

    parser = argparse.ArgumentParser(description="News Collector Agent")
    parser.add_argument("--host", default="localhost")
    parser.add_argument("--port", type=int, default=8700)
    parser.add_argument("--interval", type=int, default=300)
    args = parser.parse_args()

    agent = NewsCollectorAgent(fetch_interval=args.interval)

    try:
        await agent.async_start(network_host=args.host, network_port=args.port)
        print("[NewsCollector] Running. Ctrl+C to stop.")
        while True:
            await asyncio.sleep(1)
    except KeyboardInterrupt:
        pass
    finally:
        await agent.async_stop()


if __name__ == "__main__":
    asyncio.run(main())
