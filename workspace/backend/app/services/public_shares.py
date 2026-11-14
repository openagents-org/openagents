# -*- coding: utf-8 -*-
"""Public "anyone with the link" links to snapshots of thread artifacts.

A thread's artifacts are workspace files (images, video, tables, HTML pages,
web projects…) and knowledge documents. A person who can manage one may
publish a snapshot of it: a copy taken now, served at /share/artifact/<token>
to anyone, with an optional expiry. Refreshing keeps the token and replaces
the copy; revoking ends it for good.

Only a signed-in person ever creates or refreshes a link. An agent may only
*ask* (``create_request``): that files an approval in the thread, and the link
is made when a person who can manage the artifact approves it. An agent
steered by a prompt injection could otherwise publish anything it can reach.

A link stays good only while
  * it is not revoked and not past ``expires_at``,
  * the artifact is still active (trashing or deleting it revokes its links;
    replacing a file by a new upload at the same path moves them over), and
  * whoever created it could still create it: still a member, still able to
    manage the artifact.
"""

import hashlib
import logging
import mimetypes
import re
import secrets
import uuid
from datetime import datetime, timezone
from typing import Iterable, List, Optional, Tuple

from fastapi import HTTPException
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import config
from app.models import ApprovalRequest, FileRecord, KnowledgeEntry, PublicShare, Workspace
from app.services.access_model import (
    Principal, can_manage, can_read_file, can_read_knowledge, resource_for_file,
    resource_for_knowledge, workspace_human_role,
)
from app.storage import get_file_store

logger = logging.getLogger(__name__)

KINDS = ("file", "knowledge")
REQUEST_KIND = "public_share_request"
WEB_PROJECT_TYPE = "application/vnd.openagents.web-project+zip"

# Images a shared markdown document embeds from the workspace are copied with
# it, since an anonymous viewer cannot load /v1/files/<id>.
MAX_ASSETS = 20
MAX_ASSET_BYTES = 10 * 1024 * 1024
ASSET_SCHEME = "oa-share-asset:"
# /v1/files/<id>, /<workspace>/files/<id> (either may carry an origin), or the
# bare upload id agents sometimes embed (components/chat/markdown-image.tsx).
_FILE_REF = re.compile(r"(?:(?:https?://[^\s\"')]*?)?/(?:v1/files|[A-Za-z0-9_-]+/files)/)?([0-9a-fA-F-]{36})(?:/content|/raw)?(?:\?[^\s\"')]*)?")
_MD_IMAGE = re.compile(r"(!\[[^\]]*\]\()\s*<?([^)\s>]+)>?((?:\s+\"[^\"]*\")?\s*\))")
_HTML_IMAGE = re.compile(r"(<img\b[^>]*?\bsrc=[\"'])([^\"']+)([\"'])", re.I)


class ShareError(Exception):
    """A refusal to show the person, with the HTTP-ish status to answer."""

    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(dt: Optional[datetime]) -> Optional[datetime]:
    if dt is not None and dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def _basename(name: Optional[str]) -> str:
    return (name or "file").rsplit("/", 1)[-1] or "file"


def is_markdown(content_type: Optional[str], name: Optional[str]) -> bool:
    return "markdown" in (content_type or "") or (name or "").lower().endswith((".md", ".mdx", ".markdown"))


def is_html(content_type: Optional[str], name: Optional[str]) -> bool:
    return "html" in (content_type or "") or (name or "").lower().endswith((".html", ".htm"))


def is_web_project(content_type: Optional[str]) -> bool:
    return (content_type or "").startswith(WEB_PROJECT_TYPE)


# ---------------------------------------------------------------------------
# Artifacts
# ---------------------------------------------------------------------------

def load_artifact(db: Session, workspace_id: str, kind: str, resource_id: str):
    """The active file or knowledge entry, or None."""
    if kind == "file":
        obj = db.get(FileRecord, resource_id)
    elif kind == "knowledge":
        obj = db.get(KnowledgeEntry, resource_id)
    else:
        return None
    if obj is None or obj.status != "active" or str(obj.workspace_id) != str(workspace_id):
        return None
    return obj


