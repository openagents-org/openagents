"""
Web Search Tools
Provides web search and content fetching capabilities for research.
"""

import os
import requests
from typing import Optional
import html
import re


def search_web(query: str, count: int = 5) -> str:
    """
    Search the web using DuckDuckGo Instant Answer API or Brave Search.

    Args:
        query: Search query string
        count: Number of results to return (default 5)

    Returns:
        Formatted search results
    """
    # Try Brave Search first if API key is available
    brave_key = os.environ.get("BRAVE_API_KEY")
    if brave_key:
        return _search_brave(query, count, brave_key)

    # Fall back to DuckDuckGo Instant Answers
    return _search_duckduckgo(query, count)


def _search_brave(query: str, count: int, api_key: str) -> str:
    """Search using Brave Search API."""
    try:
        headers = {
            "Accept": "application/json",
            "X-Subscription-Token": api_key
        }
        params = {
            "q": query,
            "count": count
        }
        response = requests.get(
            "https://api.search.brave.com/res/v1/web/search",
            headers=headers,
            params=params,
            timeout=15
        )
        response.raise_for_status()
        data = response.json()

        results = data.get("web", {}).get("results", [])
        if not results:
            return f"No results found for: {query}"

        output = f"🔍 Search results for: **{query}**\n\n"
        for i, result in enumerate(results[:count], 1):
            title = result.get("title", "No title")
            url = result.get("url", "")
            description = result.get("description", "No description")
            output += f"{i}. **{title}**\n"
            output += f"   🔗 {url}\n"
            output += f"   {description}\n\n"

        return output

    except Exception as e:
        return f"Brave Search error: {str(e)}. Falling back to DuckDuckGo..."


def _search_duckduckgo(query: str, count: int) -> str:
    """Search using DuckDuckGo web search."""
    try:
        from ddgs import DDGS

        with DDGS() as ddgs:
            results = list(ddgs.text(query, max_results=count))

        if not results:
            return f"No results found for: {query}"

        output = f"🔍 Search results for: **{query}**\n\n"
        for i, result in enumerate(results[:count], 1):
            title = result.get("title", "No title")
            url = result.get("href", "")
            description = result.get("body", "No description")
            output += f"{i}. **{title}**\n"
            if url:
                output += f"   🔗 {url}\n"
            output += f"   {description}\n\n"

        return output

    except Exception as e:
        return f"Search error: {str(e)}"


def fetch_webpage(url: str, max_length: int = 8000) -> str:
    """
    Fetch and extract text content from a webpage.

    Args:
        url: The URL to fetch
        max_length: Maximum content length to return

    Returns:
        Extracted text content
    """
    try:
        headers = {
            "User-Agent": "Mozilla/5.0 (compatible; OpenAgents Research/1.0)"
        }
        response = requests.get(url, headers=headers, timeout=20)
        response.raise_for_status()

        content_type = response.headers.get("content-type", "")

        if "text/html" not in content_type:
            return f"Non-HTML content at {url} ({content_type})"

        text = response.text

        # Extract title
        title_match = re.search(r'<title[^>]*>(.*?)</title>', text, re.IGNORECASE | re.DOTALL)
        title = html.unescape(title_match.group(1).strip()) if title_match else "No title"

        # Remove script and style elements
        text = re.sub(r'<script[^>]*>.*?</script>', '', text, flags=re.DOTALL | re.IGNORECASE)
        text = re.sub(r'<style[^>]*>.*?</style>', '', text, flags=re.DOTALL | re.IGNORECASE)
        text = re.sub(r'<nav[^>]*>.*?</nav>', '', text, flags=re.DOTALL | re.IGNORECASE)
        text = re.sub(r'<header[^>]*>.*?</header>', '', text, flags=re.DOTALL | re.IGNORECASE)
        text = re.sub(r'<footer[^>]*>.*?</footer>', '', text, flags=re.DOTALL | re.IGNORECASE)

        # Remove HTML tags
        text = re.sub(r'<[^>]+>', ' ', text)

        # Clean up whitespace
        text = re.sub(r'\s+', ' ', text).strip()

        # Decode HTML entities
        text = html.unescape(text)

        if len(text) > max_length:
            text = text[:max_length] + "...[truncated]"

        return f"📄 **{title}**\n🔗 {url}\n\n{text}"

    except Exception as e:
        return f"Error fetching webpage: {str(e)}"


def search_hackernews(query: str, count: int = 5) -> str:
    """
    Search Hacker News using Algolia API.

    Args:
        query: Search query
        count: Number of results (default 5)

    Returns:
        Formatted search results from Hacker News
    """
    try:
        params = {
            "query": query,
            "hitsPerPage": count,
            "tags": "story"
        }
        response = requests.get(
            "https://hn.algolia.com/api/v1/search",
            params=params,
            timeout=15
        )
        response.raise_for_status()
        data = response.json()

        hits = data.get("hits", [])
        if not hits:
            return f"No Hacker News results for: {query}"

        output = f"🔶 Hacker News results for: **{query}**\n\n"
        for i, hit in enumerate(hits, 1):
            title = hit.get("title", "No title")
            url = hit.get("url") or f"https://news.ycombinator.com/item?id={hit.get('objectID')}"
            points = hit.get("points", 0)
            comments = hit.get("num_comments", 0)
            author = hit.get("author", "unknown")

            output += f"{i}. **{title}**\n"
            output += f"   🔗 {url}\n"
            output += f"   ⬆️ {points} points | 💬 {comments} comments | 👤 {author}\n\n"

        return output

    except Exception as e:
        return f"Hacker News search error: {str(e)}"
