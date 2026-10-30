"""Ownership continuity for existing workspace-token clients."""
from sqlalchemy import func, select, update
from app.models import Node, User, WorkspaceMember, WorkspaceMembership


def workspace_owner_email(db, workspace):
    """Prefer the recorded creator when still an owner, then the oldest owner.

    An explicit membership overrides the creator fallback, matching access.py.
    Administrators and ordinary members are never promoted to owners here.
    """
    rows = db.execute(select(User.email, WorkspaceMembership.role)
        .join(WorkspaceMembership, WorkspaceMembership.user_id == User.id)
        .where(WorkspaceMembership.workspace_id == workspace.id)
        .order_by(WorkspaceMembership.created_at, User.email)).all()
    roles = {(email or '').strip().lower(): role for email, role in rows}
    creator = (workspace.creator_email or '').strip().lower()
    if creator and roles.get(creator, 'owner') == 'owner':
        return creator
    return next(((email or '').strip().lower() for email, role in rows if role == 'owner'), None)


def inherit_unowned_resources(db, workspace, owner):
    """Claim unowned resources without replacing any explicit device owner."""
    db.execute(update(Node).where(Node.workspace_id == workspace.id,
        func.nullif(func.trim(Node.owner_email), '') == None).values(owner_email=owner))  # noqa: E711
    node_owner = select(Node.owner_email).where(Node.id == WorkspaceMember.node_id).scalar_subquery()
    db.execute(update(WorkspaceMember).where(WorkspaceMember.workspace_id == workspace.id,
        func.nullif(func.trim(WorkspaceMember.owner_email), '') == None)  # noqa: E711
        .values(owner_email=func.coalesce(node_owner, owner)))