def resource_for(kind: str, obj):
    return resource_for_file(obj) if kind == "file" else resource_for_knowledge(obj)


def can_read_artifact(db: Session, workspace_id: str, principal: Principal, kind: str, obj) -> bool:
    if kind == "file":
        return can_read_file(db, workspace_id, principal, obj)
    return can_read_knowledge(db, workspace_id, principal, obj)


def can_manage_artifact(db: Session, workspace_id: str, principal: Principal, kind: str, obj) -> bool:
    return can_manage(db, principal, resource_for(kind, obj), workspace_id)


def artifact_title(kind: str, obj) -> str:
    return _basename(obj.filename) if kind == "file" else (obj.title or obj.slug or "Document")


def human_principal(db: Session, workspace: Workspace, email: Optional[str]) -> Optional[Principal]:
    """The person as a member of the workspace now, or None if they are not one."""
    email = (email or "").strip().lower()
    if not email:
        return None
    role = workspace_human_role(db, workspace, email)
    if not role:
        return None
    return Principal("human", email=email, role=role, workspace_id=str(workspace.id))


# ---------------------------------------------------------------------------
# Snapshots
# ---------------------------------------------------------------------------

_CODE = re.compile(r"(```.*?```|~~~.*?~~~|`[^`\n]*`)", re.S)


def _embed_images(db: Session, workspace: Workspace, creator: Principal, text: str,
                  agent: Optional[Principal] = None) -> Tuple[str, List[Tuple[dict, bytes]]]:
    """Copy the workspace images a markdown document embeds and point the
    document at the copies (``oa-share-asset:<n>``).

    Publishing an image is its own decision: only images the person sharing
    can *manage* are copied, not every image they can read — an agent could
    otherwise embed the id of an image only an admin sees and ask that admin
    to share "notes.md". When an agent asked, it must be able to read the
    image too. Code is left alone, and so are images nobody may copy,
    non-images and outside links: they stay broken for the public."""
    store = get_file_store()
    assets: List[Tuple[dict, bytes]] = []
    by_file: dict = {}

    def swap(url: str) -> str:
        m = _FILE_REF.fullmatch(url.strip())
        if not m:
            return url
        file_id = m.group(1).lower()
        if file_id in by_file:
            return f"{ASSET_SCHEME}{by_file[file_id]}"
        if len(assets) >= MAX_ASSETS:
            return url
        record = db.get(FileRecord, file_id)
        if (record is None or record.status != "active" or str(record.workspace_id) != str(workspace.id)
                or not (record.content_type or "").startswith("image/")
                or (record.size or 0) > MAX_ASSET_BYTES
                or not can_manage(db, creator, resource_for_file(record), str(workspace.id))
                or (agent is not None and not can_read_file(db, str(workspace.id), agent, record))):
            return url
        try:
            data = store.read(record.storage_key)
        except Exception:  # noqa: BLE001 — S3 reports a missing object as its own error type
            return url
        by_file[file_id] = len(assets)
        assets.append(({"filename": _basename(record.filename), "content_type": record.content_type}, data))
        return f"{ASSET_SCHEME}{by_file[file_id]}"

    def prose(part: str) -> str:
        part = _MD_IMAGE.sub(lambda m: m.group(1) + swap(m.group(2)) + m.group(3), part)
        return _HTML_IMAGE.sub(lambda m: m.group(1) + swap(m.group(2)) + m.group(3), part)

    # Split on code: odd pieces are code spans and blocks, kept verbatim.
    pieces = _CODE.split(text)
    text = "".join(piece if i % 2 else prose(piece) for i, piece in enumerate(pieces))
    return text, assets


def artifact_bytes(kind: str, obj) -> bytes:
    """The artifact's content as stored now."""
    store = get_file_store()
    if kind == "knowledge" and not obj.storage_key:
        return b""
    try:
        return store.read(obj.storage_key)
    except Exception:  # noqa: BLE001 — S3 reports a missing object as its own error type
        if kind == "knowledge":
            return b""
        logger.warning("Public share: could not read %s", obj.storage_key, exc_info=True)
        raise ShareError(404, "The file's data could not be read")


