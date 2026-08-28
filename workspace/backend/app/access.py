# -*- coding: utf-8 -*-
"""
Shared human-identity & workspace-access helpers (enforced-login, v1.0).

Single source of truth for "may this caller touch this workspace?", replacing
the copies of `_verify_workspace_access` that were duplicated across the REST
routers, and adding first-class user/membership resolution on top of the
verified identity token.

Access rules (evaluated in order):
  1. Workspace token — `X-Workspace-Token` == `workspace.password_hash`.
     The MACHINE credential (agents, daemons, adapters, iOS, legacy share
     links). Always accepted regardless of `require_login`.
  2. Member identity — a logged-in user (verified Google/Apple bearer) who has
     a WorkspaceMembership row, or — for backward compatibility — whose email
     matches `creator_email` (owner) or a collaborator row (editor→member,
     viewer→viewer).
  3. Open workspace — no token set AND `require_login` is False → allow
     (grandfathers every pre-v1.0 open workspace).
Otherwise: deny.

With `require_login=False` (the default and every existing workspace) this
reduces to exactly the legacy behaviour, so wiring it in is a no-op until a
workspace opts in. The ONM pipeline guard (app/mods/auth.py) is intentionally
left on its own path for now; enforcement there lands with Phase 3.
"""

import logging
import secrets
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.orm import Session
from sqlalchemy.orm import Session as SqlaSession

from app.firebase_auth import verify_identity_claims
from app.models import Node, User, Workspace, WorkspaceCollaborator, WorkspaceMembership

logger = logging.getLogger(__name__)

# Role hierarchy, highest to lowest. Token/machine access is treated as
# owner-equivalent for min-role checks (fully trusted credential).
ROLE_RANK = {"viewer": 0, "member": 1, "admin": 2, "owner": 3}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def extract_bearer(authorization: Optional[str]) -> Optional[str]:
    """Extract the token from an `Authorization: Bearer <id>` header."""
    if authorization and authorization.lower().startswith("bearer "):
        return authorization[7:].strip()
    return None


def role_at_least(role: Optional[str], min_role: Optional[str]) -> bool:
    """True if `role` meets or exceeds `min_role` (None min_role = any role)."""
    if min_role is None:
        return role is not None
    return ROLE_RANK.get(role or "", -1) >= ROLE_RANK.get(min_role, 99)


# ---------------------------------------------------------------------------
# User resolution
# ---------------------------------------------------------------------------

def get_or_create_user(db: Session, claims: dict) -> Optional[User]:
    """Resolve (or lazily create) the User row for a verified identity.

    Keyed by normalized email. Opportunistically backfills the provider uid /
    display name on an existing row, and stamps last_login_at. Does NOT commit —
    the caller owns the transaction.
    """
    email = (claims.get("email") or "").strip().lower()
    if not email:
        return None

    user = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
    if user is None:
        user = User(
            email=email,
            firebase_uid=claims.get("firebase_uid"),
            apple_sub=claims.get("apple_sub"),
            display_name=claims.get("display_name"),
            last_login_at=_now(),
        )
        db.add(user)
        db.flush()
        return user

    # Backfill identity fields we didn't have yet (never clobber existing).
    if claims.get("firebase_uid") and not user.firebase_uid:
        user.firebase_uid = claims["firebase_uid"]
    if claims.get("apple_sub") and not user.apple_sub:
        user.apple_sub = claims["apple_sub"]
    if claims.get("display_name") and not user.display_name:
        user.display_name = claims["display_name"]
    user.last_login_at = _now()
    return user


def resolve_current_user(db: Session, authorization: Optional[str]) -> Optional[User]:
    """Verify the bearer and return the (created/refreshed) User, or None."""
    bearer = extract_bearer(authorization)
    if not bearer:
        return None
    claims = verify_identity_claims(bearer)
    if not claims:
        return None
    return get_or_create_user(db, claims)


def get_or_create_user_by_email(db: Session, email: str) -> User:
    """Resolve (or create) a User row by email alone — for inviting a teammate
    who hasn't logged in yet. The row starts with no provider uid; it's
    backfilled by get_or_create_user the first time they actually sign in.
    Does NOT commit.
    """
    email = email.strip().lower()
    user = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
    if user is None:
        user = User(email=email)
        db.add(user)
        db.flush()
    return user


# ---------------------------------------------------------------------------
# Membership reconciliation (lazy migration bridge)
# ---------------------------------------------------------------------------

def _ensure_membership(db: Session, workspace_id: str, user_id: str, role: str) -> None:
    """Create a membership row if the user isn't already a member.

    Never downgrades or overrides an existing role — explicit role changes win.
    """
    existing = db.execute(
        select(WorkspaceMembership).where(
            WorkspaceMembership.workspace_id == workspace_id,
            WorkspaceMembership.user_id == user_id,
        )
    ).scalar_one_or_none()
    if existing is None:
        db.add(WorkspaceMembership(workspace_id=workspace_id, user_id=user_id, role=role))


def reconcile_memberships(db: Session, user: User) -> None:
    """Backfill membership rows from pre-v1.0 email-keyed access.

    Workspaces this user created (`creator_email`) → owner; collaborator rows
    (editor→member, viewer→viewer). This is the migration bridge: an existing
    user inherits their workspaces the first time they sign in, with no bulk
    data migration. Create-if-missing only. Does NOT commit.
    """
    email = user.email

    owned = db.execute(
        select(Workspace).where(
            func.lower(Workspace.creator_email) == email,
            Workspace.status != "deleted",
        )
    ).scalars().all()
    for ws in owned:
        _ensure_membership(db, ws.id, user.id, "owner")

    collabs = db.execute(
        select(WorkspaceCollaborator).where(WorkspaceCollaborator.email == email)
    ).scalars().all()
    for c in collabs:
        role = "member" if (c.role or "editor") == "editor" else "viewer"
        _ensure_membership(db, c.workspace_id, user.id, role)

    # Sessions run with autoflush disabled, so flush the new rows now — callers
    # (e.g. the auto-provision check) must be able to see them in a subsequent
    # query within the same transaction.
    db.flush()


