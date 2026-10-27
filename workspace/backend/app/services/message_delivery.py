"""Idempotent message delivery using the existing event primary key (no migration)."""

import hashlib
import json
import uuid

from sqlalchemy import text

from app.models import EventRecord


def prepare_delivery(db, event, key):
    """Lock one delivery through commit; return its existing receipt if already stored.

    Call only after authentication and session validation. The key is scoped to
    the resolved workspace and sender, never used as a caller-chosen event ID.
    SQLite is used only by local tests; production PostgreSQL serializes retries
    even across backend nodes, before routing or notification side effects.
    """
    identity = json.dumps([event.network, event.source, str(key)], separators=(",", ":"))
    event.id = str(uuid.uuid5(uuid.NAMESPACE_URL, "openagents:message-delivery:" + identity))
    metadata = {k: v for k, v in (event.metadata or {}).items()
                if k not in ("session_id", "_delivery_hash")}
    fingerprint = hashlib.sha256(json.dumps(
        [event.type, event.target, event.payload, metadata, event.visibility],
        sort_keys=True, separators=(",", ":"), default=str,
    ).encode()).hexdigest()
    if db.get_bind().dialect.name == "postgresql":
        lock_id = int.from_bytes(hashlib.sha256(identity.encode()).digest()[:8], "big", signed=True)
        db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": lock_id})
    existing = db.get(EventRecord, event.id)
    if existing and (existing.metadata_ or {}).get("_delivery_hash") != fingerprint:
        raise ValueError("Idempotency key already used for a different message")
    event.metadata["_delivery_hash"] = fingerprint
    return existing