def content_digest(kind: str, obj) -> str:
    return hashlib.sha256(artifact_bytes(kind, obj)).hexdigest()


def _snapshot(db: Session, workspace: Workspace, creator: Principal, kind: str, obj,
              agent: Optional[Principal] = None):
    """(title, content_type, data, assets, entrypoint) — a copy of the artifact as it is now."""
    data = artifact_bytes(kind, obj)
    entrypoint = None
    if kind == "file":
        title, content_type = _basename(obj.filename), obj.content_type or "application/octet-stream"
        if is_web_project(content_type):
            from app.routers.web_projects import open_archive
            try:
                archive, manifest = open_archive(data)
            except HTTPException:
                raise ShareError(400, "This web project's bundle is invalid")
            archive.close()
            entrypoint = manifest["entrypoint"]
        elif is_html(content_type, title):
            entrypoint = "index.html"
    else:
        title, content_type = artifact_title(kind, obj), "text/markdown"
    assets: List[Tuple[dict, bytes]] = []
    if is_markdown(content_type, title):
        text, assets = _embed_images(db, workspace, creator, data.decode("utf-8", "replace"), agent)
        data = text.encode("utf-8")
    return title, content_type, data, assets, entrypoint


def _write_snapshot(link: PublicShare, title: str, content_type: str, data: bytes, assets) -> List[str]:
    """Store the copy under a fresh key and point the link at it. Returns the
    keys the link held before, for the caller to delete once committed."""
    store = get_file_store()
    old = [link.storage_key] + [a["storage_key"] for a in (link.assets or [])] if link.storage_key else []
    rev = uuid.uuid4().hex[:12]
    folder = f"public-shares/{link.id}-{rev}"
    # A fixed object name: the title can be "..", or too long for a filename.
    link.storage_key = store.save(str(link.workspace_id), folder, "content", data)
    saved = []
    for i, (meta, blob) in enumerate(assets):
        key = store.save(str(link.workspace_id), folder, f"asset-{i}", blob)
        saved.append({**meta, "storage_key": key})
    link.assets = saved or None
    link.title = title
    link.content_type = content_type
    link.size = len(data)
    link.snapshot_at = _now()
    return old


def delete_objects(keys: Iterable[str]) -> None:
    store = get_file_store()
    for key in keys:
        if not key:
            continue
        try:
            store.delete(key)
        except Exception:  # noqa: BLE001 — a leftover copy is harmless; it is never served
            logger.warning("Public share: could not delete %s", key, exc_info=True)


# ---------------------------------------------------------------------------
# Links
# ---------------------------------------------------------------------------

def live_share(db: Session, kind: str, resource_id: str) -> Optional[PublicShare]:
    """The artifact's unrevoked link — which may still be expired, or dead
    with its creator; see ``usable``."""
    return db.execute(
        select(PublicShare).where(
            PublicShare.resource_kind == kind,
            PublicShare.resource_id == str(resource_id),
            PublicShare.revoked_at.is_(None),
        ).order_by(PublicShare.created_at.desc())
    ).scalars().first()


def usable(db: Session, workspace: Workspace, link: Optional[PublicShare], obj) -> bool:
    """Whether a link would be served now: not expired, creator still able to share."""
    if link is None or link.revoked_at is not None:
        return False
    if link.expires_at is not None and _aware(link.expires_at) <= _now():
        return False
    return creator_can_still_share(db, workspace, link, obj)


def current_share(db: Session, workspace: Workspace, kind: str, obj) -> Optional[PublicShare]:
    """The artifact's link if it is being served, else None."""
    link = live_share(db, kind, obj.id)
    return link if usable(db, workspace, link, obj) else None


