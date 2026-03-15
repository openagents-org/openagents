# -*- coding: utf-8 -*-
"""
Workspace ORM models.

Aligned with the ONM: events table as the core log, plus materialized state
tables for efficient queries.

Uses both Python-side `default=` and PostgreSQL `server_default=` so models
work in SQLite (tests) and PostgreSQL (production).
"""

import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    BigInteger,
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    PrimaryKeyConstraint,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import relationship

from app.database import Base


def _uuid() -> str:
    return str(uuid.uuid4())


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------------------
# Core event store
# ---------------------------------------------------------------------------

class EventRecord(Base):
    """
    Persisted ONM event. Every interaction is stored as an event row.
    Populated by mod/persistence.
    """
    __tablename__ = "events"

    id = Column(Text, primary_key=True)                     # ULID or UUID
    network_id = Column(UUID(as_uuid=False), nullable=False)  # workspace ID
    type = Column(Text, nullable=False)                      # e.g. "workspace.message.posted"
    source = Column(Text, nullable=False)                    # e.g. "openagents:claude-agent"
    target = Column(Text, nullable=False)                    # e.g. "channel/session-abc"
    payload = Column(JSONB)
    metadata_ = Column("metadata", JSONB, default={})        # underscore to avoid Python keyword
    timestamp = Column(BigInteger, nullable=False)           # unix ms
    visibility = Column(Text, default="channel")
    created_at = Column(DateTime(timezone=True), default=_now, server_default=text("NOW()"))

    __table_args__ = (
        Index("idx_events_network_type", "network_id", "type"),
        Index("idx_events_network_target", "network_id", "target"),
        Index("idx_events_network_timestamp", "network_id", "timestamp"),
    )


# ---------------------------------------------------------------------------
# Materialized state tables (projections maintained by mods)
# ---------------------------------------------------------------------------

class Workspace(Base):
    """A workspace = an ONM network."""
    __tablename__ = "workspaces"

    id = Column(UUID(as_uuid=False), primary_key=True, default=_uuid, server_default=text("gen_random_uuid()"))
    slug = Column(Text, unique=True)
    name = Column(Text, nullable=False)
    creator_email = Column(Text, nullable=True)
    password_hash = Column(Text, nullable=True)
    settings = Column(JSONB, default={})
    status = Column(Text, default="active")
    created_at = Column(DateTime(timezone=True), default=_now, server_default=text("NOW()"))
    last_activity_at = Column(DateTime(timezone=True), default=_now, server_default=text("NOW()"))

    members = relationship("WorkspaceMember", back_populates="workspace", cascade="all, delete-orphan")
    channels = relationship("Channel", back_populates="workspace", cascade="all, delete-orphan")
    invitations = relationship("Invitation", back_populates="workspace", cascade="all, delete-orphan")
    collaborators = relationship("WorkspaceCollaborator", back_populates="workspace", cascade="all, delete-orphan", lazy="selectin")


class WorkspaceMember(Base):
    """Agent membership in a workspace (network membership)."""
    __tablename__ = "workspace_members"

    workspace_id = Column(UUID(as_uuid=False), ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False)
    agent_name = Column(Text, nullable=False)
    role = Column(Text, default="member")           # master | member | observer
    agent_type = Column(Text, nullable=True)          # "claude", "openclaw", etc.
    server_host = Column(Text, nullable=True)          # hostname/IP where agent runs
    working_dir = Column(Text, nullable=True)          # working directory on the server
    description = Column(Text, nullable=True)           # user-provided description of agent's role/capabilities
    status = Column(Text, default="offline")         # online | offline
    last_heartbeat = Column(DateTime(timezone=True), nullable=True)
    joined_at = Column(DateTime(timezone=True), default=_now, server_default=text("NOW()"))

    workspace = relationship("Workspace", back_populates="members")

    __table_args__ = (
        PrimaryKeyConstraint("workspace_id", "agent_name"),
    )


