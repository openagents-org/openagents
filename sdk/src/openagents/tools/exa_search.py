"""
Exa AI-powered web search tool for OpenAgents.

This module provides web search and content retrieval capabilities using
the Exa API. It supports multiple search types, content extraction modes,
and filtering options.

Requires: EXA_API_KEY environment variable.
Install: pip install exa-py>=2.0.0
"""

import logging
import os
from typing import Any, Dict

logger = logging.getLogger(__name__)


def _get_client():
    """Create and return an Exa client with integration tracking header."""
    api_key = os.environ.get("EXA_API_KEY", "")
    if not api_key:
        raise ValueError(
            "EXA_API_KEY environment variable is required. "
            "Get your key from: https://dashboard.exa.ai/api-keys"
        )

    from exa_py import Exa

    client = Exa(api_key=api_key)
    client.headers["x-exa-integration"] = "openagents"
    return client


def _extract_snippet(result, content_mode: str = "highlights") -> str:
    """Extract content snippet from an Exa result, cascading through available fields."""
    # Try highlights first
    highlights = getattr(result, "highlights", None)
    if highlights:
        return "\n".join(highlights)

    # Try summary
    summary = getattr(result, "summary", None)
    if summary:
        return summary

    # Try text (truncated)
    text = getattr(result, "text", None)
    if text:
        return text[:500] + ("..." if len(text) > 500 else "")

    return ""


def search_exa(
    query: str,
    num_results: int = 5,
    search_type: str = "auto",
    content_mode: str = "highlights",
    category: str = None,
    include_domains: str = None,
    exclude_domains: str = None,
    include_text: str = None,
    exclude_text: str = None,
    start_published_date: str = None,
    end_published_date: str = None,
) -> str:
    """
    Search the web using Exa's AI-powered search engine.

    Supports multiple search types and content extraction modes with
    advanced filtering by domain, text, category, and date range.

    Args:
        query: The search query to execute
        num_results: Number of results to return (default 5, max 100)
        search_type: Search algorithm - 'auto' (default), 'neural', 'fast',
                     'instant', 'deep-lite', 'deep', or 'deep-reasoning'
        content_mode: Content retrieval - 'highlights' (default), 'text',
                      'summary', or 'none'
        category: Filter by category - 'company', 'research paper', 'news',
                  'personal site', 'financial report', 'people'
        include_domains: Comma-separated domains to include (e.g. 'arxiv.org,github.com')
        exclude_domains: Comma-separated domains to exclude
        include_text: Text that must appear in page content
        exclude_text: Text to exclude from results
        start_published_date: ISO 8601 date; only results after this (e.g. '2024-01-01T00:00:00.000Z')
        end_published_date: ISO 8601 date; only results before this

    Returns:
        Formatted string with search results including titles, URLs, and content snippets
    """
    try:
        client = _get_client()
    except ValueError as e:
        return str(e)

    # Build search kwargs
    search_kwargs: Dict[str, Any] = {
        "query": query,
        "num_results": min(num_results, 100),
        "type": search_type,
    }

    # Build contents parameter
    if content_mode == "highlights":
        search_kwargs["contents"] = {"highlights": {"max_characters": 4000}}
    elif content_mode == "text":
        search_kwargs["contents"] = {"text": {"max_characters": 10000}}
    elif content_mode == "summary":
        search_kwargs["contents"] = {"summary": True}
    # 'none' omits contents entirely

    # Add optional filters
    if category:
        search_kwargs["category"] = category
    if include_domains:
        search_kwargs["include_domains"] = [d.strip() for d in include_domains.split(",")]
    if exclude_domains:
        search_kwargs["exclude_domains"] = [d.strip() for d in exclude_domains.split(",")]
    if include_text:
        search_kwargs["include_text"] = [include_text]
    if exclude_text:
        search_kwargs["exclude_text"] = [exclude_text]
    if start_published_date:
        search_kwargs["start_published_date"] = start_published_date
    if end_published_date:
        search_kwargs["end_published_date"] = end_published_date

    try:
        logger.info(f"Exa search: query={query!r}, type={search_type}, num_results={num_results}")
        response = client.search(**search_kwargs)
    except Exception as e:
        logger.error(f"Exa search failed: {e}")
        return f"Exa search error: {e}"

    if not response.results:
        return f"No results found for: {query}"

    # Format results matching the repo's existing web_search output style
    output = f"Search results for '{query}':\n\n"
    for i, result in enumerate(response.results, 1):
        title = getattr(result, "title", "No Title") or "No Title"
        url = getattr(result, "url", "") or ""
        published_date = getattr(result, "published_date", None)

        output += f"{i}. {title}\n"
        output += f"   URL: {url}\n"

        if published_date:
            output += f"   Published: {published_date}\n"

        snippet = _extract_snippet(result, content_mode)
        if snippet:
            output += f"   {snippet}\n"

        output += "\n"

    logger.info(f"Exa search returned {len(response.results)} results")
    return output.strip()
