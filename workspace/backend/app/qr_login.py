# -*- coding: utf-8 -*-
"""
Short-lived state for QR-code login (see app/routers/qr_login.py).

A login request lives for a couple of minutes and must be visible to every
backend worker on every node: the browser that shows the code polls whichever
one the load balancer picks, and the phone that approves it may hit another.
Production and its standby share the managed Redis (REDIS_URL), so the state
lives there under `qr_login:<id>` with a TTL — no table, no migration.

Without REDIS_URL (local development, tests) it falls back to this process's
memory, which only works with a single worker. When REDIS_URL is set but Redis
cannot be reached, QR login reports itself unavailable instead of silently
falling back to memory that other workers cannot see.
"""

import hashlib
import json
import logging
import secrets
import threading
import time
from typing import Callable, Optional

from app import cache

logger = logging.getLogger(__name__)

_KEY_PREFIX = "qr_login:"

#: How long a freshly shown code can be scanned.
CODE_TTL_SECONDS = 120
#: Once scanned, how long the phone has to confirm.
CONFIRM_TTL_SECONDS = 120
#: Once approved, how long the waiting browser has to collect its session.
CLAIM_TTL_SECONDS = 60

PENDING = "pending"
SCANNED = "scanned"
APPROVED = "approved"
CANCELLED = "cancelled"
EXPIRED = "expired"


class Unavailable(Exception):
    """Redis is configured but cannot be reached."""


class Conflict(Exception):
    """The request is not in a state that allows this step."""


def new_id() -> str:
    return secrets.token_urlsafe(18)


def new_secret() -> str:
    return secrets.token_urlsafe(32)


def hash_secret(secret: str) -> str:
    return hashlib.sha256(secret.encode()).hexdigest()


def secrets_match(record: dict, secret: str) -> bool:
    return secrets.compare_digest(record.get("secret_hash", ""), hash_secret(secret or ""))


class _MemoryStore:
    def __init__(self):
        self._items: dict = {}
        self._lock = threading.Lock()

    def _live(self, key: str) -> Optional[dict]:
        item = self._items.get(key)
        if item is None:
            return None
        record, expires = item
        if expires <= time.time():
            del self._items[key]
            return None
        return record

    def create(self, key: str, record: dict, ttl: int) -> None:
        with self._lock:
            self._items[key] = (dict(record), time.time() + ttl)

    def get(self, key: str) -> Optional[dict]:
        with self._lock:
            record = self._live(key)
            return dict(record) if record else None

    def update(self, key: str, change: Callable[[dict], tuple]) -> Optional[dict]:
        with self._lock:
            record = self._live(key)
            if record is None:
                return None
            new, ttl = change(dict(record))
            self._items[key] = (new, time.time() + ttl)
            return dict(new)

    def take(self, key: str) -> Optional[dict]:
        with self._lock:
            record = self._live(key)
            self._items.pop(key, None)
            return record


class _RedisStore:
    def __init__(self, client):
        self._c = client

    def create(self, key: str, record: dict, ttl: int) -> None:
        self._c.set(key, json.dumps(record).encode(), ex=ttl)

    def get(self, key: str) -> Optional[dict]:
        raw = self._c.get(key)
        return json.loads(raw) if raw else None

    def update(self, key: str, change: Callable[[dict], tuple]) -> Optional[dict]:
        # Optimistic compare-and-set: two phones racing to scan the same code
        # must not both win.
        import redis

        for _ in range(5):
            with self._c.pipeline() as pipe:
                try:
                    pipe.watch(key)
                    raw = pipe.get(key)
                    if not raw:
                        pipe.unwatch()
                        return None
                    new, ttl = change(json.loads(raw))
                    pipe.multi()
                    pipe.set(key, json.dumps(new).encode(), ex=ttl)
                    pipe.execute()
                    return new
                except redis.WatchError:
                    continue
        raise Conflict("busy")

    def take(self, key: str) -> Optional[dict]:
        # GETDEL: only one poll can collect an approved session.
        raw = self._c.getdel(key)
        return json.loads(raw) if raw else None


_memory = _MemoryStore()


def _store():
    if not cache._REDIS_URL:
        return _memory
    client = cache._lazy_client()
    if client is None:
        raise Unavailable("Redis unavailable")
    return _RedisStore(client)


def _call(fn: Callable, *args):
    try:
        return fn(_store(), *args)
    except (Unavailable, Conflict):
        raise
    except Exception as e:  # noqa: BLE001 — a Redis error must read as "unavailable", not 500
        logger.warning("qr_login: store error: %s", e)
        raise Unavailable(str(e)) from e


def create(record: dict) -> None:
    _call(lambda s: s.create(_KEY_PREFIX + record["id"], record, CODE_TTL_SECONDS))


def get(request_id: str) -> Optional[dict]:
    return _call(lambda s: s.get(_KEY_PREFIX + request_id))


def update(request_id: str, change: Callable[[dict], tuple]) -> Optional[dict]:
    """Apply `change(record) -> (new_record, ttl_seconds)` atomically.

    Returns the new record, or None when the request no longer exists.
    `change` raises Conflict to refuse the step.
    """
    return _call(lambda s: s.update(_KEY_PREFIX + request_id, change))


def take(request_id: str) -> Optional[dict]:
    """Remove the request and return what it held (None if already gone)."""
    return _call(lambda s: s.take(_KEY_PREFIX + request_id))


def remaining(record: dict) -> int:
    return max(0, int(record.get("expires_at", 0) - time.time()))
