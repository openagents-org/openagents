"""
News Fetcher Tools
Fetches tech news from various sources including Hacker News.
"""

import requests
from typing import Optional
from datetime import datetime


def fetch_hackernews_top(count: int = 5) -> str:
    """
    Fetch top stories from Hacker News.

    Args:
        count: Number of stories to fetch (default 5, max 30)

    Returns:
        Formatted string with top stories
    """
    try:
        count = min(max(1, count), 30)  # Clamp between 1 and 30

        # Fetch top story IDs
        response = requests.get(
            "https://hacker-news.firebaseio.com/v0/topstories.json",
            timeout=10
        )
        response.raise_for_status()
        story_ids = response.json()[:count]

        stories = []
        for story_id in story_ids:
            story_response = requests.get(
                f"https://hacker-news.firebaseio.com/v0/item/{story_id}.json",
                timeout=10
            )
            if story_response.ok:
                story = story_response.json()
                if story and story.get("title"):
                    stories.append({
                        "title": story.get("title", ""),
                        "url": story.get("url", f"https://news.ycombinator.com/item?id={story_id}"),
                        "score": story.get("score", 0),
                        "comments": story.get("descendants", 0),
                        "by": story.get("by", "unknown")
                    })

        if not stories:
            return "No stories found."

        result = f"📰 Top {len(stories)} Hacker News Stories:\n\n"
        for i, story in enumerate(stories, 1):
            result += f"{i}. **{story['title']}**\n"
            result += f"   🔗 {story['url']}\n"
            result += f"   ⬆️ {story['score']} points | 💬 {story['comments']} comments | 👤 {story['by']}\n\n"

        return result

    except Exception as e:
        return f"Error fetching Hacker News: {str(e)}"


def fetch_hackernews_new(count: int = 5) -> str:
    """
    Fetch newest stories from Hacker News.

    Args:
        count: Number of stories to fetch (default 5, max 30)

    Returns:
        Formatted string with new stories
    """
    try:
        count = min(max(1, count), 30)

        response = requests.get(
            "https://hacker-news.firebaseio.com/v0/newstories.json",
            timeout=10
        )
        response.raise_for_status()
        story_ids = response.json()[:count]

        stories = []
        for story_id in story_ids:
            story_response = requests.get(
                f"https://hacker-news.firebaseio.com/v0/item/{story_id}.json",
                timeout=10
            )
            if story_response.ok:
                story = story_response.json()
                if story and story.get("title"):
                    stories.append({
                        "title": story.get("title", ""),
                        "url": story.get("url", f"https://news.ycombinator.com/item?id={story_id}"),
                        "score": story.get("score", 0),
                        "by": story.get("by", "unknown")
                    })

        if not stories:
            return "No new stories found."

        result = f"🆕 {len(stories)} Newest Hacker News Stories:\n\n"
        for i, story in enumerate(stories, 1):
            result += f"{i}. **{story['title']}**\n"
            result += f"   🔗 {story['url']}\n"
            result += f"   ⬆️ {story['score']} points | 👤 {story['by']}\n\n"

        return result

    except Exception as e:
        return f"Error fetching Hacker News: {str(e)}"


def fetch_hackernews_best(count: int = 5) -> str:
    """
    Fetch best stories from Hacker News (highest voted recent stories).

    Args:
        count: Number of stories to fetch (default 5, max 30)

    Returns:
        Formatted string with best stories
    """
    try:
        count = min(max(1, count), 30)

        response = requests.get(
            "https://hacker-news.firebaseio.com/v0/beststories.json",
            timeout=10
        )
        response.raise_for_status()
        story_ids = response.json()[:count]

        stories = []
        for story_id in story_ids:
            story_response = requests.get(
                f"https://hacker-news.firebaseio.com/v0/item/{story_id}.json",
                timeout=10
            )
            if story_response.ok:
                story = story_response.json()
                if story and story.get("title"):
                    stories.append({
                        "title": story.get("title", ""),
                        "url": story.get("url", f"https://news.ycombinator.com/item?id={story_id}"),
                        "score": story.get("score", 0),
                        "comments": story.get("descendants", 0),
                        "by": story.get("by", "unknown")
                    })

        if not stories:
            return "No stories found."

        result = f"⭐ {len(stories)} Best Hacker News Stories:\n\n"
        for i, story in enumerate(stories, 1):
            result += f"{i}. **{story['title']}**\n"
            result += f"   🔗 {story['url']}\n"
            result += f"   ⬆️ {story['score']} points | 💬 {story['comments']} comments | 👤 {story['by']}\n\n"

        return result

    except Exception as e:
        return f"Error fetching Hacker News: {str(e)}"


def fetch_url_content(url: str, max_length: int = 5000) -> str:
    """
    Fetch and extract text content from a URL.

    Args:
        url: The URL to fetch content from
        max_length: Maximum length of content to return (default 5000)

    Returns:
        Extracted text content from the URL
    """
    try:
        headers = {
            "User-Agent": "Mozilla/5.0 (compatible; OpenAgents/1.0)"
        }
        response = requests.get(url, headers=headers, timeout=15)
        response.raise_for_status()

        content_type = response.headers.get("content-type", "")

        if "text/html" in content_type:
            # Simple HTML text extraction (basic, no BeautifulSoup dependency)
            import re
            text = response.text
            # Remove script and style elements
            text = re.sub(r'<script[^>]*>.*?</script>', '', text, flags=re.DOTALL | re.IGNORECASE)
            text = re.sub(r'<style[^>]*>.*?</style>', '', text, flags=re.DOTALL | re.IGNORECASE)
            # Remove HTML tags
            text = re.sub(r'<[^>]+>', ' ', text)
            # Clean up whitespace
            text = re.sub(r'\s+', ' ', text).strip()
            # Decode HTML entities
            import html
            text = html.unescape(text)

            if len(text) > max_length:
                text = text[:max_length] + "..."

            return f"Content from {url}:\n\n{text}"
        else:
            return f"Content from {url} (non-HTML, {len(response.content)} bytes)"

    except Exception as e:
        return f"Error fetching URL: {str(e)}"
