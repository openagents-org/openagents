# -*- coding: utf-8 -*-
"""
mod/auth — verify workspace token or human identity for an event.

Guard mod (priority 0). Rejects events from unauthorized sources.

Delegates to app.access.verify_workspace_access — the single source of truth
shared with the REST routers — so the event pipeline honours the same rules:
  1. Workspace token (X-Workspace-Token) — the machine credential (agents).
  2. Member identity (Firebase/Apple bearer → membership row, or legacy
     creator_email / collaborator match).
  3. Open, non-enforced workspace (no token AND require_login=False).
This is also where enforced-login (require_login) takes effect on the write
path: an anonymous event to an enforced open workspace is now rejected.

Expects context.extra to contain:
  - token: str (workspace token)
  - bearer_token: str (identity ID token, optional)
  - workspace: Workspace ORM object
"""

import logging
from typing import List, Optional

from openagents.core.onm_events import Event
from openagents.core.onm_mods import GuardMod, PipelineContext

logger = logging.getLogger(__name__)


class AuthMod(GuardMod):
    """Verify that the event source is authorized for this network."""
    name = "auth"
    intercepts: List[str] = []   # Match all events
    priority = 0

    async def process(self, event: Event, context: PipelineContext) -> Optional[Event]:
        workspace = context.extra.get("workspace")
        token = context.extra.get("token")
        bearer_token = context.extra.get("bearer_token")

        if not workspace:
            logger.warning("auth: no workspace in context, rejecting event")
            return None

        from app.access import verify_workspace_access

        # db is derived from the workspace's own session inside
        # verify_workspace_access (object_session); pass it explicitly when the
        # pipeline provides one, to be safe.
        db = getattr(context, "db", None) or context.extra.get("db")
        authorization = f"Bearer {bearer_token}" if bearer_token else None

        # The pipeline is the write path (posting messages, creating channels,
        # agent actions). Identity-based callers must be at least `member` —
        # this is where the read-only `viewer` role is enforced. Machine token
        # holders (agents) bypass the role check, and anonymous access to an
        # open, non-enforced workspace is still allowed (both handled inside
        # verify_workspace_access).
        if verify_workspace_access(workspace, token, authorization, db=db, min_role="member"):
            event.network = str(workspace.id)
            return event

        logger.warning("auth: rejected unauthorized/insufficient-role event for workspace %s", workspace.id)
        return None
