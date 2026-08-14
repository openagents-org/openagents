# -*- coding: utf-8 -*-
"""Everything that has to happen *after* an event is committed.

These actions used to live inline in ``POST /v1/events``. They are not part of
the mod pipeline: ``PersistenceMod`` only writes the event row and bumps the
channel's ``last_event_at``. Waking the SSE stream, dropping the poll cache,
invoking cloud agents and fanning out pushes all happen in the router, after
``db.commit()``.

That distinction matters now that a second write path exists. The integration
ingest endpoint deliberately bypasses ``WorkspaceMod`` — it must not inherit
mention parsing or agent routing, because an external platform user must never
be able to summon an agent the binding doesn't cover. But it must *not* bypass
this, or a Slack message would land in the database and nothing downstream
would notice: the workspace UI would stay silent (breaking the "same
conversation, visible live in OA" requirement) and a cloud agent would never
be woken at all.

So: routing forks, dispatch is shared. Anything added here reaches both paths.
"""

import hashlib
import json as _json
import logging

from app import cache

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Poll-cache invalidation
# ---------------------------------------------------------------------------

def poll_cache_keys_for(workspace_id: str, event_type: str = ""):
    """Return the (head_tracker_key, at_head_key) pairs to drop when a new
    event lands in *workspace_id*.

    Agents poll with a small set of well-known filter combinations, so rather
    than a wildcard scan we enumerate the patterns the adapters actually use:

    1. ``type=workspace.message.posted, sort=asc, limit=500`` — the main
       message poll in ``workspace-client.js:pollPending``.
    2. ``type=workspace.agent.control, target=openagents:*, sort=asc,
       limit=50`` — the control-event poll.
    3. The same as (1) with ``sort=desc, limit=1`` — ``getHeadEventId``.

    Common limits and both sort orders are included so nothing is missed.
    """
    keys = []

    # Same filter_parts the poll endpoint builds:
    #   [workspace_id, target, channel, type, conversation, sort, limit]
    common_filters = []

    if event_type.startswith("workspace.message"):
        for sort in ("asc",):
            for limit in (500,):
                common_filters.append(
                    (workspace_id, "", "", "workspace.message.posted", "", sort, str(limit))
                )
        # getHeadEventId uses sort=desc, limit=1
        common_filters.append(
            (workspace_id, "", "", "workspace.message.posted", "", "desc", "1")
        )

    elif event_type.startswith("workspace.agent.control"):
        for limit in (50, 500):
            common_filters.append(
                (workspace_id, "", "", "workspace.agent.control", "", "asc", str(limit))
            )

    # Always invalidate the untyped "all events" poll pattern too
    for sort in ("asc", "desc"):
        for limit in (50, 500):
            common_filters.append(
                (workspace_id, "", "", "", "", sort, str(limit))
            )

    for parts in common_filters:
        fh = hashlib.sha1("|".join(parts).encode("utf-8")).hexdigest()
        keys.append(("v1events:head:" + fh, "v1events:athead:" + fh))

    return keys


def invalidate_poll_cache(workspace_id: str, event_type: str = "") -> None:
    """Drop head-tracker and at-head entries so polling agents see a newly
    posted event immediately instead of a cached-empty response."""
    for head_key, athead_key in poll_cache_keys_for(workspace_id, event_type):
        try:
            cache.delete_key(head_key)
        except Exception:
            pass
        try:
            cache.delete_key(athead_key)
        except Exception:
            pass


# ---------------------------------------------------------------------------
# Stream wake-up
# ---------------------------------------------------------------------------

def publish_event(workspace_id: str, event_snapshot: dict) -> None:
    """Publish to the workspace's Redis channel.

    This is what wakes both the workspace UI's SSE connection and the
    gateway's integration stream. Never raises — a workspace with Redis
    unavailable degrades to cursor polling rather than failing the write.
    """
    try:
        cache.publish_event(
            f"ws:{workspace_id}:events",
            _json.dumps(event_snapshot, default=str, separators=(",", ":")).encode(),
        )
    except Exception:
        pass


# ---------------------------------------------------------------------------
# The one entry point
# ---------------------------------------------------------------------------

def post_commit_dispatch(
    background_tasks,
    workspace_id: str,
    event_snapshot: dict,
    *,
    workflow: bool = True,
) -> None:
    """Run every post-commit side effect for one event.

    Call this immediately after ``db.commit()``. Cheap, synchronous work (cache
    invalidation, the Redis publish) runs inline so listeners wake with minimal
    latency; anything that does real work runs via ``BackgroundTasks`` after the
    response is sent, exactly as before.

    ``workflow`` is off for integration messages: an integration channel is a
    mirror of an external thread, not something a Workflow template drives.
    Cloud-agent invocation stays on in both paths — the agent a binding points
    at may itself be a cloud agent, and skipping it would mean that binding
    simply never answers.
    """
    event_type = event_snapshot.get("type") or ""

    try:
        invalidate_poll_cache(workspace_id, event_type)
    except Exception:
        pass

    publish_event(workspace_id, event_snapshot)

    # Push fan-out. Opens its own short-lived session — the caller's is
    # request-scoped and already committed.
    from app.services.push import fanout_for_event
    background_tasks.add_task(fanout_for_event, workspace_id, event_snapshot)

    if event_type == "workspace.message.posted":
        from app.services.cloud_agent import invoke_cloud_agents
        background_tasks.add_task(invoke_cloud_agents, workspace_id, event_snapshot)

        if workflow:
            from app.services.workflow import advance_workflow
            background_tasks.add_task(advance_workflow, workspace_id, event_snapshot)
