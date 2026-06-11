# -*- coding: utf-8 -*-
"""
Push-notification fan-out for mobile clients (currently iOS only).

Wired into `routers/events.py` via FastAPI BackgroundTasks:
on every `POST /v1/events`, after the response is sent, this module decides
whether the event warrants a push, looks up registered device tokens for the
workspace, and dispatches via APNs directly (no Firebase intermediary).

Filtering rules (see `_should_push`):
  - workspace.message.posted, type=chat, source=openagents:* → always push
  - workspace.message.posted, type=status, content matches a TERMINAL
    pattern (done / completed / failed / error / stopped / stopping failed
    / session restarted / restart failed) → push
  - workspace.message.posted, content contains @<agent-name> where the
    agent is a member of this workspace → push (mention)
  - everything else → skip

Failure handling: tokens that APNs marks `Unregistered` / `BadDeviceToken`
/ `DeviceTokenNotForTopic` are pruned from `device_tokens`. Send failures
are logged but never raised back to the request that triggered them.
"""

import asyncio
import logging
import re

from sqlalchemy import select

from app.database import SessionLocal
from app.models import ChannelHumanMember, DeviceToken, WorkspaceCollaborator, WorkspaceMember
from app.services.apns_client import APNsAlert, send_push

logger = logging.getLogger(__name__)

# Mirrors the Swift client's isTerminalStatus (WorkspaceStore.swift) —
# session-control terminal phrases only. Case-insensitive substring match.
#
# An earlier version of this list also included the natural-English verbs
# "completed" / "done" / "failed" / "error" so an adapter's free-form
# "Task completed" status would push. In practice agents post tool-call
# messages as message_type=status with content like `Bash › for f in ...; do
# ...; done | head` — the bash `done` keyword tripped the substring filter
# and every for-loop fired a push. The 4 verbs were dropped; if we ever
# need a real "agent completed" signal, prefer a structured field over
# substring matching.
_TERMINAL_STATUS_PATTERNS = (
    "stopped",
    "stopping failed",
    "session restarted",
    "restart failed",
)

# Belt-and-suspenders against the narrow patterns above incidentally
# matching inside tool-call args. Status messages whose content starts
# with one of these shapes are intermediate process output — never push.
#   • `<ToolName> › <args>` — current adapter format (Bash, Edit, Read,
#     mcp__X__Y, ToolSearch, TodoWrite, WebFetch, Skill, …)
#   • `**Using tool:**` / `**Running:**` / `**Editing:**` / `**Thinking:**`
#     — legacy adapter markdown markers (see StepParser.swift)
#   • placeholder / process strings the runtime emits between steps
_TOOL_CALL_MARKER_RE = re.compile(
    r"^(?:[A-Za-z_][\w\-]*\s*›|\*\*(?:Using tool|Running|Editing|Thinking):\*\*"
    r"|thinking\.{3}?$|Compacting conversation|processing queued message"
    r"|message queued)",
    re.IGNORECASE,
)


def _is_intermediate_step(content: str) -> bool:
    return bool(_TOOL_CALL_MARKER_RE.match(content.lstrip()))


_MENTION_RE = re.compile(r"@([\w][\w\-_]{0,63})")


def _content_of(event: dict) -> str:
    payload = event.get("payload") or {}
    content = payload.get("content")
    return str(content) if content else ""


def _message_type_of(event: dict) -> str:
    payload = event.get("payload") or {}
    return str(payload.get("message_type") or "chat")


def _source_kind(event: dict) -> str:
    """Return 'agent' / 'human' based on the event's source prefix."""
    src = str(event.get("source") or "")
    if src.startswith("openagents:"):
        return "agent"
    if src.startswith("human:"):
        return "human"
    return "other"


def _is_terminal_status(content: str) -> bool:
    lower = content.lower()
    return any(pat in lower for pat in _TERMINAL_STATUS_PATTERNS)


def _extract_mentions(content: str) -> set[str]:
    return {m.group(1).lower() for m in _MENTION_RE.finditer(content or "")}


