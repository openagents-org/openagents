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
        Index("idx_events_network_type_target_ts", "network_id", "type", "target", "timestamp"),
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
    # When True, human web/mobile access requires a logged-in identity that is
    # a WorkspaceMembership of this workspace (enforced-login, v1.0). When False
    # (the default, and every pre-v1.0 workspace), access falls back to the
    # legacy rules: a valid workspace token, or — if no token is set — open.
    # Agents/daemons always authenticate with the workspace token regardless.
    require_login = Column(Boolean, nullable=False, default=False, server_default=text("FALSE"))
    settings = Column(JSONB, default={})
    status = Column(Text, default="active")
    created_at = Column(DateTime(timezone=True), default=_now, server_default=text("NOW()"))
    last_activity_at = Column(DateTime(timezone=True), default=_now, server_default=text("NOW()"))

    members = relationship("WorkspaceMember", back_populates="workspace", cascade="all, delete-orphan")
    channels = relationship("Channel", back_populates="workspace", cascade="all, delete-orphan")
    invitations = relationship("Invitation", back_populates="workspace", cascade="all, delete-orphan")
    collaborators = relationship("WorkspaceCollaborator", back_populates="workspace", cascade="all, delete-orphan", lazy="selectin")
    memberships = relationship("WorkspaceMembership", back_populates="workspace", cascade="all, delete-orphan")
    nodes = relationship("Node", back_populates="workspace", cascade="all, delete-orphan")


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
    enabled_skills = Column(JSONB, nullable=True)      # {"files": true, "browser": false, ...} — null = all defaults
    status = Column(Text, default="offline")         # online | offline
    last_heartbeat = Column(DateTime(timezone=True), nullable=True)
    joined_at = Column(DateTime(timezone=True), default=_now, server_default=text("NOW()"))
    # Opaque token assigned on each /v1/join. Subsequent heartbeats and
    # message posts must carry this id; a newer join rotates it so any
    # stale client (e.g. ghost adapter, second daemon on same config)
    # posting with the old id gets rejected and stops.
    session_id = Column(Text, nullable=True)
    session_started_at = Column(DateTime(timezone=True), nullable=True)

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
    # Multi-agent collaboration mode for this thread:
    #   "dynamic"  → LLM router picks next speaker (generic prompt) [default]
    #   "master"   → deterministic star: humans + sub-agents route to the
    #                master; the master delegates via @mention
    #   "workflow" → a structured Workflow template drives the thread step by
    #                step (see workflow_id + the workflow_runs table)
    orchestration_mode = Column(Text, nullable=False, server_default=text("'dynamic'"))
    # Legacy free-text collaboration plan — superseded by structured workflows
    # (kept for backward compat; no longer authored in the UI).
    orchestration_instruction = Column(Text, nullable=True)
    # Structured workflow selected for this thread ("workflow" mode). The live
    # run lives in workflow_runs, keyed by this channel's name.
    workflow_id = Column(Text, nullable=True)
    status = Column(Text, default="active")           # active | archived | deleted
    starred = Column(Boolean, default=False, server_default=text("FALSE"))
    last_event_at = Column(BigInteger, nullable=True)
    created_at = Column(DateTime(timezone=True), default=_now, server_default=text("NOW()"))

    workspace = relationship("Workspace", back_populates="channels")
    participants = relationship("ChannelMember", back_populates="channel", cascade="all, delete-orphan", lazy="selectin")

    __table_args__ = (
        Index("uq_channels_ws_name", "workspace_id", "name", unique=True),
        # Serves /v1/discover's `WHERE workspace_id = ? AND status != 'deleted'`.
        Index("idx_channels_workspace_status", "workspace_id", "status"),
        # Serves the timer-loop auto-archive scan
        # (`status = 'active' AND last_event_at < cutoff`).
        Index("idx_channels_status_last_event", "status", "last_event_at"),
    )


class ChannelMember(Base):
    """Per-channel participant (per-thread membership)."""
    __tablename__ = "channel_members"

    channel_id = Column(UUID(as_uuid=False), ForeignKey("channels.id", ondelete="CASCADE"), nullable=False)
    agent_name = Column(Text, nullable=False)

    channel = relationship("Channel", back_populates="participants")

    __table_args__ = (
        PrimaryKeyConstraint("channel_id", "agent_name"),
    )


