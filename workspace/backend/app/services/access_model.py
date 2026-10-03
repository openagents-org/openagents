# -*- coding: utf-8 -*-
"""
Workspace ownership & permission model (v1.1 slice) — the single access rule.

Contract: workspace/docs/permission-model-v1.md §3. In one paragraph: every
resource has one owner; access = owner ∪ grants (to a human, an agent or a
security group) ∪ public; there are no deny rules; agents inherit what their
human owner can access plus their own groups; machines without an agent
identity keep full access (legacy, removed in v1.2).

    allowed(P, R, right):
      owner(R) == P, or owner(R) is an agent whose owner_email == P.email  → allow
      R.visibility == public and P is in the workspace                     → allow read
      active grant on R for P (human|agent) or a group containing P       → allow
      P.kind == agent and allowed(owner-of-P as human, R, right)           → allow (inherit)
      R is a file with visibility NULL → allowed(P, its channel, right)
      P.kind == machine (no agent identity)                                 → allow (legacy)
      else                                                                  → deny
    Thread participants (channel_human_members / channel_members) count as
    grants {read, act}. "act" implies "read". Admins get METADATA only.

`app/services/visibility.py` keeps its public names and delegates here, so
the routers written against M1 keep working unchanged.
"""

from __future__ import annotations

import logging
import re
import uuid
from contextvars import ContextVar
from datetime import datetime, timezone
from typing import Dict, Iterable, List, Optional, Sequence, Set, Tuple, Union

from sqlalchemy import event, or_, select
from sqlalchemy.orm import Session

from app.models import (
    Channel,
    ChannelHumanMember,
    ChannelMember,
    FileRecord,
    KnowledgeEntry,
    Node,
    ResourceGrant,
    SecurityGroup,
    SecurityGroupMember,
    User,
    Workspace,
    WorkspaceMember,
    WorkspaceMembership,
)

logger = logging.getLogger(__name__)

RIGHTS = ("read", "act", "share")
DEFAULT_RIGHTS = ["read", "act"]
RESOURCE_KINDS = ("channel", "agent", "file", "knowledge", "browser_context")
GRANTEE_KINDS = ("human", "agent", "group")
PRINCIPAL_KINDS = ("human", "agent")
BUILTIN_GROUPS = (("everyone", "Everyone"), ("guest", "Guests"))

# Input alias accepted forever; stored/emitted value is "public".
_VISIBILITY_ALIASES = {"workspace": "public", "team": "public", "public": "public", "private": "private"}

_AGENT_SOURCE_RE = re.compile(r"^openagents:([A-Za-z0-9][A-Za-z0-9_.\-]*)$")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _norm(email: Optional[str]) -> Optional[str]:
    e = (email or "").strip().lower()
    return e or None


def normalize_visibility(value: Optional[str], default: Optional[str] = None) -> Optional[str]:
    """'workspace' → 'public' alias; unknown → None (caller validates)."""
    if value is None:
        return default
    v = str(value).strip().lower()
    if not v:
        return default
    return _VISIBILITY_ALIASES.get(v)


def normalize_rights(rights: Optional[Iterable[str]]) -> List[str]:
    if not rights:
        return list(DEFAULT_RIGHTS)
    out = [r for r in RIGHTS if r in {str(x).strip().lower() for x in rights}]
    return out or list(DEFAULT_RIGHTS)


def _has_right(rights, right: str) -> bool:
    rights = rights or []
    if right in rights:
        return True
    return right == "read" and "act" in rights


# ---------------------------------------------------------------------------
# Agent identity on machine calls
# ---------------------------------------------------------------------------

_request_agent_name: ContextVar[Optional[str]] = ContextVar("request_agent_name", default=None)


def set_request_agent_name(name: Optional[str]):
    """Stash the agent identity of the current request (set by the
    X-Agent-Name middleware in app/main.py). Returns the token to reset."""
    return _request_agent_name.set(_clean_agent_name(name))


def reset_request_agent_name(token) -> None:
    _request_agent_name.reset(token)


def get_request_agent_name() -> Optional[str]:
    return _request_agent_name.get()


def _clean_agent_name(name) -> Optional[str]:
    if not isinstance(name, str):
        return None
    n = name.strip()
    if not n or len(n) > 200 or any(c.isspace() for c in n):
        return None
    return n


def agent_name_from_source(source) -> Optional[str]:
    """'openagents:<name>' → name; anything else → None."""
    if not isinstance(source, str):
        return None
    m = _AGENT_SOURCE_RE.match(source.strip())
    return m.group(1) if m else None


def agent_name_from_request(headers=None, query=None, body=None) -> Optional[str]:
    """The agent an authenticated machine call acts for (shared helper in
    app.services.agent_identity: header X-Agent-Name, else source=openagents:<name>)."""
    from app.services.agent_identity import agent_name_from_request as _shared
    return _shared(headers, query, body)


# ---------------------------------------------------------------------------
# Principals
# ---------------------------------------------------------------------------

class Principal:
    """Resolved caller for access decisions.

    kind: "human" (signed-in person, or an anonymous visitor with email None),
          "agent" (machine credential + agent identity), "machine" (machine
          credential without identity — legacy full access).
    """

    __slots__ = ("kind", "email", "role", "agent_name", "owner_email", "workspace_id", "_group_ids")

    def __init__(self, kind: str, email: Optional[str] = None, role: Optional[str] = None,
                 agent_name: Optional[str] = None, owner_email: Optional[str] = None,
                 workspace_id: Optional[str] = None):
        self.kind = kind
        self.email = _norm(email)
        self.role = role
        self.agent_name = agent_name
        self.owner_email = _norm(owner_email)
        self.workspace_id = str(workspace_id) if workspace_id else None
        self._group_ids: Optional[Set[str]] = None

    # -- compat with the M1 Viewer -----------------------------------------
    @property
    def machine(self) -> bool:
        return self.kind == "machine"

    @property
    def is_human(self) -> bool:
        """Compat: "subject to filtering" (not a legacy machine credential)."""
        return self.kind != "machine"

    @property
    def is_agent(self) -> bool:
        return self.kind == "agent"

    @property
    def is_admin(self) -> bool:
        from app.access import role_at_least
        return self.machine or role_at_least(self.role, "admin")

    @property
    def is_guest(self) -> bool:
        return self.kind == "human" and self.role == "guest"

    @property
    def label(self) -> str:
        if self.kind == "agent":
            return f"openagents:{self.agent_name}"
        if self.email:
            return f"human:{self.email}"
        return "machine" if self.machine else "anonymous"

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"Principal({self.kind}, {self.email or self.agent_name})"


