"""Dedicated OpenAI-compatible client for human-versus-agent classification."""
from functools import lru_cache


@lru_cache(maxsize=1)
def get_client(base_url, api_key):
    from openai import OpenAI

    if not base_url or not api_key:
        raise ValueError("Message router requires its own endpoint and API key")
    return OpenAI(base_url=base_url, api_key=api_key, timeout=15, max_retries=0)
