"""Identify a human message's account across mobile and desktop clients."""


def human_sender_email(payload: dict | None, metadata: dict | None = None) -> str | None:
    """Return the email used for channel membership and self-push filtering.

    Mobile sends ``sender_email`` in the payload. The embedded Workspace UI
    sends its account email as ``sender_id``; the native Launcher sends it in
    metadata so its installed workspace client need not be updated first.
    Non-email sender IDs remain anonymous to the push system.
    """
    payload = payload if isinstance(payload, dict) else {}
    metadata = metadata if isinstance(metadata, dict) else {}
    for raw in (
        payload.get("sender_email"),
        metadata.get("sender_email"),
        payload.get("sender_id"),
    ):
        if not isinstance(raw, str):
            continue
        email = raw.strip().lower()
        parts = email.split("@")
        if len(parts) == 2 and all(parts) and not any(c.isspace() for c in email):
            return email
    return None
