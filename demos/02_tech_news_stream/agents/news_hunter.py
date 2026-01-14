#!/usr/bin/env python3
"""
News Hunter Agent - Python-based agent that continuously hunts for tech news.

This agent runs an endless loop, periodically fetching news from Hacker News
and posting interesting stories to the news-feed channel.
"""

import asyncio
import sys
from pathlib import Path

# Add parent directories to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent.parent.parent / "src"))
sys.path.insert(0, str(Path(__file__).parent.parent))

from openagents.agents.worker_agent import WorkerAgent
from openagents.models.event_context import ChannelMessageContext
from tools.news_fetcher import fetch_hackernews_top, fetch_hackernews_new


class NewsHunterAgent(WorkerAgent):
    """
    A news hunter agent that continuously fetches and posts tech news.
    """

    default_agent_id = "news-hunter"

    def __init__(self, fetch_interval: int = 60, **kwargs):
        """
        Initialize the news hunter agent.

        Args:
            fetch_interval: Seconds between news fetches (default 60)
        """
        super().__init__(**kwargs)
        self.fetch_interval = fetch_interval
        self.posted_urls = set()  # Track posted URLs to avoid duplicates
        self._hunting_task = None

    async def on_startup(self):
        """Called when agent starts and connects to the network."""
        print(f"News Hunter connected! Starting news hunt loop (interval: {self.fetch_interval}s)")
        # Start the hunting loop
        self._hunting_task = asyncio.create_task(self._hunt_news_loop())

    async def on_shutdown(self):
        """Called when agent shuts down."""
        if self._hunting_task:
            self._hunting_task.cancel()
            try:
                await self._hunting_task
            except asyncio.CancelledError:
                pass
        print("News Hunter disconnected.")

    async def on_channel_mention(self, context: ChannelMessageContext):
        """Handle when the agent is mentioned in a channel.

        Responds to questions about the agent's role and can fetch fresh news on demand.
        """
        text = context.text.lower() if context.text else ""
        channel = context.channel
        message_id = context.message_id

        # Check if user is asking for news
        wants_news = any(word in text for word in ["news", "story", "stories", "fetch", "hunt", "post", "get"])

        if wants_news:
            # Fetch and share some fresh news
            response = "Let me hunt for some fresh tech news for you!\n\n"
            news_data = fetch_hackernews_top(count=3)
            stories = self._parse_news(news_data)

            if stories:
                for i, story in enumerate(stories[:3], 1):
                    title = story.get('title', 'Untitled')
                    url = story.get('url', '')
                    score = story.get('score', 0)
                    response += f"{i}. **{title}**\n   {url}\n   ({score} points)\n\n"
            else:
                response += "Couldn't fetch any news right now. I'll keep trying in my background loop!"

            await self.reply_to_message(channel=channel, message_id=message_id, text=response)
        else:
            # Provide information about the agent
            response = (
                "Hey there! I'm the **News Hunter** - I continuously hunt for the latest tech news from Hacker News "
                "and post interesting stories to the #news-feed channel.\n\n"
                "**What I do:**\n"
                "- Automatically fetch top tech stories every minute\n"
                "- Post new stories to #news-feed as I find them\n"
                "- Track what I've already posted to avoid duplicates\n\n"
                "**Want me to fetch some news now?** Just mention me with words like 'news', 'stories', or 'fetch'!"
            )
            await self.reply_to_message(channel=channel, message_id=message_id, text=response)

    async def _hunt_news_loop(self):
        """Continuous loop to fetch and post news."""
        # Wait a bit before first fetch to let everything initialize
        await asyncio.sleep(5)

        while True:
            try:
                await self._fetch_and_post_news()
            except Exception as e:
                print(f"Error in news hunt loop: {e}")

            # Wait for next fetch cycle
            await asyncio.sleep(self.fetch_interval)

    async def _fetch_and_post_news(self):
        """Fetch news and post new stories to the channel."""
        print("Hunting for news...")

        # Fetch top stories
        news_data = fetch_hackernews_top(count=5)

        # Parse stories from the formatted output
        stories = self._parse_news(news_data)

        # Post new stories (ones we haven't posted yet)
        new_stories = [s for s in stories if s['url'] not in self.posted_urls]

        if not new_stories:
            print("No new stories to post.")
            return

        # Post up to 2 new stories per cycle
        posted_count = 0
        for story in new_stories[:2]:
            success = await self._post_story(story)
            if success:
                self.posted_urls.add(story['url'])
                posted_count += 1
            # Small delay between posts
            await asyncio.sleep(2)

        if posted_count > 0:
            print(f"Posted {posted_count} new stories. Total tracked: {len(self.posted_urls)}")
        else:
            print("Failed to post stories (messaging adapter not available)")

    def _parse_news(self, news_text: str) -> list:
        """Parse news stories from the formatted text output.

        Expected format from fetch_hackernews_top:
        1. **Title Here**
           🔗 https://example.com
           ⬆️ 123 points | 💬 45 comments | 👤 username
        """
        import re
        stories = []
        lines = news_text.split('\n')

        current_story = {}
        for line in lines:
            stripped = line.strip()

            # Match numbered titles like "1. **Title Here**"
            title_match = re.match(r'^\d+\.\s*\*\*(.+?)\*\*$', stripped)
            if title_match:
                # Save previous story if exists
                if current_story.get('title') and current_story.get('url'):
                    stories.append(current_story)
                current_story = {'title': title_match.group(1)}
            elif stripped.startswith('🔗'):
                # URL line (remove emoji and strip)
                url = stripped.replace('🔗', '').strip()
                current_story['url'] = url
            elif stripped.startswith('⬆️'):
                # Score line - extract points number
                score_match = re.search(r'(\d+)\s*points?', stripped)
                if score_match:
                    current_story['score'] = int(score_match.group(1))

        # Don't forget the last story
        if current_story.get('title') and current_story.get('url'):
            stories.append(current_story)

        return stories

    async def _post_story(self, story: dict) -> bool:
        """Post a story to the news-feed channel.

        Returns:
            bool: True if posted successfully, False otherwise
        """
        title = story.get('title', 'Untitled')
        url = story.get('url', '')
        score = story.get('score', 0)

        message = f"📰 **{title}**\n\n🔗 {url}\n⬆️ {score} points on Hacker News"

        # Get the messaging adapter
        messaging = self.client.mod_adapters.get("openagents.mods.workspace.messaging")
        if messaging:
            await messaging.send_channel_message(
                channel="news-feed",
                text=message
            )
            print(f"Posted: {title[:50]}...")
            return True
        else:
            print("Warning: Messaging adapter not available")
            return False


async def main():
    """Run the news hunter agent."""
    import argparse

    parser = argparse.ArgumentParser(description="News Hunter Agent")
    parser.add_argument("--host", default="localhost", help="Network host")
    parser.add_argument("--port", type=int, default=8700, help="Network port")
    parser.add_argument("--interval", type=int, default=60, help="Fetch interval in seconds")
    args = parser.parse_args()

    agent = NewsHunterAgent(fetch_interval=args.interval)

    try:
        await agent.async_start(
            network_host=args.host,
            network_port=args.port,
        )

        # Keep running until interrupted
        print(f"News Hunter running. Press Ctrl+C to stop.")
        while True:
            await asyncio.sleep(1)

    except KeyboardInterrupt:
        print("\nShutting down...")
    finally:
        await agent.async_stop()


if __name__ == "__main__":
    asyncio.run(main())