def is_machine_caller(workspace: Optional[Workspace], token: Optional[str], db: Optional[Session] = None) -> bool:
    """True when the caller presented a machine credential: the workspace
    token, or (when `db` is given) a per-device token of this workspace."""
    if not token:
        return False
    if workspace is None:
        return True
    if workspace.password_hash and token == workspace.password_hash:
        return True
    if db is not None:
        row = db.execute(
            select(Node.id).where(Node.token == token, Node.workspace_id == workspace.id)
        ).first()
        return row is not None
    return False


def caller_email(db: Session, authorization: Optional[str]) -> Optional[str]:
    if not authorization:
        return None
    from app.access import resolve_current_user
    try:
        user = resolve_current_user(db, authorization)
    except Exception:
        return None
    return _norm(user.email) if user else None


def _load_workspace(db: Session, workspace: Union[Workspace, str, None]) -> Optional[Workspace]:
    if workspace is None or isinstance(workspace, Workspace):
        return workspace
    return db.execute(select(Workspace).where(Workspace.id == str(workspace))).scalar_one_or_none()


def role_for_email(db: Session, workspace: Workspace, email: Optional[str]) -> Optional[str]:
    """Membership role of `email` in `workspace` (membership row, else the
    legacy creator/collaborator match). None when not a member."""
    email = _norm(email)
    if not email:
        return None
    user = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
    if user is not None:
        m = db.execute(
            select(WorkspaceMembership.role).where(
                WorkspaceMembership.workspace_id == workspace.id,
                WorkspaceMembership.user_id == user.id,
            )
        ).first()
        if m is not None:
            return m[0]
    if _norm(workspace.creator_email) == email:
        return "owner"
    for c in (workspace.collaborators or []):
        if c.email == email:
            r = c.role or "editor"
            return "member" if r == "editor" else ("guest" if r == "guest" else "viewer")
    return None


def resolve_principal(db: Session, workspace: Union[Workspace, str, None], token: Optional[str],
                      authorization: Optional[str], agent_name: Optional[str] = None) -> Principal:
    """A signed-in person is a person even when the client also sends the
    workspace token (the web app does). A machine credential with an agent
    identity (X-Agent-Name header / explicit `agent_name`) is that agent;
    without one it is a legacy machine. Neither → an anonymous visitor."""
    ws = _load_workspace(db, workspace)
    wid = str(ws.id) if ws is not None else (str(workspace) if isinstance(workspace, str) else None)
    email = caller_email(db, authorization)
    if email:
        role = None
        if ws is not None:
            from app.access import resolve_user_role
            role = resolve_user_role(db, ws, authorization)
        return Principal("human", email=email, role=role, workspace_id=wid)
    if token and is_machine_caller(ws, token, db):
        name = _clean_agent_name(agent_name) or get_request_agent_name()
        if name and wid:
            member = db.execute(
                select(WorkspaceMember).where(
                    WorkspaceMember.workspace_id == wid,
                    WorkspaceMember.agent_name == name,
                )
            ).scalar_one_or_none()
            if member is not None:
                return Principal("agent", agent_name=member.agent_name, owner_email=member.owner_email,
                                 workspace_id=wid)
        return Principal("machine", workspace_id=wid)
    return Principal("human", email=None, workspace_id=wid)


# ---------------------------------------------------------------------------
# Security groups
# ---------------------------------------------------------------------------

def get_or_create_builtin_groups(db: Session, workspace_id: str) -> Dict[str, SecurityGroup]:
    """{'everyone': group, 'guest': group} — created lazily per workspace."""
    workspace_id = str(workspace_id)
    rows = db.execute(
        select(SecurityGroup).where(
            SecurityGroup.workspace_id == workspace_id,
            SecurityGroup.kind.in_([k for k, _ in BUILTIN_GROUPS]),
        )
    ).scalars().all()
    out = {g.kind: g for g in rows}
    if all(kind in out for kind, _ in BUILTIN_GROUPS):
        return out
    # Race-safe creation (ON CONFLICT DO NOTHING) on the session's connection,
    # then re-read through the ORM.
    _ensure_builtin_groups_conn(db.connection(), workspace_id)
    rows = db.execute(
        select(SecurityGroup).where(
            SecurityGroup.workspace_id == workspace_id,
            SecurityGroup.kind.in_([k for k, _ in BUILTIN_GROUPS]),
        )
    ).scalars().all()
    return {g.kind: g for g in rows}


def builtin_group_ids(db: Session, workspace_id: str) -> Dict[str, str]:
    """Read-only {kind: id} of the builtins that exist (hot path: never
    writes; a workspace without them has no grants targeting them either)."""
    rows = db.execute(
        select(SecurityGroup.kind, SecurityGroup.id).where(
            SecurityGroup.workspace_id == str(workspace_id),
            SecurityGroup.kind.in_([k for k, _ in BUILTIN_GROUPS]),
        )
    ).all()
    return {k: i for k, i in rows}


def _insert_ignore(connection, table, values: dict, conflict_cols: Sequence[str]) -> None:
    """INSERT … ON CONFLICT DO NOTHING through Core (so column types — the
    UUID columns in particular — get their bind processing on every dialect)."""
    name = connection.dialect.name
    if name == "postgresql":
        from sqlalchemy.dialects.postgresql import insert as _insert
        stmt = _insert(table).values(**values).on_conflict_do_nothing(index_elements=list(conflict_cols))
    elif name == "sqlite":
        from sqlalchemy.dialects.sqlite import insert as _insert
        stmt = _insert(table).values(**values).on_conflict_do_nothing(index_elements=list(conflict_cols))
    else:  # pragma: no cover - other dialects: best effort
        from sqlalchemy import insert as _insert
        stmt = _insert(table).values(**values)
    connection.execute(stmt)


