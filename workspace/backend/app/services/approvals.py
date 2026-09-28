# -*- coding: utf-8 -*-
"""
Approvals — agents act, humans approve where it matters.

The approval gate is part of the conversation, not a separate console. An
agent that is about to do something a person should sign off on (deploy to
production, spend money, email customers, delete data…) calls
``request_approval``. Policy decides what happens next:

  * ``allow``  → auto-approved; the agent proceeds. Still logged and still
                 visible in the thread, so the audit trail is complete.
  * ``block``  → auto-rejected; the agent is told not to do it.
  * ``any`` / ``admin`` / ``owner`` → the request pauses. It is posted into the
                 thread as an ``approval`` message with Approve / Reject
                 buttons, filed in the inbox (push reason ``approval``), and —
                 when the thread is a Kanban task thread — the card is parked
                 in Need Input. A person with at least that role resolves it.

Resolution posts a normal human message back into the thread, @mentioning the
agent, so the decision reaches the agent through the same routing every other
human message uses (agents poll ``target_agents``; nothing new to learn).

Policies live in ``approval_policies``: one row per (workspace, channel) with
``channel_name="*"`` as the workspace default. Effective rules for a channel
are built-in defaults ← workspace row ← channel row, kind by kind.
"""

import logging
from datetime import datetime, timezone
from typing import Iterable, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import ApprovalPolicy, ApprovalRequest, KanbanTask, Workspace
from app.services.notify import REASON_APPROVAL, notify
from openagents.core.onm_events import Event

logger = logging.getLogger(__name__)

# What a policy may say about an action kind.
POLICY_ALLOW = "allow"      # no approval needed
POLICY_ANY = "any"          # any human member of the workspace
POLICY_ADMIN = "admin"      # admin or owner
POLICY_OWNER = "owner"      # owner only
POLICY_BLOCK = "block"      # never; auto-rejected
POLICIES = (POLICY_ALLOW, POLICY_ANY, POLICY_ADMIN, POLICY_OWNER, POLICY_BLOCK)

# Built-in action kinds and their default policy. These mirror the permission
# table on the "Agents act. Humans approve where it matters." slide; a
# workspace can retune any of them under Settings → Approvals.
DEFAULT_RULES = [
    {"kind": "deploy",        "label": "Deploy to production",                 "policy": POLICY_ADMIN},
    {"kind": "spend",         "label": "Spend money or call paid APIs",        "policy": POLICY_OWNER},
    {"kind": "external_send", "label": "Send email or messages to customers",  "policy": POLICY_ANY},
    {"kind": "repo_read",     "label": "Read repositories",                    "policy": POLICY_ALLOW},
    {"kind": "repo_write",    "label": "Open pull requests or push branches",  "policy": POLICY_ALLOW},
    {"kind": "data_delete",   "label": "Delete data",                          "policy": POLICY_BLOCK},
    {"kind": "shell",         "label": "Run commands with side effects",       "policy": POLICY_ANY},
    {"kind": "other",         "label": "Anything else the agent is unsure of", "policy": POLICY_ANY},
]
KINDS = tuple(r["kind"] for r in DEFAULT_RULES)
RISKS = ("low", "medium", "high")

STATUS_PENDING = "pending"
STATUS_APPROVED = "approved"
STATUS_REJECTED = "rejected"
STATUS_EXPIRED = "expired"

WORKSPACE_SCOPE = "*"

# Who may resolve a request that pauses, expressed as the minimum membership
# role. `any` means any human member (viewers are read-only and may not).
_REQUIRED_MIN_ROLE = {POLICY_ANY: "member", POLICY_ADMIN: "admin", POLICY_OWNER: "owner"}
_ROLE_RANK = {"viewer": 0, "member": 1, "admin": 2, "owner": 3}

TASK_CHANNEL_PREFIX = "task:"


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------------------
# Policy
# ---------------------------------------------------------------------------

def _policy_row(db: Session, workspace_id: str, channel_name: str) -> Optional[ApprovalPolicy]:
    return db.execute(
        select(ApprovalPolicy).where(
            ApprovalPolicy.workspace_id == workspace_id,
            ApprovalPolicy.channel_name == channel_name,
        )
    ).scalar_one_or_none()


def _rules_dict(rules: Optional[Iterable[dict]]) -> dict:
    out = {}
    for r in rules or []:
        kind = (r or {}).get("kind")
        policy = (r or {}).get("policy")
        if kind and policy in POLICIES:
            out[kind] = policy
    return out


