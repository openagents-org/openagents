# -*- coding: utf-8 -*-
"""
Pipeline factory — creates the workspace mod pipeline and provides
a FastAPI dependency for injecting it into routes.

The pipeline is created once at startup. Each request gets a fresh
PipelineContext carrying the DB session and auth info.
"""

from openagents.core.onm_pipeline import Pipeline

from app.mods.auth import AuthMod
from app.mods.workspace_mod import WorkspaceMod
from app.mods.persistence import PersistenceMod


def create_workspace_pipeline() -> Pipeline:
    """Create the standard workspace pipeline: auth → workspace → persistence."""
    return Pipeline(mods=[
        AuthMod(),           # guard,     priority 0
        WorkspaceMod(),      # transform, priority 50
        PersistenceMod(),    # observe,   priority 90
    ])


def create_integration_pipeline() -> Pipeline:
    """Persistence only — for messages bridged in from Slack / Lark / Telegram.

    Both omissions are deliberate.

    ``AuthMod`` is skipped because it only understands workspace tokens and
    logged-in humans; an integration call carries neither, and teaching it a
    third identity would mean the gateway credential flowing through the shared
    yes/no check. The endpoint has already resolved a principal before building
    the event, so authorization happened — just earlier, and with more
    precision than a boolean.

    ``WorkspaceMod`` is skipped because of what it would do with the message
    body. It parses ``@name`` against *every* agent in the workspace and gives
    a match top routing priority, so an external Slack user could type
    ``@some-other-agent`` and summon an agent this binding never covered —
    reading the thread, its attachments, and running tools. The endpoint sets
    ``target_agents`` from the principal instead.

    Of what else that mod does for a bridged message, only auto-titling is
    useful, and it is a plain function the endpoint calls directly; the human
    collaborator and channel-join hooks both no-op without a ``sender_email``.

    The cost of this fork is that behaviour added to ``_handle_message_posted``
    will not reach integration messages. That is the intended trade: a security
    boundary is worth little if it drifts every time unrelated routing changes.
    **Post-commit dispatch is the opposite case** and must stay shared — see
    ``app/services/event_dispatch.py``.
    """
    return Pipeline(mods=[
        PersistenceMod(),    # observe,   priority 90
    ])


# Singleton pipelines — created once, reused across requests
pipeline = create_workspace_pipeline()
integration_pipeline = create_integration_pipeline()