class ChannelHumanMember(Base):
    """Per-channel human participant — Slack-style thread membership.

    Lives alongside `ChannelMember` (agents only) rather than mixing
    `agent_name` + `user_email` into one row, which would muddy the
    existing agent routing queries. Auto-populated by the workspace mod
    on first human post in a channel; consulted by `services/push.py` to
    decide whose devices get a banner for non-mention chat messages.
    Mentions still wake the mentioned human regardless of membership.
    """
    __tablename__ = "channel_human_members"

    channel_id = Column(UUID(as_uuid=False), ForeignKey("channels.id", ondelete="CASCADE"), nullable=False)
    user_email = Column(Text, nullable=False)               # normalized lowercase
    joined_at = Column(DateTime(timezone=True), default=_now, server_default=text("NOW()"))

    __table_args__ = (
        PrimaryKeyConstraint("channel_id", "user_email"),
        Index("idx_channel_human_members_email", "user_email"),
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
    # Google `displayName` captured the first time the human posted in
    # this workspace. Mention picker shows it; push.py uses it (along
    # with the email local-part) to resolve "@bary" → device tokens.
    display_name = Column(Text, nullable=True)

    workspace = relationship("Workspace", back_populates="collaborators")

    __table_args__ = (
        UniqueConstraint("workspace_id", "email", name="uq_collaborator_workspace_email"),
        Index("idx_collaborators_workspace", "workspace_id"),
        Index("idx_collaborators_email", "email"),
    )


# ---------------------------------------------------------------------------
# Human identity & workspace membership (enforced-login, v1.0)
# ---------------------------------------------------------------------------

class User(Base):
    """A human end-user identity, resolved from a verified login-provider ID
    token (Google via Firebase, or Sign in with Apple).

    Distinct from `WorkspaceMember` (agents, keyed by agent_name) and the legacy
    email-only `WorkspaceCollaborator` ACL. A user's access to a workspace is
    expressed by `WorkspaceMembership` rows. Rows are created/refreshed lazily
    on login; pre-v1.0 email-keyed access (`Workspace.creator_email` and
    collaborator rows) is reconciled into memberships the first time the
    matching user signs in, so existing users keep their workspaces with no
    data migration.
    """
    __tablename__ = "users"

    id = Column(UUID(as_uuid=False), primary_key=True, default=_uuid, server_default=text("gen_random_uuid()"))
    email = Column(Text, nullable=False)                 # normalized lowercase
    firebase_uid = Column(Text, nullable=True)           # Google/Firebase `uid` claim
    apple_sub = Column(Text, nullable=True)              # Sign in with Apple `sub` claim
    display_name = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=_now, server_default=text("NOW()"))
    last_login_at = Column(DateTime(timezone=True), nullable=True)

    memberships = relationship("WorkspaceMembership", back_populates="user", cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint("email", name="uq_users_email"),
    )