def publish(db: Session, workspace: Workspace, creator: Principal, kind: str, obj,
            expires_at: Optional[datetime], *, approval_id: Optional[str] = None,
            commit: bool = True, agent: Optional[Principal] = None) -> PublicShare:
    """Create the artifact's link, or refresh the live one (same token, a new
    snapshot, the new expiry). ``creator`` must be a person who can manage the
    artifact. Commits, unless ``commit`` is False: then the caller owns the
    transaction, and the previous copy is left in storage rather than deleted
    before that transaction lands."""
    if creator.kind != "human" or not creator.email:
        raise ShareError(403, "Only a signed-in person can create a public link")
    wid = str(workspace.id)
    if not can_manage_artifact(db, wid, creator, kind, obj):
        raise ShareError(403, "Only the artifact's owner or an admin can create a public link")
    expires_at = _aware(expires_at)
    if expires_at is not None and expires_at <= _now():
        raise ShareError(400, "Choose an expiry date in the future")
    title, content_type, data, assets, entrypoint = _snapshot(db, workspace, creator, kind, obj, agent)

    link = live_share(db, kind, obj.id)
    if link is not None and not usable(db, workspace, link, obj):
        # An expired link, or one whose creator can no longer share it, ends
        # here: sharing again must not hand its old token a new copy.
        link.revoked_at = _now()
        db.flush()
        link = None
    fresh = link is None
    if fresh:
        link = PublicShare(
            id=str(uuid.uuid4()), workspace_id=wid, resource_kind=kind, resource_id=str(obj.id),
            token=secrets.token_urlsafe(24),
        )
    old_keys = _write_snapshot(link, title, content_type, data, assets)
    link.entrypoint = entrypoint
    link.created_by = f"human:{creator.email}"
    link.expires_at = expires_at
    if approval_id:
        link.approval_id = approval_id
    if fresh:
        db.add(link)
    if not commit:
        try:
            with db.begin_nested():
                db.flush()
        except IntegrityError:
            # A direct create (or another approval) won the race: keep its link.
            winner = live_share(db, kind, obj.id)
            if winner is None:
                raise ShareError(500, "Couldn't create the public link")
            return winner
        return link
    try:
        db.commit()
    except IntegrityError:
        # A second create won the race (uq_public_shares_live): keep its link.
        db.rollback()
        delete_objects([link.storage_key] + [a["storage_key"] for a in (link.assets or [])])
        winner = live_share(db, kind, obj.id)
        if winner is None:
            raise ShareError(500, "Couldn't create the public link")
        return winner
    db.refresh(link)
    delete_objects(old_keys)
    return link


def revoke(db: Session, kind: str, resource_ids: Iterable[str]) -> None:
    """Stamp revoked_at on every live link of these artifacts. The caller
    commits. The copies stay in storage until then; a revoked link never
    serves them again."""
    ids = [str(i) for i in resource_ids if i]
    if not ids:
        return
    db.execute(
        update(PublicShare)
        .where(PublicShare.resource_kind == kind, PublicShare.resource_id.in_(ids), PublicShare.revoked_at.is_(None))
        .values(revoked_at=_now())
    )


def revoke_file_links(db: Session, file_ids: Iterable[str]) -> None:
    revoke(db, "file", file_ids)


def move_file_links(db: Session, old_ids: Iterable[str], new_id: str) -> None:
    """A file replaced by a new upload at the same path keeps its public link:
    the link serves its snapshot, and refreshing it picks up the new file."""
    ids = [str(i) for i in old_ids if i]
    if not ids:
        return
    links = db.execute(
        select(PublicShare).where(PublicShare.resource_kind == "file", PublicShare.resource_id.in_(ids),
                                  PublicShare.revoked_at.is_(None)).order_by(PublicShare.created_at.desc())
    ).scalars().all()
    # Several records at one path can each have had a link; one file has one.
    for i, link in enumerate(links):
        if i == 0:
            link.resource_id = str(new_id)
        else:
            link.revoked_at = _now()


def creator_can_still_share(db: Session, workspace: Workspace, link: PublicShare, obj) -> bool:
    created_by = link.created_by or ""
    if not created_by.startswith("human:"):
        return False
    creator = human_principal(db, workspace, created_by[len("human:"):])
    return creator is not None and can_manage_artifact(db, str(workspace.id), creator, link.resource_kind, obj)