def _ensure_builtin_groups_conn(connection, workspace_id: str) -> Dict[str, str]:
    """Connection-level twin of get_or_create_builtin_groups (used inside the
    WorkspaceMember after_insert hook, where no Session is available).
    Race-safe via ON CONFLICT DO NOTHING."""
    t = SecurityGroup.__table__
    out: Dict[str, str] = {}
    for kind, name in BUILTIN_GROUPS:
        _insert_ignore(connection, t, {
            "id": str(uuid.uuid4()), "workspace_id": str(workspace_id), "name": name, "slug": kind,
            "kind": kind, "created_by": "system", "created_at": _now(),
        }, ("workspace_id", "slug"))
        row = connection.execute(
            select(t.c.id).where(t.c.workspace_id == str(workspace_id), t.c.slug == kind)
        ).first()
        if row is not None:
            out[kind] = row[0]
    return out


@event.listens_for(WorkspaceMember, "after_insert")
def _grant_everyone_on_new_agent(mapper, connection, member: WorkspaceMember) -> None:
    """Every new agent starts usable by `everyone` (rights ["act"]); the owner
    may revoke that grant. Done at INSERT time for every creation path (join,
    workspace create, cloud agents, Yumi) so "no grants" always means "the
    owner revoked everyone", never "nobody got around to it"."""
    try:
        groups = _ensure_builtin_groups_conn(connection, member.workspace_id)
        everyone = groups.get("everyone")
        if not everyone:
            return
        connection.execute(ResourceGrant.__table__.insert().values(
            id=str(uuid.uuid4()), workspace_id=str(member.workspace_id), resource_kind="agent",
            resource_id=member.agent_name, grantee_kind="group", grantee_id=everyone, rights=["act"],
            granted_by="system", note="default", created_at=_now(),
        ))
    except Exception:  # never let the default grant break an agent join
        logger.warning("access_model: default everyone grant failed for %s", member.agent_name, exc_info=True)


def workspace_human_roles(db: Session, workspace: Workspace) -> Dict[str, str]:
    """{email: role} for every human in the workspace (memberships ∪ legacy
    collaborators ∪ creator). Membership rows win."""
    out: Dict[str, str] = {}
    creator = _norm(workspace.creator_email)
    if creator:
        out[creator] = "owner"
    for c in (workspace.collaborators or []):
        if c.email and c.email not in out:
            r = c.role or "editor"
            out[c.email] = "member" if r == "editor" else ("guest" if r == "guest" else "viewer")
    rows = db.execute(
        select(User.email, WorkspaceMembership.role)
        .join(WorkspaceMembership, WorkspaceMembership.user_id == User.id)
        .where(WorkspaceMembership.workspace_id == workspace.id)
    ).all()
    for email, role in rows:
        if email:
            out[_norm(email)] = role
    return out


def group_members(db: Session, workspace: Workspace, group: SecurityGroup) -> List[dict]:
    """Members of a group: explicit rows for custom groups; derived for the
    builtins (everyone = all humans + all agents; guest = humans with role
    guest)."""
    if group.kind == "custom":
        rows = db.execute(
            select(SecurityGroupMember).where(SecurityGroupMember.group_id == group.id)
            .order_by(SecurityGroupMember.created_at.asc())
        ).scalars().all()
        return [{
            "principal_kind": r.principal_kind,
            "principal_id": r.principal_id,
            "added_by": r.added_by,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        } for r in rows]
    humans = workspace_human_roles(db, workspace)
    out = []
    for email, role in sorted(humans.items()):
        if group.kind == "guest" and role != "guest":
            continue
        out.append({"principal_kind": "human", "principal_id": email, "added_by": None, "created_at": None})
    if group.kind == "everyone":
        agents = db.execute(
            select(WorkspaceMember.agent_name).where(
                WorkspaceMember.workspace_id == workspace.id,
                WorkspaceMember.status != "removed",
            ).order_by(WorkspaceMember.agent_name.asc())
        ).scalars().all()
        out.extend({"principal_kind": "agent", "principal_id": a, "added_by": None, "created_at": None}
                   for a in agents)
    return out


def _explicit_group_ids(db: Session, workspace_id: str, pairs: Sequence[Tuple[str, str]]) -> Set[str]:
    pairs = [(k, i) for k, i in pairs if k and i]
    if not pairs:
        return set()
    conds = [
        (SecurityGroupMember.principal_kind == k) & (SecurityGroupMember.principal_id == i)
        for k, i in pairs
    ]
    return set(db.execute(
        select(SecurityGroupMember.group_id)
        .join(SecurityGroup, SecurityGroup.id == SecurityGroupMember.group_id)
        .where(SecurityGroup.workspace_id == str(workspace_id), or_(*conds))
    ).scalars().all())


def principal_group_ids(db: Session, workspace_id: str, principal: Principal) -> Set[str]:
    """Groups containing the principal: derived builtins + explicit rows. An
    agent also carries its owner's groups (inheritance). Cached on the
    principal for the request.

    `everyone` = everyone who is in the workspace. That includes a human the
    workspace let in but could not name (an open workspace's visitor, or a
    token-only client posting as ``human:user`` with no sender email — the
    Launcher/CLI path): they could already see every team agent in M1, and
    the `everyone` grant is the model's equivalent of "public" for agents.
    Only explicit (custom-group / direct) grants need an identity."""
    if principal._group_ids is not None:
        return principal._group_ids
    ids: Set[str] = set()
    if not principal.machine:
        builtin = builtin_group_ids(db, workspace_id)
        if builtin.get("everyone"):
            ids.add(builtin["everyone"])
        if principal.is_guest and builtin.get("guest"):
            ids.add(builtin["guest"])
        pairs: List[Tuple[str, str]] = []
        if principal.kind == "human" and principal.email:
            pairs.append(("human", principal.email))
        if principal.kind == "agent":
            pairs.append(("agent", principal.agent_name))
            if principal.owner_email:
                pairs.append(("human", principal.owner_email))
        if pairs:
            ids |= _explicit_group_ids(db, workspace_id, pairs)
    principal._group_ids = ids
    return ids