def _should_push(
    event: dict,
    workspace_agent_names: set[str],
    workspace_human_keys: dict[str, str] | None = None,
) -> tuple[bool, str, str | None]:
    """Decide whether `event` warrants a push.

    Returns (should_push, reason, mention_target_email). `reason` tags
    the notification's `data` payload so the iOS app can render
    different sounds/categories later. `mention_target_email` is set
    only when a `@name` resolves to a specific human collaborator —
    the fan-out then scopes its `device_tokens` query by that email so
    we wake up just that person's devices, not the whole workspace.

    `workspace_human_keys` maps lowercased mention candidates (display
    name slug, email local-part) → that human's email.
    """
    if event.get("type") != "workspace.message.posted":
        return False, "", None

    msg_type = _message_type_of(event)
    content = _content_of(event)
    source_kind = _source_kind(event)

    # Intermediate process output (thinking, tool calls, Compacting …) is
    # never push-worthy — not even when it incidentally contains "@name"
    # (e.g. `grep "@bary" file.md` inside a Bash › status, or an agent's
    # thinking text "I should ask @bary about this"). Short-circuit before
    # any other classification.
    if msg_type == "thinking" or _is_intermediate_step(content):
        return False, "", None

    # Mentions take priority — applies to both chat and status, agent or
    # human. Agent-name match → broadcast within the workspace as before.
    # Human-name match → scope to that human's device tokens.
    mentions = _extract_mentions(content)
    if mentions:
        if mentions & {n.lower() for n in workspace_agent_names}:
            return True, "mention", None
        if workspace_human_keys:
            for m in mentions:
                if m in workspace_human_keys:
                    return True, "mention", workspace_human_keys[m]

    if msg_type == "chat":
        # Both agent and human chat reach the fan-out. The Slack-style
        # channel-membership filter in `_fanout_impl` excludes the
        # sender's own devices, so humans don't get pushed for their own
        # messages while other channel members do.
        return True, "chat", None

    if msg_type in ("status", "thinking"):
        # Per-decision: only push on TERMINAL state transitions so we don't
        # flood on every "thinking" heartbeat. Tool-call / process status
        # messages (Bash › …, Compacting …, thinking…) short-circuit
        # before the substring check so a literal "stopped" inside bash
        # args can't trip a push.
        if _is_intermediate_step(content):
            return False, "", None
        if _is_terminal_status(content):
            return True, "status", None
        return False, "", None

    return False, "", None


def _build_alert(event: dict, reason: str) -> APNsAlert:
    """Build the user-visible title + body for the APNs alert."""
    source = str(event.get("source") or "")
    sender_name = source.split(":", 1)[1] if ":" in source else source

    if reason == "mention":
        title = f"{sender_name} mentioned you"
    elif reason == "status":
        title = f"{sender_name}"
    else:  # chat
        title = sender_name

    body = _content_of(event).strip()
    if len(body) > 240:
        body = body[:237] + "…"
    if not body:
        body = "(no content)"

    target = str(event.get("target") or "")
    channel = target[len("channel/"):] if target.startswith("channel/") else ""
    return APNsAlert(title=title, body=body, thread_id=channel or None)


def _build_data_payload(event: dict, reason: str) -> dict[str, str]:
    """Build the custom userInfo keys delivered alongside the alert.
    APNs puts these as siblings of the `aps` key, where iOS surfaces them
    in `UNNotification.request.content.userInfo`. All values stringified
    to match the previous FCM contract.
    """
    target = str(event.get("target") or "")
    channel = target[len("channel/"):] if target.startswith("channel/") else ""
    return {
        "reason": reason,
        "channel": channel,
        "event_id": str(event.get("id") or ""),
        "event_type": str(event.get("type") or ""),
        "source": str(event.get("source") or ""),
    }


def _workspace_agent_names(db, workspace_id: str) -> set[str]:
    rows = db.execute(
        select(WorkspaceMember.agent_name).where(WorkspaceMember.workspace_id == workspace_id)
    ).scalars().all()
    return set(rows)


def _workspace_human_keys(db, workspace_id: str) -> dict[str, str]:
    """Build the mention-resolution table for humans in this workspace.

    Maps every plausible thing a person might type after `@` to that
    human's email. Two keys are generated per collaborator:

      • `email-local-part` — e.g. `bary@peakmojo.com` → "bary".
      • `display_name_slug` — e.g. "Bary Huang" → "bary-huang",
        falling back to "bary" (the first word lowercased) so the most
        common shorthand also resolves.

    Last write wins on key collisions, which is fine: the value points
    at an email and that's all we need to scope device tokens.
    """
    keys: dict[str, str] = {}
    rows = db.execute(
        select(WorkspaceCollaborator.email, WorkspaceCollaborator.display_name)
        .where(WorkspaceCollaborator.workspace_id == workspace_id)
    ).all()
    import re as _re
    for email, display_name in rows:
        if not email:
            continue
        email_l = email.strip().lower()
        local = email_l.split("@", 1)[0]
        if local:
            keys[local] = email_l
        if display_name:
            cleaned = display_name.strip().lower()
            if cleaned:
                # Whole-name slug (spaces → hyphens, drop non-word/hyphen)
                slug = _re.sub(r"[^a-z0-9]+", "-", cleaned).strip("-")
                if slug:
                    keys[slug] = email_l
                # First word — most common shorthand ("@bary" for "Bary Huang")
                first = cleaned.split()[0]
                if first:
                    keys[first] = email_l
    return keys


