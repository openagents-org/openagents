"""Shared issues: human discussion is independent of agent execution.

Only human comments mentioning an agent already on the issue start work.
Adding participants, ordinary discussion, and linking existing work stay passive.
"""

import uuid
import re
import logging
from datetime import date, datetime, timezone
from typing import Literal, Optional

from fastapi import BackgroundTasks, APIRouter, Depends, Header, HTTPException, Query
from pydantic_core import PydanticCustomError
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.access import resolve_current_user, verify_workspace_access
from app.database import get_db
from app.models import (
    Channel,
    EventRecord,
    Issue,
    IssueComment,
    IssueThread,
    IssueAgentSharing,
    ApprovalRequest,
    WorkspaceMember,
    WorkspaceMembership,
    User,
)
from app.response import success_response
from app.routers.network import _emit_event_blocking, _resolve_workspace
from openagents.core.onm_events import Event

router = APIRouter(prefix="/v1/issues", tags=["Issues"])
IssueStatus = Literal["open", "in_progress", "paused", "closed"]


class ActorRequest(BaseModel):
    source: str = Field(default="human:user", max_length=320)
    source_name: Optional[str] = Field(default=None, max_length=240)


class CreateIssueRequest(ActorRequest):
    assignee: Optional[str] = Field(default=None, max_length=330)
    knowledge_ids: list[str] = Field(default_factory=list, max_length=100)
    file_ids: list[str] = Field(default_factory=list, max_length=100)
    title: str = Field(min_length=1, max_length=240)
    description: str = Field(default="", max_length=50000)
    channel_name: Optional[str] = None

    @field_validator("title", mode="before")
    @classmethod
    def title_not_blank(cls, value):
        return value.strip() if isinstance(value, str) else value


class UpdateIssueRequest(ActorRequest):
    due_date: Optional[date] = None

    @field_validator("due_date", mode="before")
    @classmethod
    def calendar_date_only(cls, value):
        if value is not None and (not isinstance(value, str) or not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value)):
            raise PydanticCustomError("due_date_format", "Due date must be YYYY-MM-DD or null")
        return value

    knowledge_ids: Optional[list[str]] = Field(default=None, max_length=100)
    file_ids: Optional[list[str]] = Field(default=None, max_length=100)
    title: Optional[str] = Field(default=None, min_length=1, max_length=240)
    description: Optional[str] = Field(default=None, max_length=50000)
    status: Optional[IssueStatus] = None
    assignee: Optional[str] = Field(default=None, max_length=330)
    labels: Optional[list[str]] = Field(default=None, max_length=20)

    @field_validator("labels")
    @classmethod
    def clean_labels(cls, values):
        if values is None:
            return values
        result = []
        for value in values:
            value = value.strip()
            if not value or len(value) > 40:
                raise PydanticCustomError("label_length", "Labels must be between 1 and 40 characters")
            if value.casefold() not in {item.casefold() for item in result}:
                result.append(value)
        return result

    @field_validator("title", mode="before")
    @classmethod
    def title_not_blank(cls, value):
        return value.strip() if isinstance(value, str) else value


class CommentRequest(ActorRequest):
    content: str = Field(default="", max_length=50000)
    source_event_id: Optional[str] = None


class LinkThreadRequest(ActorRequest):
    channel_name: str


class ParticipantRequest(BaseModel):
    kind: Literal["human", "agent"]
    id: str = Field(min_length=1, max_length=320)


class AddParticipantsRequest(BaseModel):
    participants: list[ParticipantRequest] = Field(min_length=1, max_length=100)


def _access(network, db, token, authorization, write=False):
    workspace = _resolve_workspace(db, network)
    if not workspace:
        raise HTTPException(404, "Workspace not found")
    if not verify_workspace_access(
        workspace, token, authorization, db, min_role="member" if write else None
    ):
        raise HTTPException(
            403, "You do not have access to this action in this workspace"
        )
    return workspace


def _issue(db, workspace, issue_id, lock=False):
    query = select(Issue).where(
        Issue.workspace_id == workspace.id, Issue.id == issue_id
    )
    if lock:
        query = query.with_for_update()
    issue = db.execute(query).scalar_one_or_none()
    if not issue:
        raise HTTPException(404, "Issue not found")
    return issue