def _identity_pairs(db: Session, workspace_id: str, principal: Principal) -> List[Tuple[str, str]]:
    """Every grantee (kind, id) that reaches this principal: itself, its
    groups, and — for an agent — its owner and the owner's groups."""
    pairs: List[Tuple[str, str]] = []
    if principal.kind == "human" and principal.email:
        pairs.append(("human", principal.email))
    elif principal.kind == "agent":
        pairs.append(("agent", principal.agent_name))
        if principal.owner_email:
            pairs.append(("human", principal.owner_email))
    pairs.extend(("group", gid) for gid in principal_group_ids(db, workspace_id, principal))
    return pairs


# ---------------------------------------------------------------------------
# Resources
# ---------------------------------------------------------------------------

class Resource:
    __slots__ = ("kind", "id", "owner", "visibility", "channel_name", "obj")

    def __init__(self, kind: str, id: str, owner: Optional[str], visibility: Optional[str],
                 channel_name: Optional[str] = None, obj=None):
        self.kind = kind
        self.id = id
        self.owner = owner
        self.visibility = visibility
        self.channel_name = channel_name
        self.obj = obj


def owner_label_for(owner: Optional[str]) -> Optional[str]:
    """'human:<email>' → '<email>'; 'openagents:<agent>' → '@<agent>'."""
    if not owner:
        return None
    if owner.startswith("human:"):
        return owner[len("human:"):]
    if owner.startswith("openagents:"):
        return "@" + owner[len("openagents:"):]
    return owner


def principal_owner_string(principal: Principal) -> Optional[str]:
    if principal.kind == "agent":
        return f"openagents:{principal.agent_name}"
    if principal.email:
        return f"human:{principal.email}"
    return None


def resource_for_channel(channel: Channel) -> Resource:
    owner = f"human:{_norm(channel.owner_email)}" if _norm(channel.owner_email) else None
    return Resource("channel", channel.name, owner, normalize_visibility(channel.visibility, "public") or "public",
                    channel_name=channel.name, obj=channel)


def resource_for_agent(member: WorkspaceMember) -> Resource:
    owner = f"human:{_norm(member.owner_email)}" if _norm(member.owner_email) else None
    return Resource("agent", member.agent_name, owner, None, obj=member)


def resource_for_file(record: FileRecord) -> Resource:
    owner = record.owner or record.uploaded_by
    vis = normalize_visibility(record.visibility, None)
    if vis is None and not record.channel_name:
        vis = "public"  # unattached legacy files stay reachable
    return Resource("file", record.id, owner, vis, channel_name=record.channel_name, obj=record)


def resource_for_knowledge(entry: KnowledgeEntry) -> Resource:
    owner = entry.owner or entry.created_by
    return Resource("knowledge", entry.id, owner, normalize_visibility(entry.visibility, "public") or "public",
                    obj=entry)


def load_resource(db: Session, workspace_id: str, kind: str, resource_id: str) -> Optional[Resource]:
    wid = str(workspace_id)
    if kind == "channel":
        ch = db.execute(select(Channel).where(Channel.workspace_id == wid, Channel.name == resource_id,
                                              Channel.status != "deleted")).scalar_one_or_none()
        return resource_for_channel(ch) if ch else None
    if kind == "agent":
        m = db.execute(select(WorkspaceMember).where(WorkspaceMember.workspace_id == wid,
                                                     WorkspaceMember.agent_name == resource_id,
                                                     WorkspaceMember.status != "removed")).scalar_one_or_none()
        return resource_for_agent(m) if m else None
    if kind == "file":
        f = db.execute(select(FileRecord).where(FileRecord.workspace_id == wid,
                                                FileRecord.id == resource_id)).scalar_one_or_none()
        return resource_for_file(f) if f else None
    if kind == "knowledge":
        k = db.execute(select(KnowledgeEntry).where(KnowledgeEntry.workspace_id == wid,
                                                    KnowledgeEntry.id == resource_id)).scalar_one_or_none()
        return resource_for_knowledge(k) if k else None
    if kind == "browser_context":
        return Resource("browser_context", resource_id, None, "public")
    return None


# ---------------------------------------------------------------------------
# Grants
# ---------------------------------------------------------------------------

def _grant_is_live(g: ResourceGrant, now: Optional[datetime] = None) -> bool:
    if g.revoked_at is not None:
        return False
    if g.expires_at is not None:
        exp = g.expires_at if g.expires_at.tzinfo else g.expires_at.replace(tzinfo=timezone.utc)
        if exp <= (now or _now()):
            return False
    return True


def active_grants(db: Session, workspace_id: str, resource_kind: Optional[str] = None,
                  resource_id: Optional[str] = None, grantee: Optional[Tuple[str, str]] = None) -> List[ResourceGrant]:
    q = select(ResourceGrant).where(
        ResourceGrant.workspace_id == str(workspace_id),
        ResourceGrant.revoked_at.is_(None),
    )
    if resource_kind:
        q = q.where(ResourceGrant.resource_kind == resource_kind)
    if resource_id is not None:
        q = q.where(ResourceGrant.resource_id == resource_id)
    if grantee:
        q = q.where(ResourceGrant.grantee_kind == grantee[0], ResourceGrant.grantee_id == grantee[1])
    now = _now()
    return [g for g in db.execute(q.order_by(ResourceGrant.created_at.asc())).scalars().all()
            if _grant_is_live(g, now)]


def grants_for_pairs(db: Session, workspace_id: str, pairs: Sequence[Tuple[str, str]],
                     resource_kind: Optional[str] = None,
                     resource_ids: Optional[Iterable[str]] = None) -> List[ResourceGrant]:
    """Active grants reaching any of the (grantee_kind, grantee_id) pairs."""
    pairs = [(k, i) for k, i in pairs if k and i]
    if not pairs:
        return []
    conds = [(ResourceGrant.grantee_kind == k) & (ResourceGrant.grantee_id == i) for k, i in pairs]
    q = select(ResourceGrant).where(
        ResourceGrant.workspace_id == str(workspace_id),
        ResourceGrant.revoked_at.is_(None),
        or_(*conds),
    )
    if resource_kind:
        q = q.where(ResourceGrant.resource_kind == resource_kind)
    if resource_ids is not None:
        ids = list(resource_ids)
        if not ids:
            return []
        q = q.where(ResourceGrant.resource_id.in_(ids))
    now = _now()
    return [g for g in db.execute(q).scalars().all() if _grant_is_live(g, now)]


