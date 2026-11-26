# -*- coding: utf-8 -*-
"""OpenAgents Share: publish an agent's thread and let guests into it.

A person finishes useful work with an agent in their own coding session and
says "share this with my team". Their agent calls ``publish``, which makes a
small workspace holding one thread: the excerpts the person chose from the
session and the agent as the thread's only member. It returns two links:

  * the owner link, carrying the workspace token (the creator's credential;
    signing in from it makes the workspace theirs), and
  * the guest link (/jam/<token>), which opens only that thread.

A guest needs no account. Reading needs nothing; posting needs a display name,
which mints a guest session kept by the browser. Guests post as
``human:guest-<id>@guest.invalid`` with ``metadata.guest`` set, so they never
pass for a member.

The thread is passive: a guest's plain message is a comment and never runs the
agent. Only a message addressed to the agent (a leading or inline @name) does,
so a comment costs the owner nothing. A guest may address only the agents in
this thread.

Nothing here touches existing workspaces: a guest link is only ever minted
together with the workspace it opens, by ``publish``.
"""

import copy
import hashlib
import logging
import re
import secrets
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import List, Optional, Tuple

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import (
    Channel,
    ChannelMember,
    EventRecord,
    ThreadGuest,
    ThreadGuestLink,
    ThreadGuestRequest,
    Workspace,
    WorkspaceMember,
    WorkspaceMembership,
)
from app.naming import has_unsafe_chars, sanitize_inline

logger = logging.getLogger(__name__)

GUEST_DOMAIN = "guest.invalid"
GUEST_CAPABILITY = "guest_turns"
AGENT_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,47}$")
MAX_EXCERPTS = 40
MAX_EXCERPT_CHARS = 8000
MAX_TOTAL_EXCERPT_CHARS = 60000
MAX_GUEST_MESSAGE_CHARS = 8000
MAX_GUESTS_PER_LINK = 200

# Posting budgets. A guest link may be forwarded beyond the people it was
# meant for; these keep a leaked link from flooding the owner's agent.
GUEST_POSTS_PER_HOUR = 60
LINK_POSTS_PER_HOUR = 300
WINDOW = timedelta(hours=1)


