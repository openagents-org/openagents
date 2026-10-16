"""Owner-reviewed requests for direct access to one agent."""
from fastapi import HTTPException
from sqlalchemy import select
from openagents.core.onm_events import Event
from app.models import ApprovalRequest, Channel, ChannelMember, WorkspaceMember
from app.services import approvals
from app.services.access_model import channel_participant_emails, create_grant
from app.services.notify import notify, REASON_APPROVAL

KIND = "agent_sharing_request"
THREAD_KIND = "thread_agent_access_request"


def pending_request(db, workspace_id, channel, agent, email, *, thread_only=False):
    return db.execute(select(ApprovalRequest).where(
        ApprovalRequest.workspace_id == workspace_id,
        ApprovalRequest.channel_name == channel,
        ApprovalRequest.requested_by == agent,
        ApprovalRequest.kind == (THREAD_KIND if thread_only else KIND),
        ApprovalRequest.status == "pending",
        ApprovalRequest.policy_requirements["share_requester"].as_string() == email,
    )).scalars().first()


def create_request(db, workspace, channel, member, requester, requester_label, *, thread_only=False):
    existing = pending_request(db, str(workspace.id), channel.name, member.agent_name, requester, thread_only=thread_only)
    if existing:
        return existing
    owner = member.owner_email.strip().lower()
    agent = member.display_name or member.agent_name
    request = ApprovalRequest(workspace_id=str(workspace.id), channel_name=channel.name,
        requested_by=member.agent_name, kind=THREAD_KIND if thread_only else KIND, action=f"Share {agent} with {requester_label}",
        details=(f"Allow {requester_label} to request work from {agent} only in this thread. "
                "This does not grant direct chat, access in other threads, or access to other agents." if thread_only else f"Allow {requester_label} to chat directly with {agent} and add it to threads. "
                "This shares only this agent, not other agents or existing private conversations. "
                "You can revoke access in the agent's sharing settings."),
        required_role="any", assignee_email=owner, status="pending",
        policy_requirements={"members": [owner], "approved_by": [], "role_required": None,
                             "role_approved": False, "share_requester": requester, "agent_owner": owner, "share_scope": "thread" if thread_only else "direct"})
    db.add(request)
    db.flush()
    card = Event(type="workspace.message.posted", source=f"human:{requester}",
        target=f"channel/{channel.name}",
        payload={"content": approvals._request_text(request), "message_type": "approval",
                 "sender_type": "human", "sender_name": requester_label, "sender_email": requester,
                 "approval": approvals.serialize(request)},
        metadata={"approval_id": request.id, "target_agents": ["__no_response__"]})
    request.request_event_id = card.id
    approvals._emit(db, workspace, card)
    notify(db, str(workspace.id), source="system:approval", title=request.action,
        message=f"{requester_label} requested access to {agent}.", priority="high",
        channel_name=channel.name, reason=REASON_APPROVAL, recipient_email=owner,
        kind="approval", action_ref=request.id)
    return request


def resolve_request(db, workspace, request, actor_id, actor_label):
    from app.routers.sharing import _is_workspace_member
    policy = request.policy_requirements or {}
    owner = policy.get("agent_owner")
    requester = policy.get("share_requester")
    if actor_id != owner:
        raise HTTPException(403, "Only the agent owner may decide this sharing request")
    if request.status == approvals.STATUS_APPROVED:
        # Lock the agent against ownership changes while consent is applied.
        member = db.execute(select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace.id,
            WorkspaceMember.agent_name == request.requested_by).with_for_update()).scalar_one_or_none()
        channel = db.execute(select(Channel).where(Channel.workspace_id == workspace.id,
            Channel.name == request.channel_name, Channel.status != "deleted")).scalar_one_or_none()
        people = channel_participant_emails(db, channel) if channel else set()
        if (not member or member.status == "removed" or (member.owner_email or "").lower() != owner
                or not channel or requester not in people or owner not in people
                or not db.get(ChannelMember, (channel.id, request.requested_by))
                or not _is_workspace_member(db, workspace, requester)):
            raise HTTPException(403, "Ownership or thread membership changed; request sharing again")
        thread_only = request.kind == THREAD_KIND
        if policy.get("share_scope") == "thread" and not thread_only:
            raise HTTPException(409, "Thread access requires a thread-scoped request")
        create_grant(db, str(workspace.id), resource_kind="thread_agent" if thread_only else "agent",
            resource_id=f"{channel.id}:{member.agent_name}" if thread_only else member.agent_name,
            grantee_kind="human", grantee_id=requester, rights=["read", "act"],
            granted_by=f"human:{owner}", note=f"Approved sharing request {request.id}")
    event = Event(type="workspace.message.posted", source=f"human:{actor_id}",
        target=f"channel/{request.channel_name}",
        payload={"content": approvals._resolution_text(request, actor_label), "message_type": "approval",
                 "sender_type": "human", "sender_name": actor_label,
                 "approval": approvals.serialize(request)},
        metadata={"approval_id": request.id, "target_agents": ["__no_response__"]})
    request.resolution_event_id = event.id
    approvals._emit(db, workspace, event)