def _actor(db, authorization, source, source_name=None):
    # A verified human identity wins over client-provided attribution. Machine
    # tokens remain trusted, as elsewhere in the workspace API.
    user = resolve_current_user(db, authorization)
    if user:
        return f"human:{user.email}", getattr(user, "display_name", None) or user.email
    if (
        not source.startswith(("human:", "openagents:"))
        or not source.split(":", 1)[1].strip()
    ):
        raise HTTPException(422, "Source must identify a human or agent")
    return source, (source_name or "").strip() or source.split(":", 1)[1]


def _iso(value):
    return (value if value.tzinfo else value.replace(tzinfo=timezone.utc)).isoformat()


def _resolve_assignee(db, workspace, actor, assignee):
    if not assignee:
        return None, None
    kind, _, identifier = assignee.partition(":")
    if kind == "human":
        member = db.execute(select(User).join(WorkspaceMembership).where(
            WorkspaceMembership.workspace_id == workspace.id,
            func.lower(User.email) == identifier.lower(),
        )).scalar_one_or_none()
        if member is None:
            raise HTTPException(422, "Choose a workspace member")
        assignee = f"human:{member.email.lower()}"
    else:
        raise HTTPException(422, "Issue assignees must be human workspace members. Mention an agent in the discussion to request work.")
    return assignee, member.display_name or identifier


def _validate_context(db, workspace, viewer, knowledge_ids, file_ids):
    from app.models import KnowledgeEntry, FileRecord
    from app.services.access_model import can_read_knowledge, can_read_file, can_manage, resource_for_file
    knowledge_ids, file_ids = list(dict.fromkeys(knowledge_ids)), list(dict.fromkeys(file_ids))
    for kind, ids, model, readable in (("knowledge", knowledge_ids, KnowledgeEntry, can_read_knowledge), ("file", file_ids, FileRecord, can_read_file)):
        rows = db.execute(select(model).where(model.workspace_id == workspace.id, model.id.in_(ids), model.status == "active")).scalars().all() if ids else []
        if len(rows) != len(ids) or any(not readable(db, str(workspace.id), viewer, row) for row in rows):
            raise HTTPException(404, f"Selected {kind} is unavailable")
        if kind == "file":
            for record in rows:
                # Issues are workspace-wide. Attaching a file deliberately shares
                # it with that audience, but requires the right to share it.
                if record.visibility not in ("public", "workspace", "team"):
                    if not can_manage(db, viewer, resource_for_file(record), str(workspace.id)):
                        raise HTTPException(403, "You cannot share this attachment with the issue")
                    record.visibility = "public"
    return knowledge_ids, file_ids


def _context_metadata(db, workspace, viewer, issue):
    from app.models import KnowledgeEntry, FileRecord
    from app.services.access_model import can_read_knowledge, can_read_file
    files = db.execute(select(FileRecord).where(FileRecord.workspace_id == workspace.id, FileRecord.id.in_(issue.file_ids or []), FileRecord.status == "active")).scalars().all()
    knowledge = db.execute(select(KnowledgeEntry).where(KnowledgeEntry.workspace_id == workspace.id, KnowledgeEntry.id.in_(issue.knowledge_ids or []), KnowledgeEntry.status == "active")).scalars().all()
    return {
        "attachments": [{"file_id": f.id, "filename": f.filename, "content_type": f.content_type, "size": f.size} for f in files if can_read_file(db, str(workspace.id), viewer, f)],
        "knowledge": [{"id": k.id, "title": k.title} for k in knowledge if can_read_knowledge(db, str(workspace.id), viewer, k)],
    }


def _serialize(issue):
    return {
        key: getattr(issue, key)
        for key in (
            "id",
            "title",
            "description",
            "status",
            "assignee",
            "assignee_name",
            "labels",
            "knowledge_ids",
            "file_ids",
            "created_by",
            "created_by_name",
            "participants",
        )
    } | {
        "due_date": issue.due_date.isoformat() if issue.due_date else None,
        "created_at": _iso(issue.created_at),
        "updated_at": _iso(issue.updated_at),
    }


def _comment(comment):
    return {
        key: getattr(comment, key)
        for key in ("id", "author", "author_name", "content", "kind", "source_event_id")
    } | {
        "created_at": _iso(comment.created_at),
    }


