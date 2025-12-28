"""
Simple RSS Fetcher for AI News
Fetches news from Google News RSS - customize for your needs.
"""

import requests
import xml.etree.ElementTree as ET
from typing import List, Dict
from html import unescape
import re


def clean_html(text: str) -> str:
    """Remove HTML tags from text."""
    if not text:
        return ""
    text = re.sub(r'<[^>]+>', '', text)
    text = unescape(text)
    return re.sub(r'\s+', ' ', text).strip()


def fetch_rss(url: str, count: int = 10) -> List[Dict]:
    """Fetch items from an RSS feed."""
    try:
        headers = {"User-Agent": "Mozilla/5.0 (compatible; OpenAgents/1.0)"}
        response = requests.get(url, headers=headers, timeout=15)
        response.raise_for_status()

        root = ET.fromstring(response.content)
        items = []

        for item in root.findall(".//item")[:count]:
            items.append({
                "title": item.findtext("title", ""),
                "link": item.findtext("link", ""),
                "description": clean_html(item.findtext("description", ""))[:500],
                "source": item.findtext("source", "RSS"),
            })

        return items
    except Exception as e:
        print(f"RSS fetch error: {e}")
        return []


def fetch_ai_news(count: int = 10) -> List[Dict]:
    """Fetch AI-related news from Google News."""
    url = "https://news.google.com/rss/search?q=artificial+intelligence&hl=en-US&gl=US&ceid=US:en"
    items = fetch_rss(url, count)
    for item in items:
        item["category"] = "ai"
    return items


if __name__ == "__main__":
    print("Fetching AI news...")
    for item in fetch_ai_news(3):
        print(f"- {item['title'][:60]}...")
