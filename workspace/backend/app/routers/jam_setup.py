"""Private review links. Only the confirmation POST creates a shared thread."""
from datetime import timedelta
import secrets
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Header
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.access import resolve_current_user
from app.database import get_db
from app.models import JamSetupDraft, ThreadGuestLink
from app.routers.guest_links import PublishRequest, _fail, _ok
from app.services import guest_links as svc

router = APIRouter(prefix="/v1/jam/setup", tags=["share"])
FileName = Annotated[str, Field(min_length=1, max_length=240)]
Email = Annotated[str, Field(max_length=320)]


class SetupDraft(PublishRequest):
    # The server replaces this with an independent key before validation.
    idempotency_key: str = ""
    agent_name: str = Field(max_length=48)
    agent_type: str | None = Field(default=None, max_length=40)
    guest_agent_access: Literal["open", "approval", "off"] = "open"
    guests_can_post: bool = True
    guests_can_bring_agents: bool = True
    access: Literal["link", "invited"] = "link"
    files: list[FileName] = Field(default_factory=list, max_length=40)
    title: str = Field(max_length=120)
    owner_name: str | None = Field(default=None, max_length=60)
    invited_emails: list[Email] = Field(default_factory=list, max_length=100)

    @field_validator("files")
    @classmethod
    def filenames_only(cls, names):
        if len(set(names)) != len(names) or any(
            not name.strip() or name in (".", "..") or "/" in name or "\\" in name
            or not name.isprintable() for name in names
        ):
            raise ValueError("Use unique filenames without paths")
        return names


class Selection(BaseModel):
    expiry: Literal["keep", "never", "1", "7", "30"] = "keep"
    title: str = Field(min_length=1, max_length=120)
    excerpts: list[int] = Field(max_length=40)
    files: list[int] = Field(max_length=40)
    guest_agent_access: Literal["open", "approval", "off"]
    access: Literal["link", "invited"]
    invited_emails: list[Email] = Field(default_factory=list, max_length=100)
    guests_can_post: bool
    guests_can_bring_agents: bool


def _subset(items, indices):
    selected = set(indices)
    if len(selected) != len(indices) or any(i < 0 or i >= len(items) for i in selected):
        raise svc.LinkError(400, "Invalid draft selection")
    return [v for i, v in enumerate(items) if i in selected]


@router.post("")
def create(body: SetupDraft, db: Session = Depends(get_db)):
    secret = secrets.token_urlsafe(32)
    body.idempotency_key = secrets.token_urlsafe(32)
    try:
        svc._validate_publish(body)
        svc._parse_expiry(body.link_expires_at)
        svc.normalize_emails(body.invited_emails)
    except svc.LinkError as e:
        return _fail(e)
    now = svc._now()
    db.execute(delete(JamSetupDraft).where(JamSetupDraft.expires_at <= now))
    draft = body.model_dump(exclude={"workspace_name", "agent_display_name"})
    db.add(JamSetupDraft(key_hash=svc._sha(secret), draft=draft, expires_at=now + timedelta(hours=1)))
    db.commit()
    return _ok({"setupUrl": f"{svc.frontend_base()}/jam/setup#{secret}", "setupToken": secret})


def _lookup(db, secret, lock=False):
    query = select(JamSetupDraft).where(JamSetupDraft.key_hash == svc._sha(secret))
    row = db.execute(query.with_for_update() if lock else query).scalar_one_or_none()
    if not row or svc._aware(row.expires_at) <= svc._now():
        raise svc.LinkError(404, "This setup link is invalid or expired. Ask your agent for a new one.")
    return row


def _state(db, row):
    draft = dict(row.draft)
    key = draft.pop("idempotency_key")
    data = {"status": "draft", "draft": draft}
    if row.published_workspace:
        link = db.execute(select(ThreadGuestLink).where(
            ThreadGuestLink.publish_key_hash == svc._sha("share-publish:" + key),
            ThreadGuestLink.workspace_id == row.published_workspace,
        )).scalar_one_or_none()
        if not link or link.revoked_at:
            raise svc.LinkError(410, "The jam has moved or its link was turned off.")
        data.update(status="published", jam=svc._publish_result(db, link, created=False))
    return data


@router.get("")
def status(x_jam_setup: str = Header(""), db: Session = Depends(get_db)):
    try:
        return _ok(_state(db, _lookup(db, x_jam_setup)))
    except svc.LinkError as e:
        return _fail(e)


@router.post("/confirm")
def confirm(selection: Selection, x_jam_setup: str = Header(""), authorization: str | None = Header(None),
            db: Session = Depends(get_db)):
    try:
        row = _lookup(db, x_jam_setup, lock=True)
        if not row.published_workspace:
            owner = resolve_current_user(db, authorization) if authorization else None
            if authorization and owner is None:
                raise svc.LinkError(401, "Your sign-in expired. Sign in again to create this jam.")
            selected = selection.model_dump()
            expiry = selected.pop("expiry")
            if expiry != "keep":
                selected["link_expires_at"] = None if expiry == "never" else (
                    svc._now() + timedelta(days=int(expiry))
                ).isoformat()
            if not selection.guests_can_post:
                selected.update(guest_agent_access="off", guests_can_bring_agents=False)
            for field in ("files", "excerpts"):
                selected[field] = _subset(row.draft[field], selected[field])
            selected["invited_emails"] = svc.normalize_emails(selection.invited_emails) if selection.access == "invited" else []
            if selection.access == "invited" and not selected["invited_emails"]:
                raise svc.LinkError(400, "Enter at least one invited email address.")
            row.draft = {**row.draft, **selected}
            svc.publish(db, PublishRequest(**row.draft), owner, setup_draft=row)
        return _ok(_state(db, row))
    except svc.LinkError as e:
        db.rollback()
        return _fail(e)
