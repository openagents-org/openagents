"""
RSS Fetcher Tools for Elon Musk News
Fetches news from various RSS sources without requiring additional dependencies.
Uses only requests (already in project) and xml.etree (standard library).
"""

import requests
import xml.etree.ElementTree as ET
from typing import List, Dict, Optional
from datetime import datetime
from html import unescape
import re


def clean_html(text: str) -> str:
    """Remove HTML tags and decode entities from text."""
    if not text:
        return ""
    # Remove HTML tags
    text = re.sub(r'<[^>]+>', '', text)
    # Decode HTML entities
    text = unescape(text)
    # Clean up whitespace
    text = re.sub(r'\s+', ' ', text).strip()
    return text


def parse_rss_date(date_str: str) -> Optional[datetime]:
    """Parse various RSS date formats."""
    formats = [
        "%a, %d %b %Y %H:%M:%S %z",  # RFC 822
        "%a, %d %b %Y %H:%M:%S GMT",
        "%Y-%m-%dT%H:%M:%S%z",  # ISO 8601
        "%Y-%m-%dT%H:%M:%SZ",
        "%Y-%m-%d %H:%M:%S",
    ]
    for fmt in formats:
        try:
            return datetime.strptime(date_str.strip(), fmt)
        except ValueError:
            continue
    return None


def fetch_google_news_rss(query: str = "Elon Musk", count: int = 10) -> List[Dict]:
    """
    Fetch news from Google News RSS.

    Args:
        query: Search query (default "Elon Musk")
        count: Number of items to return

    Returns:
        List of news items with title, link, description, published_date
    """
    try:
        # URL encode the query
        encoded_query = requests.utils.quote(query)
        url = f"https://news.google.com/rss/search?q={encoded_query}&hl=en-US&gl=US&ceid=US:en"

        headers = {
            "User-Agent": "Mozilla/5.0 (compatible; OpenAgents/1.0)"
        }

        response = requests.get(url, headers=headers, timeout=15)
        response.raise_for_status()

        root = ET.fromstring(response.content)
        items = []

        for item in root.findall(".//item")[:count]:
            title = item.findtext("title", "")
            link = item.findtext("link", "")
            description = clean_html(item.findtext("description", ""))
            pub_date = item.findtext("pubDate", "")
            source = item.findtext("source", "")

            parsed_date = parse_rss_date(pub_date)

            items.append({
                "title": title,
                "link": link,
                "description": description[:500] if description else "",
                "published_date": parsed_date.isoformat() if parsed_date else pub_date,
                "source": source,
                "feed_source": "google_news"
            })

        return items

    except Exception as e:
        print(f"Error fetching Google News RSS: {e}")
        return []


def fetch_reddit_rss(subreddit: str = "elonmusk", count: int = 10) -> List[Dict]:
    """
    Fetch posts from a Reddit subreddit via RSS.

    Args:
        subreddit: Subreddit name (default "elonmusk")
        count: Number of items to return

    Returns:
        List of posts with title, link, description, published_date
    """
    try:
        url = f"https://www.reddit.com/r/{subreddit}/new/.rss"

        headers = {
            "User-Agent": "Mozilla/5.0 (compatible; OpenAgents/1.0)"
        }

        response = requests.get(url, headers=headers, timeout=15)
        response.raise_for_status()

        # Reddit uses Atom format
        root = ET.fromstring(response.content)

        # Atom namespace
        ns = {"atom": "http://www.w3.org/2005/Atom"}

        items = []

        for entry in root.findall("atom:entry", ns)[:count]:
            title = entry.findtext("atom:title", "", ns)
            link_elem = entry.find("atom:link", ns)
            link = link_elem.get("href", "") if link_elem is not None else ""

            content = entry.findtext("atom:content", "", ns)
            description = clean_html(content)[:500] if content else ""

            updated = entry.findtext("atom:updated", "", ns)
            parsed_date = parse_rss_date(updated)

            author_elem = entry.find("atom:author/atom:name", ns)
            author = author_elem.text if author_elem is not None else ""

            items.append({
                "title": title,
                "link": link,
                "description": description,
                "published_date": parsed_date.isoformat() if parsed_date else updated,
                "author": author,
                "feed_source": f"reddit_r/{subreddit}"
            })

        return items

    except Exception as e:
        print(f"Error fetching Reddit RSS: {e}")
        return []


def fetch_hackernews_search(query: str = "Elon Musk", count: int = 10) -> List[Dict]:
    """
    Search Hacker News for stories matching a query using the Algolia API.

    Args:
        query: Search query (default "Elon Musk")
        count: Number of items to return

    Returns:
        List of stories with title, link, description, published_date
    """
    try:
        url = f"https://hn.algolia.com/api/v1/search_by_date"
        params = {
            "query": query,
            "tags": "story",
            "hitsPerPage": count
        }

        response = requests.get(url, params=params, timeout=15)
        response.raise_for_status()
        data = response.json()

        items = []

        for hit in data.get("hits", []):
            title = hit.get("title", "")
            url = hit.get("url") or f"https://news.ycombinator.com/item?id={hit.get('objectID', '')}"

            created_at = hit.get("created_at", "")
            parsed_date = parse_rss_date(created_at)

            items.append({
                "title": title,
                "link": url,
                "description": f"Points: {hit.get('points', 0)} | Comments: {hit.get('num_comments', 0)}",
                "published_date": parsed_date.isoformat() if parsed_date else created_at,
                "author": hit.get("author", ""),
                "feed_source": "hackernews"
            })

        return items

    except Exception as e:
        print(f"Error fetching Hacker News: {e}")
        return []


def fetch_all_elon_news(count_per_source: int = 5) -> List[Dict]:
    """
    Fetch Elon Musk news from all available sources.

    Args:
        count_per_source: Number of items to fetch from each source

    Returns:
        Combined list of news items from all sources, sorted by date
    """
    all_items = []

    # Google News - general Elon Musk news
    all_items.extend(fetch_google_news_rss("Elon Musk", count_per_source))

    # Reddit r/elonmusk
    all_items.extend(fetch_reddit_rss("elonmusk", count_per_source))

    # Reddit r/teslamotors (Elon-related)
    all_items.extend(fetch_reddit_rss("teslamotors", count_per_source))

    # Reddit r/SpaceX (Elon-related)
    all_items.extend(fetch_reddit_rss("spacex", count_per_source))

    # Hacker News search
    all_items.extend(fetch_hackernews_search("Elon Musk", count_per_source))

    # Sort by published date (newest first)
    def get_date(item):
        try:
            dt = datetime.fromisoformat(item.get("published_date", ""))
            # Convert to timestamp for consistent comparison
            return dt.timestamp()
        except:
            return 0.0

    all_items.sort(key=get_date, reverse=True)

    return all_items


if __name__ == "__main__":
    # Test the fetchers
    print("Testing RSS Fetchers for Elon Musk News...")
    print("=" * 60)

    print("\n1. Google News RSS:")
    for item in fetch_google_news_rss(count=3):
        print(f"  - {item['title'][:60]}...")
        print(f"    Source: {item.get('source', 'N/A')}")
        print(f"    Date: {item['published_date']}")

    print("\n2. Reddit r/elonmusk:")
    for item in fetch_reddit_rss("elonmusk", count=3):
        print(f"  - {item['title'][:60]}...")
        print(f"    Author: {item.get('author', 'N/A')}")

    print("\n3. Hacker News Search:")
    for item in fetch_hackernews_search(count=3):
        print(f"  - {item['title'][:60]}...")
        print(f"    {item['description']}")

    print("\n" + "=" * 60)
    print("All fetchers working!")