def effective_rules(db: Session, workspace_id: str, channel_name: Optional[str]) -> list:
    """Built-in defaults ← workspace default row ← channel row, kind by kind.

    Returns the full list of ``{kind, label, policy, source}`` so a settings
    page can show where each verdict comes from.
    """
    ws_row = _policy_row(db, workspace_id, WORKSPACE_SCOPE)
    ws_rules = _rules_dict(ws_row.rules if ws_row else None)
    ch_rules = {}
    if channel_name and channel_name != WORKSPACE_SCOPE:
        ch_row = _policy_row(db, workspace_id, channel_name)
        ch_rules = _rules_dict(ch_row.rules if ch_row else None)

    merged = []
    for d in DEFAULT_RULES:
        kind = d["kind"]
        if kind in ch_rules:
            merged.append({**d, "policy": ch_rules[kind], "source": "channel"})
        elif kind in ws_rules:
            merged.append({**d, "policy": ws_rules[kind], "source": "workspace"})
        else:
            merged.append({**d, "source": "default"})
    return merged


def policy_for(rules: list, kind: str) -> str:
    for r in rules:
        if r["kind"] == kind:
            return r["policy"]
    # Unknown kind → treat like "other" (pause for any member) rather than
    # silently allowing: the agent asked, so someone should answer.
    for r in rules:
        if r["kind"] == "other":
            return r["policy"]
    return POLICY_ANY


def set_rules(db: Session, workspace_id: str, channel_name: str, rules: list, updated_by: Optional[str]) -> ApprovalPolicy:
    """Replace the rule set for a scope. Unknown kinds/policies are dropped."""
    clean = [{"kind": k, "policy": p} for k, p in _rules_dict(rules).items()]
    row = _policy_row(db, workspace_id, channel_name)
    if row is None:
        row = ApprovalPolicy(workspace_id=workspace_id, channel_name=channel_name, rules=clean, updated_by=updated_by)
        db.add(row)
    else:
        row.rules = clean
        row.updated_by = updated_by
        row.updated_at = _now()
    db.flush()
    return row


def role_can_resolve(role: Optional[str], required_role: str) -> bool:
    """Whether a membership role satisfies an approval's ``required_role``."""
    min_role = _REQUIRED_MIN_ROLE.get(required_role, "member")
    return _ROLE_RANK.get(role or "", -1) >= _ROLE_RANK[min_role]


# ---------------------------------------------------------------------------
# Serialization
# ---------------------------------------------------------------------------

def serialize(a: ApprovalRequest) -> dict:
    return {
        "id": a.id,
        "channel_name": a.channel_name,
        "requested_by": a.requested_by,
        "kind": a.kind,
        "action": a.action,
        "details": a.details,
        "risk": a.risk,
        "required_role": a.required_role,
        "status": a.status,
        "resolved_by": a.resolved_by,
        "resolved_by_role": a.resolved_by_role,
        "resolved_at": a.resolved_at.isoformat() if a.resolved_at else None,
        "note": a.note,
        "request_event_id": a.request_event_id,
        "resolution_event_id": a.resolution_event_id,
        "created_at": a.created_at.isoformat() if a.created_at else None,
    }


# ---------------------------------------------------------------------------
# Thread + board side effects
# ---------------------------------------------------------------------------

def _emit(db: Session, workspace: Workspace, event: Event) -> None:
    from app.routers.network import _emit_event_blocking
    _emit_event_blocking(event, workspace, db, token=workspace.password_hash)


def _linked_task(db: Session, workspace_id: str, channel_name: str) -> Optional[KanbanTask]:
    if not channel_name.startswith(TASK_CHANNEL_PREFIX):
        return None
    return db.execute(
        select(KanbanTask).where(
            KanbanTask.workspace_id == workspace_id,
            KanbanTask.channel_name == channel_name,
        )
    ).scalar_one_or_none()


def _request_text(a: ApprovalRequest) -> str:
    """Plain-text rendering of the request — what history readers (other
    agents, bridges, search) see. The web UI renders the structured card."""
    who = {POLICY_ANY: "any member", POLICY_ADMIN: "an Admin", POLICY_OWNER: "the Owner"}.get(a.required_role, "a person")
    lines = [f"🔐 **Approval requested · {a.action}**"]
    if a.details:
        lines.append(f"```\n{a.details}\n```")
    meta = [f"kind: {a.kind}"]
    if a.risk:
        meta.append(f"risk: {a.risk}")
    if a.status == STATUS_PENDING:
        meta.append(f"needs: {who}")
    elif a.resolved_by == "policy":
        meta.append("auto-" + ("approved" if a.status == STATUS_APPROVED else "rejected") + " by policy")
    lines.append(" · ".join(meta))
    return "\n".join(lines)


