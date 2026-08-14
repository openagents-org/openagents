# -*- coding: utf-8 -*-
"""Durable queue in front of cloud-agent invocation.

``invoke_cloud_agents`` used to be handed straight to FastAPI's
``BackgroundTasks``, which ties the work to the worker process handling the
request. A deploy, a crash or an OOM between the message landing and the model
answering lost the invocation outright — the message sat in the channel and the
agent simply never spoke, with nothing recorded to say it should have.

The fix has the same shape as the agent-side one: write the intent down first,
do the work second, and let a sweep pick up whatever didn't finish.

    enqueue  — in the caller's transaction, so the queue can never disagree
               with the event log
    kick     — still a background task; the queue is for durability, latency
               is unchanged
    sweep    — the timer loop, catching anything the kick didn't complete

Retries are bounded and backed off. A model that is refusing requests will keep
refusing, and burning attempts on it just delays the error message the user
needs to see.
"""

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models import CloudAgentConfig, CloudAgentJob

logger = logging.getLogger(__name__)

MAX_ATTEMPTS = 3
#: Backoff per attempt. Deliberately short — a cloud agent that hasn't answered
#: in a few minutes has, from the user's side, already failed.
BACKOFF_SECONDS = (10, 60, 300)
#: A job left "running" for longer than this belongs to a process that is gone.
RUNNING_STALE = timedelta(minutes=15)
#: Ceiling per sweep, so one workspace's backlog can't monopolise a cycle.
SWEEP_LIMIT = 20


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _backoff(attempts: int) -> timedelta:
    idx = min(max(attempts - 1, 0), len(BACKOFF_SECONDS) - 1)
    return timedelta(seconds=BACKOFF_SECONDS[idx])


def enqueue(db: Session, workspace_id: str, event_snapshot: dict) -> int:
    """Queue invocations for any cloud agents this message targets.

    Called *before* the caller commits, so the job and the message land
    together. Does not commit. Returns how many jobs were queued.
    """
    metadata = event_snapshot.get("metadata") or {}
    targets: List[str] = metadata.get("target_agents") or []
    targets = [t for t in targets if t and t != "__no_response__"]
    if not targets:
        return 0

    event_id = event_snapshot.get("id")
    if not event_id:
        return 0

    queued = 0
    for agent_name in targets:
        # Only cloud agents are ours to run; a locally-hosted agent polls for
        # itself and must not get a job row.
        is_cloud = db.execute(
            select(CloudAgentConfig.id).where(
                CloudAgentConfig.workspace_id == workspace_id,
                CloudAgentConfig.agent_name == agent_name,
                CloudAgentConfig.status == "active",
            )
        ).scalar()
        if not is_cloud:
            continue

        try:
            with db.begin_nested():
                db.add(CloudAgentJob(
                    workspace_id=workspace_id,
                    agent_name=agent_name,
                    event_id=event_id,
                    event_snapshot=event_snapshot,
                    status="pending",
                    next_attempt_at=_now(),
                ))
                db.flush()
            queued += 1
        except IntegrityError:
            # Already queued for this (message, agent) — a retried ingest, say.
            pass

    return queued


def _claim(db: Session, limit: int) -> List[CloudAgentJob]:
    """Take ownership of due jobs.

    ``SKIP LOCKED`` is what lets both backend replicas sweep at once without
    either blocking on the other or two of them running the same job. SQLite
    has no such thing, but nothing runs concurrently there either.
    """
    now = _now()
    stale_cutoff = now - RUNNING_STALE

    q = (
        select(CloudAgentJob)
        .where(
            CloudAgentJob.status.in_(("pending", "running")),
            CloudAgentJob.next_attempt_at <= now,
        )
        .order_by(CloudAgentJob.next_attempt_at.asc())
        .limit(limit)
    )
    if db.bind.dialect.name == "postgresql":
        q = q.with_for_update(skip_locked=True)

    claimed = []
    for job in db.execute(q).scalars().all():
        # A "running" row is only reclaimable once it has gone stale; before
        # that it belongs to a live worker.
        if job.status == "running":
            updated = job.updated_at
            if updated is not None and updated.tzinfo is None:
                updated = updated.replace(tzinfo=timezone.utc)
            if updated is not None and updated > stale_cutoff:
                continue
        job.status = "running"
        job.attempts = (job.attempts or 0) + 1
        job.updated_at = now
        claimed.append(job)
    db.commit()
    return claimed


async def run_due(limit: int = SWEEP_LIMIT) -> int:
    """Run whatever is due. Safe to call from anywhere; never raises."""
    from app.services.cloud_agent import invoke_cloud_agents

    db = SessionLocal()
    try:
        jobs = _claim(db, limit)
    except Exception:
        logger.exception("cloud_agent_queue: could not claim jobs")
        db.close()
        return 0

    if not jobs:
        db.close()
        return 0

    done = 0
    for job in jobs:
        snapshot = job.event_snapshot or {}
        # Narrow the snapshot to this job's agent: the queue is per agent, and
        # the invoker would otherwise re-run every target on the message.
        scoped = dict(snapshot)
        scoped["metadata"] = {**(snapshot.get("metadata") or {}), "target_agents": [job.agent_name]}

        try:
            await invoke_cloud_agents(str(job.workspace_id), scoped)
            job.status = "done"
            job.last_error = None
            done += 1
        except Exception as exc:  # noqa: BLE001 — the point is to record it
            message = str(exc)[:500] or exc.__class__.__name__
            job.last_error = message
            if (job.attempts or 0) >= MAX_ATTEMPTS:
                job.status = "failed"
                logger.error(
                    "cloud_agent_queue: giving up on %s for event %s after %d attempts: %s",
                    job.agent_name, job.event_id, job.attempts, message,
                )
            else:
                job.status = "pending"
                job.next_attempt_at = _now() + _backoff(job.attempts or 1)
                logger.warning(
                    "cloud_agent_queue: %s failed for event %s (attempt %d), retrying: %s",
                    job.agent_name, job.event_id, job.attempts, message,
                )
        job.updated_at = _now()

    try:
        db.commit()
    except Exception:
        logger.exception("cloud_agent_queue: could not record job outcomes")
        db.rollback()
    finally:
        db.close()

    return done


async def kick(workspace_id: Optional[str] = None) -> None:
    """Best-effort immediate run, used as a background task after commit.

    Failure here costs nothing: the rows are already durable, so the sweep will
    pick them up. That is the whole reason the queue exists.
    """
    try:
        await run_due()
    except Exception:
        logger.exception("cloud_agent_queue: kick failed; leaving the jobs to the sweep")


def run_due_blocking(limit: int = SWEEP_LIMIT) -> int:
    """Synchronous entry point, for the timer loop's threadpool."""
    return asyncio.run(run_due(limit))