def create_grant(db: Session, workspace_id: str, *, resource_kind: str, resource_id: str,
                 grantee_kind: str, grantee_id: str, rights: Optional[Iterable[str]] = None,
                 scope=None, expires_at: Optional[datetime] = None, budget=None,
                 granted_by: Optional[str] = None, note: Optional[str] = None) -> Tuple[ResourceGrant, bool]:
    """Idempotent on (resource, grantee, rights): returns (grant, created)."""
    if grantee_kind == "human":
        grantee_id = _norm(grantee_id) or grantee_id
    rights = normalize_rights(rights)
    for g in active_grants(db, workspace_id, resource_kind, resource_id, (grantee_kind, grantee_id)):
        if sorted(g.rights or []) == sorted(rights) and g.expires_at == expires_at:
            return g, False
    g = ResourceGrant(
        id=str(uuid.uuid4()), workspace_id=str(workspace_id), resource_kind=resource_kind,
        resource_id=resource_id, grantee_kind=grantee_kind, grantee_id=grantee_id, rights=rights,
        scope=scope, expires_at=expires_at, budget=budget, granted_by=granted_by, note=note,
    )
    db.add(g)
    db.flush()
    return g, True


def revoke_grant(db: Session, grant: ResourceGrant, by: Optional[str]) -> None:
    if grant.revoked_at is None:
        grant.revoked_at = _now()
        grant.revoked_by = by
        db.flush()


def revoke_grants(db: Session, workspace_id: str, *, resource_kind: str, resource_id: str,
                  grantee_kind: str, grantee_id: str, by: Optional[str]) -> int:
    if grantee_kind == "human":
        grantee_id = _norm(grantee_id) or grantee_id
    n = 0
    for g in active_grants(db, workspace_id, resource_kind, resource_id, (grantee_kind, grantee_id)):
        revoke_grant(db, g, by)
        n += 1
    return n


def ensure_default_agent_grant(db: Session, workspace_id: str, agent_name: str) -> None:
    """Explicit twin of the after_insert hook, for callers that re-activate a
    removed agent and want it usable again."""
    groups = get_or_create_builtin_groups(db, workspace_id)
    create_grant(db, workspace_id, resource_kind="agent", resource_id=agent_name, grantee_kind="group",
                 grantee_id=groups["everyone"].id, rights=["act"], granted_by="system", note="default")


# ---------------------------------------------------------------------------
# The rule
# ---------------------------------------------------------------------------

class Explanation:
    __slots__ = ("allowed", "reason", "text")

    def __init__(self, allowed: bool, reason: str, text: str):
        self.allowed = allowed
        self.reason = reason
        self.text = text

    def as_dict(self) -> dict:
        return {"allowed": self.allowed, "reason": self.reason, "text": self.text}


def _owner_matches(db: Session, workspace_id: str, principal: Principal, owner: Optional[str]) -> bool:
    if not owner:
        return False
    if owner.startswith("human:"):
        email = _norm(owner[len("human:"):])
        if not email or "@" not in email:
            return False
        # A person owns it. (Their agents reach it through inheritance, which
        # is reported as such — not as ownership.)
        return principal.kind == "human" and principal.email == email
    if owner.startswith("openagents:"):
        agent = owner[len("openagents:"):]
        if principal.kind == "agent":
            return principal.agent_name == agent
        if principal.kind == "human" and principal.email:
            m = db.execute(
                select(WorkspaceMember.owner_email).where(
                    WorkspaceMember.workspace_id == str(workspace_id),
                    WorkspaceMember.agent_name == agent,
                )
            ).first()
            return bool(m) and _norm(m[0]) == principal.email
    return False


def _is_participant(db: Session, principal: Principal, channel: Channel) -> bool:
    if principal.kind == "human" and principal.email:
        row = db.execute(
            select(ChannelHumanMember.user_email).where(
                ChannelHumanMember.channel_id == channel.id,
                ChannelHumanMember.user_email == principal.email,
            )
        ).first()
        return row is not None
    if principal.kind == "agent":
        row = db.execute(
            select(ChannelMember.agent_name).where(
                ChannelMember.channel_id == channel.id,
                ChannelMember.agent_name == principal.agent_name,
            )
        ).first()
        return row is not None
    return False


def _owner_principal(db: Session, workspace_id: str, principal: Principal) -> Optional[Principal]:
    """The agent's human owner as a principal (for inheritance)."""
    if principal.kind != "agent" or not principal.owner_email:
        return None
    ws = _load_workspace(db, workspace_id)
    role = role_for_email(db, ws, principal.owner_email) if ws is not None else None
    return Principal("human", email=principal.owner_email, role=role, workspace_id=str(workspace_id))