def _add_comment(
    db, issue, author, content, kind="comment", source_event_id=None, author_name=None
):
    comment = IssueComment(
        issue_id=issue.id,
        author=author,
        author_name=author_name,
        content=content,
        kind=kind,
        source_event_id=source_event_id,
    )
    db.add(comment)
    issue.updated_at = datetime.now(timezone.utc)
    return comment


def _channel(db, workspace, name):
    channel = db.execute(
        select(Channel).where(
            Channel.workspace_id == workspace.id,
            Channel.name == name,
            Channel.status != "deleted",
        )
    ).scalar_one_or_none()
    if not channel:
        raise HTTPException(404, "Thread not found")
    return channel


def _viewer(db, workspace, token, authorization):
    # Permission model: issues are workspace-wide, but the threads linked to
    # them keep their own visibility. A private thread never shows through an
    # issue to someone who is not inside it.
    from app.services.visibility import resolve_viewer
    return resolve_viewer(db, workspace, token, authorization)


def _can_see(db, workspace, viewer, channel_name):
    from app.services.visibility import can_view_channel_name
    return can_view_channel_name(db, workspace.id, viewer, channel_name)


def _visible_channel(db, workspace, viewer, name):
    channel = _channel(db, workspace, name)
    if not _can_see(db, workspace, viewer, channel.name):
        raise HTTPException(404, "Thread not found")
    return channel


def _link_thread(db, issue, channel):
    if db.get(IssueThread, (issue.id, channel.id)) is None:
        db.add(IssueThread(issue_id=issue.id, channel_id=channel.id))
    issue.updated_at = datetime.now(timezone.utc)


def _linked_channels(db, issue):
    return list(
        db.execute(
            select(Channel)
            .join(IssueThread, IssueThread.channel_id == Channel.id)
            .where(
                IssueThread.issue_id == issue.id,
                Channel.workspace_id == issue.workspace_id,
                Channel.status != "deleted",
            )
            .order_by(IssueThread.created_at)
        ).scalars()
    )


def _participants(db, issue, channels):
    people = {issue.created_by: {"source": issue.created_by, "name": issue.created_by_name or issue.created_by.split(":", 1)[-1]}}
    for comment in db.execute(select(IssueComment).where(IssueComment.issue_id == issue.id)).scalars():
        people[comment.author] = {"source": comment.author, "name": comment.author_name or comment.author.split(":", 1)[-1]}
    for channel in channels:
        for agent in channel.participants:
            people[f"openagents:{agent.agent_name}"] = {"source": f"openagents:{agent.agent_name}", "name": agent.agent_name}
    for person in issue.participants or []:
        if person.get("removed"):
            people.pop(person["source"], None)
        else:
            people[person["source"]] = person
    return list(people.values())


def _mentioned_agents(content, agents):
    # Exact handles only: email addresses and longer handles must not trigger
    # a similarly named agent. Code snippets and quoted text are passive.
    prose = re.sub(r"```[\s\S]*?```|`[^`\n]*`|(?m:^>.*$)", "", content)
    return [name for name in agents if re.search(r"(?<![\w@])@" + re.escape(name) + r"(?![\w@-]|\.[\w-])", prose)]


@router.get("")
def list_issues(
    network: str,
    q: str = Query("", max_length=240),
    status: Optional[IssueStatus] = None,
    assigned_to_me: bool = False,
    active_only: bool = False,
    offset: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=200),
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    workspace = _access(network, db, x_workspace_token, authorization)
    query = select(Issue).where(Issue.workspace_id == workspace.id)
    if assigned_to_me:
        user = resolve_current_user(db, authorization)
        if not user:
            raise HTTPException(401, "Sign in to view issues assigned to you")
        query = query.where(func.lower(Issue.assignee) == f"human:{user.email.lower()}")
    if status:
        query = query.where(Issue.status == status)
    elif active_only:
        query = query.where(Issue.status.in_(("open", "in_progress")))
    if q.strip():
        query = query.where(
            Issue.title.icontains(q.strip(), autoescape=True)
            | Issue.description.icontains(q.strip(), autoescape=True)
        )
    rows = list(
        db.execute(
            query.order_by(Issue.updated_at.desc(), Issue.id)
            .offset(offset)
            .limit(limit + 1)
        ).scalars()
    )
    counts = dict(
        db.execute(
            select(IssueComment.issue_id, func.count())
            .where(
                IssueComment.issue_id.in_([i.id for i in rows[:limit]]),
                IssueComment.kind != "status",
            )
            .group_by(IssueComment.issue_id)
        ).all()
    )
    return success_response(
        {
            "issues": [
                _serialize(i) | {"comment_count": counts.get(i.id, 0)}
                for i in rows[:limit]
            ],
            "next_offset": offset + limit if len(rows) > limit else None,
        }
    )


