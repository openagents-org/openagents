"""Shared utilities for adapter implementations."""
import re
from typing import Optional

SESSION_DEFAULT_RE = re.compile(r"^(Session \d+|session-[0-9a-f]+|channel-[0-9a-f]+)$")


def generate_session_title(message: str, max_words: int = 6) -> str:
    """Generate a short session title from the first user message.

    Strategy:
    1. Strip markdown/code fences
    2. Take the first sentence (up to sentence-ending punctuation)
    3. Fall back to first max_words words
    4. Strip leading filler words
    5. Capitalize first letter, cap at 50 chars
    """
    # Collapse whitespace, strip code blocks
    text = re.sub(r"\s+", " ", message).strip()
    text = re.sub(r"```[\s\S]*?```", "", text).strip()
    text = re.sub(r"`[^`]+`", "", text).strip()

    if not text:
        return ""

    # Try to get first sentence
    sentence_match = re.match(r"^(.+?[.!?])\s", text)
    if sentence_match:
        text = sentence_match.group(1).rstrip(".!?").strip()

    # Take first max_words words
    words = text.split()
    if len(words) > max_words:
        words = words[:max_words]
        text = " ".join(words)

    # Strip common filler prefixes
    filler_re = re.compile(
        r"^(hey|hi|hello|please|can you|could you|"
        r"i need you to|i want you to)\s+",
        re.IGNORECASE,
    )
    text = filler_re.sub("", text).strip()

    # Capitalize first letter
    if text:
        text = text[0].upper() + text[1:]

    # Hard cap at 50 characters
    if len(text) > 50:
        text = text[:47] + "..."

    return text


def format_attachments_for_prompt(attachments: list[dict]) -> Optional[str]:
    """Format attachment metadata into text to append to an agent prompt.

    Returns None if no attachments. Otherwise returns a text block describing
    each attachment with its file_id and content type so the agent can use
    workspace_read_file to access them.
    """
    if not attachments:
        return None

    lines = ["\n[Attached files]"]
    for att in attachments:
        filename = att.get("filename", "unknown")
        file_id = att.get("fileId", "")
        content_type = att.get("contentType", "")
        if content_type.startswith("image/"):
            lines.append(
                f"- Image: {filename} (file_id: {file_id}) — "
                f"use workspace_read_file to view this image"
            )
        else:
            lines.append(
                f"- File: {filename} (file_id: {file_id}, type: {content_type}) — "
                f"use workspace_read_file to read this file"
            )
    return "\n".join(lines)
