"""
Webpage fetch tool to retrieve and extract content from URLs
"""
import asyncio
import aiohttp
from bs4 import BeautifulSoup
from typing import Dict, Any


async def fetch_webpage(url: str) -> str:
    """
    Fetch a webpage and extract key information.

    Args:
        url: The URL to fetch

    Returns:
        Formatted string with extracted content including title, description, and main text
    """
    try:
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }

        async with aiohttp.ClientSession() as session:
            async with session.get(url, headers=headers, timeout=15) as response:
                if response.status != 200:
                    return f"Failed to fetch {url}: HTTP {response.status}"

                html = await response.text()

        # Parse HTML
        soup = BeautifulSoup(html, 'html.parser')

        # Remove script and style elements
        for script in soup(["script", "style", "nav", "footer", "header"]):
            script.decompose()

        # Extract title
        title = soup.find('title')
        title_text = title.get_text(strip=True) if title else "No title"

        # Extract meta description
        meta_desc = soup.find('meta', attrs={'name': 'description'})
        if not meta_desc:
            meta_desc = soup.find('meta', attrs={'property': 'og:description'})
        description = meta_desc.get('content', '').strip() if meta_desc else ""

        # Extract main content
        # Try to find main content areas
        main_content = soup.find('main') or soup.find('article') or soup.find('div', class_='content')

        if main_content:
            text = main_content.get_text(separator='\n', strip=True)
        else:
            # Fallback to body
            body = soup.find('body')
            text = body.get_text(separator='\n', strip=True) if body else ""

        # Clean up text - remove excessive whitespace
        lines = [line.strip() for line in text.split('\n') if line.strip()]
        text = '\n'.join(lines)

        # Limit text length
        if len(text) > 3000:
            text = text[:3000] + "..."

        # Extract pricing info (look for common pricing indicators)
        pricing_keywords = ['price', 'pricing', 'cost', 'plan', 'free', '$', '€', '£']
        pricing_lines = []
        for line in lines[:100]:  # Check first 100 lines
            if any(keyword in line.lower() for keyword in pricing_keywords):
                if len(line) < 200:  # Avoid long paragraphs
                    pricing_lines.append(line)
                if len(pricing_lines) >= 5:
                    break

        # Format output
        output = f"=== {title_text} ===\n"
        output += f"URL: {url}\n\n"

        if description:
            output += f"Description: {description}\n\n"

        if pricing_lines:
            output += "Pricing Information:\n"
            for line in pricing_lines:
                output += f"- {line}\n"
            output += "\n"

        output += "Content:\n"
        output += text[:2000]  # Limit content

        return output

    except asyncio.TimeoutError:
        return f"Timeout fetching {url}"
    except Exception as e:
        return f"Error fetching {url}: {str(e)}"


# Synchronous wrapper
def fetch_webpage_sync(url: str) -> str:
    """Synchronous wrapper for fetch_webpage"""
    try:
        loop = asyncio.get_event_loop()
    except RuntimeError:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)

    return loop.run_until_complete(fetch_webpage(url))
