"""Per-thread permission to request work from another person's agent."""
from sqlalchemy import select
from app.models import ChannelAgentSharing, ChannelMember
from app.services.access_model import Principal, explain, resource_for_agent, channel_participant_emails, active_grants


def sharing_mode(setting):
    if setting and getattr(setting, "enabled", False):
        return "yes"
    return setting.mode if setting and setting.mode in ("yes", "approval") else "no"


def request_access(db, workspace_id, channel, member, email):
    if not member or member.status == "removed" or not email:
        return "no"
    # Explicit agent grants remain independent of this thread-only setting.
    principal = Principal("human", email=email, workspace_id=str(workspace_id))
    if explain(db, principal, resource_for_agent(member), "act", str(workspace_id), include_thread_sharing=False).allowed:
        return "yes"
    if not channel or channel.service_id:
        return "no"
    owner = (member.owner_email or "").strip().lower()
    people = channel_participant_emails(db, channel)
    if (channel.status != "deleted" and email in people and owner in people
            and db.get(ChannelMember, (channel.id, member.agent_name))):
        grants = active_grants(db, str(workspace_id), "thread_agent", f"{channel.id}:{member.agent_name}", ("human", email))
        if any("act" in (grant.rights or []) and grant.granted_by == f"human:{owner}" for grant in grants):
            return "yes"
    issue = issue_for_work(db, channel)
    if issue:
        return issue_request_access(db, workspace_id, issue, member, email)
    people = channel_participant_emails(db, channel)
    owner = (member.owner_email or "").strip().lower()
    if email not in people or owner not in people:
        return "no"
    if not db.get(ChannelMember, (channel.id, member.agent_name)):
        return "no"
    return sharing_mode(db.get(ChannelAgentSharing, (channel.id, owner)))


def blocked_notice(db, workspace, channel, member):
    from app.mods.workspace_mod import _post_system_notice
    from app.models import User
    owner = (member.owner_email or "").strip().lower()
    person = db.execute(select(User).where(User.email == owner)).scalar_one_or_none() if owner else None
    owner_label = (person.display_name if person else None) or owner or "the agent's owner"
    _post_system_notice(db, workspace, channel.name,
        f"Your message was posted, but {member.display_name or member.agent_name} wasn’t asked to work. "
        f"Ask {owner_label} to enable sharing or require approval in this thread’s settings.",
        notice="agent_access_required")


def shared_agent_names(db, workspace_id):
    """Agents whose owners have enabled sharing in a thread they still belong to."""
    from sqlalchemy import or_, func
    from app.models import WorkspaceMember, Channel, ChannelHumanMember
    shared = set(db.execute(select(WorkspaceMember.agent_name)
        .join(ChannelMember, ChannelMember.agent_name == WorkspaceMember.agent_name)
        .join(Channel, Channel.id == ChannelMember.channel_id)
        .join(ChannelAgentSharing, ChannelAgentSharing.channel_id == Channel.id)
        .join(ChannelHumanMember, ChannelHumanMember.channel_id == Channel.id)
        .where(WorkspaceMember.workspace_id == str(workspace_id), Channel.workspace_id == str(workspace_id),
               WorkspaceMember.status != "removed", Channel.service_id.is_(None),
               ChannelAgentSharing.owner_email == func.lower(WorkspaceMember.owner_email),
               ChannelHumanMember.user_email == ChannelAgentSharing.owner_email,
               or_(ChannelAgentSharing.enabled.is_(True), ChannelAgentSharing.mode == "approval"))
    ).scalars().all())

    from app.models import Issue, IssueAgentSharing
    from app.routers.issues import _participants, _linked_channels
    settings = db.execute(select(IssueAgentSharing, Issue).join(Issue, Issue.id == IssueAgentSharing.issue_id)
        .where(Issue.workspace_id == str(workspace_id), IssueAgentSharing.mode.in_(["yes", "approval"]))).all()
    members = db.execute(select(WorkspaceMember).where(WorkspaceMember.workspace_id == str(workspace_id), WorkspaceMember.status != "removed")).scalars().all()
    for setting, issue in settings:
        roster = {person["source"] for person in _participants(db, issue, _linked_channels(db, issue))}
        if f"human:{setting.owner_email}" not in roster:
            continue
        shared.update(member.agent_name for member in members
            if (member.owner_email or "").lower() == setting.owner_email and f"openagents:{member.agent_name}" in roster)
    return shared


def issue_for_work(db, channel):
    from app.models import Issue, IssueThread
    if not channel:
        return None
    if channel.name.startswith("task:"):
        from app.models import KanbanTask
        return db.execute(select(Issue).join(KanbanTask, KanbanTask.issue_id == Issue.id)
            .where(KanbanTask.channel_name == channel.name,
                   KanbanTask.workspace_id == channel.workspace_id,
                   Issue.workspace_id == channel.workspace_id)).scalars().first()
    if not channel.name.startswith("issue-work-"):
        return None
    return db.execute(select(Issue).join(IssueThread, IssueThread.issue_id == Issue.id)
        .where(IssueThread.channel_id == channel.id, Issue.workspace_id == channel.workspace_id)).scalars().first()


def issue_request_access(db, workspace_id, issue, member, email):
    from app.models import IssueAgentSharing
    from app.routers.issues import _participants, _linked_channels
    if not member or member.status == "removed" or not email:
        return "no"
    if explain(db, Principal("human", email=email, workspace_id=str(workspace_id)),
               resource_for_agent(member), "act", str(workspace_id), include_thread_sharing=False).allowed:
        return "yes"
    roster = {p["source"] for p in _participants(db, issue, _linked_channels(db, issue))}
    owner = (member.owner_email or "").strip().lower()
    if not {f"human:{owner}", f"human:{email}", f"openagents:{member.agent_name}"}.issubset(roster):
        return "no"
    return sharing_mode(db.get(IssueAgentSharing, (issue.id, owner)))