def explain(db: Session, principal: Principal, resource: Resource, right: str = "read",
            workspace_id: Optional[str] = None, _depth: int = 0) -> Explanation:
    """Why may (or may not) the principal exercise `right` on `resource`."""
    wid = str(workspace_id or principal.workspace_id or "")
    if principal.machine:
        return Explanation(True, "machine", "Machine credential without agent identity (legacy full access).")

    if _owner_matches(db, wid, principal, resource.owner):
        return Explanation(True, "owner", "You own this.")

    if resource.visibility == "public" and right in ("read", "act"):
        return Explanation(True, "public", "This is public to everyone in the workspace.")

    if resource.kind == "channel" and resource.obj is not None and right in ("read", "act"):
        if _is_participant(db, principal, resource.obj):
            return Explanation(True, "participant", "You are a participant of this thread.")

    if wid:
        pairs = _identity_pairs(db, wid, principal)
        grants = grants_for_pairs(db, wid, pairs, resource.kind, [resource.id])
        direct = [g for g in grants if g.grantee_kind != "group" and _has_right(g.rights, right)]
        if direct:
            g = direct[0]
            if (principal.kind == "agent" and g.grantee_kind == "human"):
                return Explanation(True, "inherited_from_owner",
                                   f"Your owner ({g.grantee_id}) was granted access, and you inherit it.")
            return Explanation(True, "grant", f"You were granted access by {g.granted_by or 'the owner'}.")
        via_group = [g for g in grants if g.grantee_kind == "group" and _has_right(g.rights, right)]
        if via_group:
            g = via_group[0]
            grp = db.execute(select(SecurityGroup).where(SecurityGroup.id == g.grantee_id)).scalar_one_or_none()
            name = grp.name if grp else "a group"
            return Explanation(True, f"group:{name}", f"Granted to the group “{name}”, which includes you.")

    if principal.kind == "agent" and _depth == 0:
        owner = _owner_principal(db, wid, principal)
        if owner is not None:
            inner = explain(db, owner, resource, right, wid, _depth=1)
            if inner.allowed:
                return Explanation(True, "inherited_from_owner",
                                   f"Your owner ({owner.email}) can access this ({inner.reason}); you inherit it.")

    if resource.kind == "file" and resource.visibility is None and resource.channel_name and _depth < 2:
        ch = db.execute(select(Channel).where(Channel.workspace_id == wid,
                                              Channel.name == resource.channel_name)).scalar_one_or_none()
        if ch is None:
            return Explanation(True, "inherited_from_channel", "The thread this file belonged to is gone; it is open.")
        inner = explain(db, principal, resource_for_channel(ch), right, wid, _depth=_depth + 1)
        if inner.allowed:
            return Explanation(True, "inherited_from_channel", f"Attached to a thread you can access ({inner.reason}).")

    if principal.is_admin and principal.kind == "human":
        return Explanation(False, "admin_metadata", "Admins see only metadata of private things; the owner can share it.")
    return Explanation(False, "denied", "You do not have access to this.")


def allowed(db: Session, principal: Principal, resource: Resource, right: str = "read",
            workspace_id: Optional[str] = None) -> bool:
    return explain(db, principal, resource, right, workspace_id).allowed


def can_manage(db: Session, principal: Principal, resource: Resource, workspace_id: Optional[str] = None) -> bool:
    """May the principal change visibility / grants of this resource: owner,
    admin, machine, or a holder of the `share` right."""
    wid = str(workspace_id or principal.workspace_id or "")
    if principal.machine or (principal.kind == "human" and principal.is_admin):
        return True
    if _owner_matches(db, wid, principal, resource.owner):
        return True
    if not wid:
        return False
    pairs = _identity_pairs(db, wid, principal)
    return any(_has_right(g.rights, "share") for g in grants_for_pairs(db, wid, pairs, resource.kind, [resource.id]))


# ---------------------------------------------------------------------------
# Hot-path helpers (bulk)
# ---------------------------------------------------------------------------

def can_view_channel(db: Session, workspace_id: str, principal: Principal, channel: Channel) -> bool:
    if principal.machine:
        return True
    return allowed(db, principal, resource_for_channel(channel), "read", workspace_id)


def hidden_channel_names(db: Session, workspace_id: str, principal: Principal) -> Set[str]:
    """Private channels this principal may NOT see. Empty for machines."""
    if principal.machine:
        return set()
    wid = str(workspace_id)
    private = db.execute(
        select(Channel.id, Channel.name, Channel.owner_email).where(
            Channel.workspace_id == wid,
            Channel.visibility == "private",
        )
    ).all()
    if not private:
        return set()
    visible_ids: Set[str] = set()
    visible_names: Set[str] = set()
    emails = set()
    if principal.kind == "human" and principal.email:
        emails.add(principal.email)
    if principal.kind == "agent" and principal.owner_email:
        emails.add(principal.owner_email)
    ids = [cid for cid, _, _ in private]
    if emails:
        visible_ids |= set(db.execute(
            select(ChannelHumanMember.channel_id).where(
                ChannelHumanMember.channel_id.in_(ids),
                ChannelHumanMember.user_email.in_(list(emails)),
            )
        ).scalars().all())
        for cid, name, owner in private:
            if _norm(owner) in emails:
                visible_ids.add(cid)
    if principal.kind == "agent":
        visible_ids |= set(db.execute(
            select(ChannelMember.channel_id).where(
                ChannelMember.channel_id.in_(ids),
                ChannelMember.agent_name == principal.agent_name,
            )
        ).scalars().all())
    pairs = _identity_pairs(db, wid, principal)
    for g in grants_for_pairs(db, wid, pairs, "channel"):
        if _has_right(g.rights, "read"):
            visible_names.add(g.resource_id)
    return {name for cid, name, _ in private if cid not in visible_ids and name not in visible_names}


def can_use_agent(db: Session, workspace_id: str, principal: Principal, member: WorkspaceMember) -> bool:
    """May this principal see/mention/start requests with the agent?"""
    if principal.machine:
        return True
    if principal.kind == "agent" and principal.agent_name == member.agent_name:
        return True
    return allowed(db, principal, resource_for_agent(member), "act", workspace_id)


def hidden_agent_names(db: Session, workspace_id: str, principal: Principal,
                       members: Optional[Iterable[WorkspaceMember]] = None) -> Set[str]:
    """Agents this principal may not see. Empty for machines."""
    if principal.machine:
        return set()
    wid = str(workspace_id)
    if members is None:
        members = db.execute(
            select(WorkspaceMember).where(
                WorkspaceMember.workspace_id == wid,
                WorkspaceMember.status != "removed",
            )
        ).scalars().all()
    members = list(members)
    if not members:
        return set()
    emails = set()
    if principal.kind == "human" and principal.email:
        emails.add(principal.email)
    if principal.kind == "agent" and principal.owner_email:
        emails.add(principal.owner_email)
    granted: Set[str] = set()
    pairs = _identity_pairs(db, wid, principal)
    for g in grants_for_pairs(db, wid, pairs, "agent", [m.agent_name for m in members]):
        if _has_right(g.rights, "read"):
            granted.add(g.resource_id)
    hidden = set()
    for m in members:
        if m.agent_name in granted:
            continue
        if _norm(m.owner_email) and _norm(m.owner_email) in emails:
            continue
        if principal.kind == "agent" and principal.agent_name == m.agent_name:
            continue
        hidden.add(m.agent_name)
    return hidden