class Channel(Base):
    """A channel = session / thread (named event stream)."""
    __tablename__ = "channels"

    id = Column(UUID(as_uuid=False), primary_key=True, default=_uuid, server_default=text("gen_random_uuid()"))
    workspace_id = Column(UUID(as_uuid=False), ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False)
    name = Column(Text, nullable=False)              # e.g. "session-{uuid}"
    title = Column(Text, nullable=True)
    title_manually_set = Column(Boolean, default=False, server_default=text("FALSE"))
    created_by = Column(Text, nullable=True)
    master_agent = Column(Text, nullable=True)       # per-channel master
    resume_from = Column(Text, nullable=True)         # channel name to resume context from
    status = Column(Text, default="active")           # active | archived | deleted
    starred = Column(Boolean, default=False, server_default=text("FALSE"))
    created_at = Column(DateTime(timezone=True), default=_now, server_default=text("NOW()"))

    workspace = relationship("Workspace", back_populates="channels")
    participants = relationship("ChannelMember", back_populates="channel", cascade="all, delete-orphan", lazy="selectin")


class ChannelMember(Base):
    """Per-channel participant (per-thread membership)."""
    __tablename__ = "channel_members"

    channel_id = Column(UUID(as_uuid=False), ForeignKey("channels.id", ondelete="CASCADE"), nullable=False)
    agent_name = Column(Text, nullable=False)

    channel = relationship("Channel", back_populates="participants")

    __table_args__ = (
        PrimaryKeyConstraint("channel_id", "agent_name"),
    )


class Invitation(Base):
    """Workspace invitation."""
    __tablename__ = "invitations"

    id = Column(UUID(as_uuid=False), primary_key=True, default=_uuid, server_default=text("gen_random_uuid()"))
    workspace_id = Column(UUID(as_uuid=False), ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False)
    target_agent = Column(Text, nullable=False)
    invite_token = Column(Text, nullable=False, unique=True)
    status = Column(Text, default="pending")         # pending | accepted | rejected | expired
    created_at = Column(DateTime(timezone=True), default=_now, server_default=text("NOW()"))
    expires_at = Column(DateTime(timezone=True), nullable=False)

    workspace = relationship("Workspace", back_populates="invitations")


class WorkspaceCollaborator(Base):
    """Email-based workspace access (human collaborators)."""
    __tablename__ = "workspace_collaborators"

    id = Column(UUID(as_uuid=False), primary_key=True, default=_uuid, server_default=text("gen_random_uuid()"))
    workspace_id = Column(UUID(as_uuid=False), ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False)
    email = Column(Text, nullable=False)                # normalized lowercase
    role = Column(Text, default="editor")               # editor | viewer
    added_by = Column(Text, nullable=True)              # email of who added
    added_at = Column(DateTime(timezone=True), default=_now, server_default=text("NOW()"))

    workspace = relationship("Workspace", back_populates="collaborators")

    __table_args__ = (
        UniqueConstraint("workspace_id", "email", name="uq_collaborator_workspace_email"),
        Index("idx_collaborators_workspace", "workspace_id"),
        Index("idx_collaborators_email", "email"),
    )


# ---------------------------------------------------------------------------
# Shared file storage
# ---------------------------------------------------------------------------

class FileRecord(Base):
    """Metadata for a file stored in the workspace."""
    __tablename__ = "files"

    id = Column(Text, primary_key=True, default=_uuid)
    workspace_id = Column(UUID(as_uuid=False), ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False)
    filename = Column(Text, nullable=False)
    content_type = Column(Text, nullable=False, default="application/octet-stream")
    size = Column(Integer, nullable=False)
    storage_key = Column(Text, nullable=False)
    uploaded_by = Column(Text, nullable=False)        # "human:user" or "openagents:agent-name"
    channel_name = Column(Text, nullable=True)         # optional channel context
    status = Column(Text, nullable=False, default="active")  # active | deleted
    created_at = Column(DateTime(timezone=True), default=_now, server_default=text("NOW()"))

    __table_args__ = (
        Index("idx_files_workspace_status", "workspace_id", "status"),
    )


# ---------------------------------------------------------------------------
# Shared browser
# ---------------------------------------------------------------------------

