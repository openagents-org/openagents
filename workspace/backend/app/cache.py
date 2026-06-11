# -*- coding: utf-8 -*-
"""
Lightweight Redis cache helper.

Used to deduplicate high-frequency identical requests (e.g. /v1/events polls
from many agents with the same query params within a 1-second window). The
cache is intentionally dumb: read-through with a short TTL, no invalidation.
Correctness comes from the TTL being short enough that freshness is
acceptable for the use case (poll loops).

If REDIS_URL is not set, or Redis is unreachable, everything becomes a
no-op and callers fall through to their normal code path. Failures are
logged at debug level only — the backend must still serve requests when
Redis is down.
"""

import asyncio
import json
import logging
import os
from typing import Any, AsyncGenerator, Callable, Optional

logger = logging.getLogger(__name__)

_REDIS_URL = os.environ.get("REDIS_URL", "").strip()
_client = None
_disabled = not _REDIS_URL


def _lazy_client():
    """Initialize the Redis client on first use."""
    global _client, _disabled
    if _disabled or _client is not None:
        return _client
    try:
        import redis  # noqa: F401  — optional dep
        _client = redis.Redis.from_url(
            _REDIS_URL,
            socket_timeout=0.25,          # 250ms: don't let Redis stalls slow requests
            socket_connect_timeout=1.0,
            retry_on_timeout=False,
            decode_responses=False,       # we pass bytes
            health_check_interval=30,
        )
        # Probe once on startup so we know connectivity works.
        _client.ping()
        logger.info("Redis cache: connected to %s", _REDIS_URL.split("@")[-1])
    except Exception as e:
        logger.warning("Redis cache disabled (connect failed): %s", e)
        _disabled = True
        _client = None
    return _client


def get_bytes(key: str) -> Optional[bytes]:
    """Return cached bytes, or None on miss/error/disabled."""
    c = _lazy_client()
    if c is None:
        return None
    try:
        return c.get(key)
    except Exception as e:
        logger.debug("Redis GET failed for %s: %s", key, e)
        return None


def set_bytes(key: str, value: bytes, ttl_seconds: float) -> None:
    """Store bytes with a TTL. Silent on failure."""
    c = _lazy_client()
    if c is None:
        return
    try:
        # Redis SET PX uses milliseconds; round up to avoid zero-ms TTL
        px = max(1, int(round(ttl_seconds * 1000)))
        c.set(key, value, px=px)
    except Exception as e:
        logger.debug("Redis SET failed for %s: %s", key, e)


def delete_key(key: str) -> None:
    """Delete a cache key. Silent on failure."""
    c = _lazy_client()
    if c is None:
        return
    try:
        c.delete(key)
    except Exception as e:
        logger.debug("Redis DELETE failed for %s: %s", key, e)


def json_read_through(
    key: str,
    ttl_seconds: float,
    compute: Callable[[], Any],
) -> Any:
    """Read-through JSON cache.

    Returns the cached JSON value for ``key`` if present; otherwise calls
    ``compute()``, caches its result for ``ttl_seconds``, and returns it.

    ``compute`` must return a JSON-serializable object. Any exception from
    ``compute`` propagates unchanged (we never cache errors).
    """
    raw = get_bytes(key)
    if raw is not None:
        try:
            return json.loads(raw)
        except Exception:
            # Corrupt entry — fall through to recompute and overwrite
            pass

    value = compute()
    try:
        set_bytes(key, json.dumps(value, separators=(",", ":")).encode("utf-8"), ttl_seconds)
    except (TypeError, ValueError) as e:
        # Not JSON-serializable — skip caching but still return the value
        logger.debug("Skip cache for %s (not JSON-serializable): %s", key, e)
    return value


# ---------------------------------------------------------------------------
# Pub/Sub — used by SSE streaming
# ---------------------------------------------------------------------------

def publish_event(channel: str, data: bytes) -> None:
    """Publish event data to a Redis pub/sub channel. Silent on failure."""
    c = _lazy_client()
    if c is None:
        return
    try:
        c.publish(channel, data)
    except Exception as e:
        logger.debug("Redis PUBLISH failed for %s: %s", channel, e)


_async_redis = None


async def _lazy_async_client():
    """Initialize an async Redis client for pub/sub subscriptions."""
    global _async_redis
    if _disabled:
        return None
    if _async_redis is not None:
        return _async_redis
    try:
        import redis.asyncio as aioredis
        _async_redis = aioredis.from_url(
            _REDIS_URL,
            socket_timeout=5.0,
            socket_connect_timeout=5.0,
            decode_responses=False,
        )
        await _async_redis.ping()
        logger.info("Redis async pub/sub: connected")
    except Exception as e:
        logger.warning("Redis async pub/sub disabled: %s", e)
        _async_redis = None
    return _async_redis


async def subscribe_events(channel: str) -> AsyncGenerator[bytes, None]:
    """Async generator that yields messages from a Redis pub/sub channel.
    Yields raw bytes. Caller is responsible for cleanup."""
    client = await _lazy_async_client()
    if client is None:
        return
    pubsub = client.pubsub()
    try:
        await pubsub.subscribe(channel)
        while True:
            msg = await pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
            if msg and msg["type"] == "message":
                yield msg["data"]
            else:
                await asyncio.sleep(0.05)
    except Exception as e:
        logger.debug("Redis subscribe error on %s: %s", channel, e)
    finally:
        try:
            await pubsub.unsubscribe(channel)
            await pubsub.close()
        except Exception:
            pass