def resolve_public(db: Session, token: str) -> Tuple[Optional[PublicShare], Optional[str]]:
    """(link, None) for a link that may be served, else (None, why)."""
    gone = "This link is no longer available"
    link = db.execute(select(PublicShare).where(PublicShare.token == token)).scalar_one_or_none()
    if link is None or link.revoked_at is not None:
        return None, gone
    if link.expires_at is not None and _aware(link.expires_at) <= _now():
        return None, "This link has expired"
    workspace = db.get(Workspace, link.workspace_id)
    if not workspace or workspace.status == "deleted":
        return None, gone
    obj = load_artifact(db, link.workspace_id, link.resource_kind, link.resource_id)
    if obj is None or not creator_can_still_share(db, workspace, link, obj):
        return None, gone
    return link, None


def public_url(token: str) -> str:
    """The address a public link is handed out as: the share domain's own
    viewer (https://<share host>/<token>), or the workspace app's page where
    no share domain is configured (preview, local development)."""
    if config.SHARE_CONTENT_HOST:
        return f"https://{config.SHARE_CONTENT_HOST}/{token}"
    return f"{config.FRONTEND_BASE_URL.rstrip('/')}/share/artifact/{token}"


def render_base(token: str) -> Optional[str]:
    """Where an HTML page or web project renders, on the separate share domain."""
    if not config.SHARE_CONTENT_HOST:
        return None
    return f"https://{config.SHARE_CONTENT_HOST}/v1/public/shares/{token}/site/"


def serialize(link: Optional[PublicShare], manage: bool) -> dict:
    """``manage`` (and with it the token) only for a signed-in person: agents
    and bare tokens neither create links nor learn them here."""
    if link is None:
        return {"link": None, "can_manage": manage}
    body = {
        "active": True,
        "created_at": link.created_at.isoformat() if link.created_at else None,
        "snapshot_at": link.snapshot_at.isoformat() if link.snapshot_at else None,
        "expires_at": _aware(link.expires_at).isoformat() if link.expires_at else None,
    }
    if manage:
        body.update({"token": link.token, "url": public_url(link.token), "created_by": link.created_by})
    return {"link": body, "can_manage": manage}


# ---------------------------------------------------------------------------
# Agent requests → approval by a person
# ---------------------------------------------------------------------------

def create_request(db: Session, workspace: Workspace, *, channel_name: str, agent: str, kind: str, obj,
                   expires_at: Optional[datetime], reason: Optional[str],
                   requester_email: Optional[str]) -> ApprovalRequest:
    """File an approval for a public link in the thread. No policy applies:
    a public link always waits for a person. Does not commit."""
    from openagents.core.onm_events import Event
    from app.services import approvals
    from app.services.notify import REASON_APPROVAL, notify

    wid = str(workspace.id)
    existing = db.execute(select(ApprovalRequest).where(
        ApprovalRequest.workspace_id == wid,
        ApprovalRequest.channel_name == channel_name,
        ApprovalRequest.kind == REQUEST_KIND,
        ApprovalRequest.status == approvals.STATUS_PENDING,
        ApprovalRequest.policy_requirements["share_artifact_id"].as_string() == str(obj.id),
    )).scalars().first()
    if existing:
        return existing
    expires_at = _aware(expires_at)
    title = artifact_title(kind, obj)
    details = [f"Anyone with the link will be able to view a copy of \"{title}\" as it is now, without signing in."]
    details.append(f"Expires: {expires_at.date().isoformat()}" if expires_at else "Expires: never")
    if (reason or "").strip():
        details.append(f"Reason given by {agent}: {reason.strip()[:500]}")
    owner = approvals.agent_owner_email(db, wid, agent)
    request = ApprovalRequest(
        workspace_id=wid, channel_name=channel_name, requested_by=agent, kind=REQUEST_KIND,
        action=f"Create a public link to {title}", details="\n".join(details), risk="medium",
        required_role="any", assignee_email=None, status=approvals.STATUS_PENDING,
        policy_requirements={
            "share_artifact_kind": kind, "share_artifact_id": str(obj.id),
            "share_expires_at": expires_at.isoformat() if expires_at else None,
            # What the person is shown is what gets published: approving
            # checks the artifact still has this content.
            "share_digest": content_digest(kind, obj),
        },
    )
    db.add(request)
    db.flush()
    card = Event(type="workspace.message.posted", source=f"openagents:{agent}",
                 target=f"channel/{channel_name}",
                 payload={"content": approvals._request_text(request, requester_email), "message_type": "approval",
                          "approval": approvals.serialize(request, owner_email=owner, requester_email=requester_email)},
                 metadata={"approval_id": request.id})
    request.request_event_id = card.id
    approvals._emit(db, workspace, card)
    for recipient in {e for e in (approvals._norm_email(requester_email), owner) if e}:
        notify(db, wid, source=f"openagents:{agent}", title=request.action,
               message=f"{agent} asks to share \"{title}\" publicly.", priority="high",
               channel_name=channel_name, reason=REASON_APPROVAL, recipient_email=recipient,
               kind="approval", action_ref=request.id)
    db.flush()
    return request


