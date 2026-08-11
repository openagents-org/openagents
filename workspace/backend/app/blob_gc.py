# -*- coding: utf-8 -*-
"""
Reliable FileStore blob deletion, via a transactional outbox.

Deleting from S3 is a side effect on a remote system, so it can't be part of the
transaction that stops pointing at the key. Doing it best-effort right after the
commit gives you this: one S3 timeout, and a blob the user asked us to remove
stays readable forever with nothing in the system recording that it shouldn't.

So callers don't delete. They `enqueue_deletion()` inside the same transaction
that clears the pointer, and both commit together — after which the deletion is
durable regardless of what the process or S3 does next. `try_delete_now()` takes
the common fast path right after the commit, and anything it doesn't manage is
picked up by `drain_blob_deletions()` on the maintenance cycle.

The pleasant side effect is that this doubles as the orphan sweep for superseded
keys: every replaced key is already a row here, so nothing has to go scanning
storage to find them.
"""

import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import BlobDeletion
from app.storage import get_file_store

logger = logging.getLogger(__name__)

# Give up retrying (but keep the row, loudly) after this many failures. At the
# backoff below that's roughly a day of trying.
MAX_ATTEMPTS = 12
# Rows claimed per drain pass. Keeps the maintenance cycle short and bounded.
DRAIN_BATCH = 50


def enqueue_deletion(db: Session, storage_key: str | None) -> None:
    """Record that `storage_key` should be deleted.

    Does NOT commit — that's the whole point. The caller commits this together
    with whatever change stopped referencing the key, so the two can't diverge.
    A None/empty key is a no-op, which lets callers pass an old pointer without
    checking whether there was one.
    """
    if not storage_key:
        return
    db.add(BlobDeletion(storage_key=storage_key))


def try_delete_now(db: Session, storage_key: str | None) -> bool:
    """Best-effort immediate delete of an already-enqueued key.

    Call this *after* the enqueueing transaction has committed. On success the
    outbox row is cleared and this returns True; on failure the row stays put
    for the drainer and this returns False. Either way it does not raise —
    the user's avatar has already changed, and failing their request over a
    cleanup step would be the wrong trade.
    """
    if not storage_key:
        return False
    try:
        get_file_store().delete(storage_key)
    except Exception as exc:
        logger.warning("blob_gc: immediate delete failed for %s (%s); leaving for drainer", storage_key, exc)
        return False

    try:
        db.query(BlobDeletion).filter(BlobDeletion.storage_key == storage_key).delete(synchronize_session=False)
        db.commit()
    except Exception:
        db.rollback()
        # The bytes are gone; a stale row just makes the drainer do one
        # idempotent no-op delete later.
        logger.warning("blob_gc: could not clear outbox row for %s", storage_key)
    return True


def _claim(db: Session, now: datetime) -> list[BlobDeletion]:
    """Claim a batch of due rows.

    Every uvicorn worker runs its own maintenance loop, so several drainers hit
    this table at once. SKIP LOCKED hands each of them a disjoint set instead of
    having them queue behind each other. Duplicate work would be harmless —
    FileStore.delete is idempotent — but pointless S3 calls aren't free.

    SQLite (tests) has no row locking; there's also only ever one drainer there.
    """
    stmt = (
        select(BlobDeletion)
        .where(BlobDeletion.next_retry_at <= now)
        .order_by(BlobDeletion.next_retry_at)
        .limit(DRAIN_BATCH)
    )
    bind = db.get_bind()
    if bind is not None and bind.dialect.name == "postgresql":
        stmt = stmt.with_for_update(skip_locked=True)
    return list(db.execute(stmt).scalars().all())


def drain_blob_deletions(db: Session | None = None) -> int:
    """Delete the blobs recorded in the outbox. Returns the number removed.

    Synchronous and short-lived by design — it runs from the maintenance cycle
    via `asyncio.to_thread`, alongside the other periodic table sweeps. Pass
    `db` to drive it from a caller that already has a session (tests).
    """
    from app.database import SessionLocal

    owns_session = db is None
    if db is None:
        db = SessionLocal()
    deleted = 0
    try:
        now = datetime.now(timezone.utc)
        rows = _claim(db, now)
        if not rows:
            return 0

        store = get_file_store()
        for row in rows:
            try:
                store.delete(row.storage_key)
            except Exception as exc:
                row.attempts = (row.attempts or 0) + 1
                row.last_error = str(exc)[:500]
                # Exponential backoff, capped at an hour.
                delay = min(3600, 30 * (2 ** min(row.attempts, 7)))
                row.next_retry_at = now + timedelta(seconds=delay)
                if row.attempts >= MAX_ATTEMPTS:
                    # Keep the row rather than dropping it: a blob we failed to
                    # delete is exactly the thing someone needs to know about.
                    logger.error(
                        "blob_gc: giving up on %s after %s attempts (%s)",
                        row.storage_key, row.attempts, row.last_error,
                    )
                continue
            db.delete(row)
            deleted += 1

        db.commit()
        if deleted:
            logger.info("blob_gc: deleted %s blob(s)", deleted)
        return deleted
    except Exception:
        db.rollback()
        logger.exception("blob_gc: drain failed")
        return deleted
    finally:
        if owns_session:
            db.close()