def fanout_for_event(workspace_id: str, event: dict) -> None:
    """Entry point for the BackgroundTasks hook. Opens its own DB session
    (the request's session is closed by the time this runs)."""
    try:
        _fanout_impl(workspace_id, event)
    except Exception as e:
        # Never let push send failures propagate — the event has already
        # been committed; we don't want background-task exceptions to
        # corrupt anything downstream.
        logger.warning("push: fanout failed for workspace=%s: %s", workspace_id, e)


def _channel_name_from_target(event: dict) -> str:
    target = str(event.get("target") or "")
    return target[len("channel/"):] if target.startswith("channel/") else ""


def _channel_human_emails(db, workspace_id: str, channel_name: str) -> set[str]:
    """Return the lowercased emails of humans who have joined this channel.

    The implicit-join hook in workspace_mod inserts a row the first time
    someone with a `sender_email` posts in the channel, so a Slack-style
    "you've participated → you're a member" model holds.
    """
    if not channel_name:
        return set()
    from app.models import Channel
    rows = db.execute(
        select(ChannelHumanMember.user_email)
        .join(Channel, Channel.id == ChannelHumanMember.channel_id)
        .where(
            Channel.workspace_id == workspace_id,
            Channel.name == channel_name,
        )
    ).scalars().all()
    return {e for e in rows if e}


def _sender_email_for(event: dict) -> str | None:
    """The signed-in sender's email if they identified themselves on the
    chat post — used to skip pushing back to their own devices.
    """
    payload = event.get("payload") or {}
    email = str(payload.get("sender_email") or "").strip().lower()
    return email or None


def _fanout_impl(workspace_id: str, event: dict) -> None:
    db = SessionLocal()
    try:
        agent_names = _workspace_agent_names(db, workspace_id)
        human_keys = _workspace_human_keys(db, workspace_id)
        should, reason, mention_target_email = _should_push(
            event, agent_names, human_keys,
        )
        if not should:
            return

        sender_email = _sender_email_for(event)
        token_query = select(DeviceToken).where(DeviceToken.workspace_id == workspace_id)

        if mention_target_email:
            # Mention path — scope to the mentioned human, regardless of
            # whether they're in this channel. One-off notification.
            token_query = token_query.where(DeviceToken.user_email == mention_target_email)
            scope_label = mention_target_email
        else:
            # Chat / status path — scope to humans who have joined *this*
            # channel via implicit Slack-style membership. Skip the
            # sender's own devices so they don't get notified about their
            # own message.
            channel_name = _channel_name_from_target(event)
            channel_humans = _channel_human_emails(db, workspace_id, channel_name)
            if sender_email:
                channel_humans.discard(sender_email)
            if not channel_humans:
                logger.info(
                    "push: skipped reason=%s workspace=%s — no channel members",
                    reason, workspace_id,
                )
                return
            token_query = token_query.where(DeviceToken.user_email.in_(channel_humans))
            scope_label = f"#{channel_name}[{len(channel_humans)}]"

        tokens: list[DeviceToken] = db.execute(token_query).scalars().all()
        if not tokens:
            return

        alert = _build_alert(event, reason)
        data = _build_data_payload(event, reason)

        # aioapns is async; this hook runs from FastAPI BackgroundTasks which
        # is sync, so we drive the coroutine on a private event loop.
        token_strings = [t.fcm_token for t in tokens]
        _, dead = asyncio.run(send_push(token_strings, alert, data))

        if dead:
            _prune_dead_tokens(db, tokens, dead)
        logger.info(
            "push: sent reason=%s workspace=%s scope=%s tokens=%d dead=%d",
            reason, workspace_id, scope_label, len(token_strings), len(dead),
        )
    finally:
        db.close()


def _prune_dead_tokens(db, tokens: list[DeviceToken], dead_token_strings: list[str]) -> None:
    """Delete DeviceToken rows whose APNs token was rejected as dead.

    `dead_token_strings` is the subset returned by `apns_client.send_push`
    that APNs flagged as `Unregistered` / `BadDeviceToken` / etc. — those
    devices have uninstalled, opted out, or never had this app registered.
    """
    dead_set = set(dead_token_strings)
    invalid_ids = [t.id for t in tokens if t.fcm_token in dead_set]
    if not invalid_ids:
        return
    db.query(DeviceToken).filter(DeviceToken.id.in_(invalid_ids)).delete(
        synchronize_session=False
    )
    db.commit()
    logger.info("push: pruned %d dead token(s)", len(invalid_ids))