def _resolution_text(a: ApprovalRequest, actor_label: str) -> str:
    verdict = "✅ Approved" if a.status == STATUS_APPROVED else "❌ Rejected"
    text = f"@{a.requested_by} {verdict}: {a.action}"
    if a.note:
        text += f"\n{a.note}"
    return text


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def create_request(
    db: Session,
    workspace: Workspace,
    *,
    channel_name: str,
    agent: str,
    kind: str,
    action: str,
    details: Optional[str] = None,
    risk: Optional[str] = None,
) -> ApprovalRequest:
    """File an approval request, apply policy, post it into the thread.

    Does NOT commit — the caller owns the transaction (the notification's push
    fires only after that commit lands).
    """
    ws_id = str(workspace.id)
    rules = effective_rules(db, ws_id, channel_name)
    policy = policy_for(rules, kind)

    a = ApprovalRequest(
        workspace_id=ws_id,
        channel_name=channel_name,
        requested_by=agent,
        kind=kind,
        action=action.strip(),
        details=(details or "").strip() or None,
        risk=risk if risk in RISKS else None,
        required_role=policy if policy in _REQUIRED_MIN_ROLE else POLICY_ANY,
        status=STATUS_PENDING,
    )
    if policy == POLICY_ALLOW:
        a.status = STATUS_APPROVED
        a.resolved_by = "policy"
        a.resolved_at = _now()
    elif policy == POLICY_BLOCK:
        a.status = STATUS_REJECTED
        a.resolved_by = "policy"
        a.resolved_at = _now()
        a.note = "Blocked by workspace policy."
    db.add(a)
    db.flush()

    # Post into the thread. `message_type: approval` keeps it out of routing
    # (see workspace_mod) — the request is addressed to people, not agents.
    event = Event(
        type="workspace.message.posted",
        source=f"openagents:{agent}",
        target=f"channel/{channel_name}",
        payload={
            "content": _request_text(a),
            "message_type": "approval",
            "approval": serialize(a),
        },
        metadata={"approval_id": a.id},
    )
    a.request_event_id = event.id
    _emit(db, workspace, event)

    if a.status == STATUS_PENDING:
        task = _linked_task(db, ws_id, channel_name)
        if task is not None and task.status != "need_input":
            task.status = "need_input"
        notify(
            db,
            ws_id,
            source=f"openagents:{agent}",
            title=f"Approval requested · {a.action}",
            message=f"{agent} needs {'an Admin' if a.required_role == POLICY_ADMIN else 'the Owner' if a.required_role == POLICY_OWNER else 'someone'} to approve: {a.action}",
            priority="high",
            channel_name=channel_name,
            reason=REASON_APPROVAL,
        )
    db.flush()
    return a


def resolve(
    db: Session,
    workspace: Workspace,
    approval: ApprovalRequest,
    *,
    approve: bool,
    actor_id: str,
    actor_label: str,
    actor_role: Optional[str],
    note: Optional[str] = None,
) -> ApprovalRequest:
    """Approve or reject a pending request and tell the agent in-thread.

    ``actor_id`` is what goes on the record (email, or "token"); ``actor_label``
    is the name shown in the thread. Raises ValueError if not pending. Does
    NOT commit.
    """
    if approval.status != STATUS_PENDING:
        raise ValueError(f"approval is already {approval.status}")

    approval.status = STATUS_APPROVED if approve else STATUS_REJECTED
    approval.resolved_by = actor_id
    approval.resolved_by_role = actor_role
    approval.resolved_at = _now()
    approval.note = (note or "").strip() or None
    db.flush()

    # A regular human message @mentioning the agent: routed exactly like any
    # other human reply, so the agent (blocked in request_approval, or idle)
    # picks the decision up through its normal poll.
    event = Event(
        type="workspace.message.posted",
        source=f"human:{actor_id}",
        target=f"channel/{approval.channel_name}",
        payload={
            "content": _resolution_text(approval, actor_label),
            "message_type": "chat",
            "sender_type": "human",
            "sender_name": actor_label,
            "sender_id": actor_id,
            "mentions": [approval.requested_by],
            "approval": serialize(approval),
        },
        metadata={"approval_id": approval.id, "target_agents": [approval.requested_by]},
    )
    approval.resolution_event_id = event.id
    _emit(db, workspace, event)

    # The card was parked while the person decided; either answer unblocks the
    # agent, so back to In Progress.
    task = _linked_task(db, str(workspace.id), approval.channel_name)
    if task is not None and task.status == "need_input":
        task.status = "in_progress"
    db.flush()
    return approval


def pending_for_agent(db: Session, workspace_id: str) -> dict:
    """``{agent_name: count}`` of pending requests — drives the amber
    "waiting for approval" presence dot."""
    rows = db.execute(
        select(ApprovalRequest.requested_by).where(
            ApprovalRequest.workspace_id == workspace_id,
            ApprovalRequest.status == STATUS_PENDING,
        )
    ).scalars().all()
    out: dict = {}
    for name in rows:
        out[name] = out.get(name, 0) + 1
    return out