@router.post("")
def create_issue(
    body: CreateIssueRequest,
    network: str,
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    workspace = _access(network, db, x_workspace_token, authorization, write=True)
    actor, actor_name = _actor(db, authorization, body.source, body.source_name)
    channel = (
        _visible_channel(db, workspace, _viewer(db, workspace, x_workspace_token, authorization), body.channel_name)
        if body.channel_name else None
    )
    assignee, assignee_name = _resolve_assignee(db, workspace, actor, body.assignee)
    viewer = _viewer(db, workspace, x_workspace_token, authorization)
    knowledge_ids, file_ids = _validate_context(db, workspace, viewer, body.knowledge_ids, body.file_ids)
    issue = Issue(
        assignee=assignee, assignee_name=assignee_name,
        knowledge_ids=knowledge_ids, file_ids=file_ids,
        participants=[{"source": assignee, "name": assignee_name}] if assignee else [],
        workspace_id=workspace.id,
        title=body.title,
        description=body.description.strip(),
        created_by=actor,
        created_by_name=actor_name,
    )
    db.add(issue)
    db.flush()
    if channel:
        _link_thread(db, issue, channel)
    db.commit()
    return success_response(_serialize(issue))


@router.get("/labels")
def list_issue_labels(
    network: str,
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    workspace = _access(network, db, x_workspace_token, authorization)
    labels = {}
    for values in db.scalars(select(Issue.labels).where(Issue.workspace_id == workspace.id)):
        for value in values or []:
            labels.setdefault(value.casefold(), value)
    return success_response({"labels": sorted(labels.values(), key=str.casefold)})


@router.get("/{issue_id}")
def get_issue(
    issue_id: str,
    network: str,
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    workspace = _access(network, db, x_workspace_token, authorization)
    viewer = _viewer(db, workspace, x_workspace_token, authorization)
    issue = _issue(db, workspace, issue_id)
    comments = (
        db.execute(
            select(IssueComment)
            .where(IssueComment.issue_id == issue.id)
            .order_by(IssueComment.created_at, IssueComment.id)
        )
        .scalars()
        .all()
    )
    channels = [c for c in _linked_channels(db, issue) if _can_see(db, workspace, viewer, c.name)]
    # Only expose replies from linked execution threads the caller may read.
    names = {c.name for c in channels}
    latest = {}
    if names:
        ranked = (
            select(
                EventRecord.id,
                EventRecord.target,
                func.row_number()
                .over(
                    partition_by=EventRecord.target,
                    order_by=(EventRecord.timestamp.desc(), EventRecord.id.desc()),
                )
                .label("rank"),
            )
            .where(
                EventRecord.network_id == workspace.id,
                EventRecord.target.in_([f"channel/{n}" for n in names]),
                EventRecord.type == "workspace.message.posted",
                EventRecord.source.startswith("openagents:"),
                func.coalesce(EventRecord.payload["message_type"].as_string(), "chat")
                == "chat",
            )
            .subquery()
        )
        events = db.execute(
            select(EventRecord)
            .join(ranked, ranked.c.id == EventRecord.id)
            .where(ranked.c.rank == 1)
        ).scalars()
        for event in events:
            latest[event.target[len("channel/") :]] = {
                "id": event.id,
                "author": event.source,
                "content": (event.payload or {}).get("content", ""),
            }
    # Project completed chat replies into the discussion without copying
    # private thread content into a workspace-visible IssueComment record.
    discussion = [_comment(c) for c in comments]
    already = {c.source_event_id for c in comments if c.source_event_id}
    if names:
        replies = db.execute(select(EventRecord).where(
            EventRecord.network_id == workspace.id,
            EventRecord.target.in_([f"channel/{n}" for n in names]),
            EventRecord.type == "workspace.message.posted",
            EventRecord.source.startswith("openagents:"),
            func.coalesce(EventRecord.payload["message_type"].as_string(), "chat") == "chat",
        ).order_by(EventRecord.timestamp, EventRecord.id)).scalars()
        for reply in replies:
            content = (reply.payload or {}).get("content", "")
            if reply.id in already or not content.strip():
                continue
            discussion.append({"id": reply.id, "source_event_id": reply.id,
                "author": reply.source, "author_name": reply.source.split(":", 1)[-1],
                "content": content, "kind": "result",
                "created_at": datetime.fromtimestamp(reply.timestamp / 1000, timezone.utc).isoformat()})
    from app.services.approvals import serialize_with_owner
    for approval in db.execute(select(ApprovalRequest).where(ApprovalRequest.workspace_id == workspace.id,
            ApprovalRequest.channel_name.in_(names), ApprovalRequest.kind == "issue_agent_request")).scalars():
        discussion.append({"id": approval.id, "author": "system:approval", "author_name": "Approval",
            "kind": "approval", "content": approval.action, "source_event_id": None,
            "created_at": _iso(approval.created_at), "approval": serialize_with_owner(db, approval)})
    discussion.sort(key=lambda item: (item["created_at"], item["id"]))
    from app.services.thread_agent_requests import issue_request_access
    participants = [dict(person) for person in _participants(db, issue, channels)]
    for person in participants:
        if not person["source"].startswith("openagents:"):
            continue
        member = db.get(WorkspaceMember, (str(workspace.id), person["source"].split(":", 1)[1]))
        owner = member.owner_email if member else None
        user = db.execute(select(User).where(User.email == owner)).scalar_one_or_none() if owner else None
        person.update(owner_email=owner, owner_name=(user.display_name if user else None),
            request_access=issue_request_access(db, workspace.id, issue, member, viewer.email))

    return success_response(
        _serialize(issue)
        | _context_metadata(db, workspace, viewer, issue)
        | {
            "participants": participants,
            "comments": discussion,
            "agent_sharing_mode": (db.get(IssueAgentSharing, (issue.id, viewer.email)).mode if viewer.email and db.get(IssueAgentSharing, (issue.id, viewer.email)) else "no"),
            "threads": [
                {
                    "channel_name": c.name,
                    "title": c.title or c.name,
                    "status": c.status,
                    "agents": [p.agent_name for p in c.participants],
                    "latest_reply": latest.get(c.name),
                }
                for c in channels
            ],
        }
    )


@router.patch("/{issue_id}")
def update_issue(
    issue_id: str,
    body: UpdateIssueRequest,
    network: str,
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    workspace = _access(network, db, x_workspace_token, authorization, write=True)
    issue = _issue(db, workspace, issue_id, lock=True)
    actor, actor_name = _actor(db, authorization, body.source, body.source_name)
    if "due_date" in body.model_fields_set:
        # Attribution in the request is not proof of ownership. Require the
        # creator's authenticated human identity, even for workspace tokens.
        user = resolve_current_user(db, authorization)
        if not user or f"human:{user.email}".lower() != issue.created_by.lower():
            raise HTTPException(403, "Only the person who opened this issue can change its due date")
        if body.due_date != issue.due_date:
            issue.due_date = body.due_date
            _add_comment(db, issue, actor, body.due_date.isoformat() if body.due_date else "",
                         "due_date", author_name=actor_name)
    if "assignee" in body.model_fields_set and body.assignee != issue.assignee:
        current_agent = None
        if (issue.assignee or "").startswith("openagents:"):
            current_agent = db.get(WorkspaceMember, (str(workspace.id), issue.assignee.split(":", 1)[1]))
        may_assign = actor in (issue.created_by, issue.assignee) or (
            current_agent is not None and actor == f"human:{current_agent.owner_email}"
        )
        if not may_assign:
            raise HTTPException(403, "Only the creator or current assignee can reassign this issue")
        assignee, name = _resolve_assignee(db, workspace, actor, body.assignee)
        if assignee:
            roster = {p["source"]: p for p in issue.participants or []}
            roster[assignee] = {"source": assignee, "name": name}
            issue.participants = list(roster.values())
        issue.assignee, issue.assignee_name = assignee, name
        _add_comment(db, issue, actor, f"assigned this issue to {name}" if name else "removed the assignment", "activity", author_name=actor_name)
    if body.knowledge_ids is not None or body.file_ids is not None:
        viewer = _viewer(db, workspace, x_workspace_token, authorization)
        knowledge_ids, file_ids = _validate_context(db, workspace, viewer,
            body.knowledge_ids or [], body.file_ids or [])
        if body.knowledge_ids is not None:
            issue.knowledge_ids = knowledge_ids
        if body.file_ids is not None:
            issue.file_ids = file_ids
    if body.labels is not None and body.labels != issue.labels:
        issue.labels = body.labels
        _add_comment(db, issue, actor, "updated labels: " + (", ".join(body.labels) or "none"), "activity", author_name=actor_name)
    if body.title is not None:
        issue.title = body.title
    if body.description is not None:
        issue.description = body.description.strip()
    if body.status is not None and body.status != issue.status:
        _add_comment(
            db,
            issue,
            actor,
            f"{issue.status} → {body.status}",
            "status",
            author_name=actor_name,
        )
        issue.status = body.status
    db.commit()
    return success_response(_serialize(issue))


@router.post("/{issue_id}/comments")
def add_comment(
    issue_id: str,
    body: CommentRequest,
    network: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db, scope="function"),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    workspace = _access(network, db, x_workspace_token, authorization, write=True)
    issue = _issue(db, workspace, issue_id, lock=True)
    actor, actor_name = _actor(db, authorization, body.source, body.source_name)
    content, kind = body.content.strip(), "comment"
    if body.source_event_id:
        event = db.get(EventRecord, body.source_event_id)
        if event and (event.target or "").startswith("channel/") and not _can_see(
            db, workspace, _viewer(db, workspace, x_workspace_token, authorization),
            event.target[len("channel/"):],
        ):
            event = None
        names = {c.name for c in _linked_channels(db, issue)}
        if (
            not event
            or event.network_id != workspace.id
            or event.target not in {f"channel/{n}" for n in names}
            or event.type != "workspace.message.posted"
            or not event.source.startswith("openagents:")
            or (event.payload or {}).get("message_type", "chat") != "chat"
        ):
            raise HTTPException(
                404, "Agent reply not found in this issue's linked work"
            )
        existing = db.execute(
            select(IssueComment).where(
                IssueComment.issue_id == issue.id,
                IssueComment.source_event_id == event.id,
            )
        ).scalar_one_or_none()
        if existing:
            return success_response(_comment(existing))
        content, actor, kind = (
            (event.payload or {}).get("content", "").strip(),
            event.source,
            "result",
        )
        actor_name = event.source.removeprefix("openagents:")
    if not content:
        raise HTTPException(422, "Comment cannot be empty")
    targets = []
    if kind == "comment" and actor.startswith("human:"):
        viewer = _viewer(db, workspace, x_workspace_token, authorization)
        visible = [c for c in _linked_channels(db, issue) if _can_see(db, workspace, viewer, c.name)]
        roster = {p["source"].removeprefix("openagents:") for p in _participants(db, issue, visible) if p["source"].startswith("openagents:")}
        active = db.execute(select(WorkspaceMember.agent_name).where(
            WorkspaceMember.workspace_id == workspace.id, WorkspaceMember.status != "removed",
            WorkspaceMember.agent_name.in_(roster),
        )).scalars()
        targets = _mentioned_agents(content, sorted(active))
        if targets and issue.status == "closed":
            raise HTTPException(409, "Reopen the issue before asking an agent to work")
    comment = _add_comment(
        db, issue, actor, content, kind, body.source_event_id, author_name=actor_name
    )
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        # Concurrent attempts to share the same result are idempotent.
        if not body.source_event_id:
            raise
        comment = db.execute(
            select(IssueComment).where(
                IssueComment.issue_id == issue_id,
                IssueComment.source_event_id == body.source_event_id,
            )
        ).scalar_one_or_none()
        if comment is None:
            raise
    result = _comment(comment)
    if targets:
        from app.services.thread_agent_requests import issue_request_access
        allowed_targets = []
        for name in targets:
            member = db.get(WorkspaceMember, (str(workspace.id), name))
            if not viewer.machine and issue_request_access(db, workspace.id, issue, member, actor.removeprefix("human:")) == "no":
                owner_email = member.owner_email if member else None
                owner_user = db.execute(select(User).where(User.email == owner_email)).scalar_one_or_none() if owner_email else None
                owner = (owner_user.display_name if owner_user else None) or owner_email or "the owner"
                result["dispatch_error"] = f"Your comment was posted, but {name} wasn’t asked to work. Ask {owner} to enable sharing or require approval in this issue’s Details."
            else:
                allowed_targets.append(name)
        targets = allowed_targets
    if targets:
        try:
            result["channel_name"] = _start_issue_work(db, workspace, issue, actor, actor_name, targets, content, background_tasks)
        except Exception:
            # The comment is saved. Do not encourage reposting it (which could
            # create duplicate work); expose delivery failure separately.
            logging.getLogger(__name__).exception("Issue comment saved but agent dispatch failed")
            result["dispatch_error"] = "Your comment was saved, but the agent request could not be delivered. Check the linked work before trying again."
    return success_response(result)


@router.post("/{issue_id}/links")
def link_thread(
    issue_id: str,
    body: LinkThreadRequest,
    network: str,
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    workspace = _access(network, db, x_workspace_token, authorization, write=True)
    issue = _issue(db, workspace, issue_id, lock=True)
    viewer = _viewer(db, workspace, x_workspace_token, authorization)
    _link_thread(db, issue, _visible_channel(db, workspace, viewer, body.channel_name))
    db.commit()
    return success_response({"linked": True})


def _start_issue_work(db, workspace, issue, actor, actor_name, agents, instruction, background_tasks):
    # Bound the initial context. The durable discussion remains on the issue.
    comments = list(
        db.execute(
            select(IssueComment)
            .where(IssueComment.issue_id == issue.id, IssueComment.kind != "status")
            .order_by(IssueComment.created_at.desc(), IssueComment.id.desc())
            .limit(20)
        ).scalars()
    )
    discussion = "\n\n".join(
        f"{c.author}: {c.content[:4000]}" for c in reversed(comments)
    )
    name = f"issue-work-{uuid.uuid4().hex[:12]}"
    created = _emit_event_blocking(
        Event(
            type="network.channel.create",
            source=actor,
            target="core",
            # Issues are workspace-wide, so the execution thread an issue starts
            # is public (everyone who can read the issue can follow its work),
            # owned by the person who brought the agents in.
            payload={
                "name": name, "title": issue.title, "participants": agents,
                "visibility": "public",
                **({"owner_email": actor.split(":", 1)[1]} if actor.startswith("human:") and "@" in actor else {}),
            },
            metadata={},
        ),
        workspace,
        db,
        token=workspace.password_hash,
    )
    if created is None:
        raise HTTPException(502, "Could not create the agent thread")
    channel = _channel(db, workspace, name)
    _link_thread(db, issue, channel)
    db.commit()
    from types import SimpleNamespace
    from app.routers.tasks import _context_block, _task_attachments
    context = SimpleNamespace(issue_id=issue.id, knowledge_ids=[], file_ids=[])
    attachments = _task_attachments(db, str(workspace.id), context)
    kickoff = Event(
        type="workspace.message.posted",
        source=actor,
        target=f"channel/{name}",
        payload={
            "content": (
                f"{' '.join('@' + a for a in agents)}\n\nRequested work: {instruction.strip()}\n\n"
                f"Issue: {issue.title}\n{issue.description[:20000]}\n\nRecent discussion:\n{discussion}\n\n"
                f"{_context_block(db, str(workspace.id), SimpleNamespace(issue_id=None, knowledge_ids=issue.knowledge_ids))}\n\n"
                "Post your findings or deliverable here for the team to review. "
                "The issue stays open until the team decides it is resolved."
            ),
            "message_type": "chat",
            **({"attachments": attachments} if attachments else {}),
            "sender_email": actor.removeprefix("human:") if "@" in actor else None,
            "sender_name": actor_name,
        },
        metadata={"target_agents": agents},
    )
    sent = _emit_event_blocking(kickoff, workspace, db, token=workspace.password_hash)
    if sent is None:
        raise HTTPException(
            502,
            "Thread created, but the request could not be delivered. Open the linked thread to retry.",
        )
    db.refresh(issue)
    if issue.status == "open":
        issue.status = "in_progress"
    db.commit()
    from app.services.cloud_agent import invoke_cloud_agents
    background_tasks.add_task(invoke_cloud_agents, str(workspace.id), {
        "id": str(sent.id), "type": sent.type, "source": sent.source,
        "target": sent.target, "payload": sent.payload, "metadata": sent.metadata,
    })
    return name


@router.post("/{issue_id}/participants")
def add_participants(
    issue_id: str,
    body: AddParticipantsRequest,
    network: str,
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    workspace = _access(network, db, x_workspace_token, authorization, write=True)
    issue = _issue(db, workspace, issue_id, lock=True)
    participants = {p["source"]: p for p in (issue.participants or [])}
    # Validate the entire selection before changing the saved roster. Adding
    # an agent here is passive: only the explicit start-work endpoint routes it.
    for person in body.participants:
        identity = person.id.strip()
        if person.kind == "human":
            identity = identity.lower()
            member = db.execute(select(User).join(WorkspaceMembership).where(
                WorkspaceMembership.workspace_id == workspace.id,
                func.lower(User.email) == identity,
            )).scalar_one_or_none()
            source = f"human:{identity}"
        else:
            member = db.execute(select(WorkspaceMember).where(
                WorkspaceMember.workspace_id == workspace.id,
                WorkspaceMember.agent_name == identity,
                WorkspaceMember.status != "removed",
            )).scalar_one_or_none()
            source = f"openagents:{identity}"
        if member is None:
            raise HTTPException(422, "Choose an existing workspace member or agent")
        participants[source] = {"source": source, "name": member.display_name or identity}
    issue.participants = list(participants.values())
    issue.updated_at = datetime.now(timezone.utc)
    db.commit()
    return success_response({"participants": issue.participants})


@router.post("/{issue_id}/participants/remove")
def remove_participant(
    issue_id: str, body: ParticipantRequest, network: str,
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None), authorization: Optional[str] = Header(None),
):
    workspace = _access(network, db, x_workspace_token, authorization, write=True)
    issue = _issue(db, workspace, issue_id, lock=True)
    if body.kind != "agent":
        raise HTTPException(422, "Only agents can be removed from an issue")
    source = f"openagents:{body.id.strip()}"
    participants = {p["source"]: p for p in (issue.participants or [])}
    # A tombstone prevents historical comments/threads re-adding this agent.
    # Existing work and discussion remain intact. Re-adding clears it.
    participants[source] = {"source": source, "name": body.id.strip(), "removed": True}
    issue.participants = list(participants.values())
    issue.updated_at = datetime.now(timezone.utc)
    db.commit()
    return success_response({"removed": True})


class IssueAgentSharingPatch(BaseModel):
    mode: Literal["no", "yes", "approval"]


@router.patch("/{issue_id}/my-agent-sharing")
def update_issue_agent_sharing(issue_id: str, network: str, body: IssueAgentSharingPatch,
        db: Session = Depends(get_db), x_workspace_token: Optional[str] = Header(None),
        authorization: Optional[str] = Header(None)):
    workspace = _access(network, db, x_workspace_token, authorization, write=True)
    issue = _issue(db, workspace, issue_id, lock=True)
    user = resolve_current_user(db, authorization)
    if not user:
        raise HTTPException(403, "Sign in to manage sharing of your agents")
    setting = db.get(IssueAgentSharing, (issue.id, user.email))
    if setting is None:
        setting = IssueAgentSharing(issue_id=issue.id, owner_email=user.email)
        db.add(setting)
    setting.mode = body.mode
    # Saving this personal preference also joins the person to the issue.
    roster = {p["source"]: p for p in issue.participants or []}
    roster[f"human:{user.email}"] = {"source": f"human:{user.email}", "name": user.display_name or user.email}
    issue.participants = list(roster.values())
    db.commit()
    return success_response({"mode": setting.mode})