class LinkError(Exception):
    """A refusal to show the caller, with its HTTP status."""

    def __init__(self, status: int, message: str, data=None):
        super().__init__(message)
        self.status = status
        self.message = message
        self.data = data


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(dt: Optional[datetime]) -> Optional[datetime]:
    if dt is not None and dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def _sha(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def frontend_base() -> str:
    import app.config as app_config  # read at call time: settings can be reloaded
    return (app_config.config.FRONTEND_BASE_URL or "").rstrip("/")


def guest_url(token: str) -> str:
    return f"{frontend_base()}/jam/{token}"


def owner_url(workspace: Workspace, channel_name: str) -> str:
    """The owner's light jam: just this conversation, its link and "keep it".

    The full workspace UI comes only once the person keeps the conversation.
    """
    return f"{frontend_base()}/jam/own/{workspace.slug}?token={workspace.password_hash}"


def guest_address(guest_id: str) -> str:
    return f"guest-{guest_id}@{GUEST_DOMAIN}"


def is_guest_source(source: Optional[str]) -> bool:
    return bool(source) and source.startswith("human:") and source.lower().endswith("@" + GUEST_DOMAIN)


def clean_name(raw: Optional[str], limit: int) -> str:
    name = sanitize_inline(raw or "")
    name = re.sub(r"\s+", " ", name).strip()
    return name[:limit]


# ---------------------------------------------------------------------------
# Publish
# ---------------------------------------------------------------------------

def _parse_expiry(raw: Optional[str]) -> Optional[datetime]:
    if raw in (None, "", "never"):
        return None
    try:
        dt = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except ValueError:
        raise LinkError(400, "link_expires_at must be an ISO-8601 timestamp, or null for never")
    dt = _aware(dt)
    if dt <= _now():
        raise LinkError(400, "link_expires_at must be in the future")
    return dt


def _validate_publish(body) -> Tuple[str, str, str, str]:
    key = (body.idempotency_key or "").strip()
    if not (16 <= len(key) <= 128):
        raise LinkError(400, "idempotency_key must be 16-128 characters")
    title = clean_name(body.title, 120)
    if not title:
        raise LinkError(400, "title is required")
    agent = (body.agent_name or "").strip()
    if not AGENT_NAME_RE.match(agent):
        raise LinkError(400, "agent_name must be 1-48 letters, digits, '-' or '_'")
    agent_type = (body.agent_type or "").strip()[:40]
    if agent_type and not re.fullmatch(r"[A-Za-z0-9:_.-]+", agent_type):
        raise LinkError(400, "invalid agent_type")
    excerpts = body.excerpts or []
    if len(excerpts) > MAX_EXCERPTS:
        raise LinkError(400, f"at most {MAX_EXCERPTS} excerpts")
    total = 0
    for item in excerpts:
        if item.author not in ("owner", "agent"):
            raise LinkError(400, "excerpt author must be 'owner' or 'agent'")
        text = item.text or ""
        if not text.strip() or len(text) > MAX_EXCERPT_CHARS:
            raise LinkError(400, f"each excerpt needs 1-{MAX_EXCERPT_CHARS} characters")
        total += len(text)
    intro = body.intro or ""
    if len(intro) > MAX_EXCERPT_CHARS:
        raise LinkError(400, "intro is too long")
    if total + len(intro) > MAX_TOTAL_EXCERPT_CHARS:
        raise LinkError(400, "the shared conversation is too long; choose fewer excerpts")
    return key, title, agent, agent_type


def _publish_result(db: Session, link: ThreadGuestLink, created: bool) -> dict:
    workspace = db.get(Workspace, link.workspace_id)
    channel = db.execute(select(Channel).where(
        Channel.workspace_id == link.workspace_id, Channel.name == link.channel_name,
    )).scalar_one()
    return {
        "created": created,
        "workspaceId": str(workspace.id),
        "slug": workspace.slug,
        "token": workspace.password_hash,
        "channel": {"name": channel.name, "title": channel.title},
        "agentName": channel.master_agent,
        "ownerUrl": owner_url(workspace, channel.name),
        "guestUrl": guest_url(link.token),
        "link": serialize_link(link),
    }


def _seed(db: Session, workspace_id: str, channel_name: str, source: str, sender_name: str,
          content: str, ts: int, kind: str) -> None:
    payload = {"content": content, "message_type": "chat"}
    if source.startswith("human:"):
        payload.update({"sender_type": "human", "sender_name": sender_name, "sender_display_name": sender_name})
    # An agent's excerpt carries no name of its own: clients name and draw it
    # from the agent (as they do its live replies), so both look the same.
    db.add(EventRecord(
        id=str(uuid.uuid4()),
        network_id=workspace_id,
        type="workspace.message.posted",
        source=source,
        target=f"channel/{channel_name}",
        payload=payload,
        metadata_={"share_seed": True, "share_seed_kind": kind,
                   **({"share_owner": True} if source.startswith("human:") else {})},
        timestamp=ts,
        visibility="channel",
    ))


def publish(db: Session, body, owner) -> dict:
    """Create (or, on retry, return) the shared workspace, thread and guest link.

    ``owner`` is the signed-in account when the caller sent one: the workspace
    is then theirs from the start. Without it the workspace is anonymous and
    the owner link's token is the only credential, as for any CLI-created
    workspace; signing in from that link later claims it.
    """
    key, title, agent_name, agent_type = _validate_publish(body)
    expires_at = _parse_expiry(body.link_expires_at)
    access = (getattr(body, "guest_agent_access", None) or "open").strip().lower()
    if access not in AGENT_ACCESS:
        raise LinkError(400, "guest_agent_access must be 'open', 'approval' or 'off'")
    access_mode = (getattr(body, "access", None) or "link").strip().lower()
    if access_mode not in ("link", "invited"):
        raise LinkError(400, "access must be 'link' or 'invited'")
    invited = normalize_emails(getattr(body, "invited_emails", None) or [])
    key_hash = _sha("share-publish:" + key)

    existing = db.execute(select(ThreadGuestLink).where(
        ThreadGuestLink.publish_key_hash == key_hash)).scalar_one_or_none()
    if existing is not None:
        return _publish_result(db, existing, created=False)

    owner_email = owner.email.strip().lower() if owner is not None else None
    owner_name = clean_name(body.owner_name, 60) or (
        (getattr(owner, "display_name", None) or owner_email.split("@")[0]) if owner_email else "Owner")

    workspace = Workspace(
        slug=secrets.token_hex(4),
        name=clean_name(body.workspace_name, 80) or f"{owner_name}'s shared workspace",
        creator_email=owner_email,
        password_hash=secrets.token_urlsafe(32),
        require_login=True,
        settings={"openagents_share": {"version": 1}},
        status="active",
    )
    db.add(workspace)
    db.flush()
    wid = str(workspace.id)
    if owner is not None:
        db.add(WorkspaceMembership(workspace_id=wid, user_id=owner.id, role="owner"))
    db.add(WorkspaceMember(
        workspace_id=wid,
        agent_name=agent_name,
        # Shown by its own name (letters, digits, - and _, no spaces), the
        # handle people type to ask it; never a generic label like "Claude Code".
        display_name=None,
        owner_email=owner_email,
        role="master",
        agent_type=agent_type or None,
        status="offline",
    ))
    channel_name = f"share-{secrets.token_hex(6)}"
    channel = Channel(
        workspace_id=wid,
        name=channel_name,
        title=title,
        created_by=agent_name,
        master_agent=agent_name,
        response_mode="passive",
        visibility="public",
        owner_email=owner_email,
        status="active",
    )
    db.add(channel)
    db.flush()
    db.add(ChannelMember(channel_id=channel.id, agent_name=agent_name))

    owner_source = f"human:{owner_email}" if owner_email else "human:owner"
    agent_label = agent_name
    ts = int(time.time() * 1000) - (len(body.excerpts or []) + 2)
    for item in body.excerpts or []:
        if item.author == "owner":
            _seed(db, wid, channel_name, owner_source, owner_name, item.text, ts, "excerpt")
        else:
            _seed(db, wid, channel_name, f"openagents:{agent_name}", agent_label, item.text, ts, "excerpt")
        ts += 1
    if (body.intro or "").strip():
        _seed(db, wid, channel_name, f"openagents:{agent_name}", agent_label, body.intro, ts, "intro")
        ts += 1
    channel.last_event_at = ts

    link = ThreadGuestLink(
        workspace_id=wid,
        channel_name=channel_name,
        token=secrets.token_urlsafe(24),
        created_by=f"human:{owner_email}" if owner_email else "share:anonymous",
        owner_name=owner_name,
        can_post=getattr(body, "guests_can_post", True) is not False,
        access=access_mode,
        invited_emails=invited,
        approval_mode=AGENT_ACCESS[access],
        allow_guest_agents=getattr(body, "guests_can_bring_agents", True) is not False,
        publish_key_hash=key_hash,
        expires_at=expires_at,
    )
    db.add(link)
    try:
        db.commit()
    except IntegrityError:
        # A concurrent retry of the same publish won the race: answer with its result.
        db.rollback()
        winner = db.execute(select(ThreadGuestLink).where(
            ThreadGuestLink.publish_key_hash == key_hash)).scalar_one_or_none()
        if winner is None:
            raise
        return _publish_result(db, winner, created=False)
    db.refresh(link)
    if invited:
        send_invites(link, title, owner_name, invited)
    logger.info("share: published workspace=%s channel=%s signed_in=%s expires=%s",
                wid, channel_name, owner is not None, expires_at.isoformat() if expires_at else "never")
    return _publish_result(db, link, created=True)


# ---------------------------------------------------------------------------
# Link state
# ---------------------------------------------------------------------------

def serialize_link(link: ThreadGuestLink) -> dict:
    return {
        "id": link.id,
        "channel": link.channel_name,
        "url": guest_url(link.token),
        "canPost": bool(link.can_post),
        "approvalMode": link.approval_mode or "none",
        "access": link.access or "link",
        "allowGuestAgents": bool(link.allow_guest_agents),
        "invitedEmails": list(link.invited_emails or []),
        "expiresAt": _aware(link.expires_at).isoformat() if link.expires_at else None,
        "revokedAt": _aware(link.revoked_at).isoformat() if link.revoked_at else None,
        "createdAt": _aware(link.created_at).isoformat() if link.created_at else None,
    }


def viewer_email(db: Session, authorization: Optional[str]) -> Optional[str]:
    if not authorization:
        return None
    from app.access import resolve_current_user
    user = resolve_current_user(db, authorization)
    return user.email.strip().lower() if user else None


def check_invited(db: Session, link: ThreadGuestLink, workspace: Workspace, authorization: Optional[str]) -> Optional[str]:
    """For invite-only jams: the signed-in invitee's email, or a LinkError. The owner always passes."""
    if (link.access or "link") != "invited":
        return None
    email = viewer_email(db, authorization)
    if not email:
        raise LinkError(401, "This jam is invite-only. Sign in with the email it was shared with.",
                        data={"access": "invited"})
    if email in [e.lower() for e in (link.invited_emails or [])] or room_owner_user(db, workspace, authorization):
        return email
    raise LinkError(403, "You don't have access to this jam. Ask the person who shared it to invite you.",
                    data={"access": "invited", "email": email})


def live_link(db: Session, token: str, authorization: Optional[str] = None) -> Tuple[ThreadGuestLink, Workspace, Channel]:
    """The link, its workspace and thread — or a LinkError saying why not.

    404 covers unknown and revoked alike (a revoked link reveals nothing);
    410 says the link existed and ran out, which the guest can act on.
    """
    if not token or len(token) > 128:
        raise LinkError(404, "This link doesn't exist or was turned off")
    link = db.execute(select(ThreadGuestLink).where(ThreadGuestLink.token == token)).scalar_one_or_none()
    if link is None or link.revoked_at is not None:
        raise LinkError(404, "This link doesn't exist or was turned off")
    workspace = db.get(Workspace, link.workspace_id)
    if workspace is None or workspace.status == "deleted":
        raise LinkError(404, "This link doesn't exist or was turned off")
    if link.expires_at is not None and _aware(link.expires_at) <= _now():
        raise LinkError(410, "This link has expired")
    channel = db.execute(select(Channel).where(
        Channel.workspace_id == link.workspace_id, Channel.name == link.channel_name,
    )).scalar_one_or_none()
    if channel is None or (channel.status or "active") == "deleted":
        raise LinkError(404, "This link doesn't exist or was turned off")
    check_invited(db, link, workspace, authorization)
    return link, workspace, channel


def guest_for_session(db: Session, link: ThreadGuestLink, session: Optional[str]) -> Optional[ThreadGuest]:
    if not session or len(session) > 128:
        return None
    guest = db.execute(select(ThreadGuest).where(ThreadGuest.session_hash == _sha(session))).scalar_one_or_none()
    if guest is None or guest.link_id != link.id or guest.revoked_at is not None:
        return None
    return guest


def channel_agents(db: Session, workspace: Workspace, channel: Channel) -> List[dict]:
    names = [m.agent_name for m in (channel.participants or []) if m.agent_name != "__no_response__"]
    if not names:
        return []
    members = db.execute(select(WorkspaceMember).where(
        WorkspaceMember.workspace_id == workspace.id,
        WorkspaceMember.agent_name.in_(names),
        WorkspaceMember.status != "removed",
    )).scalars().all()
    from app.routers.network import effective_agent_status
    from app.services.room_agents import brought_by
    brought = brought_by(db, members)
    now = _now()
    out = []
    for m in members:
        online = effective_agent_status(m, now) == "online"
        out.append({
            "name": m.agent_name,
            "displayName": m.display_name or m.agent_name,
            "type": m.agent_type,
            "online": online,
            # False when the connected launcher is too old to run a guest's
            # turn read-only; a guest's request then gets a notice instead.
            "acceptsGuests": GUEST_CAPABILITY in (m.capabilities or []),
            # Set for an agent a guest brought: that guest's display name.
            "broughtBy": brought.get(m.agent_name),
        })
    return out


def is_guest_email(email: Optional[str]) -> bool:
    return bool(email) and email.strip().lower().endswith("@" + GUEST_DOMAIN)


def guest_may_run(db: Session, workspace_id, channel: Optional[Channel], member, email: str) -> bool:
    """A guest may run an agent of the thread their live link opens — no other."""
    local = email.strip().lower().split("@", 1)[0]
    if not local.startswith("guest-") or channel is None:
        return False
    guest = db.get(ThreadGuest, local[len("guest-"):])
    if guest is None or guest.revoked_at is not None:
        return False
    link = db.get(ThreadGuestLink, guest.link_id)
    if (link is None or link.revoked_at is not None or not link.can_post
            or str(link.workspace_id) != str(workspace_id) or link.channel_name != channel.name
            or (link.expires_at is not None and _aware(link.expires_at) <= _now())):
        return False
    if (link.approval_mode or "none") == "off":
        return False   # the owner doesn't let guests use the agent
    if GUEST_CAPABILITY not in (getattr(member, "capabilities", None) or []):
        # The connected client can't run a guest's turn read-only (an older
        # launcher): it would run with the owner's full rights. Never route.
        return False
    return any(p.agent_name == member.agent_name for p in (channel.participants or []))


def guest_blocked_text(db: Session, workspace: Workspace, channel: Channel, member) -> Optional[str]:
    """The notice for a shared thread whose agent can't take a guest's request, or None."""
    link = db.execute(select(ThreadGuestLink).where(
        ThreadGuestLink.workspace_id == str(workspace.id),
        ThreadGuestLink.channel_name == channel.name,
    ).order_by(ThreadGuestLink.created_at.desc()).limit(1)).scalar_one_or_none()
    if link is None:
        return None
    name = member.display_name or member.agent_name
    owner = link.owner_name or "The person who shared it"
    if (link.approval_mode or "none") == "off":
        return f"{owner} doesn't let guests ask {name}. Your message was posted as a comment."
    if GUEST_CAPABILITY not in (getattr(member, "capabilities", None) or []):
        return (f"Your message was posted, but {name} can't take requests from guests yet. "
                f"{owner} needs to update the OpenAgents launcher on their computer.")
    return f"Your message was posted, but {name} wasn't asked to work."


def guest_for_user(db: Session, link: ThreadGuestLink, email: str, name: Optional[str] = None,
                   create: bool = False) -> Optional[ThreadGuest]:
    """In an invite-only jam the account is the identity: one guest per email, on any device."""
    guest = db.execute(select(ThreadGuest).where(ThreadGuest.link_id == link.id,
                                                 ThreadGuest.email == email)).scalar_one_or_none()
    if guest is None and create:
        guest = ThreadGuest(link_id=link.id, email=email, display_name=clean_name(name, 40) or email.split("@")[0],
                            session_hash=_sha(secrets.token_urlsafe(32)), last_seen_at=_now())
        db.add(guest)
        db.flush()
    return guest


def describe(db: Session, token: str, session: Optional[str], authorization: Optional[str] = None) -> dict:
    link, workspace, channel = live_link(db, token, authorization)
    guest = guest_for_session(db, link, session)
    if guest is None and (link.access or "link") == "invited":
        email = viewer_email(db, authorization)
        g = guest_for_user(db, link, email) if email else None
        guest = g if g is not None and g.revoked_at is None else None
    # A conversation moved into someone's team workspace shouldn't tell guests
    # that workspace's name; the small Share workspace's own name is fine.
    is_share_ws = bool((workspace.settings or {}).get("openagents_share"))
    mine = set(db.execute(select(WorkspaceMember.agent_name).where(
        WorkspaceMember.workspace_id == str(workspace.id), WorkspaceMember.status != "removed",
        WorkspaceMember.owner_email == guest_address(guest.id))).scalars()) if guest else set()
    return {
        "thread": {"name": channel.name, "title": channel.title},
        "workspace": {"name": workspace.name if is_share_ws else f"Shared by {link.owner_name or 'the owner'}"},
        "owner": {"name": link.owner_name or "Owner"},
        "agents": [{**a, "mine": a["name"] in mine} for a in channel_agents(db, workspace, channel)],
        "expiresAt": _aware(link.expires_at).isoformat() if link.expires_at else None,
        "canPost": bool(link.can_post),
        "approvalMode": link.approval_mode or "none",
        "access": link.access or "link",
        "allowGuestAgents": bool(link.allow_guest_agents and link.can_post),
        "pinnedArtifact": pinned_for_share(db, workspace, channel),
        "guest": {"id": guest.id, "name": guest.display_name} if guest else None,
    }


def create_guest(db: Session, token: str, name: Optional[str], authorization: Optional[str] = None) -> dict:
    link, _workspace, _channel = live_link(db, token, authorization)
    if not link.can_post:
        raise LinkError(403, "This link is read-only")
    if (link.access or "link") == "invited":
        # The signed-in invitee: the same guest on every device; a session for this browser.
        email = viewer_email(db, authorization)
        guest = guest_for_user(db, link, email, name, create=True)
        if guest.revoked_at is not None:
            raise LinkError(403, "The owner removed you from this conversation. You can still read it.")
        if clean_name(name, 40):
            guest.display_name = clean_name(name, 40)
        session = secrets.token_urlsafe(32)
        guest.session_hash = _sha(session)
        db.commit()
        return {"guest": {"id": guest.id, "name": guest.display_name}, "session": session}
    display = clean_name(name, 40)
    if not display or has_unsafe_chars(display):
        raise LinkError(400, "Choose a name of 1-40 characters")
    count = db.query(ThreadGuest).filter(ThreadGuest.link_id == link.id).count()
    if count >= MAX_GUESTS_PER_LINK:
        raise LinkError(429, "This link has reached its number of guests")
    session = secrets.token_urlsafe(32)
    guest = ThreadGuest(link_id=link.id, display_name=display, session_hash=_sha(session), last_seen_at=_now())
    db.add(guest)
    db.commit()
    db.refresh(guest)
    return {"guest": {"id": guest.id, "name": guest.display_name}, "session": session}


def list_messages(db: Session, token: str, after: Optional[str], limit: int, before: Optional[str] = None,
                  authorization: Optional[str] = None) -> dict:
    link, workspace, channel = live_link(db, token, authorization)
    return channel_messages(db, workspace, channel, after, limit, before)


def channel_messages(db: Session, workspace: Workspace, channel: Channel, after: Optional[str], limit: int,
                     before: Optional[str] = None) -> dict:
    """One page of a thread's messages, in the shape guests (and the owner jam) read."""
    limit = max(1, min(int(limit or 100), 200))
    base = select(EventRecord).where(
        EventRecord.network_id == str(workspace.id),
        EventRecord.type == "workspace.message.posted",
        EventRecord.target == f"channel/{channel.name}",
        EventRecord.visibility != "direct",
    )
    if after and before:
        raise LinkError(400, "Use either 'after' or 'before', not both")
    if before:
        anchor = db.get(EventRecord, before)
        if anchor is None or anchor.target != f"channel/{channel.name}":
            raise LinkError(400, "Unknown 'before' message")
        rows = db.execute(base.where(
            (EventRecord.timestamp < anchor.timestamp)
            | ((EventRecord.timestamp == anchor.timestamp) & (EventRecord.id < anchor.id))
        ).order_by(EventRecord.timestamp.desc(), EventRecord.id.desc()).limit(limit + 1)).scalars().all()
        has_more = len(rows) > limit
        rows = list(reversed(rows[:limit]))
    elif after:
        anchor = db.get(EventRecord, after)
        if anchor is None or anchor.target != f"channel/{channel.name}":
            raise LinkError(400, "Unknown 'after' message")
        rows = db.execute(base.where(
            (EventRecord.timestamp > anchor.timestamp)
            | ((EventRecord.timestamp == anchor.timestamp) & (EventRecord.id > anchor.id))
        ).order_by(EventRecord.timestamp, EventRecord.id).limit(limit + 1)).scalars().all()
        has_more = len(rows) > limit
        rows = rows[:limit]
    else:
        rows = db.execute(base.order_by(EventRecord.timestamp.desc(), EventRecord.id.desc())
                          .limit(limit + 1)).scalars().all()
        has_more = len(rows) > limit
        rows = list(reversed(rows[:limit]))
    return {"messages": [serialize_event(r) for r in rows], "hasMore": has_more}


# Metadata a guest may see. Everything else (routing traces, delivery
# fingerprints, who an agent acted for) stays inside the workspace.
_PUBLIC_METADATA = ("share_seed", "share_seed_kind", "share_owner", "share_request", "share_request_update",
                    "share_released_from", "guest", "client_key", "reply_to", "in_reply_to",
                    "message_kind", "attachments", "task_id", "run_id")
_PUBLIC_PAYLOAD = ("content", "message_type", "sender_name", "sender_display_name", "sender_type", "attachments",
                   "reply_to", "quote", "status", "progress", "title")


# Home folders in agent output ("Read › /home/alex/…") name the person's
# account on their computer. Guests see "~/…" instead.
_HOME_PATH = re.compile(r"(?:/home/|/Users/|[A-Za-z]:\\Users\\)[^/\\\s`'\")]+")


_CLI_ERROR = re.compile(r"(?m)^\s*(?:API Error:|Claude error:|Error processing message:)")


def _redact_home(text):
    return _HOME_PATH.sub("~", text) if isinstance(text, str) else text


def serialize_event(r: EventRecord) -> dict:
    payload = r.payload or {}
    metadata = r.metadata_ or {}
    source = r.source or ""
    if source.startswith("human:") and not is_guest_source(source):
        # A member's email never reaches a guest; their display name does.
        source = "human:member"
    public_payload = {k: payload[k] for k in _PUBLIC_PAYLOAD if k in payload}
    if source.startswith("openagents:") and "content" in public_payload:
        content = _redact_home(public_payload["content"])
        if isinstance(content, str) and _CLI_ERROR.search(content):
            # An agent CLI's own error (account, model, request ids) is for the
            # owner's eyes; the guest learns only that the run failed.
            content = _CLI_ERROR.split(content)[0].rstrip() or "The agent couldn't finish this request."
        public_payload["content"] = content
    return {
        "id": r.id,
        "type": r.type,
        "source": source,
        "target": r.target,
        "payload": public_payload,
        "metadata": {k: metadata[k] for k in _PUBLIC_METADATA if k in metadata},
        "timestamp": r.timestamp,
    }


# ---------------------------------------------------------------------------
# Posting
# ---------------------------------------------------------------------------

def _take_budget(db: Session, model, row_id: str, per_hour: int) -> bool:
    """Count one post against a rolling hourly window; False when it's spent."""
    now = _now()
    window_start = now - WINDOW
    reset = db.execute(update(model).where(
        model.id == row_id,
        (model.post_window_started_at.is_(None)) | (model.post_window_started_at < window_start),
    ).values(post_window_started_at=now, post_window_count=1))
    if reset.rowcount:
        return True
    took = db.execute(update(model).where(
        model.id == row_id, model.post_window_count < per_hour,
    ).values(post_window_count=model.post_window_count + 1))
    return bool(took.rowcount)


_MENTION = re.compile(r"(?<![\w@.])@([\w-]+)")


def address_agents_by_name(db: Session, workspace: Workspace, channel: Channel, content: str) -> str:
    """Turn "@Claude Code …" into "@pr-reviewer …" for this thread's agents.

    People address an agent by the name they see; routing matches the agent's
    handle. Longest names first, so "@Claude Code Pro" never half-matches.
    """
    names = {}
    for m in db.execute(select(WorkspaceMember).where(
        WorkspaceMember.workspace_id == workspace.id,
        WorkspaceMember.agent_name.in_([p.agent_name for p in (channel.participants or [])]),
    )).scalars():
        if m.display_name and m.display_name != m.agent_name:
            names[m.display_name] = m.agent_name
    for display in sorted(names, key=len, reverse=True):
        content = re.sub(r"(?<![\w@.])@" + re.escape(display) + r"(?![\w-])", "@" + names[display],
                         content, flags=re.IGNORECASE)
    return content


def check_mentions(db: Session, workspace: Workspace, channel: Channel, content: str) -> None:
    """A guest may address only the agents in this thread."""
    names = set(_MENTION.findall(content))
    if not names:
        return
    allowed = {m.agent_name for m in (channel.participants or [])}
    others = db.execute(select(WorkspaceMember.agent_name).where(
        WorkspaceMember.workspace_id == workspace.id,
        WorkspaceMember.agent_name.in_(names - allowed),
    )).scalars().all()
    if others:
        raise LinkError(403, "Guests can only ask the agents in this thread")


def prepare_guest_post(db: Session, token: str, session: Optional[str], content: str,
                       authorization: Optional[str] = None):
    """Authorize a guest post; returns (link, workspace, channel, guest, content)."""
    link, workspace, channel = live_link(db, token, authorization)
    if not link.can_post:
        raise LinkError(403, "This link is read-only")
    guest = guest_for_session(db, link, session)
    if guest is None and (link.access or "link") == "invited":
        guest = guest_for_user(db, link, viewer_email(db, authorization), create=True)
        if guest.revoked_at is not None:
            raise LinkError(403, "The owner removed you from this conversation. You can still read it.")
    if guest is None:
        removed = db.execute(select(ThreadGuest).where(
            ThreadGuest.session_hash == _sha(session or ""))).scalar_one_or_none() if session else None
        if removed is not None and removed.link_id == link.id and removed.revoked_at is not None:
            raise LinkError(403, "The owner removed you from this conversation. You can still read it.")
        raise LinkError(401, "Your guest session ended. Enter your name again to post.")
    text = (content or "").strip()
    if not text:
        raise LinkError(400, "Message is empty")
    if len(text) > MAX_GUEST_MESSAGE_CHARS:
        raise LinkError(400, f"Messages are limited to {MAX_GUEST_MESSAGE_CHARS} characters")
    text = address_agents_by_name(db, workspace, channel, text)
    check_mentions(db, workspace, channel, text)
    return link, workspace, channel, guest, text


def charge_post(db: Session, link: ThreadGuestLink, guest: ThreadGuest) -> None:
    if not _take_budget(db, ThreadGuest, guest.id, GUEST_POSTS_PER_HOUR):
        db.rollback()
        raise LinkError(429, "You're posting too fast. Try again in a while.")
    if not _take_budget(db, ThreadGuestLink, link.id, LINK_POSTS_PER_HOUR):
        db.rollback()
        raise LinkError(429, "This thread is busy. Try again in a while.")
    guest.last_seen_at = _now()


# ---------------------------------------------------------------------------
# Owner management
# ---------------------------------------------------------------------------

def links_for(db: Session, workspace_id: str, channel_name: Optional[str]) -> List[ThreadGuestLink]:
    q = select(ThreadGuestLink).where(ThreadGuestLink.workspace_id == workspace_id)
    if channel_name:
        q = q.where(ThreadGuestLink.channel_name == channel_name)
    return db.execute(q.order_by(ThreadGuestLink.created_at.desc())).scalars().all()


def create_link(db: Session, workspace: Workspace, channel_name: str, raw_expiry: Optional[str],
                created_by: str) -> ThreadGuestLink:
    """A new guest link for a thread that was shared before (e.g. after turning one off).

    Only threads published through Share get guest links: a link is the
    owner's decision to let strangers in, made at publish time. Turning a
    link off and making a new one keeps that decision; it never opens an
    ordinary workspace thread to guests.
    """
    channel = db.execute(select(Channel).where(
        Channel.workspace_id == str(workspace.id), Channel.name == channel_name,
    )).scalar_one_or_none()
    if channel is None or (channel.status or "active") == "deleted":
        raise LinkError(404, "Thread not found")
    previous = db.execute(select(ThreadGuestLink).where(
        ThreadGuestLink.workspace_id == str(workspace.id), ThreadGuestLink.channel_name == channel_name,
    ).order_by(ThreadGuestLink.created_at.desc()).limit(1)).scalar_one_or_none()
    if previous is None:
        raise LinkError(403, "Guest links are available only for threads shared with OpenAgents Share")
    live = [l for l in links_for(db, str(workspace.id), channel_name)
            if l.revoked_at is None and (l.expires_at is None or _aware(l.expires_at) > _now())]
    if live:
        raise LinkError(409, "This thread already has a live guest link")
    link = ThreadGuestLink(
        workspace_id=str(workspace.id),
        channel_name=channel_name,
        token=secrets.token_urlsafe(24),
        created_by=created_by,
        owner_name=previous.owner_name,
        can_post=True,
        allow_guest_agents=previous.allow_guest_agents,
        expires_at=_parse_expiry(raw_expiry),
    )
    db.add(link)
    db.commit()
    db.refresh(link)
    return link


def share_state(workspace: Workspace) -> Optional[dict]:
    """{claimed, ownerEmail?} for a workspace made by Share, else None."""
    if not (workspace.settings or {}).get("openagents_share"):
        return None
    return {"claimed": bool(workspace.creator_email)}


def claim(db: Session, workspace: Workspace, token: Optional[str], user) -> dict:
    """Make an anonymously shared workspace the signed-in person's.

    Proof is the creator credential (the workspace token in the owner link)
    plus a signed-in account. Idempotent for the same person; a workspace
    someone already kept can't be taken over with an old owner link.
    """
    if not (workspace.settings or {}).get("openagents_share"):
        raise LinkError(404, "Not a shared workspace")
    if not token or not secrets.compare_digest(str(token), str(workspace.password_hash or "")):
        raise LinkError(403, "Open the private owner link to keep this workspace")
    email = user.email.strip().lower()
    if workspace.creator_email:
        if workspace.creator_email.strip().lower() == email:
            return {"claimed": True, "already": True}
        raise LinkError(409, "Someone has already kept this workspace")
    workspace.creator_email = email
    exists = db.execute(select(WorkspaceMembership).where(
        WorkspaceMembership.workspace_id == str(workspace.id), WorkspaceMembership.user_id == user.id,
    )).scalar_one_or_none()
    if exists is None:
        db.add(WorkspaceMembership(workspace_id=str(workspace.id), user_id=user.id, role="owner"))
    else:
        exists.role = "owner"
    from app.models import ChannelHumanMember
    for channel in db.execute(select(Channel).where(Channel.workspace_id == str(workspace.id))).scalars():
        if not channel.owner_email:
            channel.owner_email = email
        # They're in the conversation they kept (no "Join" button on it).
        if db.get(ChannelHumanMember, (channel.id, email)) is None:
            db.add(ChannelHumanMember(channel_id=channel.id, user_email=email))
    for member in db.execute(select(WorkspaceMember).where(WorkspaceMember.workspace_id == str(workspace.id))).scalars():
        if not member.owner_email:
            member.owner_email = email
    db.commit()
    logger.info("share: workspace %s kept by an account", workspace.id)
    return {"claimed": True, "already": False}


def revoke(db: Session, workspace_id: str, link_id: str) -> ThreadGuestLink:
    link = db.get(ThreadGuestLink, link_id)
    if link is None or str(link.workspace_id) != str(workspace_id):
        raise LinkError(404, "Link not found")
    if link.revoked_at is None:
        link.revoked_at = _now()
        db.commit()
    return link


# "none": guests' requests run at once; "owner": each waits for the owner's
# approval; "off": guests can't ask the agent at all (their messages are comments).
APPROVAL_MODES = ("none", "owner", "off")
# What people say at setup → what's stored.
AGENT_ACCESS = {"open": "none", "approval": "owner", "off": "off"}


def set_approval_mode(db: Session, workspace_id: str, link_id: str, mode: str) -> ThreadGuestLink:
    if mode not in APPROVAL_MODES:
        raise LinkError(400, "approval_mode must be 'none' or 'owner'")
    link = db.get(ThreadGuestLink, link_id)
    if link is None or str(link.workspace_id) != str(workspace_id) or link.revoked_at is not None:
        raise LinkError(404, "Link not found")
    link.approval_mode = mode
    db.commit()
    return link


def set_expiry(db: Session, workspace_id: str, link_id: str, raw: Optional[str]) -> ThreadGuestLink:
    link = db.get(ThreadGuestLink, link_id)
    if link is None or str(link.workspace_id) != str(workspace_id) or link.revoked_at is not None:
        raise LinkError(404, "Link not found")
    link.expires_at = _parse_expiry(raw)
    db.commit()
    return link


# ---------------------------------------------------------------------------
# The owner's light jam
# ---------------------------------------------------------------------------

def share_thread(db: Session, workspace: Workspace) -> Optional[Channel]:
    """The one conversation a Share workspace was made for."""
    link = db.execute(select(ThreadGuestLink).where(ThreadGuestLink.workspace_id == str(workspace.id))
                      .order_by(ThreadGuestLink.created_at).limit(1)).scalar_one_or_none()
    name = link.channel_name if link else None
    if name is None:
        return None
    return db.execute(select(Channel).where(Channel.workspace_id == str(workspace.id),
                                            Channel.name == name)).scalar_one_or_none()


def room_owner_user(db: Session, workspace: Workspace, authorization: Optional[str]):
    """The signed-in person, if they own (or administer) this jam."""
    if not authorization:
        return None
    from app.access import _role_for_email, resolve_current_user
    user = resolve_current_user(db, authorization)
    if user is None:
        return None
    return user if _role_for_email(db, workspace, user.email.strip().lower()) in ("owner", "admin") else None


def owner_room(db: Session, network: str, token: Optional[str], authorization: Optional[str] = None):
    """(workspace, channel) for the jam's owner, or a LinkError (410 says where it went).

    The owner is whoever holds the private owner link (the workspace token) or,
    once they saved the jam to their account, the signed-in account itself.
    """
    from app.routers.network import _resolve_workspace
    workspace = _resolve_workspace(db, network) if network else None
    share = (workspace.settings or {}).get("openagents_share") if workspace else None
    if workspace is None or not isinstance(share, dict):
        raise LinkError(404, "This owner link isn't valid")
    current = bool(token) and secrets.compare_digest(str(token), str(workspace.password_hash or ""))
    retired = bool(token) and share.get("retired_token_hash") and secrets.compare_digest(
        _sha("owner:" + str(token)), str(share.get("retired_token_hash")))
    if not (current or retired or room_owner_user(db, workspace, authorization)):
        raise LinkError(404, "This owner link isn't valid")
    moved = share.get("moved_to")
    if moved:
        err = LinkError(410, "This conversation moved to another workspace")
        err.data = {"movedTo": {"slug": moved.get("slug"), "channel": moved.get("channel")}}
        raise err
    if workspace.status == "deleted":
        raise LinkError(404, "This owner link isn't valid")
    channel = share_thread(db, workspace)
    if channel is None:
        raise LinkError(404, "This owner link isn't valid")
    return workspace, channel


def describe_room(db: Session, workspace: Workspace, channel: Channel) -> dict:
    links = links_for(db, str(workspace.id), channel.name)
    owner_name = next((l.owner_name for l in reversed(links) if l.owner_name), None) or "Owner"
    return {
        "workspace": {"id": str(workspace.id), "slug": workspace.slug, "name": workspace.name},
        "thread": {"name": channel.name, "title": channel.title},
        "owner": {"name": owner_name},
        "agents": channel_agents(db, workspace, channel),
        "link": serialize_link(links[0]) if links else None,
        "pinnedArtifact": pinned_for_share(db, workspace, channel),
        "share": {"claimed": bool(workspace.creator_email), "movedTo": None,
                  "keptAsWorkspace": bool(((workspace.settings or {}).get("openagents_share") or {}).get("kept_as_workspace"))},
    }


def owner_name_for(db: Session, workspace: Workspace, channel: Channel) -> str:
    links = links_for(db, str(workspace.id), channel.name)
    return next((l.owner_name for l in links if l.owner_name), None) or "Owner"


# ---------------------------------------------------------------------------
# Adding a shared conversation to an existing workspace
# ---------------------------------------------------------------------------

RELOCATE_CAPABILITY = "relocate"


def import_into(db: Session, source: Workspace, token: Optional[str], user, target_id: str,
                authorization: Optional[str] = None) -> dict:
    """Move the shared conversation into one of the person's workspaces.

    The thread (with its history), the agent and the guest link move; the guest
    link keeps its URL and its guests. The agent's launcher is told where it
    now lives (a ``relocate`` control action) and fetches a connection token
    for the target once, with its session id (``accept_relocation``); after
    that the old Share workspace is closed, so its owner link stops working.
    """
    from app.access import _role_for_email
    from app.models import ChannelHumanMember, Node
    from app.routers.network import _resolve_workspace
    from app.routers.workspaces import _emit_agent_control_event

    workspace, channel = owner_room(db, str(source.id), token, authorization)
    target = _resolve_workspace(db, target_id) if target_id else None
    if target is None or target.status == "deleted" or str(target.id) == str(workspace.id):
        raise LinkError(404, "Workspace not found")
    email = user.email.strip().lower()
    role = _role_for_email(db, target, email)
    if role not in ("member", "admin", "owner"):
        raise LinkError(403, "You can add conversations only to workspaces where you're a member")

    agents = [m for m in db.execute(select(WorkspaceMember).where(
        WorkspaceMember.workspace_id == str(workspace.id), WorkspaceMember.status != "removed",
    )).scalars().all() if any(p.agent_name == m.agent_name for p in (channel.participants or []))
        and not is_guest_email(m.owner_email)]   # guests' own agents don't move with it
    for m in agents:
        # An offline agent can move too: it learns where it lives the next
        # time its launcher joins (pending_relocation, in the join reply).
        if RELOCATE_CAPABILITY not in (m.capabilities or []):
            raise LinkError(409, "Update the OpenAgents launcher on your computer first, then try again.")
        clash = db.get(WorkspaceMember, (str(target.id), m.agent_name))
        if clash is not None and clash.status != "removed":
            raise LinkError(409, f"That workspace already has an agent named {m.agent_name}.")

    now_name = f"share-{secrets.token_hex(6)}"
    new_channel = Channel(
        workspace_id=str(target.id), name=now_name, title=channel.title, created_by=email,
        master_agent=channel.master_agent, response_mode="passive", visibility="private",
        owner_email=email, status="active", last_event_at=channel.last_event_at,
    )
    db.add(new_channel)
    db.flush()
    db.add(ChannelHumanMember(channel_id=new_channel.id, user_email=email))
    relocations = []
    for m in agents:
        db.add(WorkspaceMember(
            workspace_id=str(target.id), agent_name=m.agent_name, display_name=m.display_name,
            owner_email=email, role="member", agent_type=m.agent_type, status="offline",
        ))
        db.add(ChannelMember(channel_id=new_channel.id, agent_name=m.agent_name))
        node = Node(workspace_id=str(target.id), node_key=f"share-relocate-{secrets.token_hex(8)}",
                    owner_email=email, name=f"{m.display_name or m.agent_name} (shared)",
                    token=secrets.token_urlsafe(32))
        db.add(node)
        db.flush()
        relocations.append({"id": secrets.token_urlsafe(16), "agent": m.agent_name, "node_id": str(node.id),
                            "session_id": m.session_id})

    # History: the same messages, now in the new thread.
    records = db.execute(select(EventRecord).where(
        EventRecord.network_id == str(workspace.id), EventRecord.target == f"channel/{channel.name}",
        EventRecord.type == "workspace.message.posted",
    ).order_by(EventRecord.timestamp, EventRecord.id)).scalars().all()
    for r in records:
        meta = dict(r.metadata_ or {})
        meta["imported_from_event_id"] = r.id
        meta.pop("_delivery_hash", None)
        db.add(EventRecord(id=str(uuid.uuid4()), network_id=str(target.id), type=r.type,
                           source=f"human:{email}" if (meta.get("share_owner") or r.source == "human:owner") else r.source,
                           target=f"channel/{now_name}", payload=dict(r.payload or {}), metadata_=meta,
                           timestamp=r.timestamp, visibility=r.visibility))

    # The guest link follows the conversation: same URL, same guests.
    for link in links_for(db, str(workspace.id), channel.name):
        link.workspace_id = str(target.id)
        link.channel_name = now_name

    settings = dict(workspace.settings or {})
    share = dict(settings.get("openagents_share") or {})
    share["moved_to"] = {"slug": target.slug, "channel": now_name, "workspaceId": str(target.id)}
    share["relocations"] = relocations
    settings["openagents_share"] = share
    workspace.settings = settings

    for rel in relocations:
        _emit_agent_control_event(db, workspace, rel["agent"], "relocate", {
            "relocation_id": rel["id"],
            "workspace_id": str(target.id),
            "slug": target.slug,
            "name": target.name,
        })
    db.commit()
    logger.info("share: conversation moved from %s to %s (%d agents)", workspace.id, target.id, len(relocations))
    return {"workspace": {"id": str(target.id), "slug": target.slug, "name": target.name},
            "channel": {"name": now_name, "title": new_channel.title}}


def pending_relocation(db: Session, workspace: Workspace, agent_name: str, session_id: Optional[str]) -> Optional[dict]:
    """A move this agent hasn't collected yet, for the join reply.

    An agent that was offline when its conversation moved missed the control
    action; joining the old workspace hands it the move instead, bound to the
    session it just started.
    """
    # Deep copies: JSON columns only save when the new value differs from the
    # loaded one, and an in-place edit changes both.
    share = copy.deepcopy((workspace.settings or {}).get("openagents_share"))
    if not isinstance(share, dict) or not share.get("moved_to"):
        return None
    rels = share.get("relocations") or []
    rel = next((r for r in rels if r.get("agent") == agent_name and not r.get("accepted")), None)
    if rel is None:
        return None
    rel["session_id"] = session_id
    share["relocations"] = rels
    settings = copy.deepcopy(workspace.settings or {})
    settings["openagents_share"] = share
    workspace.settings = settings
    db.commit()
    moved = share["moved_to"]
    return {"relocation_id": rel["id"], "workspace_id": moved.get("workspaceId"), "slug": moved.get("slug")}


def accept_relocation(db: Session, source: Workspace, token: Optional[str], agent_name: str,
                      relocation_id: str, session_id: Optional[str]) -> dict:
    """The launcher, still holding the old token, collects its new connection — once."""
    from app.models import Node
    if not token or not secrets.compare_digest(str(token), str(source.password_hash or "")):
        raise LinkError(403, "Not allowed")
    share = copy.deepcopy((source.settings or {}).get("openagents_share") or {})
    rels = share.get("relocations") or []
    rel = next((r for r in rels if r.get("id") == relocation_id and r.get("agent") == agent_name), None)
    if rel is None or rel.get("accepted"):
        raise LinkError(404, "Unknown or already used relocation")
    if rel.get("session_id") and rel.get("session_id") != session_id:
        raise LinkError(403, "Only the running agent can accept this")
    node = db.get(Node, rel["node_id"])
    moved = share.get("moved_to") or {}
    if node is None:
        raise LinkError(404, "Unknown relocation")
    rel["accepted"] = True
    share["relocations"] = rels
    settings = copy.deepcopy(source.settings or {})
    settings["openagents_share"] = share
    source.settings = settings
    if all(r.get("accepted") for r in rels):
        # Every agent has its new connection: retire the old workspace and its
        # owner link (the link now answers 410 "moved" in the owner jam).
        share["retired_token_hash"] = _sha("owner:" + str(source.password_hash))
        settings["openagents_share"] = share
        source.settings = settings
        source.status = "deleted"
        source.password_hash = secrets.token_urlsafe(32)
    db.commit()
    return {"workspace_id": moved.get("workspaceId"), "slug": moved.get("slug"), "token": node.token,
            "agent_name": agent_name}


# ---------------------------------------------------------------------------
# Owner approval of guests' requests
# ---------------------------------------------------------------------------

def addressed_agents(channel: Channel, content: str) -> List[str]:
    """The thread's agents a message addresses (@handle anywhere)."""
    names = set(_MENTION.findall(content or ""))
    return [p.agent_name for p in (channel.participants or []) if p.agent_name in names]


def needs_approval(link: ThreadGuestLink, channel: Channel, content: str) -> bool:
    return (link.approval_mode or "none") == "owner" and bool(addressed_agents(channel, content))


def _notice(db: Session, workspace: Workspace, channel: Channel, content: str, metadata: dict) -> EventRecord:
    """A small system line in the thread (an approval decision)."""
    ts = int(time.time() * 1000)
    rec = EventRecord(
        id=str(uuid.uuid4()), network_id=str(workspace.id), type="workspace.message.posted",
        source="system:share", target=f"channel/{channel.name}",
        payload={"content": content, "message_type": "notice", "sender_name": "OpenAgents"},
        metadata_={"target_agents": ["__no_response__"], **metadata}, timestamp=ts, visibility="channel",
    )
    db.add(rec)
    channel.last_event_at = ts
    return rec


def serialize_request(db: Session, req: ThreadGuestRequest) -> dict:
    guest = db.get(ThreadGuest, req.guest_id)
    event = db.get(EventRecord, req.event_id)
    return {
        "id": req.id,
        "status": req.status,
        "guest": {"id": req.guest_id, "name": guest.display_name if guest else "Guest"},
        "messageId": req.event_id,
        "content": ((event.payload or {}).get("content") if event else "") or "",
        "createdAt": _aware(req.created_at).isoformat() if req.created_at else None,
        "decidedAt": _aware(req.decided_at).isoformat() if req.decided_at else None,
    }


def pending_requests(db: Session, workspace: Workspace, channel: Channel) -> List[dict]:
    link_ids = [l.id for l in links_for(db, str(workspace.id), channel.name)]
    if not link_ids:
        return []
    rows = db.execute(select(ThreadGuestRequest).where(
        ThreadGuestRequest.link_id.in_(link_ids), ThreadGuestRequest.status == "pending",
    ).order_by(ThreadGuestRequest.created_at)).scalars().all()
    return [serialize_request(db, r) for r in rows]


def decide_request(db: Session, workspace: Workspace, channel: Channel, request_id: str, decision: str,
                   decided_by: str, owner_label: str):
    """Approve (the request goes to the agent) or decline (the guest is told). Once."""
    if decision not in ("approve", "decline"):
        raise LinkError(400, "decision must be 'approve' or 'decline'")
    req = db.execute(select(ThreadGuestRequest).where(ThreadGuestRequest.id == request_id)
                     .with_for_update()).scalar_one_or_none()
    link = db.get(ThreadGuestLink, req.link_id) if req else None
    if (req is None or link is None or str(link.workspace_id) != str(workspace.id)
            or link.channel_name != channel.name):
        raise LinkError(404, "Request not found")
    if req.status != "pending":
        raise LinkError(409, f"This request was already {req.status}")
    original = db.get(EventRecord, req.event_id)
    guest = db.get(ThreadGuest, req.guest_id)
    guest_name = guest.display_name if guest else "the guest"
    req.status = "approved" if decision == "approve" else "declined"
    req.decided_by = decided_by
    req.decided_at = _now()
    verb = "approved" if decision == "approve" else "declined"
    _notice(db, workspace, channel, f"{owner_label} {verb} {guest_name}'s request.",
            {"share_request_update": {"id": req.id, "messageId": req.event_id, "status": req.status}})
    release = None
    if decision == "approve" and original is not None and guest is not None:
        payload = dict(original.payload or {})
        metadata = {k: v for k, v in (original.metadata_ or {}).items()
                    if k in ("sender_email", "guest", "guest_link_id")}
        metadata["share_released_from"] = original.id
        metadata["share_request"] = {"id": req.id, "status": "approved"}
        release = {"source": original.source, "target": original.target, "payload": payload, "metadata": metadata}
    db.commit()
    return req, release


# ---------------------------------------------------------------------------
# A guest takes a copy into their own workspace
# ---------------------------------------------------------------------------

def fork_for_guest(db: Session, token: str, user, target_id: Optional[str], authorization: Optional[str] = None) -> dict:
    """Copy what the guest can see into a private thread in one of their workspaces.

    The copy holds the same messages the guest page shows (member emails
    already replaced by names), no agent and no link back into the original:
    the guest continues with their own agents. The original is untouched.
    """
    from app.access import _role_for_email, provision_workspace
    from app.models import ChannelHumanMember
    from app.routers.network import _resolve_workspace

    link, workspace, channel = live_link(db, token, authorization)
    email = user.email.strip().lower()
    if target_id:
        target = _resolve_workspace(db, target_id)
        if target is None or target.status == "deleted":
            raise LinkError(404, "Workspace not found")
        if _role_for_email(db, target, email) not in ("member", "admin", "owner"):
            raise LinkError(403, "You can copy into workspaces where you're a member")
    else:
        target = provision_workspace(db, user, name=f"{getattr(user, 'display_name', None) or email.split('@')[0]}'s workspace")
    if str(target.id) == str(workspace.id):
        raise LinkError(400, "Pick another workspace")

    owner = link.owner_name or "Owner"
    name = f"share-copy-{secrets.token_hex(6)}"
    copy_channel = Channel(workspace_id=str(target.id), name=name, title=f"{channel.title} (from {owner})"[:200],
                           created_by=email, response_mode="passive", visibility="private",
                           owner_email=email, status="active")
    db.add(copy_channel)
    db.flush()
    db.add(ChannelHumanMember(channel_id=copy_channel.id, user_email=email))
    page = channel_messages(db, workspace, channel, None, 200)
    last = None
    for m in page["messages"]:
        if (m["payload"] or {}).get("message_type", "chat") not in ("chat", "notice"):
            continue
        meta = dict(m["metadata"] or {})
        meta.update({"share_copied_from": m["id"], "target_agents": ["__no_response__"]})
        source = m["source"] if not m["source"].startswith("openagents:") else m["source"]
        db.add(EventRecord(id=str(uuid.uuid4()), network_id=str(target.id), type="workspace.message.posted",
                           source=source, target=f"channel/{name}", payload=dict(m["payload"] or {}),
                           metadata_=meta, timestamp=m["timestamp"], visibility="channel"))
        last = m["timestamp"]
    copy_channel.last_event_at = last
    db.commit()
    logger.info("share: guest copied a shared thread into workspace %s", target.id)
    return {"workspace": {"id": str(target.id), "slug": target.slug, "name": target.name},
            "channel": {"name": name, "title": copy_channel.title}}


def notify_owner_of_request(db: Session, workspace: Workspace, channel: Channel, guest_name: str, content: str) -> None:
    """Tell the person who kept the workspace that a guest request waits (inbox + push).

    An anonymous owner has no inbox; they see the request in their jam.
    """
    owner = (workspace.creator_email or "").strip().lower()
    if not owner:
        return
    try:
        from app.services.notify import notify
        notify(db, str(workspace.id), source="system:share",
               title=f"{guest_name} is waiting for your approval",
               message=(content or "")[:200], priority="high", channel_name=channel.name,
               reason="share_request", recipient_email=owner, kind="share_request")
    except Exception:
        logger.warning("share: could not notify the owner of a guest request", exc_info=True)


# ---------------------------------------------------------------------------
# Thread resources: what a Workspace thread shows above its messages
# ---------------------------------------------------------------------------

def _thread_files(db: Session, workspace: Workspace, channel: Channel) -> list:
    from app.models import FileRecord
    rows = db.execute(select(FileRecord).where(
        FileRecord.workspace_id == str(workspace.id), FileRecord.channel_name == channel.name,
        FileRecord.status == "active",
    ).order_by(FileRecord.created_at.desc())).scalars().all()
    return [f for f in rows if not f.filename.endswith("/.keep")]


def _thread_browsers(db: Session, workspace: Workspace, channel: Channel) -> list:
    from app.models import BrowserTab
    rows = db.execute(select(BrowserTab).where(
        BrowserTab.workspace_id == str(workspace.id), BrowserTab.status == "active",
    )).scalars().all()
    return [t for t in rows if channel.name in (t.artifact_channels or [])]


def thread_resources(db: Session, workspace: Workspace, channel: Channel) -> dict:
    """The thread's artifacts (files, browser sessions) and routines, for its share pages.

    Only what the Workspace thread itself shows. Routine instructions stay out:
    their runs are visible as messages, their setup is the owner's business.
    """
    from app.models import RoutineRecord

    def _iso(dt):
        return _aware(dt).isoformat() if dt else None

    files = [{
        "id": f.id,
        # Uploads are stored as "20261124_002319_report.md"; people see "report.md".
        "name": re.sub(r"^\d{8}_\d{6}_", "", f.filename.rsplit("/", 1)[-1]),
        "path": f.filename,
        "contentType": f.content_type,
        "size": f.size,
        "createdAt": _iso(f.created_at),
        "uploadedBy": f.uploaded_by if (f.uploaded_by or "").startswith("openagents:") else "human",
    } for f in _thread_files(db, workspace, channel)]
    browsers = [{
        "id": t.id, "title": t.title or t.url, "url": t.url,
    } for t in _thread_browsers(db, workspace, channel)]
    routines = [{
        "id": r.id, "name": r.name, "status": r.status,
        "scheduleHour": r.schedule_hour, "scheduleMinute": r.schedule_minute,
        "scheduleDays": r.schedule_days, "scheduleIntervalMinutes": r.schedule_interval_minutes,
        "timezone": r.timezone, "nextFiresAt": _iso(r.next_fires_at), "lastFiredAt": _iso(r.last_fired_at),
    } for r in db.execute(select(RoutineRecord).where(
        RoutineRecord.workspace_id == str(workspace.id), RoutineRecord.status != "cancelled",
        RoutineRecord.source_channel_name == channel.name,
    ).order_by(RoutineRecord.created_at)).scalars().all()]
    return {"files": files, "browsers": browsers, "routines": routines}


def thread_file(db: Session, workspace: Workspace, channel: Channel, file_id: str):
    """(record, bytes) for a file this thread shows — as an artifact or a message attachment."""
    from app.models import FileRecord
    from app.storage import get_file_store
    f = db.get(FileRecord, file_id)
    if f is None or str(f.workspace_id) != str(workspace.id) or f.status != "active":
        raise LinkError(404, "File not found")
    if f.channel_name != channel.name:
        attached = False
        for (payload,) in db.execute(select(EventRecord.payload).where(
            EventRecord.network_id == str(workspace.id), EventRecord.target == f"channel/{channel.name}",
            EventRecord.type == "workspace.message.posted",
        )).all():
            for a in (payload or {}).get("attachments") or []:
                if isinstance(a, dict) and str(a.get("fileId") or a.get("file_id") or a.get("id")) == f.id:
                    attached = True
                    break
            if attached:
                break
        if not attached:
            raise LinkError(404, "File not found")
    return f, get_file_store().read(f.storage_key)


def thread_browser(db: Session, workspace: Workspace, channel: Channel, tab_id: str):
    tab = next((t for t in _thread_browsers(db, workspace, channel) if t.id == tab_id), None)
    if tab is None:
        raise LinkError(404, "Browser not found")
    return tab


# ---------------------------------------------------------------------------
# The owner's controls over guests
# ---------------------------------------------------------------------------

def set_can_post(db: Session, workspace_id: str, link_id: str, can_post: bool) -> ThreadGuestLink:
    link = db.get(ThreadGuestLink, link_id)
    if link is None or str(link.workspace_id) != str(workspace_id) or link.revoked_at is not None:
        raise LinkError(404, "Link not found")
    link.can_post = bool(can_post)
    db.commit()
    return link


def list_guests(db: Session, workspace: Workspace, channel: Channel) -> List[dict]:
    link_ids = [l.id for l in links_for(db, str(workspace.id), channel.name)]
    if not link_ids:
        return []
    rows = db.execute(select(ThreadGuest).where(ThreadGuest.link_id.in_(link_ids))
                      .order_by(ThreadGuest.created_at)).scalars().all()
    return [{
        "id": g.id, "name": g.display_name,
        "joinedAt": _aware(g.created_at).isoformat() if g.created_at else None,
        "lastSeenAt": _aware(g.last_seen_at).isoformat() if g.last_seen_at else None,
        "removed": g.revoked_at is not None,
    } for g in rows]


def remove_guest(db: Session, workspace: Workspace, channel: Channel, guest_id: str) -> dict:
    """The guest can still read (it's a link) but can no longer post or ask the agent.

    Their pending requests are declined. Turning the link off and making a new
    one is how to shut someone out entirely.
    """
    guest = db.get(ThreadGuest, guest_id)
    link = db.get(ThreadGuestLink, guest.link_id) if guest else None
    if (guest is None or link is None or str(link.workspace_id) != str(workspace.id)
            or link.channel_name != channel.name):
        raise LinkError(404, "Guest not found")
    if guest.revoked_at is None:
        guest.revoked_at = _now()
        from app.services.room_agents import remove_agents_of_guest
        remove_agents_of_guest(db, workspace, channel, guest.id)
        for req in db.execute(select(ThreadGuestRequest).where(
            ThreadGuestRequest.guest_id == guest.id, ThreadGuestRequest.status == "pending",
        )).scalars():
            req.status = "declined"
            req.decided_by = "owner"
            req.decided_at = _now()
        db.commit()
    return {"id": guest.id, "name": guest.display_name, "removed": True}


# ---------------------------------------------------------------------------
# A person's jams (like gists: not workspaces until they decide so)
# ---------------------------------------------------------------------------

def is_room(workspace: Workspace) -> bool:
    """A Share workspace that hasn't been made a full workspace."""
    share = (workspace.settings or {}).get("openagents_share")
    return isinstance(share, dict) and not share.get("kept_as_workspace")


def _set_share_flag(db: Session, workspace: Workspace, **values) -> None:
    settings = copy.deepcopy(workspace.settings or {})
    share = dict(settings.get("openagents_share") or {})
    share.update(values)
    settings["openagents_share"] = share
    workspace.settings = settings


def my_rooms(db: Session, user) -> List[dict]:
    """Jams this person saved or published while signed in, newest activity first."""
    from app.models import WorkspaceMembership
    email = user.email.strip().lower()
    ids = {w for (w,) in db.execute(select(WorkspaceMembership.workspace_id).where(
        WorkspaceMembership.user_id == user.id, WorkspaceMembership.role.in_(("owner", "admin")))).all()}
    rows = db.execute(select(Workspace).where(
        Workspace.status == "active",
        (Workspace.id.in_(ids)) | (Workspace.creator_email == email),
    )).scalars().all()
    out = []
    for ws in rows:
        share = (ws.settings or {}).get("openagents_share")
        if not isinstance(share, dict) or share.get("moved_to"):
            continue
        channel = share_thread(db, ws)
        if channel is None:
            continue
        jam = describe_room(db, ws, channel)
        live = next((l for l in links_for(db, str(ws.id), channel.name)
                     if l.revoked_at is None and (l.expires_at is None or _aware(l.expires_at) > _now())), None)
        jam.update({
            "lastActivityAt": channel.last_event_at,
            "liveLink": serialize_link(live) if live else None,
            "guestCount": len([g for g in list_guests(db, ws, channel) if not g["removed"]]),
            "pendingRequests": len(pending_requests(db, ws, channel)),
            "keptAsWorkspace": bool(share.get("kept_as_workspace")),
        })
        out.append(jam)
    out.sort(key=lambda r: r.get("lastActivityAt") or 0, reverse=True)
    return out


def keep_as_workspace(db: Session, workspace: Workspace, channel: Channel, user) -> dict:
    """Turn a jam into a full workspace of theirs (it then shows among their workspaces)."""
    if not workspace.creator_email:
        claim(db, workspace, workspace.password_hash, user)
    _set_share_flag(db, workspace, kept_as_workspace=True)
    db.commit()
    return {"workspace": {"id": str(workspace.id), "slug": workspace.slug, "name": workspace.name},
            "channel": {"name": channel.name, "title": channel.title}}


def delete_room(db: Session, workspace: Workspace) -> None:
    """Delete a jam: its links stop working, the conversation is gone for guests."""
    for link in db.execute(select(ThreadGuestLink).where(ThreadGuestLink.workspace_id == str(workspace.id))).scalars():
        if link.revoked_at is None:
            link.revoked_at = _now()
    workspace.status = "deleted"
    db.commit()


# ---------------------------------------------------------------------------
# The artifact open for everyone (the thread's pinned artifact)
# ---------------------------------------------------------------------------

def pinned_for_share(db: Session, workspace: Workspace, channel: Channel) -> Optional[dict]:
    """The thread's pinned artifact, if it's one the share pages can show."""
    ref = channel.pinned_artifact if isinstance(channel.pinned_artifact, dict) else None
    if not ref or ref.get("kind") not in ("file", "browser") or not ref.get("id"):
        return None
    if ref["kind"] == "file":
        if not any(f.id == ref["id"] for f in _thread_files(db, workspace, channel)):
            return None
    elif not any(t.id == ref["id"] for t in _thread_browsers(db, workspace, channel)):
        return None
    return {"kind": ref["kind"], "id": ref["id"]}


def set_pinned(db: Session, workspace: Workspace, channel: Channel, kind: Optional[str], ref_id: Optional[str]) -> Optional[dict]:
    """Open an artifact for everyone who opens the link (or close it: kind None)."""
    if not kind:
        channel.pinned_artifact = None
        db.commit()
        return None
    if kind not in ("file", "browser") or not ref_id:
        raise LinkError(400, "kind must be 'file' or 'browser' with an id")
    channel.pinned_artifact = {"kind": kind, "id": ref_id}
    if pinned_for_share(db, workspace, channel) is None:
        db.rollback()
        raise LinkError(404, "That artifact isn't in this thread")
    db.commit()
    return {"kind": kind, "id": ref_id}


# ---------------------------------------------------------------------------
# Who can open the jam: anyone with the link, or invited emails only
# ---------------------------------------------------------------------------

ACCESS_MODES = ("link", "invited")
_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
MAX_INVITES = 200


def _owned_link(db: Session, workspace_id: str, link_id: str) -> ThreadGuestLink:
    link = db.get(ThreadGuestLink, link_id)
    if link is None or str(link.workspace_id) != str(workspace_id) or link.revoked_at is not None:
        raise LinkError(404, "Link not found")
    return link


def set_access(db: Session, workspace_id: str, link_id: str, access: str) -> ThreadGuestLink:
    if access not in ACCESS_MODES:
        raise LinkError(400, "access must be 'link' or 'invited'")
    link = _owned_link(db, workspace_id, link_id)
    link.access = access
    db.commit()
    return link


def normalize_emails(raw) -> List[str]:
    out = []
    for e in raw or []:
        e = str(e or "").strip().lower()
        if not e:
            continue
        if not _EMAIL.match(e) or e.endswith("@" + GUEST_DOMAIN):
            raise LinkError(400, f"Not an email address: {e}")
        if e not in out:
            out.append(e)
    return out


def add_invites(db: Session, workspace: Workspace, link_id: str, emails: List[str], inviter: str) -> tuple:
    """Invite people by email; returns (link, newly added). Each new invitee gets an email with the link."""
    link = _owned_link(db, str(workspace.id), link_id)
    current = [e.lower() for e in (link.invited_emails or [])]
    new = [e for e in normalize_emails(emails) if e not in current]
    if len(current) + len(new) > MAX_INVITES:
        raise LinkError(400, f"At most {MAX_INVITES} people per jam")
    link.invited_emails = current + new
    db.commit()
    channel = db.execute(select(Channel).where(Channel.workspace_id == str(workspace.id),
                                               Channel.name == link.channel_name)).scalar_one_or_none()
    send_invites(link, channel.title if channel else "a jam", inviter, new)
    return link, new


def send_invites(link: ThreadGuestLink, title: str, inviter: str, emails: List[str]) -> None:
    for email in emails:
        try:
            from app.services.email import send_email
            from html import escape
            send_email(email, f"{inviter} invited you to “{title}” on OpenAgents",
                       f"<p>{escape(inviter)} invited you to the jam <b>{escape(title)}</b>, "
                       f"where you can talk with their agent.</p>"
                       f"<p><a href=\"{guest_url(link.token)}\">Open the jam</a></p>"
                       f"<p>Sign in with {escape(email)} to open it.</p>")
        except Exception:
            logger.warning("share: invite email failed", exc_info=True)


def remove_invite(db: Session, workspace: Workspace, link_id: str, email: str) -> ThreadGuestLink:
    """Uninvite: they lose access to an invite-only jam at once (and can't post if it opens to the link later)."""
    link = _owned_link(db, str(workspace.id), link_id)
    email = (email or "").strip().lower()
    link.invited_emails = [e for e in (link.invited_emails or []) if e.lower() != email]
    for g in db.execute(select(ThreadGuest).where(ThreadGuest.link_id == link.id, ThreadGuest.email == email)).scalars():
        if g.revoked_at is None:
            g.revoked_at = _now()
    db.commit()
    return link