class WorkspaceMembership(Base):
    """A human user's membership of a workspace, with role.

    The v1.0 replacement for the "owner = `Workspace.creator_email` string" +
    editor/viewer `WorkspaceCollaborator` split. Roles, highest to lowest:
    `owner` | `admin` | `member` | `viewer`. `viewer` is read-only and cannot
    interact with agents — the role is modeled now; its enforcement is deferred.
    """
    __tablename__ = "workspace_memberships"

    workspace_id = Column(UUID(as_uuid=False), ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(UUID(as_uuid=False), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    role = Column(Text, nullable=False, default="member", server_default=text("'member'"))  # owner | admin | member | viewer
    created_at = Column(DateTime(timezone=True), default=_now, server_default=text("NOW()"))

    workspace = relationship("Workspace", back_populates="memberships")
    user = relationship("User", back_populates="memberships")

    __table_args__ = (
        PrimaryKeyConstraint("workspace_id", "user_id"),
        # The composite PK indexes (workspace_id, ...) for "members of a
        # workspace"; this serves the reverse "workspaces for a user" lookup.
        Index("idx_memberships_user", "user_id"),
    )


# ---------------------------------------------------------------------------
# Nodes — a connected device/daemon (launcher host), independent of agents
# ---------------------------------------------------------------------------

class Node(Base):
    """A device running the OpenAgents launcher daemon, connected to a workspace.

    A node is registered before (and independently of) any agent, so the
    workspace can show "this laptop/server is connected" as an early onboarding
    win. Agents (`WorkspaceMember`) run ON a node; a node can host many agents or
    none. Liveness is by `last_heartbeat` freshness (like agents), not the
    persisted `status` column.
    """
    __tablename__ = "nodes"

    id = Column(UUID(as_uuid=False), primary_key=True, default=_uuid, server_default=text("gen_random_uuid()"))
    workspace_id = Column(UUID(as_uuid=False), ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False)
    node_key = Column(Text, nullable=False)             # stable device id generated by the launcher
    name = Column(Text, nullable=True)                  # display name (defaults to hostname)
    hostname = Column(Text, nullable=True)
    device_type = Column(Text, default="unknown")       # server | laptop | desktop | unknown
    os = Column(Text, nullable=True)                    # e.g. "darwin", "linux", "win32"
    launcher_version = Column(Text, nullable=True)
    status = Column(Text, default="offline")            # online | offline
    last_heartbeat = Column(DateTime(timezone=True), nullable=True)
    # Roster of agents the daemon reports it is hosting, e.g.
    # [{"name": "...", "type": "claude", "status": "running"}]. Refreshed each
    # heartbeat so the workspace can list/manage a node's agents remotely.
    agents = Column(JSONB, default=list)
    # Per-agent-type runtime detection reported by the daemon, e.g.
    # [{"type": "claude", "installed": true, "ready": true, "version": "1.2.3",
    #   "reason": "ready", "message": "Logged in"}]. Powers the "Add agent"
    # gallery (what's installed / logged-in on this device).
    runtimes = Column(JSONB, default=list)
    # Filesystem hint for the working-directory picker: the device's home dir and
    # its immediate subfolders, refreshed each heartbeat, e.g.
    # {"home": "/home/ubuntu", "dirs": ["projects", "work"]}.
    fs = Column(JSONB, default=dict)
    created_at = Column(DateTime(timezone=True), default=_now, server_default=text("NOW()"))

    workspace = relationship("Workspace", back_populates="nodes")

    __table_args__ = (
        UniqueConstraint("workspace_id", "node_key", name="uq_node_workspace_key"),
        Index("idx_nodes_workspace", "workspace_id"),
    )


class NodePairingCode(Base):
    """A short-lived, single-use code that pairs a device to a workspace.

    Generated by an owner/admin in the workspace UI; the launcher redeems it to
    obtain the workspace token and register a Node — so the user types one short
    code instead of copy-pasting the workspace id + token.
    """
    __tablename__ = "node_pairing_codes"

    code = Column(Text, primary_key=True)               # normalized (uppercase, no dashes)
    workspace_id = Column(UUID(as_uuid=False), ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False)
    created_by = Column(Text, nullable=True)            # email of the creator
    created_at = Column(DateTime(timezone=True), default=_now, server_default=text("NOW()"))
    expires_at = Column(DateTime(timezone=True), nullable=False)
    redeemed_at = Column(DateTime(timezone=True), nullable=True)
    node_id = Column(UUID(as_uuid=False), nullable=True)  # set on successful redeem

    __table_args__ = (
        Index("idx_pairing_workspace", "workspace_id"),
    )


class NodeCommand(Base):
    """A remote agent-management command queued for a node's daemon.

    The node isn't directly reachable (it's behind NAT), so the workspace can't
    call it — instead an owner/admin enqueues a command here; the daemon picks it
    up on its next heartbeat, runs it locally (create/start/stop/remove an
    agent), and posts the result back. `command`/`result` are free-form JSON.
    """
    __tablename__ = "node_commands"

    id = Column(UUID(as_uuid=False), primary_key=True, default=_uuid, server_default=text("gen_random_uuid()"))
    node_id = Column(UUID(as_uuid=False), ForeignKey("nodes.id", ondelete="CASCADE"), nullable=False)
    workspace_id = Column(UUID(as_uuid=False), ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False)
    action = Column(Text, nullable=False)               # create_agent | start_agent | stop_agent | remove_agent
    command = Column(JSONB, default=dict)               # action args (may hold secrets briefly)
    status = Column(Text, default="pending")            # pending | running | done | error
    result = Column(JSONB, nullable=True)               # {ok, message, ...} — never contains secrets
    created_by = Column(Text, nullable=True)            # email of the requester
    created_at = Column(DateTime(timezone=True), default=_now, server_default=text("NOW()"))
    delivered_at = Column(DateTime(timezone=True), nullable=True)
    finished_at = Column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        Index("idx_node_commands_node_status", "node_id", "status"),
    )


# ---------------------------------------------------------------------------
# Shared knowledge base
# ---------------------------------------------------------------------------

class KnowledgeEntry(Base):
    """A knowledge base entry — workspace-global markdown document."""
    __tablename__ = "knowledge_entries"

    id = Column(Text, primary_key=True, default=_uuid)
    workspace_id = Column(UUID(as_uuid=False), ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False)
    slug = Column(Text, nullable=False)
    title = Column(Text, nullable=False)
    description = Column(Text, nullable=True)
    storage_key = Column(Text, nullable=True)
    content_size = Column(Integer, nullable=True)
    created_by = Column(Text, nullable=False)
    updated_by = Column(Text, nullable=True)
    status = Column(Text, nullable=False, default="active")
    created_at = Column(DateTime(timezone=True), default=_now, server_default=text("NOW()"))
    updated_at = Column(DateTime(timezone=True), default=_now, server_default=text("NOW()"))

    __table_args__ = (
        UniqueConstraint("workspace_id", "slug", name="uq_knowledge_workspace_slug"),
        Index("idx_knowledge_workspace_status", "workspace_id", "status"),
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

    # Trash. A deleted record keeps its bytes until it's purged; these three
    # columns are what turn "status = deleted" into something restorable.
    #   deleted_at  when it went to the trash (and what an expiry sweep reads)
    #   trash_id    one delete action — deleting a folder trashes N records
    #               that must come back, or be purged, together
    #   trash_path  what the user deleted: a file's path, or a folder's
    # All nullable: records deleted before trash existed simply have none.
    deleted_at = Column(DateTime(timezone=True), nullable=True)
    trash_id = Column(Text, nullable=True)
    trash_path = Column(Text, nullable=True)

    __table_args__ = (
        Index("idx_files_workspace_status", "workspace_id", "status"),
        Index("idx_files_trash", "workspace_id", "trash_id"),
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
    # --- BF credential reference (never the key itself; see app/browser_creds.py) ---
    bf_key_source = Column(Text, nullable=True)                    # 'workspace' | 'global' | NULL (local/legacy)
    bf_key_fingerprint = Column(Text, nullable=True)               # SHA-256 hex of the creating key
    # --- Remote session release tracking ---
    session_closed = Column(Boolean, nullable=False, default=False, server_default=text("FALSE"))  # BF session confirmed released
    close_status = Column(Text, nullable=False, default="none", server_default=text("'none'"))  # none|open|closing|closed|close_failed|retry_exhausted
    close_attempts = Column(Integer, nullable=False, default=0, server_default=text("0"))
    last_close_attempt_at = Column(DateTime(timezone=True), nullable=True)
    last_close_error = Column(Text, nullable=True)                 # redacted — never contains key material
    last_error = Column(Text, nullable=True)                       # last init/navigation error (redacted)
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


# ---------------------------------------------------------------------------
# Push-notification device registration
# ---------------------------------------------------------------------------

class DeviceToken(Base):
    """An iOS / future-Android device's FCM token, scoped to a workspace.

    Created by `POST /v1/devices/register` from the OpenAgents Go iOS app
    (and any future mobile client). Used by `services/push.py` to fan out
    APNs notifications when relevant workspace events fire.

    Tied to a workspace via `workspace_id` — the same auth model as every
    other table here. We do not link to a specific human user because the
    workspace token is the only identity the iOS client carries today.
    """

    __tablename__ = "device_tokens"

    id = Column(UUID(as_uuid=False), primary_key=True, default=_uuid, server_default=text("gen_random_uuid()"))
    workspace_id = Column(UUID(as_uuid=False), ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False)
    fcm_token = Column(Text, nullable=False)
    device_type = Column(Text, nullable=False)            # "ios" | future: "android" | "macos"
    bundle_id = Column(Text, nullable=True)               # e.g. "com.openagents.go"
    # Google email of the signed-in user on the device that registered.
    # NULL for older clients without a user identity; populated by builds
    # that started sending `userEmail` with /v1/devices/register. The push
    # fan-out filters by this column when a @-mention resolves to a human
    # collaborator so only that specific human's devices get woken up.
    user_email = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=_now, server_default=text("NOW()"))
    last_seen_at = Column(DateTime(timezone=True), default=_now, server_default=text("NOW()"))

    __table_args__ = (
        UniqueConstraint("workspace_id", "fcm_token", name="uq_device_token_workspace_fcm"),
        Index("idx_device_tokens_workspace", "workspace_id"),
        Index("idx_device_tokens_workspace_user", "workspace_id", "user_email"),
    )


# ---------------------------------------------------------------------------
# Planning: To-dos & Timers
# ---------------------------------------------------------------------------

class TodoRecord(Base):
    """A single to-do item belonging to an agent in a channel."""
    __tablename__ = "todos"

    id = Column(Text, primary_key=True, default=_uuid)
    workspace_id = Column(UUID(as_uuid=False), ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False)
    channel_name = Column(Text, nullable=False)
    thread_id = Column(Text, nullable=True)
    created_by = Column(Text, nullable=False)              # "openagents:agent-name"
    assignee = Column(Text, nullable=False)                # defaults to created_by agent
    content = Column(Text, nullable=False)
    status = Column(Text, nullable=False, default="pending")  # pending | in_progress | completed
    position = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), default=_now, server_default=text("NOW()"))
    updated_at = Column(DateTime(timezone=True), default=_now, server_default=text("NOW()"))

    __table_args__ = (
        Index("idx_todos_workspace_channel", "workspace_id", "channel_name"),
        Index("idx_todos_workspace_created_by", "workspace_id", "created_by"),
    )


