"""Shared issues: human discussion is independent of agent execution.

Only POST /threads starts agents. Comments, edits, task creation, and linking
existing work never enter the agent-routing pipeline.
"""

import uuid
from datetime import datetime, timezone
from typing import Literal, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query
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
    KanbanTask,
    WorkspaceMember,
)
from app.response import success_response
from app.routers.network import _emit_event_blocking, _resolve_workspace
from app.routers.tasks import _serialize_task
from openagents.core.onm_events import Event

router = APIRouter(prefix="/v1/issues", tags=["Issues"])
IssueStatus = Literal["open", "in_progress", "closed"]


class ActorRequest(BaseModel):
    source: str = Field(default="human:user", max_length=320)
    source_name: Optional[str] = Field(default=None, max_length=240)


class CreateIssueRequest(ActorRequest):
    title: str = Field(min_length=1, max_length=240)
    description: str = Field(default="", max_length=50000)
    channel_name: Optional[str] = None

    @field_validator("title", mode="before")
    @classmethod
    def title_not_blank(cls, value):
        return value.strip() if isinstance(value, str) else value


class UpdateIssueRequest(ActorRequest):
    title: Optional[str] = Field(default=None, min_length=1, max_length=240)
    description: Optional[str] = Field(default=None, max_length=50000)
    status: Optional[IssueStatus] = None

    @field_validator("title", mode="before")
    @classmethod
    def title_not_blank(cls, value):
        return value.strip() if isinstance(value, str) else value


class CommentRequest(ActorRequest):
    content: str = Field(default="", max_length=50000)
    source_event_id: Optional[str] = None


class StartThreadRequest(ActorRequest):
    agents: list[str] = Field(min_length=1, max_length=10)
    instruction: str = Field(min_length=1, max_length=10000)


class LinkThreadRequest(ActorRequest):
    channel_name: str


class IssueTaskRequest(ActorRequest):
    task_id: Optional[str] = None
    title: str = Field(default="", max_length=240)
    description: str = Field(default="", max_length=50000)


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


def _serialize(issue):
    return {
        key: getattr(issue, key)
        for key in (
            "id",
            "title",
            "description",
            "status",
            "created_by",
            "created_by_name",
        )
    } | {
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


@router.get("")
def list_issues(
    network: str,
    q: str = Query("", max_length=240),
    status: Optional[IssueStatus] = None,
    offset: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=200),
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    workspace = _access(network, db, x_workspace_token, authorization)
    query = select(Issue).where(Issue.workspace_id == workspace.id)
    if status:
        query = query.where(Issue.status == status)
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
    issue = Issue(
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
    tasks = (
        db.execute(
            select(KanbanTask).where(
                KanbanTask.issue_id == issue.id, KanbanTask.workspace_id == workspace.id
            )
        )
        .scalars()
        .all()
    )
    channels = [c for c in _linked_channels(db, issue) if _can_see(db, workspace, viewer, c.name)]
    # Fetch the latest shareable agent reply for each linked execution thread
    # the caller may read.
    names = {c.name for c in channels} | {
        t.channel_name for t in tasks
        if t.channel_name and _can_see(db, workspace, viewer, t.channel_name)
    }
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
    return success_response(
        _serialize(issue)
        | {
            "comments": [_comment(c) for c in comments],
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
            "tasks": [
                _serialize_task(t) | {"latest_reply": latest.get(t.channel_name)}
                for t in tasks
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
    db: Session = Depends(get_db),
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
        names.update(
            db.execute(
                select(KanbanTask.channel_name).where(
                    KanbanTask.workspace_id == workspace.id,
                    KanbanTask.issue_id == issue.id,
                    KanbanTask.channel_name.is_not(None),
                )
            ).scalars()
        )
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
    return success_response(_comment(comment))


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


@router.post("/{issue_id}/threads")
def start_thread(
    issue_id: str,
    body: StartThreadRequest,
    network: str,
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    workspace = _access(network, db, x_workspace_token, authorization, write=True)
    issue = _issue(db, workspace, issue_id)
    if issue.status == "closed":
        raise HTTPException(409, "Reopen the issue before starting new work")
    actor, actor_name = _actor(db, authorization, body.source, body.source_name)
    agents = list(
        dict.fromkeys(a.removeprefix("openagents:").strip() for a in body.agents)
    )
    members = set(
        db.execute(
            select(WorkspaceMember.agent_name).where(
                WorkspaceMember.workspace_id == workspace.id,
                WorkspaceMember.agent_name.in_(agents),
            )
        ).scalars()
    )
    if not agents or any(a not in members for a in agents):
        raise HTTPException(422, "Choose agents that belong to this workspace")
    if not body.instruction.strip():
        raise HTTPException(422, "Describe what you want the agents to do")
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
    kickoff = Event(
        type="workspace.message.posted",
        source=actor,
        target=f"channel/{name}",
        payload={
            "content": (
                f"{' '.join('@' + a for a in agents)}\n\nRequested work: {body.instruction.strip()}\n\n"
                f"Issue: {issue.title}\n{issue.description[:20000]}\n\nRecent discussion:\n{discussion}\n\n"
                "Post your findings or deliverable here for the team to review. "
                "The issue stays open until the team decides it is resolved."
            ),
            "message_type": "chat",
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
    _add_comment(
        db, issue, actor, body.instruction.strip(), "activity", author_name=actor_name
    )
    db.commit()
    return success_response({"channel_name": name})


@router.post("/{issue_id}/tasks")
def add_task(
    issue_id: str,
    body: IssueTaskRequest,
    network: str,
    db: Session = Depends(get_db),
    x_workspace_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    workspace = _access(network, db, x_workspace_token, authorization, write=True)
    issue = _issue(db, workspace, issue_id, lock=True)
    actor, actor_name = _actor(db, authorization, body.source, body.source_name)
    if body.task_id:
        task = db.execute(
            select(KanbanTask)
            .where(
                KanbanTask.workspace_id == workspace.id, KanbanTask.id == body.task_id
            )
            .with_for_update()
        ).scalar_one_or_none()
        if not task:
            raise HTTPException(404, "Task not found")
        if task.issue_id and task.issue_id != issue.id:
            raise HTTPException(409, "Task already belongs to another issue")
        task.issue_id = issue.id
    else:
        if not body.title.strip():
            raise HTTPException(422, "Task title is required")
        task = KanbanTask(
            workspace_id=workspace.id,
            issue_id=issue.id,
            title=body.title.strip(),
            description=body.description.strip(),
            created_by=actor,
        )
        db.add(task)
    issue.updated_at = datetime.now(timezone.utc)
    db.commit()
    return success_response(_serialize_task(task))
