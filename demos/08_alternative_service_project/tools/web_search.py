"""
Web search tool using DuckDuckGo (no API key required)
"""
import asyncio
from typing import Dict, Any
import aiohttp
from bs4 import BeautifulSoup


async def search_web(query: str, max_results: int = 5) -> str:
    """
    Search the web using DuckDuckGo HTML search.

    Args:
        query: Search query string
        max_results: Maximum number of results to return (default 5)

    Returns:
        Formatted string with search results including titles, URLs, and snippets
    """
    try:
        # Use DuckDuckGo HTML search (no API key needed)
        url = "https://html.duckduckgo.com/html/"

        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }

        data = {
            'q': query,
            'kl': 'us-en'
        }

        async with aiohttp.ClientSession() as session:
            async with session.post(url, data=data, headers=headers, timeout=10) as response:
                if response.status != 200:
                    return f"Search failed with status {response.status}"

                html = await response.text()

        # Parse results
        soup = BeautifulSoup(html, 'html.parser')
        results = []

        # Find result divs
        result_divs = soup.find_all('div', class_='result', limit=max_results)

        for div in result_divs:
            # Extract title and URL
            title_link = div.find('a', class_='result__a')
            if not title_link:
                continue

            title = title_link.get_text(strip=True)
            url = title_link.get('href', '')

            # Extract snippet
            snippet_div = div.find('a', class_='result__snippet')
            snippet = snippet_div.get_text(strip=True) if snippet_div else ""

            if title and url:
                results.append({
                    'title': title,
                    'url': url,
                    'snippet': snippet
                })

        if not results:
            return f"No results found for query: {query}"

        # Format results
        output = f"Search results for '{query}':\n\n"
        for i, result in enumerate(results, 1):
            output += f"{i}. {result['title']}\n"
            output += f"   URL: {result['url']}\n"
            if result['snippet']:
                output += f"   {result['snippet']}\n"
            output += "\n"

        return output.strip()

    except asyncio.TimeoutError:
        return "Search timed out. Please try again."
    except Exception as e:
        return f"Search error: {str(e)}"


# Synchronous wrapper for compatibility
def search_web_sync(query: str, max_results: int = 5) -> str:
    """Synchronous wrapper for search_web"""
    try:
        loop = asyncio.get_event_loop()
    except RuntimeError:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)

    return loop.run_until_complete(search_web(query, max_results))