class KanbanTask(Base):
    """A Kanban board task — workspace-wide, assignable to a single agent.

    Distinct from ``TodoRecord`` (agent-private, in-thread planning
    checklists). A Kanban task is a GitHub-issue-like work item on a shared
    board. Assigning it to an agent spins up a dedicated *hidden* thread
    (a ``task:<id>`` channel) where the agent does the long-running work; a
    fast-model classifier watches the agent's replies there and moves the
    card between columns (``in_progress`` → ``need_input`` / ``done``).
    """
    __tablename__ = "kanban_tasks"

    id = Column(Text, primary_key=True, default=_uuid)
    workspace_id = Column(UUID(as_uuid=False), ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False)
    title = Column(Text, nullable=False)
    description = Column(Text, nullable=False, default="", server_default="")
    # backlog | todo | in_progress | need_input | done
    status = Column(Text, nullable=False, default="backlog", server_default="backlog")
    assignee = Column(Text, nullable=True)                 # bare agent name; null = unassigned
    # A task runs on either a single agent (assignee) OR a workflow template.
    workflow_id = Column(Text, nullable=True)             # run this task via a Workflow
    created_by = Column(Text, nullable=False)              # "human:..." or "openagents:..."
    channel_name = Column(Text, nullable=True)            # the hidden `task:<id>` thread, once assigned
    priority = Column(Text, nullable=False, default="normal", server_default="normal")  # low | normal | high
    position = Column(Integer, nullable=False, default=0, server_default="0")  # ordering within a column
    created_at = Column(DateTime(timezone=True), default=_now, server_default=text("NOW()"))
    updated_at = Column(DateTime(timezone=True), default=_now, onupdate=_now, server_default=text("NOW()"))

    __table_args__ = (
        Index("idx_kanban_workspace_status", "workspace_id", "status"),
        Index("idx_kanban_workspace_channel", "workspace_id", "channel_name"),
    )


