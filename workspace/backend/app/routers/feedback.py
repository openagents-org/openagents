# -*- coding: utf-8 -*-
"""In-app feedback — POST /v1/feedback.

Bug reports and feature requests from the workspace UI. Stored in the
feedback table first (so nothing is ever lost), then best-effort forwarded
by email when FEEDBACK_EMAIL_TO is configured. Requires a signed-in user:
feedback is most useful when we can follow up, and it keeps the endpoint
from being an anonymous spam sink.
"""

import html
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Header
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.access import resolve_current_user
from app.config import config
from app.database import get_db
from app.models import Feedback
from app.response import ResponseCode, json_response, success_response
from app.services.email import send_email

router = APIRouter(prefix="/v1/feedback", tags=["feedback"])

VALID_KINDS = {"bug", "feature", "other"}
MAX_MESSAGE_CHARS = 5000
MAX_PER_DAY = 20
# Only these client-context keys are stored, each clipped — the context blob
# is convenience metadata, not a free-form dumping ground.
CONTEXT_KEYS = ("url", "userAgent", "locale", "appVersion")


class FeedbackRequest(BaseModel):
    kind: str
    message: str
    network: Optional[str] = None
    context: Optional[dict] = None


@router.post("")
def submit_feedback(
    body: FeedbackRequest,
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    user = resolve_current_user(db, authorization)
    if not user:
        return json_response(ResponseCode.UNAUTHORIZED, "Sign-in required")

    kind = (body.kind or "").strip().lower()
    if kind not in VALID_KINDS:
        return json_response(ResponseCode.BAD_REQUEST, f"kind must be one of: {', '.join(sorted(VALID_KINDS))}")
    message = (body.message or "").strip()
    if not message:
        return json_response(ResponseCode.BAD_REQUEST, "message is required")
    if len(message) > MAX_MESSAGE_CHARS:
        message = message[:MAX_MESSAGE_CHARS]

    since = datetime.now(timezone.utc) - timedelta(days=1)
    recent = db.execute(
        select(func.count()).select_from(Feedback).where(
            Feedback.user_id == user.id,
            Feedback.created_at >= since,
        )
    ).scalar_one()
    if recent >= MAX_PER_DAY:
        return json_response(ResponseCode.BAD_REQUEST, "Too much feedback today — thank you! Please try again tomorrow.")

    context = None
    if isinstance(body.context, dict):
        context = {k: str(body.context[k])[:500] for k in CONTEXT_KEYS if body.context.get(k)}

    row = Feedback(
        user_id=user.id,
        user_email=user.email,
        workspace_id=(body.network or "").strip()[:64] or None,
        kind=kind,
        message=message,
        context=context or None,
    )
    db.add(row)
    db.commit()

    # Best-effort forward — the DB row is the source of truth either way.
    if config.FEEDBACK_EMAIL_TO:
        ctx_lines = "".join(
            f"<div style='color:#666;font-size:12px'>{html.escape(k)}: {html.escape(v)}</div>"
            for k, v in (context or {}).items()
        )
        send_email(
            config.FEEDBACK_EMAIL_TO,
            f"[OpenAgents feedback] {kind} — {user.email}",
            f"<p style='white-space:pre-wrap'>{html.escape(message)}</p>"
            f"<hr>{ctx_lines}"
            f"<div style='color:#666;font-size:12px'>workspace: {html.escape(row.workspace_id or '-')}"
            f" · user: {html.escape(user.email or user.id)}</div>",
        )

    return success_response({"id": row.id})
