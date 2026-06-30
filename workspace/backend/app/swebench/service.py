# -*- coding: utf-8 -*-
"""
SWE-bench job service: the background worker, concurrency control, and the
high-level create/cancel/retry operations the router calls.

The worker is launched from the FastAPI lifespan ONLY when SWEBENCH_ENABLED is
set, so the feature is fully inert otherwise. At most ``MAX_CONCURRENCY`` jobs
run at once (default 1); everything heavy happens in ``run_job`` off the
request path.
"""

import asyncio
import logging
from datetime import datetime, timezone
from typing import Dict, Optional

from sqlalchemy import select

from .config import config
from .runner import default_deps, run_job

logger = logging.getLogger(__name__)

# job_id -> Task. Lets the worker avoid double-launching and lets cancel reach
# an in-flight asyncio task.
_running: Dict[str, asyncio.Task] = {}
_worker_task: Optional[asyncio.Task] = None


def running_count() -> int:
    return len([t for t in _running.values() if not t.done()])


def is_running(job_id: str) -> bool:
    t = _running.get(job_id)
    return bool(t and not t.done())


async def _run_one(job_id: str, session_factory) -> None:
    try:
        await run_job(job_id, default_deps(session_factory))
    finally:
        _running.pop(job_id, None)


async def _tick(session_factory) -> None:
    from app.models import EvaluationJob

    # Reap completed task handles.
    for jid in [j for j, t in _running.items() if t.done()]:
        _running.pop(jid, None)

    free = config.MAX_CONCURRENCY - running_count()
    if free <= 0:
        return

    db = session_factory()
    try:
        rows = db.execute(
            select(EvaluationJob)
            .where(EvaluationJob.status == "queued")
            .order_by(EvaluationJob.created_at.asc())
            .limit(free * 4)
        ).scalars().all()
        candidates = [r.id for r in rows if not is_running(r.id)]
    finally:
        db.close()

    for job_id in candidates[:free]:
        logger.info("swebench worker launching job %s", job_id)
        _running[job_id] = asyncio.create_task(_run_one(job_id, session_factory))


async def worker_loop(session_factory) -> None:
    """Background loop: launch queued jobs up to the concurrency limit."""
    logger.info("swebench worker started (max_concurrency=%d)", config.MAX_CONCURRENCY)
    while True:
        try:
            await _tick(session_factory)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("swebench worker tick failed")
        await asyncio.sleep(config.WORKER_INTERVAL_SECONDS)


def start_worker(session_factory) -> Optional[asyncio.Task]:
    """Start the worker if the feature is enabled. Returns the task (or None)."""
    global _worker_task
    if not config.ENABLED:
        logger.info("swebench disabled; worker not started")
        return None
    if _worker_task and not _worker_task.done():
        return _worker_task
    _worker_task = asyncio.create_task(worker_loop(session_factory))
    return _worker_task


async def stop_worker() -> None:
    global _worker_task
    if _worker_task:
        _worker_task.cancel()
        try:
            await _worker_task
        except asyncio.CancelledError:
            pass
        _worker_task = None
    # Cancel any in-flight jobs cleanly.
    for task in list(_running.values()):
        task.cancel()


# ---------------------------------------------------------------------------
# High-level operations used by the router
# ---------------------------------------------------------------------------

def _now() -> datetime:
    return datetime.now(timezone.utc)


def request_cancel(db, job) -> dict:
    """Cancel a queued job immediately, or flag a running one for cooperative
    cancellation (the runner reclaims its containers/dirs)."""
    terminal = {"completed", "failed", "timeout", "cancelled", "error", "integrity_rejected"}
    if job.status in terminal:
        return {"changed": False, "status": job.status}
    if job.status == "queued" and not is_running(job.id):
        job.status = "cancelled"
        job.outcome = "cancelled"
        job.error_category = "cancelled"
        job.error_reason = "Cancelled before it started."
        job.finished_at = _now()
        db.commit()
        return {"changed": True, "status": "cancelled"}
    job.cancel_requested = True
    db.commit()
    return {"changed": True, "status": job.status, "cancel_requested": True}