class Workflow(Base):
    """A reusable multi-agent collaboration template.

    A workflow is an ordered list of steps (stored as JSON). Each step has an
    instruction and an assignee (an agent or a named human), and an optional
    natural-language **gate** — "go to step X if <condition>" — that the fast
    model judges, enabling forward skips and backward loops.

    step := {
      "id": str, "name": str, "instruction": str,
      "assignee": {"kind": "agent"|"human", "agent"?: str, "human"?: str},
      "gate"?: {"condition": str, "target": <step id>}   # else falls through
    }

    Running a task/thread copies this template into a ``WorkflowRun`` snapshot,
    so later edits never disturb work already in flight.
    """
    __tablename__ = "workflows"

    id = Column(Text, primary_key=True, default=_uuid)
    workspace_id = Column(UUID(as_uuid=False), ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False)
    name = Column(Text, nullable=False)
    description = Column(Text, nullable=False, default="", server_default="")
    steps = Column(JSONB, nullable=False)                  # ordered list of step dicts
    # Loop budget: how many times the run may cycle before it stalls. The engine
    # also enforces a hard backstop of max_iterations * len(steps) activations.
    max_iterations = Column(Integer, nullable=False, default=5, server_default="5")
    created_by = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), default=_now, server_default=text("NOW()"))
    updated_at = Column(DateTime(timezone=True), default=_now, onupdate=_now, server_default=text("NOW()"))

    __table_args__ = (
        Index("idx_workflows_workspace", "workspace_id"),
    )


class WorkflowRun(Base):
    """Live execution state for a workflow driving one thread (channel).

    Serves both a Kanban task and a group-chat thread — whichever owns the
    ``channel_name``. Holds the frozen template ``snapshot`` and the cursor
    (``current_step`` + ``iterations``).
    """
    __tablename__ = "workflow_runs"

    id = Column(Text, primary_key=True, default=_uuid)
    workspace_id = Column(UUID(as_uuid=False), ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False)
    workflow_id = Column(Text, nullable=True)              # origin template (reference only)
    channel_name = Column(Text, nullable=False)            # the thread this run drives
    snapshot = Column(JSONB, nullable=False)               # {name, steps, max_iterations}
    current_step = Column(Text, nullable=True)             # step id, or null before start / after end
    iterations = Column(Integer, nullable=False, default=0, server_default="0")
    status = Column(Text, nullable=False, default="running", server_default="running")  # running | done | stalled | cancelled
    created_at = Column(DateTime(timezone=True), default=_now, server_default=text("NOW()"))
    updated_at = Column(DateTime(timezone=True), default=_now, onupdate=_now, server_default=text("NOW()"))

    __table_args__ = (
        Index("idx_workflow_runs_ws_channel", "workspace_id", "channel_name"),
    )


class TimerRecord(Base):
    """A scheduled timer that posts a message when it fires."""
    __tablename__ = "timers"

    id = Column(Text, primary_key=True, default=_uuid)
    workspace_id = Column(UUID(as_uuid=False), ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False)
    channel_name = Column(Text, nullable=False)
    thread_id = Column(Text, nullable=True)
    created_by = Column(Text, nullable=False)              # "openagents:agent-name"
    message = Column(Text, nullable=False)
    delay_seconds = Column(Integer, nullable=False)
    fires_at = Column(DateTime(timezone=True), nullable=False)
    status = Column(Text, nullable=False, default="active")  # active | fired | cancelled
    created_at = Column(DateTime(timezone=True), default=_now, server_default=text("NOW()"))

    __table_args__ = (
        Index("idx_timers_fires_at_status", "fires_at", "status"),
        Index("idx_timers_workspace_channel", "workspace_id", "channel_name"),
    )


