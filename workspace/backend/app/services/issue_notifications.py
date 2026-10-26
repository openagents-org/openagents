"""Address completed issue work to the human who requested that turn."""

from sqlalchemy import select

from app.models import Channel, EventRecord, Issue, IssueThread, NotificationRecord, Workspace
from app.services.access_model import Principal, can_view_channel, role_for_email
from app.services.notify import notify


def notify_issue_completion(db, workspace_id: str, event: dict) -> bool:
    """Handle issue completions before generic thread push fan-out.

    The persisted reply's requester was resolved by workspace_mod from the
    routed human request. Never substitute the issue owner or agent owner.
    Lock the event to serialize duplicate deliveries, without a schema change.
    Returns True for a linked issue completion even when no recipient remains.
    """
    from app.services.push import _COMPLETED_STATUS_KINDS, _is_intermediate_step, _structured_status_kind

    if event.get('type') != 'workspace.message.posted' or not str(event.get('source', '')).startswith('openagents:'):
        return False
    record = db.scalar(select(EventRecord).where(
        EventRecord.id == event.get('id'), EventRecord.network_id == workspace_id,
    ).with_for_update())
    if not record or record.type != 'workspace.message.posted' or not record.source.startswith('openagents:'):
        return False
    payload = record.payload or {}
    content = str(payload.get('content') or '').strip()
    kind = _structured_status_kind({'payload': payload, 'metadata': record.metadata_})
    if (payload.get('message_type', 'chat') != 'chat' or not content or _is_intermediate_step(content)
            or (kind and kind not in _COMPLETED_STATUS_KINDS)):
        return False
    if not record.target.startswith('channel/'):
        return False
    channel = db.scalar(select(Channel).where(
        Channel.workspace_id == workspace_id, Channel.name == record.target[len('channel/'):],
        Channel.status != 'deleted',
    ))
    if not channel:
        return False
    issues = db.scalars(select(Issue).join(IssueThread, IssueThread.issue_id == Issue.id).where(
        Issue.workspace_id == workspace_id, IssueThread.channel_id == channel.id,
    )).all()
    if not issues:
        return False
    requester = str((record.metadata_ or {}).get('requester_email') or '').strip().lower()
    workspace = db.get(Workspace, workspace_id)
    role = role_for_email(db, workspace, requester) if requester and workspace else None
    if not role or not can_view_channel(db, workspace_id, Principal('human', email=requester, role=role, workspace_id=workspace_id), channel):
        return True
    for issue in issues:
        ref = f'{record.id}:{issue.id}'
        if db.scalar(select(NotificationRecord.id).where(
            NotificationRecord.workspace_id == workspace_id,
            NotificationRecord.kind == 'issue_completed', NotificationRecord.action_ref == ref,
            NotificationRecord.recipient_email == requester,
        )):
            continue
        name = record.source.split(':', 1)[1]
        notify(db, workspace_id, source=record.source,
               title=f'{name} finished work on your issue',
               message=f'{issue.title}\n{content[:240]}',
               channel_name=channel.name,
               link_url=f'/{workspace.slug or workspace.id}/issues/{issue.id}',
               recipient_email=requester, kind='issue_completed', action_ref=ref)
    return True
