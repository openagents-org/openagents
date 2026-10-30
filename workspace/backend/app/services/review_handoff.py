"""Honor explicitly configured reviewer duties once per human request."""
import re
from sqlalchemy import select
from app.models import Channel, EventRecord, WorkspaceMember
from app.services.thread_activity import sender_email
from app.services.thread_agent_requests import request_access


def reviews_agent(description, agent_name):
    text = (description or '').strip()
    prefix = r'(?:(?:请|帮我|请帮我|负责|你负责|主要负责)\s*)?(?:审核|审查|复核|检查)|(?:(?:please|you should|your role is to)\s+)?(?:review|audit|verify)\s+'
    return bool(re.match(rf'^(?:{prefix})\s*@?{re.escape(agent_name)}(?![\w-])', text, re.I)) or bool(
        re.match(rf'^(?:请|帮我|请帮我|负责|你负责|主要负责)?\s*(?:审核|审查|复核|检查)\s*@?{re.escape(agent_name)}(?=这|的|所|\s|$)', text))


def reviewer_targets(db, workspace, channel, event):
    from app.config import config
    if not config.AUTOMATIC_REVIEW_HANDOFF_ENABLED:
        return []
    if channel.response_mode == 'passive' or channel.orchestration_mode == 'workflow':
        return []
    if not event.source.startswith('openagents:') or (event.payload or {}).get('message_type', 'chat') != 'chat':
        return []
    if not str((event.payload or {}).get('content') or '').strip():
        return []
    executor = event.source.removeprefix('openagents:')
    # Serialize deduplication with the message transaction.
    db.execute(select(Channel).where(Channel.id == channel.id).with_for_update()).scalar_one()
    root = db.execute(select(EventRecord).where(EventRecord.network_id == workspace.id,
        EventRecord.target == f'channel/{channel.name}', EventRecord.type == 'workspace.message.posted',
        EventRecord.source.like('human:%')).order_by(EventRecord.timestamp.desc()).limit(1)).scalar_one_or_none()
    if not root or (root.payload or {}).get('message_type', 'chat') != 'chat':
        return []
    meta = root.metadata_ or {}
    if meta.get('target_agents') != [executor] or 'review_dispatched' in meta:
        return []
    if event.metadata.get('in_reply_to') and event.metadata['in_reply_to'] != root.id:
        return []
    text = re.sub(r'^@[\w.-]+\s*', '', str((root.payload or {}).get('content') or '').strip())
    if re.fullmatch(r'(?:hi|hello|hey|thanks|thank you|ok|test|你好|谢谢|好的|测试)[\s!.?！。？]*', text, re.I):
        return []
    requester = sender_email(root)
    if not requester:
        return []
    names = [p.agent_name for p in channel.participants or [] if p.agent_name != executor]
    members = db.execute(select(WorkspaceMember).where(WorkspaceMember.workspace_id == workspace.id,
        WorkspaceMember.agent_name.in_(names), WorkspaceMember.status != 'removed')).scalars().all()
    from app.services.thread_collaboration import settings
    roles = settings(db, workspace.id, channel.name) if config.THREAD_COLLABORATION_ENABLED else {}
    targets, blocked = [], []
    for member in members:
        configured = roles.get(member.agent_name)
        should_review = configured.get('review_after') == executor if configured is not None else reviews_agent(member.description, executor)
        if not should_review:
            continue
        # Never bypass per-request owner approval during an automatic follow-up.
        if request_access(db, workspace.id, channel, member, requester) != 'yes':
            blocked.append(member.agent_name)
        else:
            targets.append(member.agent_name)
    if targets or blocked:
        root.metadata_ = {**meta, 'review_dispatched': targets, 'review_blocked': blocked}
        event.metadata['review_handoff'] = {'request_id': root.id, 'reviewers': targets, 'blocked': blocked}
        event.metadata['requester_email'] = requester
    return targets