def can_read_file(db: Session, workspace_id: str, principal: Principal, record: FileRecord) -> bool:
    if principal.machine:
        return True
    return allowed(db, principal, resource_for_file(record), "read", workspace_id)


def can_read_knowledge(db: Session, workspace_id: str, principal: Principal, entry: KnowledgeEntry) -> bool:
    if principal.machine:
        return True
    return allowed(db, principal, resource_for_knowledge(entry), "read", workspace_id)


def filter_files(db: Session, workspace_id: str, principal: Principal,
                 records: Sequence[FileRecord]) -> List[FileRecord]:
    """Bulk version of can_read_file for list endpoints: one pass over the
    hidden-channel set and the principal's file grants."""
    if principal.machine or not records:
        return list(records)
    wid = str(workspace_id)
    hidden_channels = hidden_channel_names(db, wid, principal)
    granted: Set[str] = set()
    pairs = _identity_pairs(db, wid, principal)
    for g in grants_for_pairs(db, wid, pairs, "file", [r.id for r in records]):
        if _has_right(g.rights, "read"):
            granted.add(g.resource_id)
    out = []
    for r in records:
        res = resource_for_file(r)
        if _owner_matches(db, wid, principal, res.owner) or r.id in granted:
            out.append(r)
        elif res.visibility == "public":
            out.append(r)
        elif res.visibility is None:
            if r.channel_name not in hidden_channels:
                out.append(r)
        # private & not granted → hidden
    return out


def filter_knowledge(db: Session, workspace_id: str, principal: Principal,
                     entries: Sequence[KnowledgeEntry]) -> List[KnowledgeEntry]:
    if principal.machine or not entries:
        return list(entries)
    wid = str(workspace_id)
    granted: Set[str] = set()
    pairs = _identity_pairs(db, wid, principal)
    for g in grants_for_pairs(db, wid, pairs, "knowledge", [e.id for e in entries]):
        if _has_right(g.rights, "read"):
            granted.add(g.resource_id)
    out = []
    for e in entries:
        res = resource_for_knowledge(e)
        if res.visibility == "public" or e.id in granted or _owner_matches(db, wid, principal, res.owner):
            out.append(e)
    return out


# ---------------------------------------------------------------------------
# Thread participants (the ACL rows; unchanged semantics from M1)
# ---------------------------------------------------------------------------

def channel_participant_emails(db: Session, channel: Channel) -> Set[str]:
    return set(db.execute(
        select(ChannelHumanMember.user_email).where(ChannelHumanMember.channel_id == channel.id)
    ).scalars().all())


def add_channel_participant(db: Session, channel: Channel, email: str) -> bool:
    email = _norm(email)
    if not email:
        return False
    existing = db.execute(
        select(ChannelHumanMember).where(
            ChannelHumanMember.channel_id == channel.id,
            ChannelHumanMember.user_email == email,
        )
    ).scalar_one_or_none()
    if existing:
        return False
    db.add(ChannelHumanMember(channel_id=channel.id, user_email=email))
    db.flush()
    return True


def remove_channel_participant(db: Session, channel: Channel, email: str) -> bool:
    email = _norm(email)
    row = db.execute(
        select(ChannelHumanMember).where(
            ChannelHumanMember.channel_id == channel.id,
            ChannelHumanMember.user_email == email,
        )
    ).scalar_one_or_none()
    if not row:
        return False
    db.delete(row)
    db.flush()
    return True


def add_channel_agent(db: Session, channel: Channel, agent_name: str) -> bool:
    existing = db.execute(
        select(ChannelMember).where(ChannelMember.channel_id == channel.id, ChannelMember.agent_name == agent_name)
    ).scalar_one_or_none()
    if existing:
        return False
    db.add(ChannelMember(channel_id=channel.id, agent_name=agent_name))
    db.flush()
    return True


# ---------------------------------------------------------------------------
# Agents: who may use them (directory), legacy helpers
# ---------------------------------------------------------------------------

def agent_usable_by(db: Session, workspace_id: str, agent_names: Iterable[str]) -> Dict[str, dict]:
    """{agent: {everyone, groups:[{id,name}], people, agents}} from the active
    agent grants, in one query."""
    names = list(agent_names)
    out = {n: {"everyone": False, "groups": [], "people": 0, "agents": 0} for n in names}
    if not names:
        return out
    wid = str(workspace_id)
    groups = {g.id: g for g in db.execute(
        select(SecurityGroup).where(SecurityGroup.workspace_id == wid)
    ).scalars().all()}
    now = _now()
    rows = db.execute(
        select(ResourceGrant).where(
            ResourceGrant.workspace_id == wid,
            ResourceGrant.resource_kind == "agent",
            ResourceGrant.resource_id.in_(names),
            ResourceGrant.revoked_at.is_(None),
        )
    ).scalars().all()
    seen = set()
    for g in rows:
        if not _grant_is_live(g, now) or not _has_right(g.rights, "act"):
            continue
        key = (g.resource_id, g.grantee_kind, g.grantee_id)
        if key in seen:
            continue
        seen.add(key)
        entry = out.setdefault(g.resource_id, {"everyone": False, "groups": [], "people": 0, "agents": 0})
        if g.grantee_kind == "group":
            grp = groups.get(g.grantee_id)
            if grp is None:
                continue
            if grp.kind == "everyone":
                entry["everyone"] = True
            else:
                entry["groups"].append({"id": grp.id, "name": grp.name})
        elif g.grantee_kind == "human":
            entry["people"] += 1
        elif g.grantee_kind == "agent":
            entry["agents"] += 1
    return out


def legacy_agent_visibility(usable: dict) -> str:
    """What old clients read as the personal/team flag: mirrors the
    `everyone` grant."""
    return "team" if usable.get("everyone") else "personal"