# ---------------------------------------------------------------------------
# Routines (recurring scheduled tasks)
# ---------------------------------------------------------------------------

class RoutineRecord(Base):
    """A recurring scheduled task that fires on a repeating schedule."""
    __tablename__ = "routines"

    id = Column(Text, primary_key=True, default=_uuid)
    workspace_id = Column(UUID(as_uuid=False), ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False)
    channel_name = Column(Text, nullable=False)
    thread_id = Column(Text, nullable=True)
    created_by = Column(Text, nullable=False)              # "openagents:agent-name"
    name = Column(Text, nullable=False)                     # human-readable label
    message = Column(Text, nullable=False)                  # message posted when routine fires
    context = Column(Text, nullable=True)                    # comprehensive background for the routine
    # Daily schedule mode: hour + minute (+ optional days). One of the two
    # modes must be set when the row is created (enforced in the router).
    schedule_hour = Column(Integer, nullable=True)          # 0-23 UTC
    schedule_minute = Column(Integer, nullable=True)        # 0-59
    schedule_days = Column(JSONB, nullable=True)            # null=every day, or [0..6] (0=Mon)
    # Interval mode: fire every N minutes. Mutually exclusive with hour/minute.
    schedule_interval_minutes = Column(Integer, nullable=True)
    timezone = Column(Text, default="UTC")
    next_fires_at = Column(DateTime(timezone=True), nullable=False)
    last_fired_at = Column(DateTime(timezone=True), nullable=True)
    status = Column(Text, nullable=False, default="active")  # active | paused | cancelled
    created_at = Column(DateTime(timezone=True), default=_now, server_default=text("NOW()"))

    __table_args__ = (
        Index("idx_routines_workspace_channel", "workspace_id", "channel_name"),
        Index("idx_routines_next_fires_status", "next_fires_at", "status"),
    )


# ---------------------------------------------------------------------------
# Inbox / Notifications
# ---------------------------------------------------------------------------

class NotificationRecord(Base):
    """A notification sent by an agent to the workspace inbox."""
    __tablename__ = "notifications"

    id = Column(Text, primary_key=True, default=_uuid)
    workspace_id = Column(UUID(as_uuid=False), ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False)
    created_by = Column(Text, nullable=False)              # "openagents:agent-name" or "system:routine"
    title = Column(Text, nullable=False)
    message = Column(Text, nullable=False)
    priority = Column(Text, nullable=False, default="normal")  # low | normal | high
    is_read = Column(Boolean, default=False, server_default=text("FALSE"))
    channel_name = Column(Text, nullable=True)              # optional link to related thread
    thread_id = Column(Text, nullable=True)
    link_url = Column(Text, nullable=True)                  # optional external link
    status = Column(Text, nullable=False, default="active") # active | dismissed | expired
    created_at = Column(DateTime(timezone=True), default=_now, server_default=text("NOW()"))
    read_at = Column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        Index("idx_notifications_workspace_status", "workspace_id", "status"),
        Index("idx_notifications_workspace_read", "workspace_id", "is_read"),
        Index("idx_notifications_created_at", "created_at"),
    )


# ---------------------------------------------------------------------------
# Cloud agent configurations
# ---------------------------------------------------------------------------

class CloudAgentConfig(Base):
    """Configuration for a cloud-based agent (API-proxied by the server)."""
    __tablename__ = "cloud_agent_configs"

    id = Column(Text, primary_key=True, default=_uuid)
    workspace_id = Column(UUID(as_uuid=False), ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False)
    agent_name = Column(Text, nullable=False)
    provider = Column(Text, nullable=False)              # "openai", "google", "xai", "deepseek"
    model = Column(Text, nullable=False)                  # "gpt-4o", "gemini-2.5-pro", etc.
    category = Column(Text, nullable=False, default="chat")  # "chat" or "image"
    api_key = Column(Text, nullable=False)
    base_url = Column(Text, nullable=True)                # custom OpenAI-compatible endpoint
    system_prompt = Column(Text, nullable=True)
    max_tokens = Column(Integer, nullable=True)
    status = Column(Text, nullable=False, default="active")  # active | disabled
    created_at = Column(DateTime(timezone=True), default=_now, server_default=text("NOW()"))

    __table_args__ = (
        UniqueConstraint("workspace_id", "agent_name", name="uq_cloud_agent_workspace_name"),
        Index("idx_cloud_agent_workspace", "workspace_id"),
    )


