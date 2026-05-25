"""Composing (typing) signal store backed by Redis.

Tracks whether any user is actively typing in a workspace. Signals
expire after TTL_SECONDS without a refresh. Uses Redis so the signal
is shared across replicas.
"""

from app import cache

TTL_SECONDS = 30.0
_KEY_PREFIX = "composing:"


def set_composing(workspace_id: str, channel: str) -> None:
    cache.set_bytes(f"{_KEY_PREFIX}{workspace_id}", b"1", TTL_SECONDS)


def has_any_composing(workspace_id: str) -> bool:
    return cache.get_bytes(f"{_KEY_PREFIX}{workspace_id}") is not None
