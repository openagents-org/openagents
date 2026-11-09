"""
cloro web search tool for OpenAgents.

This module returns live Google results, or the answer and cited sources of
Google AI Mode or Bing AI Mode, through the cloro API
(https://cloro.dev/docs).

Requires: CLORO_API_KEY environment variable.
Uses the core `requests` dependency, so no extra install is needed.
"""

import logging
import os

import requests

logger = logging.getLogger(__name__)

API_URL = "https://api.cloro.dev/v1/monitor"
# Google returns organic results. The two AI Modes return an answer with its cited sources.
ENDPOINTS = {
    "google": "google",
    "aimode": "aimode",
    "bing_aimode": "bing/aimode",
}
# cloro opens the live page during the request, so allow more time than a search index needs.
TIMEOUT_SECONDS = 120


def _get_api_key() -> str:
    api_key = os.environ.get("CLORO_API_KEY", "")
    if not api_key:
        raise ValueError(
            "CLORO_API_KEY environment variable is required. "
            "Get your key from: https://dashboard.cloro.dev/api-keys"
        )
    return api_key


def search_cloro(query: str, engine: str = "google", num_results: int = 5, country: str = "US") -> str:
    """
    Search the web with cloro.

    Args:
        query: The search query, or the prompt for an AI Mode engine
        engine: 'google' (default) for organic results, 'aimode' for the
                Google AI Mode answer, or 'bing_aimode' for the Bing AI Mode
                answer. Bing AI Mode accepts prompts of up to 3,500
                characters after URL encoding.
        num_results: Number of results or sources to return (default 5)
        country: ISO 3166-1 alpha-2 country code for localized results (default 'US')

    Returns:
        Formatted string with the answer (AI Mode engines only) and the
        results with titles, URLs and snippets
    """
    if engine not in ENDPOINTS:
        return f"cloro search error: engine must be one of: {', '.join(ENDPOINTS)}"
    try:
        api_key = _get_api_key()
    except ValueError as e:
        return str(e)

    if engine == "google":
        body = {"query": query, "country": country}
    else:
        body = {"prompt": query, "country": country, "include": {"markdown": True}}

    try:
        logger.info(f"cloro search: engine={engine}, query={query!r}")
        response = requests.post(
            f"{API_URL}/{ENDPOINTS[engine]}",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
                "User-Agent": "openagents",
            },
            json=body,
            timeout=TIMEOUT_SECONDS,
        )
        data = response.json()
    except Exception as e:
        logger.error(f"cloro search failed: {e}")
        return f"cloro search error: {e}"

    if not isinstance(data, dict):
        logger.error(f"cloro search failed: unexpected response (HTTP {response.status_code})")
        return f"cloro search error: unexpected response (HTTP {response.status_code})"

    # Failures arrive as {"success": false, "error": {"code": "...", "message": "..."}}.
    if not response.ok or not data.get("success"):
        error = data.get("error") or {}
        message = error.get("message") or f"HTTP {response.status_code}"
        logger.error(f"cloro search failed: {message}")
        return f"cloro search error: {message}"

    result = data.get("result") or {}
    if engine == "google":
        entries = [
            (item.get("title"), item.get("link"), item.get("snippet")) for item in result.get("organicResults") or []
        ]
        answer = ""
    else:
        entries = [
            (item.get("label"), item.get("url"), item.get("description")) for item in result.get("sources") or []
        ]
        answer = (result.get("markdown") or result.get("text") or "").strip()

    entries = entries[: max(num_results, 1)]
    if not answer and not entries:
        return f"No results found for: {query}"

    output = f"Search results for '{query}':\n\n"
    if answer:
        output += f"Answer:\n{answer}\n\nSources:\n\n"
    for i, (title, url, snippet) in enumerate(entries, 1):
        output += f"{i}. {title or 'No Title'}\n"
        output += f"   URL: {url or ''}\n"
        if snippet:
            output += f"   {snippet}\n"
        output += "\n"

    logger.info(f"cloro search returned {len(entries)} results")
    return output.strip()
