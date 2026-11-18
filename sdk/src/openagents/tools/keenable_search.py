"""
Keenable web search tool for OpenAgents.

Searches the web with Keenable (https://docs.keenable.ai). Works without an
API key through the keyless public endpoint, which is rate limited per IP
address. Set KEENABLE_API_KEY to use the keyed endpoint instead.

Uses the core `requests` dependency, so no extra install is needed.
"""

import logging
import os

import requests

logger = logging.getLogger(__name__)

KEYLESS_URL = "https://api.keenable.ai/v1/search/public"
KEYED_URL = "https://api.keenable.ai/v1/search"
# The keyless endpoint requires an app title header.
APP_TITLE = "OpenAgents"
MAX_RESULTS = 20
TIMEOUT_SECONDS = 30


def search_keenable(query: str, num_results: int = 5) -> str:
    """
    Search the web with Keenable.

    Args:
        query: The search query
        num_results: Number of results to return (default 5, max 20)

    Returns:
        Formatted string with titles, URLs and snippets
    """
    if not query or not query.strip():
        return "Keenable search error: query must not be empty"
    try:
        count = max(1, min(int(num_results), MAX_RESULTS))
    except (TypeError, ValueError):
        count = 5

    headers = {"Content-Type": "application/json", "User-Agent": "openagents"}
    api_key = os.environ.get("KEENABLE_API_KEY", "").strip()
    if api_key:
        url = KEYED_URL
        headers["X-API-Key"] = api_key
    else:
        url = KEYLESS_URL
        headers["X-Keenable-Title"] = APP_TITLE

    try:
        logger.info(f"Keenable search: query={query!r}, keyed={bool(api_key)}")
        # allow_redirects=False keeps the API key from being sent to another host.
        response = requests.post(
            url,
            headers=headers,
            json={"query": query, "max_results": count},
            timeout=TIMEOUT_SECONDS,
            allow_redirects=False,
        )
    except requests.RequestException as e:
        logger.error(f"Keenable search failed: {e}")
        return f"Keenable search error: {type(e).__name__}"

    if response.status_code == 429:
        return "Keenable search error: rate limit reached. Try again later or set KEENABLE_API_KEY."
    if response.status_code != 200:
        logger.error(f"Keenable search failed: HTTP {response.status_code}")
        return f"Keenable search error: HTTP {response.status_code}"

    try:
        data = response.json()
    except ValueError:
        return "Keenable search error: invalid JSON response"

    results = [r for r in (data.get("results") or []) if isinstance(r, dict) and r.get("url")][:count]
    if not results:
        return f"No results found for: {query}"

    output = f"Search results for '{query}':\n\n"
    for i, item in enumerate(results, 1):
        snippet = (item.get("snippet") or item.get("description") or "").strip()
        if len(snippet) > 500:
            snippet = snippet[:500].rstrip() + "..."
        output += f"{i}. {item.get('title') or 'No Title'}\n"
        output += f"   URL: {item['url']}\n"
        if snippet:
            output += f"   {snippet}\n"
        output += "\n"

    logger.info(f"Keenable search returned {len(results)} results")
    return output.strip()
