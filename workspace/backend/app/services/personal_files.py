"""Default organization only; file ownership and visibility remain independent."""
from urllib.parse import quote
from app.services.thread_activity import reply_requester


def personal_folder(email):
    return f"people/{quote(email.strip().lower(), safe='@')}" if email else None


def default_file_folder(db, workspace_id, viewer, channel_name=None):
    if viewer.kind == "human" and viewer.email:
        return personal_folder(viewer.email)
    if viewer.kind == "agent":
        requester = None
        if channel_name:
            requester = reply_requester(db, str(workspace_id), f"openagents:{viewer.agent_name}",
                                        f"channel/{channel_name}", {})
        return personal_folder(requester or viewer.owner_email)
    return None