# ---------------------------------------------------------------------------
# Platform integrations (Slack / Lark / Telegram bridge)
# ---------------------------------------------------------------------------

class MessageReply(Base):
    """At-most-once for the *n*-th reply an agent makes to a given message.

    An agent that crashes between producing a reply and recording that it
    finished will, on restart, reprocess the message and post the answer again.
    Reprocessing is the recovery — the alternative is losing the reply — so the
    duplicate has to be absorbed here instead.

    The sequence number is not incidental. Answering is not one message per
    turn: an agent may stream a clarifying question, report that it stopped,
    and then send its conclusion, all while working on a single request. Keyed
    on the answered message alone, everything after the first would be
    swallowed. Keyed on ``(workspace, agent, answered message, position in the
    turn)``, a replayed turn collides reply-for-reply with the original while a
    genuinely multi-part answer passes through intact.

    Only replies that declare ``metadata.in_reply_to`` are recorded; everything
    else — human posts, agent chatter, status updates — is untouched.
    """
    __tablename__ = "message_replies"

    id = Column(Text, primary_key=True, default=_uuid)
    workspace_id = Column(UUID(as_uuid=False), ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False)
    source = Column(Text, nullable=False)                 # "openagents:<agent>"
    in_reply_to = Column(Text, nullable=False)            # the event being answered
    reply_seq = Column(Integer, nullable=False, default=0, server_default="0")  # position within the turn
    event_id = Column(Text, nullable=False)               # the reply that won
    channel_name = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=_now, server_default=text("NOW()"))

    __table_args__ = (
        UniqueConstraint(
            "workspace_id", "source", "in_reply_to", "reply_seq",
            name="uq_message_reply_once",
        ),
    )


class IntegrationBinding(Base):
    """One exported agent on one external platform installation.

    The unit the whole bridge is scoped to: a gateway credential resolves to
    exactly one of these rows, and everything the gateway may touch — which
    workspace, which agent, which external conversations — is derived from it
    rather than from anything the caller sends.

    The gateway owns the platform credentials (see the plan's "凭证存网关");
    this row deliberately holds only non-secret metadata so the workspace UI
    can show "this agent is connected to Slack" and offer a disconnect.
    """
    __tablename__ = "integration_bindings"

    id = Column(Text, primary_key=True, default=_uuid)
    workspace_id = Column(UUID(as_uuid=False), ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False)
    platform = Column(Text, nullable=False)               # slack | lark | telegram
    agent_name = Column(Text, nullable=False)
    # Non-secret identifiers of the external installation, e.g.
    # {"app_id": "A123", "tenant_id": "T456", "bot_user_id": "U789"}.
    installation = Column(JSONB, default=dict)
    # What the gateway is allowed to touch, e.g.
    # {"dm": true, "channels": ["C123", "C456"]}. Enforced server-side on
    # every ingest — the caller cannot widen it.
    external_scope = Column(JSONB, default=dict)
    # authorizing → credentials_stored → active → disconnecting → disconnected
    status = Column(Text, nullable=False, default="authorizing", server_default=text("'authorizing'"))
    # One-time connect ticket, consumed atomically when the gateway activates
    # this binding. Stored hashed; the plaintext only ever lives in the
    # redirect URL the operator's browser follows.
    ticket_nonce_hash = Column(Text, nullable=True)
    ticket_expires_at = Column(DateTime(timezone=True), nullable=True)
    created_by = Column(Text, nullable=True)              # email of the operator
    created_at = Column(DateTime(timezone=True), default=_now, server_default=text("NOW()"))
    activated_at = Column(DateTime(timezone=True), nullable=True)
    disconnect_requested_at = Column(DateTime(timezone=True), nullable=True)
    disconnected_at = Column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        Index("idx_integration_bindings_workspace", "workspace_id", "status"),
        Index("idx_integration_bindings_agent", "workspace_id", "agent_name"),
    )


class IntegrationKey(Base):
    """A restricted credential the gateway presents on every integration call.

    Only the SHA-256 fingerprint lives here. The gateway generates the secret,
    keeps the plaintext itself, and hands us the hash — so there is nothing to
    recover on our side and re-sending an activation is naturally idempotent
    (same binding + same hash = same row).
    """
    __tablename__ = "integration_keys"

    id = Column(Text, primary_key=True, default=_uuid)
    binding_id = Column(Text, ForeignKey("integration_bindings.id", ondelete="CASCADE"), nullable=False)
    key_hash = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), default=_now, server_default=text("NOW()"))
    revoked_at = Column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        UniqueConstraint("key_hash", name="uq_integration_key_hash"),
        Index("idx_integration_keys_binding", "binding_id"),
    )


