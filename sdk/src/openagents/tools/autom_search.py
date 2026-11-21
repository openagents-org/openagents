"""
Autom web search tool for OpenAgents.

This module returns live results from Google, Google News, Bing, Brave,
DuckDuckGo or Yahoo through the Autom SERP API (https://docs.autom.dev).

Requires: AUTOM_API_KEY environment variable.
Uses the core `requests` dependency, so no extra install is needed.
"""

import logging
import os

import requests

logger = logging.getLogger(__name__)

API_URL = "https://api.autom.dev/v1"
# Every engine answers {"organic_results": [{"title", "link", "snippet", ...}]}.
ENDPOINTS = {
    "google": "google/search",
    "google_news": "google/news",
    "bing": "bing/search",
    "brave": "brave/search",
    "duckduckgo": "duckduckgo/search",
    "yahoo": "yahoo/search",
}
TIMEOUT_SECONDS = 60


def _get_api_key() -> str:
    api_key = os.environ.get("AUTOM_API_KEY", "")
    if not api_key:
        raise ValueError(
            "AUTOM_API_KEY environment variable is required. " "Get your key from: https://app.autom.dev"
        )
    return api_key


def search_autom(
    query: str, engine: str = "google", num_results: int = 5, country: str = "us", language: str = ""
) -> str:
    """
    Search the web with Autom.

    Args:
        query: The search query
        engine: 'google' (default), 'google_news', 'bing', 'brave',
                'duckduckgo' or 'yahoo'
        num_results: Number of results to return (default 5, at most 10)
        country: ISO 3166-1 alpha-2 country code for localized results (default 'us')
        language: Optional language code for the results, for example 'en' or 'fr'

    Returns:
        Formatted string with the results' titles, URLs and snippets
    """
    if engine not in ENDPOINTS:
        return f"Autom search error: engine must be one of: {', '.join(ENDPOINTS)}"
    try:
        api_key = _get_api_key()
    except ValueError as e:
        return str(e)

    params = {"query": query}
    if country:
        # Bing takes the country as `cc`, the other engines as `gl`.
        params["cc" if engine == "bing" else "gl"] = country.lower()
    if language and engine != "bing":
        params["hl"] = language.lower()

    try:
        logger.info(f"Autom search: engine={engine}, query={query!r}")
        response = requests.get(
            f"{API_URL}/{ENDPOINTS[engine]}",
            headers={"x-api-key": api_key, "Accept": "application/json", "User-Agent": "openagents"},
            params=params,
            timeout=TIMEOUT_SECONDS,
        )
        data = response.json()
    except Exception as e:
        logger.error(f"Autom search failed: {e}")
        return f"Autom search error: {e}"

    if not isinstance(data, dict):
        logger.error(f"Autom search failed: unexpected response (HTTP {response.status_code})")
        return f"Autom search error: unexpected response (HTTP {response.status_code})"

    # Failures arrive as {"error": "message"}.
    if not response.ok:
        message = data.get("error") if isinstance(data.get("error"), str) else f"HTTP {response.status_code}"
        logger.error(f"Autom search failed: {message}")
        return f"Autom search error: {message}"

    entries = [
        (item.get("title"), item.get("link"), item.get("snippet"), item.get("date"))
        for item in data.get("organic_results") or []
        if isinstance(item, dict) and item.get("link")
    ][: min(max(num_results, 1), 10)]
    if not entries:
        return f"No results found for: {query}"

    output = f"Search results for '{query}':\n\n"
    for i, (title, url, snippet, date) in enumerate(entries, 1):
        output += f"{i}. {title or 'No Title'}\n"
        output += f"   URL: {url}\n"
        if date:
            output += f"   Date: {date}\n"
        if snippet:
            output += f"   {snippet}\n"
        output += "\n"

    logger.info(f"Autom search returned {len(entries)} results")
    return output.strip()
