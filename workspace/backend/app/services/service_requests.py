"""Hold routed service requests until the configured person approves them."""
from copy import deepcopy

from sqlalchemy import select
from openagents.core.onm_events import Event
from openagents.core.onm_mods import PipelineContext
from app.models import ApprovalRequest, WorkspaceMember, Channel, AgentService
from app.services import approvals
from app.services.notify import notify, REASON_APPROVAL
from app.services.people_notify import dm_session_id

KIND = "service_request"
THREAD_KIND = "thread_agent_request"
ISSUE_KIND = "issue_agent_request"


async def gate_requests(event, context):
    if event.type != "workspace.message.posted" or (event.payload or {}).get("message_type", "chat") != "chat":
        return event
    db, workspace = context.extra["db"], context.extra["workspace"]
    targets = list((event.metadata or {}).get("target_agents") or [])
    if not targets or targets == ["__no_response__"]:
        return event
    from types import SimpleNamespace
    members = db.execute(select(WorkspaceMember).where(
        WorkspaceMember.workspace_id == workspace.id,
        WorkspaceMember.agent_name.in_(targets),
        WorkspaceMember.status != "removed",
    )).scalars().all()
    channel_row = None
    if event.target.startswith("channel/"):
        channel_row = db.execute(select(Channel).where(Channel.workspace_id == workspace.id, Channel.name == event.target[8:])).scalar_one_or_none()
    gated = []
    if channel_row and channel_row.service_id:
        service = db.get(AgentService, channel_row.service_id)
        gated = [SimpleNamespace(agent_name=service.agent_name, display_name=service.name,
                 request_approver_email=service.request_approver_email, kind=KIND)] if service and service.request_approver_email else []
    else:
        from app.services.thread_agent_requests import request_access, blocked_notice
        from app.services.message_identity import human_sender_email
        email = human_sender_email(event.payload or {}, event.metadata)
        for member in members:
            reviewer = member.request_approver_email
            kind = KIND
            if channel_row and event.source.startswith("human:") and (email or context.extra.get("bearer_token")):
                access = request_access(db, workspace.id, channel_row, member, email)
                if access == "no":
                    if member.agent_name not in (event.metadata.get("blocked_agents") or []):
                        blocked_notice(db, workspace, channel_row, member)
                    targets = [name for name in targets if name != member.agent_name]
                    continue
                if access == "approval":
                    from app.services.thread_agent_requests import issue_for_work
                    reviewer = member.owner_email
                    kind = ISSUE_KIND if issue_for_work(db, channel_row) else THREAD_KIND
            if reviewer:
                gated.append(SimpleNamespace(agent_name=member.agent_name, display_name=member.display_name,
                             request_approver_email=reviewer, kind=kind))
    event.metadata["target_agents"] = targets or ["__no_response__"]
    members = gated
    if not members:
        return event
    from app.pipeline_factory import pipeline
    channel = event.target[8:] if event.target.startswith("channel/") else dm_session_id(event.source, event.target)
    snapshot = {"source": event.source, "target": event.target, "payload": deepcopy(event.payload),
                "metadata": deepcopy(event.metadata), "visibility": getattr(event.visibility, "value", event.visibility)}
    for member in members:
        reviewer = member.request_approver_email
        request = ApprovalRequest(workspace_id=str(workspace.id), channel_name=channel,
            requested_by=member.agent_name, kind=member.kind, action=f"Start a task with {member.display_name or member.agent_name}",
            details=(event.payload or {}).get("content", ""), required_role="any", assignee_email=reviewer,
            status="pending", policy_requirements={"members": [reviewer], "approved_by": [],
                "role_required": None, "role_approved": False, "service_trigger": snapshot,
                "trigger_event_id": event.id, "agent_owner": reviewer if member.kind in (THREAD_KIND, ISSUE_KIND) else None})
        db.add(request)
        db.flush()
        card = Event(type="workspace.message.posted", source=event.source, target=event.target, visibility=event.visibility,
            payload={"content": approvals._request_text(request), "message_type": "approval",
                     "approval": approvals.serialize(request)},
            metadata={"approval_id": request.id, "target_agents": ["__no_response__"]})
        request.request_event_id = card.id
        card_context = PipelineContext(network_id=str(workspace.id), agent_address=card.source,
            db=db, workspace=workspace, token=workspace.password_hash)
        await pipeline.process(card, card_context)
        task = approvals._linked_task(db, str(workspace.id), channel)
        if task is not None:
            task.status = "need_input"
        notify(db, str(workspace.id), source="system:approval", title=request.action,
            message=f"Approval from {reviewer} is required before {member.display_name or member.agent_name} starts this request.",
            priority="high", channel_name=channel, reason=REASON_APPROVAL,
            recipient_email=reviewer, kind="approval", action_ref=request.id)
        targets = [target for target in targets if target != member.agent_name]
    event.metadata["target_agents"] = targets or ["__no_response__"]
    return event