class IntegrationConversation(Base):
    """External thread ↔ OA channel mapping.

    `external_key` is composed server-side from the structured identifiers the
    gateway sends (never from a string it assembled), and the channel name is
    derived from it deterministically — so two webhooks racing to open the same
    thread compute the same name and the unique constraints settle the race.

    `channel_id` is unique on purpose: an OA channel belongs to exactly one
    binding, so a rebind can never inherit a previous binding's history by
    accident.
    """
    __tablename__ = "integration_conversations"

    id = Column(Text, primary_key=True, default=_uuid)
    binding_id = Column(Text, ForeignKey("integration_bindings.id", ondelete="CASCADE"), nullable=False)
    external_key = Column(Text, nullable=False)
    # "dm" | "channel" | "thread" — the normalized shape, checked against scope.
    conversation_kind = Column(Text, nullable=False, default="dm")
    channel_id = Column(UUID(as_uuid=False), ForeignKey("channels.id", ondelete="CASCADE"), nullable=False)
    channel_name = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), default=_now, server_default=text("NOW()"))

    __table_args__ = (
        UniqueConstraint("binding_id", "external_key", name="uq_integration_conv_binding_key"),
        UniqueConstraint("channel_id", name="uq_integration_conv_channel"),
    )


class IntegrationInbound(Base):
    """Message-level idempotency for inbound platform events.

    Keyed by the platform's own event id. A retried ingest returns the event
    that was already created instead of posting a second copy — Slack retries
    on its own, so this is not a theoretical case.
    """
    __tablename__ = "integration_inbound"

    id = Column(Text, primary_key=True, default=_uuid)
    binding_id = Column(Text, ForeignKey("integration_bindings.id", ondelete="CASCADE"), nullable=False)
    idempotency_key = Column(Text, nullable=False)
    event_id = Column(Text, nullable=False)               # the OA event created
    channel_name = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), default=_now, server_default=text("NOW()"))

    __table_args__ = (
        UniqueConstraint("binding_id", "idempotency_key", name="uq_integration_inbound_key"),
    )


class IntegrationFileUpload(Base):
    """File-level idempotency plus the ownership/lifetime edge for attachments.

    Separate from `FileRecord` so integration concerns don't leak into the
    generic file model. Two jobs:

    * dedupe — a retried upload of the same platform file returns the same
      `file_id` instead of writing a second object;
    * orphan reclaim — an upload whose ingest never succeeded stays unattached,
      and a sweep moves it to the trash once `expires_at` passes. (The existing
      purge only handles already-trashed rows, so identifying the orphan is the
      new part; deleting the bytes reuses what's there.)
    """
    __tablename__ = "integration_file_uploads"

    id = Column(Text, primary_key=True, default=_uuid)
    binding_id = Column(Text, ForeignKey("integration_bindings.id", ondelete="CASCADE"), nullable=False)
    platform_event_id = Column(Text, nullable=False)
    platform_file_id = Column(Text, nullable=False)
    file_id = Column(Text, nullable=False)                # → FileRecord.id
    attached_event_id = Column(Text, nullable=True)       # set once ingest consumes it
    expires_at = Column(DateTime(timezone=True), nullable=False)
    created_at = Column(DateTime(timezone=True), default=_now, server_default=text("NOW()"))

    __table_args__ = (
        UniqueConstraint(
            "binding_id", "platform_event_id", "platform_file_id",
            name="uq_integration_file_upload",
        ),
        Index("idx_integration_file_uploads_orphan", "attached_event_id", "expires_at"),
    )


# ---------------------------------------------------------------------------
# Shared conversation snapshots
# ---------------------------------------------------------------------------

class ShareSnapshot(Base):
    """A public snapshot of a conversation thread."""
    __tablename__ = "share_snapshots"

    id = Column(Text, primary_key=True, default=_uuid)
    workspace_id = Column(UUID(as_uuid=False), ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False)
    channel_name = Column(Text, nullable=False)
    title = Column(Text, nullable=True)
    created_by = Column(Text, nullable=False)
    snapshot_data = Column(JSONB, nullable=False)
    share_token = Column(Text, unique=True, nullable=False)
    message_count = Column(Integer, nullable=False, default=0)
    status = Column(Text, nullable=False, default="active")
    created_at = Column(DateTime(timezone=True), default=_now, server_default=text("NOW()"))

    __table_args__ = (
        Index("idx_share_snapshots_workspace", "workspace_id"),
        Index("idx_share_snapshots_token", "share_token"),
    )


# Standalone agent table (used when IDENTITY_MODE=standalone)
class Agent(Base):
    """Local agent identity (standalone mode only)."""
    __tablename__ = "agents"

    agent_name = Column(Text, primary_key=True)
    display_name = Column(Text, nullable=True)
    agent_type = Column(Text, nullable=True)         # "claude", "codex", "gemini", etc.
    created_at = Column(DateTime(timezone=True), default=_now, server_default=text("NOW()"))