def grantee_emails(db: Session, workspace_id: str, agent_name: str) -> Set[str]:
    """People holding a direct grant on the agent (legacy name)."""
    return {g.grantee_id for g in active_grants(db, workspace_id, "agent", agent_name)
            if g.grantee_kind == "human"}


def granted_agent_names(db: Session, workspace_id: str, email: Optional[str]) -> Set[str]:
    email = _norm(email)
    if not email:
        return set()
    return {g.resource_id for g in active_grants(db, workspace_id, "agent", grantee=("human", email))}


def is_agent_owner(principal: Principal, member: WorkspaceMember) -> bool:
    owner = _norm(member.owner_email)
    if not owner:
        return False
    if principal.kind == "agent":
        return principal.owner_email == owner
    return bool(principal.email) and principal.email == owner


# ---------------------------------------------------------------------------
# Grantee picker / preview helpers
# ---------------------------------------------------------------------------

def grant_candidates(db: Session, workspace: Workspace, kinds: Optional[Iterable[str]] = None,
                     exclude: Optional[Iterable[str]] = None) -> dict:
    """Everything a grant can target in this workspace: humans (collaborators
    + members), agents, groups (builtins first)."""
    kinds = set(kinds or GRANTEE_KINDS)
    exclude = set(exclude or [])
    out = {"humans": [], "agents": [], "groups": []}
    if "human" in kinds:
        names = {}
        emails = workspace_human_roles(db, workspace)
        if emails:
            rows = db.execute(select(User.email, User.display_name).where(User.email.in_(list(emails)))).all()
            names = {e: n for e, n in rows}
        for email, role in sorted(emails.items()):
            if email in exclude:
                continue
            out["humans"].append({"kind": "human", "id": email, "label": names.get(email) or email, "role": role})
    if "agent" in kinds:
        agents = db.execute(
            select(WorkspaceMember).where(
                WorkspaceMember.workspace_id == workspace.id,
                WorkspaceMember.status != "removed",
            ).order_by(WorkspaceMember.agent_name.asc())
        ).scalars().all()
        for m in agents:
            if m.agent_name in exclude:
                continue
            out["agents"].append({"kind": "agent", "id": m.agent_name,
                                  "label": m.display_name or f"@{m.agent_name}", "owner_email": _norm(m.owner_email)})
    if "group" in kinds:
        get_or_create_builtin_groups(db, str(workspace.id))
        groups = db.execute(
            select(SecurityGroup).where(SecurityGroup.workspace_id == workspace.id)
        ).scalars().all()
        order = {"everyone": 0, "guest": 1, "custom": 2}
        for g in sorted(groups, key=lambda g: (order.get(g.kind, 9), g.name.lower())):
            if g.id in exclude:
                continue
            out["groups"].append({"kind": "group", "id": g.id, "label": g.name, "group_kind": g.kind,
                                  "builtin": g.kind != "custom"})
    return out


def grantee_label(db: Session, workspace_id: str, grantee_kind: str, grantee_id: str) -> str:
    if grantee_kind == "group":
        g = db.execute(select(SecurityGroup).where(SecurityGroup.id == grantee_id)).scalar_one_or_none()
        return g.name if g else grantee_id
    if grantee_kind == "agent":
        m = db.execute(select(WorkspaceMember.display_name).where(
            WorkspaceMember.workspace_id == str(workspace_id), WorkspaceMember.agent_name == grantee_id)).first()
        return (m[0] if m and m[0] else None) or f"@{grantee_id}"
    u = db.execute(select(User.display_name).where(User.email == _norm(grantee_id))).first()
    return (u[0] if u and u[0] else None) or grantee_id


def grant_preview(db: Session, workspace_id: str, resource: Resource) -> List[dict]:
    """What becomes accessible with a grant on `resource`: channels → the
    thread + its files + its tasks; agents → profile + example requests;
    files/knowledge → the item."""
    wid = str(workspace_id)
    items: List[dict] = []
    if resource.kind == "channel":
        ch: Channel = resource.obj
        items.append({"kind": "channel", "id": ch.name, "title": ch.title or ch.name})
        files = db.execute(
            select(FileRecord.id, FileRecord.filename).where(
                FileRecord.workspace_id == wid, FileRecord.channel_name == ch.name, FileRecord.status == "active",
            ).order_by(FileRecord.created_at.asc())
        ).all()
        items.extend({"kind": "file", "id": fid, "title": fname} for fid, fname in files)
        from app.models import KanbanTask
        tasks = db.execute(
            select(KanbanTask.id, KanbanTask.title).where(
                KanbanTask.workspace_id == wid, KanbanTask.channel_name == ch.name,
            )
        ).all()
        items.extend({"kind": "task", "id": tid, "title": title} for tid, title in tasks)
    elif resource.kind == "agent":
        m: WorkspaceMember = resource.obj
        items.append({"kind": "agent", "id": m.agent_name, "title": m.display_name or f"@{m.agent_name}"})
        for i, ex in enumerate(m.example_requests or []):
            items.append({"kind": "example_request", "id": f"{m.agent_name}#{i}", "title": ex})
    elif resource.kind == "file":
        f: FileRecord = resource.obj
        items.append({"kind": "file", "id": f.id, "title": f.filename})
    elif resource.kind == "knowledge":
        k: KnowledgeEntry = resource.obj
        items.append({"kind": "knowledge", "id": k.id, "title": k.title})
    else:
        items.append({"kind": resource.kind, "id": resource.id, "title": resource.id})
    return items


def resource_meta(db: Session, workspace_id: str, principal: Principal, resource: Resource) -> dict:
    """The owner/visibility block files and knowledge responses carry."""
    vis = resource.visibility
    effective = vis
    if resource.kind == "file" and vis is None:
        effective = "public"
        if resource.channel_name:
            ch = db.execute(select(Channel.visibility).where(
                Channel.workspace_id == str(workspace_id), Channel.name == resource.channel_name)).first()
            if ch is not None:
                effective = normalize_visibility(ch[0], "public") or "public"
    return {
        "owner": resource.owner,
        "owner_label": owner_label_for(resource.owner),
        "visibility": vis,
        "effective_visibility": effective,
        "can_manage": can_manage(db, principal, resource, workspace_id),
    }