def provision_workspace(db: Session, user: User, name: str = "My Workspace") -> Workspace:
    """Create a fresh empty workspace owned by `user` (Overleaf-style first-run).

    Mirrors the agent-less path of POST /v1/workspaces: a slug + token + owner,
    no seeded channels or agents. Keeps a workspace token so agents and legacy
    clients can still attach. Does NOT commit — the caller owns the transaction.
    """
    ws = Workspace(
        slug=secrets.token_hex(4),
        name=name,
        creator_email=user.email,
        password_hash=secrets.token_urlsafe(32),
        # Identity-created workspace → enforced login by default (v1.0). The
        # kept token still lets agents/legacy clients attach.
        require_login=True,
        settings={},
        status="active",
    )
    db.add(ws)
    db.flush()
    db.add(WorkspaceMembership(workspace_id=ws.id, user_id=user.id, role="owner"))

    # Auto-provision the built-in Yumi onboarding assistant, same as
    # POST /v1/workspaces — a first workspace without any agent is a dead end
    # (especially on mobile, where the launcher can't be installed). Never let
    # this block workspace creation.
    try:
        from app.services.yumi import provision_yumi
        provision_yumi(db, ws)
    except Exception:
        logger.warning("provision_workspace: failed to provision Yumi", exc_info=True)
    return ws


# ---------------------------------------------------------------------------
# Access verification
# ---------------------------------------------------------------------------

def resolve_user_role(db: Session, workspace: Workspace, authorization: Optional[str]) -> Optional[str]:
    """Return the caller's role in this workspace from their identity bearer.

    Prefers an explicit WorkspaceMembership row; falls back to legacy
    email-based access (creator_email → owner, collaborator → member/viewer) so
    access works before the user has logged in and been reconciled. Returns None
    if the caller has no identity or no access.
    """
    bearer = extract_bearer(authorization)
    if not bearer:
        return None
    claims = verify_identity_claims(bearer)
    if not claims:
        return None
    email = (claims.get("email") or "").strip().lower()
    if not email:
        return None

    user = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
    if user is not None:
        membership = db.execute(
            select(WorkspaceMembership).where(
                WorkspaceMembership.workspace_id == workspace.id,
                WorkspaceMembership.user_id == user.id,
            )
        ).scalar_one_or_none()
        if membership is not None:
            return membership.role

    # Legacy email fallbacks (pre-reconciliation access).
    if workspace.creator_email and workspace.creator_email.strip().lower() == email:
        return "owner"
    for c in (workspace.collaborators or []):
        if c.email == email:
            return "member" if (c.role or "editor") == "editor" else "viewer"
    return None


def resolve_machine_token(db: Session, token: str):
    """Map a machine token to (workspace, node) — the single source of truth.

    Two credential classes exist: the shared workspace token
    (workspaces.password_hash, legacy + manual connections) and per-node
    tokens (nodes.token, minted at pairing redeem). This helper is used by
    BOTH the access check and /v1/token/resolve so the two can never disagree
    about what a token means (the failure mode behind "agn connect says
    invalid token while the same token heartbeats fine").

    Returns (workspace, node|None), or (None, None) when the token matches
    nothing. `node` is set only for node tokens — callers use it to attribute
    joins to a device.
    """
    if not token:
        return None, None
    ws = db.execute(
        select(Workspace).where(
            Workspace.password_hash == token,
            Workspace.status != "deleted",
        )
    ).scalar_one_or_none()
    if ws is not None:
        return ws, None
    node = db.execute(select(Node).where(Node.token == token)).scalar_one_or_none()
    if node is not None:
        ws = db.execute(
            select(Workspace).where(
                Workspace.id == node.workspace_id,
                Workspace.status != "deleted",
            )
        ).scalar_one_or_none()
        if ws is not None:
            return ws, node
    return None, None


def verify_workspace_access(
    workspace: Workspace,
    token: Optional[str],
    authorization: Optional[str],
    db: Optional[Session] = None,
    min_role: Optional[str] = None,
) -> bool:
    """The single access check. See module docstring for the rule order.

    `db` is optional — when omitted it is derived from the workspace's own
    session (`object_session`), so the thin router wrappers keep their existing
    3-arg signature and no call site has to change. `min_role`
    (owner|admin|member|viewer) gates identity-based access; token (machine)
    access is fully trusted and bypasses the role check.
    """
    # 1. Machine / legacy workspace token — fully trusted.
    if workspace.password_hash and token and token == workspace.password_hash:
        return True

    if db is None:
        db = SqlaSession.object_session(workspace)

    # 1b. Per-node token belonging to THIS workspace — the machine credential
    # minted at pairing redeem. Same full trust as the workspace token, but
    # scoped: another workspace's node token does not pass.
    if token and db is not None:
        node = db.execute(
            select(Node).where(
                Node.token == token,
                Node.workspace_id == workspace.id,
            )
        ).scalar_one_or_none()
        if node is not None:
            return True

    # 2. Member identity (membership row or legacy email match).
    if db is not None:
        role = resolve_user_role(db, workspace, authorization)
        if role is not None:
            return role_at_least(role, min_role)

    # 3. Open, non-enforced workspace — grandfathered.
    if not workspace.password_hash and not workspace.require_login:
        return True

    return False
