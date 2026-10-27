"""Personal-only boundaries for the server-managed Yumi assistant."""
from fastapi import HTTPException
from sqlalchemy import select

from app.models import Channel, ChannelMember, CloudAgentConfig, WorkspaceMember

PERSONAL_ONLY = "Yumi is your personal assistant. Open a direct conversation with Yumi instead."


def is_yumi(db, workspace_id, name):
    # A user's ordinary agent named yumi is not the built-in assistant.
    if name != "yumi":
        return False
    return db.execute(select(WorkspaceMember.agent_name).join(
        CloudAgentConfig,
        (CloudAgentConfig.workspace_id == WorkspaceMember.workspace_id)
        & (CloudAgentConfig.agent_name == WorkspaceMember.agent_name),
    ).where(
        WorkspaceMember.workspace_id == str(workspace_id),
        WorkspaceMember.agent_name == name,
        WorkspaceMember.agent_type == "cloud:openagents",
        CloudAgentConfig.provider == "openagents",
    )).first() is not None


def personal_channels(db, workspace_id):
    """Legacy one-to-one/welcome threads; mixed team threads remain team threads.

    Treat these as private at read time, even if an old default made them
    public. No data rewrite or deletion of conversation history is needed.
    """
    if not is_yumi(db, workspace_id, "yumi"):
        return []
    return list(db.execute(select(Channel).where(
        Channel.workspace_id == str(workspace_id),
        Channel.owner_email.is_not(None),
        Channel.owner_email != "",
        Channel.id.in_(select(ChannelMember.channel_id).where(ChannelMember.agent_name == "yumi")),
        ~Channel.id.in_(select(ChannelMember.channel_id).where(
            ChannelMember.agent_name.notin_(["yumi", "__no_response__"]))),
    )).scalars())


def is_personal_channel(db, channel):
    if not channel.owner_email:
        return False
    names = set(db.execute(select(ChannelMember.agent_name).where(
        ChannelMember.channel_id == channel.id,
    )).scalars()) - {"__no_response__"}
    return names == {"yumi"} and is_yumi(db, channel.workspace_id, "yumi")


def require_group_agent(db, workspace_id, name):
    if is_yumi(db, workspace_id, name):
        raise HTTPException(403, PERSONAL_ONLY)


def require_shareable_channel(db, channel):
    if is_personal_channel(db, channel):
        raise HTTPException(403, "Personal Yumi conversations cannot be shared or have participants added.")


def may_invoke(db, workspace_id, event):
    target = event.get("target") or ""
    source = event.get("source") or ""
    if target.startswith("channel/"):
        channel = db.execute(select(Channel).where(
            Channel.workspace_id == str(workspace_id), Channel.name == target[8:],
        )).scalar_one_or_none()
        return channel is not None and is_personal_channel(db, channel)
    # Human DMs have their own per-person history and visibility rules.
    return target == "openagents:yumi" and source.startswith("human:")