def release_request(db, workspace, approval, actor_label):
    """Called only after the locked request passes its reviewer checks."""
    import asyncio
    from app.pipeline_factory import pipeline
    original = approval.policy_requirements["service_trigger"]
    accepted = approval.status == approvals.STATUS_APPROVED
    channel_row = db.execute(select(Channel).where(Channel.workspace_id == workspace.id, Channel.name == approval.channel_name)).scalar_one_or_none()
    if accepted and approval.kind in (THREAD_KIND, ISSUE_KIND):
        from app.services.thread_agent_requests import request_access
        from app.services.access_model import channel_participant_emails
        from app.models import ChannelMember
        from fastapi import HTTPException
        member = db.get(WorkspaceMember, (str(workspace.id), approval.requested_by))
        email = (original.get("payload") or {}).get("sender_email")
        owner = approval.policy_requirements.get("agent_owner")
        from app.services.thread_agent_requests import issue_for_work
        people = channel_participant_emails(db, channel_row) if channel_row else set()
        issue = issue_for_work(db, channel_row)
        if approval.kind == ISSUE_KIND:
            from app.routers.issues import _participants, _linked_channels
            people = {p["source"].removeprefix("human:") for p in _participants(db, issue, _linked_channels(db, issue)) if p["source"].startswith("human:")} if issue else set()
        if (not channel_row or not member or member.owner_email != owner
                or email not in people
                or owner not in people
                or not db.get(ChannelMember, (channel_row.id, member.agent_name))
                or request_access(db, workspace.id, channel_row, member, email) == "no"):
            raise HTTPException(403, "Agent sharing changed; this request can no longer start.")
    if accepted and channel_row and channel_row.service_id:
        from app.routers.agent_services import can_use_service
        from app.services.visibility import Viewer
        service = db.get(AgentService, channel_row.service_id)
        email = (original.get("payload") or {}).get("sender_email")
        if not service or not can_use_service(db, str(workspace.id), Viewer(False, email), service):
            from fastapi import HTTPException
            raise HTTPException(403, "Service access was revoked; request cannot start")
    payload = deepcopy(original["payload"]) if accepted else {}
    payload.update({"message_type": "chat" if accepted else "approval", "approval": approvals.serialize(approval)})
    payload["content"] = (f"Approved by {actor_label}. Task request:\n{payload.get('content', '')}"
                          if accepted else f"Task request rejected by {actor_label}.")
    event = Event(type="workspace.message.posted", source=original["source"], target=original["target"], visibility=original.get("visibility") or "channel",
        payload=payload, metadata={**original.get("metadata", {}), "approval_id": approval.id,
            "target_agents": [approval.requested_by] if accepted else ["__no_response__"]})
    approval.resolution_event_id = event.id
    context = PipelineContext(network_id=str(workspace.id), agent_address=event.source, db=db,
        workspace=workspace, token=workspace.password_hash,
        approved_service_agent=approval.requested_by if accepted else None)
    asyncio.run(pipeline.process(event, context))
    task = approvals._linked_task(db, str(workspace.id), approval.channel_name)
    if accepted and task is not None and task.status == "need_input":
        task.status = "in_progress"
    db.flush()