class BrowserTab(Base):
    """A shared browser tab in the workspace."""
    __tablename__ = "browser_tabs"

    id = Column(Text, primary_key=True, default=_uuid)
    workspace_id = Column(UUID(as_uuid=False), ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False)
    url = Column(Text, nullable=False, default="about:blank")
    title = Column(Text, nullable=True)
    status = Column(Text, nullable=False, default="active")       # active | closed
    created_by = Column(Text, nullable=False)                      # "human:user" or "openagents:agent-name"
    shared_with = Column(JSONB, default=[])                        # list of agent names with access
    context_id = Column(Text, ForeignKey("browser_contexts.id", ondelete="SET NULL"), nullable=True)  # persistent context
    session_id = Column(Text, nullable=True)                       # Browserbase session ID
    live_url = Column(Text, nullable=True)                         # Browserbase live view URL
    created_at = Column(DateTime(timezone=True), default=_now, server_default=text("NOW()"))
    last_active_at = Column(DateTime(timezone=True), default=_now, server_default=text("NOW()"))

    __table_args__ = (
        Index("idx_browser_tabs_workspace_status", "workspace_id", "status"),
    )


# ---------------------------------------------------------------------------
# Persistent browser contexts (BrowserBase contexts for session persistence)
# ---------------------------------------------------------------------------

class BrowserContext(Base):
    """A persistent browser context that preserves cookies/storage across sessions.

    Users mark a tab as persistent by giving it a name (e.g. "LinkedIn Account").
    A BrowserBase context is created and reused across tab open/close cycles,
    so the logged-in state survives indefinitely.
    """
    __tablename__ = "browser_contexts"

    id = Column(Text, primary_key=True, default=_uuid)
    workspace_id = Column(UUID(as_uuid=False), ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False)
    name = Column(Text, nullable=False)                          # user-provided label, e.g. "LinkedIn Account"
    bb_context_id = Column(Text, nullable=True)                  # BrowserBase context ID (null in local mode)
    domain = Column(Text, nullable=True)                         # auto-captured from tab URL, e.g. "linkedin.com"
    status = Column(Text, nullable=False, default="active")      # active | expired
    created_by = Column(Text, nullable=False)                    # "human:user" or "openagents:agent-name"
    shared_with = Column(JSONB, default=[])                      # list of agent names that can use this context
    created_at = Column(DateTime(timezone=True), default=_now, server_default=text("NOW()"))
    last_used_at = Column(DateTime(timezone=True), default=_now, server_default=text("NOW()"))

    __table_args__ = (
        UniqueConstraint("workspace_id", "name", name="uq_browser_context_workspace_name"),
        Index("idx_browser_contexts_workspace_status", "workspace_id", "status"),
    )


# ---------------------------------------------------------------------------
# Browser usage tracking
# ---------------------------------------------------------------------------

class BrowserUsage(Base):
    """Tracks browser session duration for billing/monitoring."""
    __tablename__ = "browser_usage"

    id = Column(Text, primary_key=True, default=_uuid)
    workspace_id = Column(UUID(as_uuid=False), ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False)
    tab_id = Column(Text, nullable=False)
    session_id = Column(Text, nullable=True)             # Browserbase session ID
    opened_by = Column(Text, nullable=False)               # source: "human:user" or "openagents:agent-name"
    started_at = Column(DateTime(timezone=True), nullable=False, default=_now, server_default=text("NOW()"))
    ended_at = Column(DateTime(timezone=True), nullable=True)
    duration_seconds = Column(Integer, nullable=True)     # computed on close

    __table_args__ = (
        Index("idx_browser_usage_workspace", "workspace_id"),
        Index("idx_browser_usage_opened_by", "opened_by"),
        Index("idx_browser_usage_started", "started_at"),
    )


# Standalone agent table (used when IDENTITY_MODE=standalone)
class Agent(Base):
    """Local agent identity (standalone mode only)."""
    __tablename__ = "agents"

    agent_name = Column(Text, primary_key=True)
    display_name = Column(Text, nullable=True)
    agent_type = Column(Text, nullable=True)         # "claude", "codex", "gemini", etc.
    created_at = Column(DateTime(timezone=True), default=_now, server_default=text("NOW()"))
