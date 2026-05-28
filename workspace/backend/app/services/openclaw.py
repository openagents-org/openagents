# -*- coding: utf-8 -*-
"""
OpenClaw integration service — async client for project context management.

Handles:
- Context-aware Q&A (query project context via OpenClaw)
- Channel summarization (extract key decisions from conversations)
- Graceful degradation when OpenClaw is unavailable
"""

import logging
import os
from typing import List, Optional

import httpx

logger = logging.getLogger(__name__)

# Configuration from environment
OPENCLAW_BASE_URL = os.environ.get("OPENCLAW_BASE_URL", "http://localhost:3333")
OPENCLAW_API_KEY = os.environ.get("OPENCLAW_API_KEY", "")
OPENCLAW_TIMEOUT = int(os.environ.get("OPENCLAW_TIMEOUT", "30"))


class OpenClawClient:
    """Async client for OpenClaw API integration."""

    def __init__(
        self,
        base_url: str = OPENCLAW_BASE_URL,
        api_key: str = OPENCLAW_API_KEY,
        timeout: int = OPENCLAW_TIMEOUT,
    ):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.timeout = timeout
        self._client: Optional[httpx.AsyncClient] = None

    async def _get_client(self) -> httpx.AsyncClient:
        """Lazily create the async HTTP client."""
        if self._client is None or self._client.is_closed:
            headers = {"Content-Type": "application/json"}
            if self.api_key:
                headers["Authorization"] = f"Bearer {self.api_key}"
            self._client = httpx.AsyncClient(
                base_url=self.base_url,
                timeout=self.timeout,
                headers=headers,
            )
        return self._client

    async def query(self, project_context: List[dict], question: str) -> str:
        """
        Query OpenClaw with project context + user question.

        Args:
            project_context: List of {"key": str, "content": str, "type": str}
            question: User's question about the project

        Returns:
            AI-generated answer grounded in project context
        """
        client = await self._get_client()

        system_prompt = self._build_system_prompt(project_context)

        try:
            response = await client.post("/v1/chat/completions", json={
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": question},
                ],
                "stream": False,
            })
            response.raise_for_status()
            data = response.json()

            # Handle both OpenAI-compatible and simple response formats
            if "choices" in data:
                return data["choices"][0]["message"]["content"]
            elif "content" in data:
                return data["content"]
            elif "message" in data:
                return data["message"]
            else:
                return str(data)

        except httpx.TimeoutException:
            logger.error("OpenClaw request timed out after %ds", self.timeout)
            raise
        except httpx.HTTPStatusError as e:
            logger.error("OpenClaw HTTP error: %s %s", e.response.status_code, e.response.text[:200])
            raise
        except httpx.ConnectError:
            logger.error("Cannot connect to OpenClaw at %s", self.base_url)
            raise

    async def summarize_channel(self, messages: List[dict], project_name: str = "") -> dict:
        """
        Summarize a channel conversation to extract key decisions and context.

        Args:
            messages: List of {"sender": str, "content": str, "timestamp": str}
            project_name: Name of the parent project for context

        Returns:
            {"summary": str, "decisions": list, "action_items": list}
        """
        client = await self._get_client()

        conversation_text = "\n".join([
            f"[{m.get('sender', 'unknown')}]: {m.get('content', '')}"
            for m in messages[-50:]  # Last 50 messages max
        ])

        system_prompt = (
            f"You are a project context manager for '{project_name}'. "
            "Analyze the following conversation and extract:\n"
            "1. A brief summary (2-3 sentences)\n"
            "2. Key decisions made\n"
            "3. Action items identified\n\n"
            "Respond in JSON format: {\"summary\": str, \"decisions\": [str], \"action_items\": [str]}"
        )

        try:
            response = await client.post("/v1/chat/completions", json={
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": conversation_text},
                ],
                "stream": False,
            })
            response.raise_for_status()
            data = response.json()

            content = data.get("choices", [{}])[0].get("message", {}).get("content", "")

            # Try to parse as JSON
            import json
            try:
                return json.loads(content)
            except json.JSONDecodeError:
                return {"summary": content, "decisions": [], "action_items": []}

        except Exception as e:
            logger.warning("Channel summarization failed: %s", e)
            return {"summary": "", "decisions": [], "action_items": [], "error": str(e)}

    async def health_check(self) -> bool:
        """Check if OpenClaw is reachable."""
        try:
            client = await self._get_client()
            response = await client.get("/health", timeout=5)
            return response.status_code == 200
        except Exception:
            return False

    async def close(self):
        """Close the HTTP client."""
        if self._client and not self._client.is_closed:
            await self._client.aclose()
            self._client = None

    def _build_system_prompt(self, context: List[dict]) -> str:
        """Build a system prompt that includes all project context."""
        context_sections = []
        for doc in context:
            key = doc.get("key", "unknown")
            content = doc.get("content", "")
            # Truncate very long entries
            if len(content) > 3000:
                content = content[:3000] + "\n... [truncated]"
            context_sections.append(f"## {key}\n{content}")

        context_block = "\n\n".join(context_sections) if context_sections else "(No context available yet)"

        return (
            "You are a project context management assistant. "
            "You have access to the following project documentation and context:\n\n"
            f"---\n{context_block}\n---\n\n"
            "Answer questions based on this context. "
            "If the answer is not in the context, say so clearly. "
            "Be concise and specific. Reference which context document(s) you're drawing from."
        )


# ---------------------------------------------------------------------------
# Singleton access
# ---------------------------------------------------------------------------

_client_instance: Optional[OpenClawClient] = None


def get_openclaw_client() -> OpenClawClient:
    """Get or create the singleton OpenClaw client."""
    global _client_instance
    if _client_instance is None:
        _client_instance = OpenClawClient()
    return _client_instance