def resolve_request(db: Session, workspace: Workspace, request: ApprovalRequest, actor_id: str, actor_label: str) -> None:
    """Called from approvals.resolve. Approving publishes the link as the
    approver, who must be a signed-in person able to manage the artifact; the
    agent is told the link in the thread."""
    from openagents.core.onm_events import Event
    from app.services import approvals

    policy = request.policy_requirements or {}
    url = None
    if request.status == approvals.STATUS_APPROVED:
        approver = human_principal(db, workspace, actor_id if "@" in (actor_id or "") else None)
        if approver is None:
            raise HTTPException(403, "Sign in as a workspace member to approve a public link")
        obj = load_artifact(db, str(workspace.id), policy.get("share_artifact_kind"), policy.get("share_artifact_id"))
        if obj is None:
            raise HTTPException(404, "The artifact no longer exists")
        kind = policy["share_artifact_kind"]
        if not can_manage_artifact(db, str(workspace.id), approver, kind, obj):
            raise HTTPException(403, "Only the artifact's owner or an admin can approve a public link")
        if policy.get("share_digest") and policy["share_digest"] != content_digest(kind, obj):
            raise HTTPException(409, "The artifact changed after the agent asked. Reject this request and ask the agent again.")
        expires = policy.get("share_expires_at")
        expires_at = datetime.fromisoformat(expires) if expires else None
        if expires_at is not None and _aware(expires_at) <= _now():
            raise HTTPException(400, "The expiry the agent asked for has passed. Reject this request and ask again.")
        from app.models import WorkspaceMember
        member = db.execute(select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == str(workspace.id),
            WorkspaceMember.agent_name == request.requested_by)).scalar_one_or_none()
        agent = Principal("agent", agent_name=request.requested_by, workspace_id=str(workspace.id),
                          owner_email=member.owner_email if member else None)
        try:
            link = publish(db, workspace, approver, kind, obj, expires_at,
                           approval_id=request.id, commit=False, agent=agent)
        except ShareError as exc:
            raise HTTPException(exc.status, exc.message)
        url = public_url(link.token)
        request.note = ((request.note or "") + f"\nPublic link: {url}").strip()
    text = approvals._resolution_text(request, actor_label)
    event = Event(
        type="workspace.message.posted", source=f"human:{actor_id}",
        target=f"channel/{request.channel_name}",
        payload={"content": text, "message_type": "chat", "sender_type": "human",
                 "sender_name": actor_label, "sender_id": actor_id, "mentions": [request.requested_by],
                 "approval": approvals.serialize_with_owner(db, request)},
        metadata={"approval_id": request.id, "target_agents": [request.requested_by]},
    )
    request.resolution_event_id = event.id
    approvals._emit(db, workspace, event, approved_agent=request.requested_by)


def guess_type(path: str) -> str:
    mime = mimetypes.guess_type(path)[0] or "application/octet-stream"
    return "text/javascript" if path.endswith((".js", ".mjs")) else mime
